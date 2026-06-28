<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  viewMode: { type: String, default: 'perspective' },
})

const wrapRef = ref(null)
const canvasRef = ref(null)
const showAnnotations = ref(true)
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
})

let renderer
let scene
let camera
let frameId = 0
let resizeObserver
let pulseRings = []
let rayLines = []
let wavefronts = []
let echoWavefronts = []
let echoFlashes = []
let menuPointerOpened = false

const RADAR_SOURCE = new THREE.Vector3(-1.78, 0.55, -0.65)
const WAVEFRONT_ARC_START = -1.12
const WAVEFRONT_ARC_END = 1.12
const WAVEFRONT_POINT_COUNT = 48
const ECHO_POINTS = [
  new THREE.Vector3(1.55, 0.62, -0.25),
  new THREE.Vector3(1.15, 0.55, 0.35),
  new THREE.Vector3(0.95, 0.64, -0.5),
]

function makeMat(color, opacity = 1, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    roughness: 0.65,
    metalness: 0.05,
    ...extra,
  })
}

function buildHeatmapTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const stops = [
    { x: 0.2, y: 0.48, r: 0.22, c: '#ff2a00' },
    { x: 0.34, y: 0.56, r: 0.26, c: '#ffd400' },
    { x: 0.52, y: 0.52, r: 0.28, c: '#00e676' },
    { x: 0.68, y: 0.42, r: 0.3, c: '#0091ff' },
    { x: 0.82, y: 0.64, r: 0.2, c: '#142cff' },
  ]
  ctx.fillStyle = '#0a1e3d'
  ctx.fillRect(0, 0, size, size)
  stops.forEach(({ x, y, r, c }) => {
    const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size)
    g.addColorStop(0, c)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  })
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

function addRoom(group) {
  const wallMat = makeMat('#6f8295', 0.25, { side: THREE.DoubleSide, depthWrite: false })
  const obstacleMat = makeMat('#8d9bab', 0.52, { depthWrite: false })
  const edgeMat = new THREE.LineBasicMaterial({ color: '#9bb5ce', transparent: true, opacity: 0.55 })
  const gridMat = new THREE.LineBasicMaterial({ color: '#5ec8ff', transparent: true, opacity: 0.18 })

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshStandardMaterial({
      map: buildHeatmapTexture(),
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0
  group.add(floor)

  const floorGrid = new THREE.GridHelper(4, 16, '#4fd5ff', '#4fd5ff')
  floorGrid.position.y = 0.01
  floorGrid.material = gridMat
  group.add(floorGrid)

  const floorEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(4, 3)),
    edgeMat,
  )
  floorEdge.rotation.x = -Math.PI / 2
  floorEdge.position.y = 0.002
  group.add(floorEdge)

  const wallDefs = [
    { w: 4, h: 1.5, d: 0.06, x: 0, y: 0.75, z: -1.5 },
    { w: 4, h: 1.5, d: 0.06, x: 0, y: 0.75, z: 1.5 },
    { w: 0.06, h: 1.5, d: 3, x: -2, y: 0.75, z: 0 },
    { w: 0.06, h: 1.5, d: 1.2, x: 2, y: 0.75, z: -0.9 },
    { w: 0.06, h: 1.5, d: 1.8, x: 2, y: 0.75, z: 0.6 },
    { w: 1.2, h: 1.5, d: 0.06, x: -0.5, y: 0.75, z: 0.15 },
    { w: 0.9, h: 1.5, d: 0.06, x: 0.95, y: 0.75, z: -0.5 },
  ]
  wallDefs.forEach(({ w, h, d, x, y, z }) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
    mesh.position.set(x, y, z)
    group.add(mesh)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat)
    edges.position.copy(mesh.position)
    group.add(edges)
  })

  const obstacles = [
    { size: [0.45, 0.85, 0.42], pos: [0.35, 0.43, 0.38] },
    { size: [0.55, 0.48, 0.36], pos: [-0.55, 0.24, -0.04] },
    { size: [0.22, 0.72, 0.5], pos: [1.15, 0.36, 0.35] },
  ]
  obstacles.forEach(({ size, pos }) => {
    const geo = new THREE.BoxGeometry(...size)
    const mesh = new THREE.Mesh(geo, obstacleMat)
    mesh.position.set(...pos)
    group.add(mesh)
    const obsEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: '#d3e5ff', transparent: true, opacity: 0.75 }),
    )
    obsEdges.position.copy(mesh.position)
    group.add(obsEdges)
  })
}

