<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { Aim, ArrowLeft, Box, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import modelApi, { unwrapApiModel } from '@/api/model.js'

const route = useRoute()
const router = useRouter()
const containerRef = ref(null)
const loading = ref(false)
const modelDetail = ref(null)
const activeKind = ref('geometry')
const errorText = ref('')

let scene
let camera
let renderer
let controls
let modelRoot
let resizeObserver
let animationId = 0
let lastFrameAt = 0
let textureLoader = null
const animationMixers = []
const textureCache = new Map()

const MODEL_PREVIEW_CONFIGS = {
  geometry: {
    key: 'geometry',
    layerKind: 'model',
    rotation: [Math.PI / 2, 0, 0],
  },
  real: {
    key: 'real',
    layerKind: 'realModel',
    rotation: [Math.PI / 2, 0, 0],
  },
}

const REAL_MODEL_TEXTURES = {
  cz_Inst: {
    map: '/材质/房子/initialShadingGroup_Base_color.png',
    normalMap: '/材质/房子/initialShadingGroup_Normal_OpenGL.png',
    roughnessMap: '/材质/房子/initialShadingGroup_Roughness.png',
  },
  MI_riAmD: {
    map: '/材质/砖/T_riAmD_2K_B.PNG',
    normalMap: '/材质/砖/T_riAmD_2K_N.PNG',
    roughnessMap: '/材质/砖/T_riAmD_2K_ORM.PNG',
    aoMap: '/材质/砖/T_riAmD_2K_ORM.PNG',
  },
  MI_texcdfcda: {
    map: '/材质/木板/T_texcdfcda_2K_B.PNG',
    normalMap: '/材质/木板/T_texcdfcda_2K_N.PNG',
    roughnessMap: '/材质/木板/T_texcdfcda_2K_ORM.PNG',
    aoMap: '/材质/木板/T_texcdfcda_2K_ORM.PNG',
  },
  Wood_001: {
    map: '/材质/椅子/low_poly_old_wood_chair_texture_1.PNG',
  },
  NewMaterial_Inst: {
    map: '/材质/桌子/Table_BaseColor.PNG',
  },
}

const modelTitle = computed(() => modelDetail.value?.name || `模型 ${route.params.id}`)
const previewSources = computed(() => ({
  geometry:
    modelDetail.value?.geometry_model_url ||
    modelDetail.value?.geometry_model_file ||
    '',
  real:
    modelDetail.value?.real_model_url || modelDetail.value?.real_model_file || '',
}))
const activeSource = computed(() => previewSources.value[activeKind.value] || '')
const activeKindLabel = computed(() =>
  activeKind.value === 'geometry' ? '几何模型' : '真实模型',
)

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.filter(Boolean).forEach((material) => material.dispose?.())
  })
}

function clearModel() {
  animationMixers.splice(0)
  if (!modelRoot || !scene) return
  scene.remove(modelRoot)
  disposeObject(modelRoot)
  modelRoot = null
}

function ensureModelMaterial(root) {
  root.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    if (child.material) return
    child.material = new THREE.MeshStandardMaterial({
      color: 0x9db3bd,
      roughness: 0.72,
      metalness: 0.08,
    })
  })
}

function applyModelBaseTransform(model, config) {
  const rotation = Array.isArray(config?.rotation) ? config.rotation : null
  model.rotation.set(
    Number(rotation?.[0]) || 0,
    Number(rotation?.[1]) || 0,
    Number(rotation?.[2]) || 0,
  )
  const position = Array.isArray(config?.position) ? config.position : null
  if (position) {
    model.position.set(
      Number(position[0]) || 0,
      Number(position[1]) || 0,
      Number(position[2]) || 0,
    )
  }
  const scale = Array.isArray(config?.scale) ? config.scale : null
  if (scale) {
    model.scale.set(
      Number.isFinite(Number(scale[0])) ? Number(scale[0]) : 1,
      Number.isFinite(Number(scale[1])) ? Number(scale[1]) : 1,
      Number.isFinite(Number(scale[2])) ? Number(scale[2]) : 1,
    )
  }
}

function getTextureLoader() {
  if (!textureLoader) {
    textureLoader = new THREE.TextureLoader()
  }
  return textureLoader
}

function loadModelTexture(url, colorSpace = THREE.NoColorSpace) {
  if (!url) return null
  const normalizedUrl = encodeURI(url)
  if (textureCache.has(normalizedUrl)) {
    return textureCache.get(normalizedUrl)
  }
  const texture = getTextureLoader().load(normalizedUrl)
  texture.colorSpace = colorSpace
  texture.flipY = false
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  textureCache.set(normalizedUrl, texture)
  return texture
}

function applyTextureSetToMaterial(material, textureSet) {
  if (!material || !textureSet) return
  if (textureSet.map) {
    material.map = loadModelTexture(textureSet.map, THREE.SRGBColorSpace)
    material.color?.set?.(0xffffff)
  }
  if (textureSet.normalMap) {
    material.normalMap = loadModelTexture(textureSet.normalMap)
  }
  if (textureSet.roughnessMap) {
    material.roughnessMap = loadModelTexture(textureSet.roughnessMap)
  }
  if (textureSet.aoMap) {
    material.aoMap = loadModelTexture(textureSet.aoMap)
  }
  material.needsUpdate = true
}