function addRadarSource(group) {
  const src = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 20, 20),
    makeMat('#ff3344', 1, { emissive: '#aa0011', emissiveIntensity: 1.4 }),
  )
  src.position.copy(RADAR_SOURCE)
  group.add(src)

  pulseRings = []
  for (let i = 0; i < 5; i += 1) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12 + i * 0.14, 0.14 + i * 0.14, 48),
      new THREE.MeshBasicMaterial({
        color: '#00c8ff',
        transparent: true,
        opacity: 0.55 - i * 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    ring.rotation.y = Math.PI / 2
    ring.position.set(-1.72 + i * 0.05, 0.55, -0.65)
    pulseRings.push(ring)
    group.add(ring)
  }
}

function addRayPaths(group) {
  rayLines = []
  const paths = [
    [[-1.78, 0.55, -0.65], [-0.35, 0.7, -1.46], [1.55, 0.62, -0.25], [1.82, 0.42, 0.7]],
    [[-1.78, 0.55, -0.65], [-1.1, 0.58, 1.35], [0.3, 0.42, 1.16], [1.55, 0.5, 0.2]],
    [[-1.78, 0.55, -0.65], [-0.18, 0.95, -0.25], [0.82, 0.5, -1.42], [1.6, 0.4, -0.65]],
    [[-1.78, 0.55, -0.65], [-0.7, 0.34, 0.52], [0.45, 0.3, 0.05], [1.44, 0.35, 1.05]],
    [[-1.78, 0.55, -0.65], [-0.2, 0.48, 0.82], [0.95, 0.72, 0.15], [1.68, 0.48, -1.05]],
  ]
  const colors = ['#ffd740', '#29d5ff', '#ffd740', '#29d5ff', '#ffd740']
  paths.forEach((pts, i) => {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
      new THREE.LineBasicMaterial({ color: colors[i], transparent: true, opacity: 0.75 }),
    )
    rayLines.push(line)
    group.add(line)
  })
}

function addWavefronts(group) {
  wavefronts = []
  for (let i = 0; i < 7; i += 1) {
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: i % 3 === 0 ? '#ffad5a' : i % 3 === 1 ? '#ffe27a' : '#74e8ff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    )
    line.userData.wavePhase = i / 7
    line.userData.waveJitter = (i % 3) * 0.025
    updateWavefrontGeometry(line, i / 7)
    wavefronts.push(line)
    group.add(line)
  }
}

function addEchoWavefronts(group) {
  echoWavefronts = []
  echoFlashes = []
  ECHO_POINTS.forEach((point, i) => {
    const flash = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.105, 42),
      new THREE.MeshBasicMaterial({
        color: i === 0 ? '#fff1a6' : '#ffb36a',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    flash.position.copy(point)
    flash.rotation.y = Math.PI / 2
    flash.userData.echoPhase = i / ECHO_POINTS.length
    echoFlashes.push(flash)
    group.add(flash)

    for (let k = 0; k < 2; k += 1) {
      const line = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color: k === 0 ? '#ffd45a' : '#ff8f4a',
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      )
      line.userData.echoPoint = point
      line.userData.echoPhase = (i / ECHO_POINTS.length + k * 0.16) % 1
      line.userData.echoLane = k
      updateEchoWavefrontGeometry(line, 0)
      echoWavefronts.push(line)
      group.add(line)
    }
  })
}

function updateWavefrontGeometry(line, phase) {
  const pts = []
  const radiusX = 0.18 + phase * 1.65
  const radiusY = 0.24 + phase * 1.38
  const forwardX = 0.04 + phase * 0.86
  const verticalLift = Math.sin(phase * Math.PI) * 0.08 + (line.userData.waveJitter || 0)

  for (let i = 0; i <= WAVEFRONT_POINT_COUNT; i += 1) {
    const a =
      WAVEFRONT_ARC_START +
      ((WAVEFRONT_ARC_END - WAVEFRONT_ARC_START) * i) / WAVEFRONT_POINT_COUNT
    pts.push(
      new THREE.Vector3(
        RADAR_SOURCE.x + forwardX + Math.cos(a) * radiusX,
        RADAR_SOURCE.y + verticalLift + Math.sin(a) * radiusY,
        RADAR_SOURCE.z + Math.sin(a * 0.42) * 0.18,
      ),
    )
  }

  line.geometry.dispose()
  line.geometry = new THREE.BufferGeometry().setFromPoints(pts)
}