function normalizeMaterialKey(value) {
  return String(value || '').trim().toLowerCase()
}

function resolveRealModelTextureSet(material, mesh) {
  if (!material) return null
  if (REAL_MODEL_TEXTURES[material.name]) {
    return REAL_MODEL_TEXTURES[material.name]
  }

  const key = normalizeMaterialKey(
    [material.name, mesh?.name, mesh?.parent?.name].filter(Boolean).join(' '),
  )
  if (!key) return null

  if (key.includes('riamd') || key.includes('brick') || key.includes('砖')) {
    return REAL_MODEL_TEXTURES.MI_riAmD
  }
  if (key.includes('texcdfcda') || key.includes('plank') || key.includes('木板')) {
    return REAL_MODEL_TEXTURES.MI_texcdfcda
  }
  if (key.includes('wood_001') || key.includes('chair') || key.includes('椅')) {
    return REAL_MODEL_TEXTURES.Wood_001
  }
  if (key.includes('table') || key.includes('desk') || key.includes('桌')) {
    return REAL_MODEL_TEXTURES.NewMaterial_Inst
  }
  if (key.includes('cz') || key.includes('house') || key.includes('wall') || key.includes('房')) {
    return REAL_MODEL_TEXTURES.cz_Inst
  }
  return null
}

function applyRealModelTextures(model) {
  if (!model) return
  model.traverse((child) => {
    if (!child?.isMesh || !child.material) return
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material]
    for (const material of materials) {
      applyTextureSetToMaterial(material, resolveRealModelTextureSet(material, child))
    }
  })
}

function attachModelAnimations(model, animations) {
  if (!model || !Array.isArray(animations) || animations.length === 0) return
  const mixer = new THREE.AnimationMixer(model)
  for (const clip of animations) {
    if (!clip) continue
    mixer.clipAction(clip).play()
  }
  animationMixers.push(mixer)
}

function alignModelToGround(root) {
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  root.position.x -= center.x
  root.position.y -= center.y
  root.position.z -= box.min.z
}

function addStlMesh(geometry) {
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    color: 0xa8c7d1,
    roughness: 0.76,
    metalness: 0.04,
    side: THREE.DoubleSide,
  })
  return new THREE.Mesh(geometry, material)
}

async function parseModelByUrl(url) {
  const cleanPath = url.split('?')[0].split('#')[0].toLowerCase()
  if (cleanPath.endsWith('.glb') || cleanPath.endsWith('.gltf')) {
    const loader = new GLTFLoader()
    loader.setCrossOrigin('anonymous')
    loader.setResourcePath(getModelResourceBaseUrl(url))
    const gltf = await loader.loadAsync(url)
    return {
      model: gltf.scene,
      animations: Array.isArray(gltf.animations) ? gltf.animations : [],
    }
  }
  if (cleanPath.endsWith('.obj')) {
    return {
      model: await new OBJLoader().loadAsync(url),
      animations: [],
    }
  }
  if (cleanPath.endsWith('.stl')) {
    return {
      model: addStlMesh(await new STLLoader().loadAsync(url)),
      animations: [],
    }
  }
  if (cleanPath.endsWith('.fbx')) {
    const model = await new FBXLoader().loadAsync(url)
    return {
      model,
      animations: Array.isArray(model.animations) ? model.animations : [],
    }
  }
  throw new Error('暂不支持该模型格式，请上传 .glb / .gltf / .obj / .stl / .fbx')
}

function getModelResourceBaseUrl(url) {
  try {
    return new URL('.', new URL(url, window.location.href)).href
  } catch {
    const path = String(url || '').split('?')[0].split('#')[0]
    const slash = path.lastIndexOf('/')
    return slash >= 0 ? path.slice(0, slash + 1) : '/'
  }
}

function fitCameraToModel(root) {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const distance = maxDim * 2.2

  controls.target.copy(center)
  camera.position.set(center.x + distance, center.y - distance, center.z + distance * 0.75)
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  controls.update()
}

function resetCamera() {
  if (modelRoot) {
    fitCameraToModel(modelRoot)
  }
}

function resizeRenderer() {
  const container = containerRef.value
  if (!container || !renderer || !camera) return
  const width = Math.max(1, container.clientWidth)
  const height = Math.max(1, container.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function renderLoop() {
  animationId = window.requestAnimationFrame(renderLoop)
  const now = performance.now()
  const delta = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 0.05) : 0
  lastFrameAt = now
  for (const mixer of animationMixers) {
    mixer.update(delta)
  }
  controls?.update()
  renderer?.render(scene, camera)
}

async function loadActiveModel() {
  const url = activeSource.value
  clearModel()
  errorText.value = ''
  if (!url) {
    errorText.value = `当前模型没有上传${activeKindLabel.value}文件`
    return
  }

  loading.value = true
  try {
    const config = MODEL_PREVIEW_CONFIGS[activeKind.value]
    const loaded = await parseModelByUrl(url)
    modelRoot = loaded.model
    modelRoot.name = config.layerKind
    modelRoot.userData.layerKind = config.layerKind
    modelRoot.userData.gltfModelKey = config.key
    modelRoot.userData.gltfModelUrl = url
    modelRoot.userData.gltfAnimations = loaded.animations
    applyModelBaseTransform(modelRoot, config)
    ensureModelMaterial(modelRoot)
    if (config.key === 'real') {
      applyRealModelTextures(modelRoot)
    }
    attachModelAnimations(modelRoot, loaded.animations)
    alignModelToGround(modelRoot)
    scene.add(modelRoot)
    fitCameraToModel(modelRoot)
  } catch (error) {
    console.error('[model-preview]', error)
    errorText.value = error?.message || '模型加载失败'
  } finally {
    loading.value = false
  }
}

async function fetchModelDetail() {
  loading.value = true
  try {
    const res = await modelApi.getModelInfo(route.params.id)
    modelDetail.value = unwrapApiModel(res)
    await loadActiveModel()
  } catch (error) {
    console.error('[model-preview] 获取模型详情失败:', error)
    errorText.value = '获取模型详情失败'
    ElMessage.error(error?.message || '获取模型详情失败')
  } finally {
    loading.value = false
  }
}

async function initScene() {
  await nextTick()
  const container = containerRef.value
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d1423)

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 1000)
  camera.up.set(0, 0, 1)
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = false
  controls.zoomToCursor = true
  controls.rotateSpeed = 0.72
  controls.panSpeed = 0.82
  controls.minDistance = 0.02
  controls.maxDistance = 10000

  scene.add(new THREE.HemisphereLight(0xddeeff, 0x25313f, 1.6))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(4, -6, 5)
  scene.add(keyLight)
  const grid = new THREE.GridHelper(20, 40, 0x147b87, 0x1d3540)
  grid.rotation.x = Math.PI / 2
  scene.add(grid)

  resizeObserver = new ResizeObserver(resizeRenderer)
  resizeObserver.observe(container)
  resizeRenderer()
  renderLoop()
  await fetchModelDetail()
}

watch(activeKind, () => {
  loadActiveModel()
})

onMounted(initScene)

onBeforeUnmount(() => {
  if (animationId) window.cancelAnimationFrame(animationId)
  resizeObserver?.disconnect()
  controls?.dispose()
  clearModel()
  for (const texture of textureCache.values()) {
    texture?.dispose?.()
  }
  textureCache.clear()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <main class="model-preview-page">
    <header class="preview-toolbar">
      <el-button class="ghost-button" :icon="ArrowLeft" @click="router.back()">返回</el-button>
      <div class="title-block">
        <span>模型预览</span>
        <strong>{{ modelTitle }}</strong>
      </div>
      <el-segmented
        v-model="activeKind"
        class="kind-switch"
        :options="[
          { label: '几何模型', value: 'geometry' },
          { label: '真实模型', value: 'real' },
        ]" />
      <el-button class="ghost-button" :icon="Aim" @click="resetCamera">重置视角</el-button>
      <el-button class="ghost-button" :icon="Refresh" @click="loadActiveModel">重新加载</el-button>
    </header>

    <section class="preview-stage">
      <div ref="containerRef" class="viewer-canvas"></div>
      <div v-if="loading" class="state-layer">
        <el-icon class="state-icon"><Box /></el-icon>
        <span>加载{{ activeKindLabel }}中...</span>
      </div>
      <div v-else-if="errorText" class="state-layer">
        <el-icon class="state-icon"><Box /></el-icon>
        <span>{{ errorText }}</span>
      </div>
      <div class="source-strip">{{ activeSource || '未上传模型文件' }}</div>
    </section>
  </main>
</template>

<style scoped>
.model-preview-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  background: #0d1423;
  color: rgba(255, 255, 255, 0.92);
}

.preview-toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 16px;
  min-height: 72px;
  padding: 12px 22px;
  border-bottom: 1px solid rgba(0, 243, 255, 0.18);
  background: rgba(12, 20, 34, 0.96);
}

.title-block {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.title-block span {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
}

.title-block strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 20px;
}

.ghost-button {
  border-color: rgba(0, 243, 255, 0.26);
  background: rgba(0, 243, 255, 0.06);
  color: rgba(255, 255, 255, 0.86);
}

.kind-switch {
  --el-segmented-item-selected-bg-color: rgba(0, 243, 255, 0.24);
  --el-segmented-item-selected-color: #ffffff;
}

.preview-stage {
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.viewer-canvas {
  position: absolute;
  inset: 0;
}

.viewer-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.state-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  background: rgba(10, 16, 28, 0.56);
  color: rgba(255, 255, 255, 0.8);
}

.state-icon {
  color: rgba(0, 243, 255, 0.75);
  font-size: 38px;
}

.source-strip {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 16px;
  z-index: 3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(9, 14, 24, 0.72);
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
}

@media (max-width: 760px) {
  .preview-toolbar {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .kind-switch,
  .preview-toolbar .ghost-button:nth-last-child(2),
  .preview-toolbar .ghost-button:last-child {
    grid-column: 1 / -1;
  }
}
</style>