function updateEchoWavefrontGeometry(line, phase) {
  const hit = line.userData.echoPoint || ECHO_POINTS[0]
  const lane = line.userData.echoLane || 0
  const pts = []
  const radiusY = 0.12 + phase * (0.64 + lane * 0.12)
  const radiusZ = 0.1 + phase * (0.52 + lane * 0.1)
  const bow = 0.04 + phase * 0.18
  const centerX = hit.x - phase * (1.32 + lane * 0.16)

  for (let i = 0; i <= WAVEFRONT_POINT_COUNT; i += 1) {
    const a =
      WAVEFRONT_ARC_START +
      ((WAVEFRONT_ARC_END - WAVEFRONT_ARC_START) * i) / WAVEFRONT_POINT_COUNT
    pts.push(
      new THREE.Vector3(
        centerX - Math.cos(a) * bow,
        hit.y + Math.sin(a) * radiusY,
        hit.z + Math.cos(a) * radiusZ,
      ),
    )
  }

  line.geometry.dispose()
  line.geometry = new THREE.BufferGeometry().setFromPoints(pts)
}

function echoEnvelope(phase) {
  const fadeIn = Math.min(phase / 0.18, 1)
  const fadeOut = Math.min((1 - phase) / 0.36, 1)
  return Math.max(0, fadeIn * fadeOut)
}

function applyViewMode() {
  if (!camera) return
  if (props.viewMode === 'top') {
    camera.position.set(0, 8, 0.01)
    camera.lookAt(0, 0, 0)
  } else if (props.viewMode === 'section') {
    camera.position.set(0, 2.2, 6.5)
    camera.lookAt(0, 0.6, 0)
  } else {
    camera.position.set(-3.3, 2.55, 3.85)
    camera.lookAt(0, 0.4, 0)
  }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function openContextMenu(event) {
  if (!wrapRef.value) return
  event.preventDefault()
  const rect = wrapRef.value.getBoundingClientRect()
  showContextMenu(event.clientX - rect.left, event.clientY - rect.top)
}

function openContextMenuFromPointer(event) {
  if (event.button !== 2) return
  menuPointerOpened = true
  openContextMenu(event)
}

function openContextMenuFromButton(event) {
  if (!wrapRef.value) return
  const wrapRect = wrapRef.value.getBoundingClientRect()
  const buttonRect = event.currentTarget.getBoundingClientRect()
  showContextMenu(buttonRect.right - wrapRect.left - 168, buttonRect.bottom - wrapRect.top + 8)
}

function showContextMenu(left, top) {
  if (!wrapRef.value) return
  const rect = wrapRef.value.getBoundingClientRect()
  const menuWidth = 168
  const menuHeight = 148
  const x = Math.min(Math.max(8, left), Math.max(8, rect.width - menuWidth - 8))
  const y = Math.min(Math.max(8, top), Math.max(8, rect.height - menuHeight - 8))

  contextMenu.value = {
    visible: true,
    x,
    y,
  }
}

function handleWrapPointerDown(event) {
  if (event.button === 2 || menuPointerOpened) {
    menuPointerOpened = false
    return
  }
  if (!contextMenu.value.visible) return
  if (event.target.closest?.('.scene-context-menu')) return
  closeContextMenu()
}

function resetCameraView() {
  applyViewMode()
  closeContextMenu()
}

function toggleAnnotations() {
  showAnnotations.value = !showAnnotations.value
  closeContextMenu()
}

function copyCameraParams() {
  if (!camera) return
  const data = {
    position: camera.position.toArray().map((v) => Number(v.toFixed(3))),
    rotation: camera.rotation.toArray().slice(0, 3).map((v) => Number(v.toFixed(3))),
    viewMode: props.viewMode,
  }
  navigator.clipboard?.writeText(JSON.stringify(data, null, 2))
  closeContextMenu()
}

function downloadSnapshot() {
  if (!renderer || !scene || !camera) return
  renderer.render(scene, camera)
  const link = document.createElement('a')
  link.href = renderer.domElement.toDataURL('image/png')
  link.download = `leida-scene-${Date.now()}.png`
  link.click()
  closeContextMenu()
}

function handleKeydown(event) {
  if (event.key === 'Escape') closeContextMenu()
}

function resize() {
  if (!renderer || !camera || !wrapRef.value) return
  const { width, height } = wrapRef.value.getBoundingClientRect()
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

function animate() {
  frameId = requestAnimationFrame(animate)
  const t = performance.now() * 0.001
  pulseRings.forEach((ring, i) => {
    const s = 1 + Math.sin(t * 2.8 - i * 0.5) * 0.12
    ring.scale.set(s, s, 1)
    ring.material.opacity = 0.2 + Math.abs(Math.sin(t * 2.2 + i * 0.7)) * 0.45
  })
  wavefronts.forEach((line, i) => {
    const phase = (t * 0.24 + line.userData.wavePhase) % 1
    const fadeIn = Math.min(phase / 0.16, 1)
    const fadeOut = Math.min((1 - phase) / 0.28, 1)
    updateWavefrontGeometry(line, phase)
    line.material.opacity = (0.12 + Math.sin(phase * Math.PI) * 0.62) * fadeIn * fadeOut
    line.material.linewidth = 1 + Math.sin(phase * Math.PI) * 1.5
  })
  echoWavefronts.forEach((line) => {
    const phase = (t * 0.3 + line.userData.echoPhase) % 1
    const envelope = echoEnvelope(phase)
    updateEchoWavefrontGeometry(line, phase)
    line.material.opacity = (0.1 + Math.sin(phase * Math.PI) * 0.56) * envelope
  })
  echoFlashes.forEach((flash, i) => {
    const phase = (t * 0.3 + flash.userData.echoPhase) % 1
    const pulse = Math.max(0, 1 - phase / 0.28)
    const scale = 0.8 + Math.sin(Math.min(phase / 0.28, 1) * Math.PI) * 1.8
    flash.scale.setScalar(scale)
    flash.material.opacity = pulse * (0.38 + i * 0.06)
  })
  rayLines.forEach((line, i) => {
    const flow = (Math.sin(t * 2.4 - i * 0.9) + 1) * 0.5
    line.material.opacity = 0.22 + flow * 0.58
  })
  renderer.render(scene, camera)
}

function init() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#0b1628')
  scene.fog = new THREE.Fog('#0b1628', 8, 18)

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50)
  applyViewMode()

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  scene.add(new THREE.AmbientLight('#8eb4d8', 1.1))
  const dir = new THREE.DirectionalLight('#ffffff', 1.8)
  dir.position.set(4, 6, 3)
  scene.add(dir)
  const fill = new THREE.PointLight('#00b4ff', 0.6, 12)
  fill.position.set(-2, 2, 2)
  scene.add(fill)

  const root = new THREE.Group()
  addRoom(root)
  addRadarSource(root)
  addRayPaths(root)
  addWavefronts(root)
  addEchoWavefronts(root)
  scene.add(root)

  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(wrapRef.value)
  animate()
}

onMounted(init)

watch(() => props.viewMode, applyViewMode)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', closeContextMenu)
  wrapRef.value?.addEventListener('pointerdown', openContextMenuFromPointer, true)
  wrapRef.value?.addEventListener('mousedown', openContextMenuFromPointer, true)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId)
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', closeContextMenu)
  wrapRef.value?.removeEventListener('pointerdown', openContextMenuFromPointer, true)
  wrapRef.value?.removeEventListener('mousedown', openContextMenuFromPointer, true)
  renderer?.dispose()
})

defineExpose({ applyViewMode })
</script>

<template>
  <div
    ref="wrapRef"
    class="leida-scene-wrap"
    @contextmenu.prevent="openContextMenu"
    @pointerdown="handleWrapPointerDown">
    <canvas ref="canvasRef" class="leida-scene-canvas" />
    <div class="scene-quick-actions">
      <button
        type="button"
        class="scene-quick-btn"
        title="场景菜单"
        @click.stop="openContextMenuFromButton">
        菜单
      </button>
      <button
        type="button"
        class="scene-quick-btn"
        :class="{ active: showAnnotations }"
        :title="showAnnotations ? '隐藏场景标注' : '显示场景标注'"
        @click.stop="toggleAnnotations">
        标注
      </button>
    </div>
    <div v-if="showAnnotations" class="scene-labels">
      <span class="lbl lbl-wall" style="left: 28%; top: 10%">墙体</span>
      <span class="lbl lbl-cavity" style="left: 74%; top: 13%">空腔</span>
      <span class="lbl lbl-obs" style="left: 74%; top: 51%">障碍物</span>
      <span class="lbl lbl-floor" style="left: 66%; top: 73%">地板</span>
      <span class="lbl lbl-radar" style="left: 18%; top: 45%">雷达源<br>（收发一体）</span>
    </div>
    <div class="axis-corner">
      <span class="axis z">Z 轴</span>
      <span class="axis y">Y 轴</span>
      <span class="axis x">X 轴</span>
    </div>
    <div class="scene-dim dim-height">1.5 米</div>
    <div class="scene-dim dim-width">2.0 米</div>
    <div class="scene-dim dim-depth">2.0 米</div>
    <div
      v-if="contextMenu.visible"
      class="scene-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @pointerdown.stop>
      <button type="button" @click="resetCameraView">重置当前视角</button>
      <button type="button" @click="toggleAnnotations">
        {{ showAnnotations ? '隐藏场景标注' : '显示场景标注' }}
      </button>
      <button type="button" @click="copyCameraParams">复制相机参数</button>
      <button type="button" @click="downloadSnapshot">导出视口截图</button>
    </div>
  </div>
</template>

<style scoped>
.leida-scene-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 4px;
  background: radial-gradient(ellipse at 50% 40%, rgba(20, 60, 110, 0.35), transparent 60%);
}

.leida-scene-wrap::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(rgba(90, 160, 230, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(90, 160, 230, 0.07) 1px, transparent 1px);
  background-size: 38px 38px;
  mask-image: radial-gradient(circle at center, black 0%, transparent 76%);
}

.leida-scene-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.scene-quick-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 7;
  display: flex;
  gap: 6px;
}

.scene-quick-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(96, 178, 255, 0.34);
  border-radius: 3px;
  background: rgba(6, 18, 34, 0.78);
  color: rgba(232, 242, 255, 0.78);
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(6px);
}

.scene-quick-btn:hover,
.scene-quick-btn.active {
  border-color: rgba(96, 178, 255, 0.66);
  background: rgba(28, 115, 220, 0.36);
  color: #fff;
}

.scene-context-menu {
  position: absolute;
  z-index: 8;
  width: 168px;
  padding: 6px;
  border: 1px solid rgba(96, 178, 255, 0.42);
  border-radius: 4px;
  background: rgba(5, 15, 30, 0.96);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.38), inset 0 0 18px rgba(42, 140, 255, 0.12);
  backdrop-filter: blur(8px);
}

.scene-context-menu button {
  display: block;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #e8f2ff;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.scene-context-menu button:hover {
  background: rgba(36, 135, 245, 0.26);
  color: #fff;
}

.scene-labels .lbl {
  position: absolute;
  padding: 2px 8px;
  font-size: 11px;
  color: #d8ecff;
  background: rgba(8, 20, 40, 0.72);
  border: 1px solid rgba(80, 180, 255, 0.35);
  border-radius: 3px;
  pointer-events: none;
  white-space: nowrap;
}

.scene-labels .lbl::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  width: 58px;
  height: 1px;
  background: rgba(235, 245, 255, 0.65);
  transform: rotate(20deg);
  transform-origin: left center;
}

.lbl-radar {
  color: #ff8a80;
  border-color: rgba(255, 100, 100, 0.45);
}

.axis-corner {
  position: absolute;
  left: 42px;
  bottom: 34px;
  z-index: 2;
  width: 58px;
  height: 58px;
  border-left: 2px solid #2aa8ff;
  border-bottom: 2px solid #ff4f4f;
}

.axis-corner::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 46px;
  height: 2px;
  background: #7ee061;
  transform: rotate(-30deg);
  transform-origin: left center;
}

.axis {
  position: absolute;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
}

.axis.z {
  left: -5px;
  top: -16px;
  color: #2aa8ff;
}

.axis.y {
  right: -3px;
  bottom: 18px;
  color: #7ee061;
}

.axis.x {
  right: -5px;
  bottom: -13px;
  color: #ff6b6b;
}

.scene-dim {
  position: absolute;
  z-index: 2;
  color: rgba(235, 245, 255, 0.9);
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.8);
}

.dim-height {
  right: 52px;
  top: 48%;
}

.dim-width {
  left: 35%;
  bottom: 11%;
}

.dim-depth {
  right: 12%;
  bottom: 16%;
}
</style>
