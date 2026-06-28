import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { resolveRenderPixelRatio } from './renderQuality'

export function ensureThreeSceneShell({
  scene,
  camera,
  renderer,
  controls,
  raycaster,
  rootGroup,
  planeGroup,
  dynamicGroup,
  boundsGroup,
  overlayGroup,
  monitoringPointsGroup,
  ambientLight,
  keyLight,
  fillLight,
  rimLight,
  axisGroup,
  modelGroup,
  createAxisHelpers,
  loadModel,
  onControlsReady,
}) {
  if (scene) return { scene, camera, renderer, controls, raycaster }

  scene = new THREE.Scene()
  scene.background = new THREE.Color('#06111d')
  scene.fog = new THREE.Fog('#06111d', 5000, 15000)
  scene.add(rootGroup)
  rootGroup.add(planeGroup)
  rootGroup.add(dynamicGroup)
  rootGroup.add(boundsGroup)
  rootGroup.add(overlayGroup)
  rootGroup.add(monitoringPointsGroup)
  scene.add(ambientLight)
  scene.add(keyLight)
  scene.add(fillLight)
  scene.add(rimLight)
  scene.add(axisGroup)
  scene.add(modelGroup)

  const grid = new THREE.GridHelper(12000, 12, '#2c8cb4', '#123144')
  grid.rotation.x = Math.PI / 2
  grid.position.set(0, 0, 0)
  grid.material.opacity = 0.2
  grid.material.transparent = true
  axisGroup.add(grid)

  createAxisHelpers(axisGroup)
  loadModel()

  raycaster = new THREE.Raycaster()

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000)
  camera.position.set(8, -10, 8)
  camera.up.set(0, 0, 1)

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(
    resolveRenderPixelRatio({ devicePixelRatio: window.devicePixelRatio }),
  )
  renderer.outputColorSpace = THREE.SRGBColorSpace

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)
  controls.minDistance = 0.1
  controls.maxDistance = 500
  onControlsReady?.(controls)

  return { scene, camera, renderer, controls, raycaster }
}

export function attachThreeRenderer({
  host,
  renderer,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onMouseClick,
  onKeyDown,
  onKeyUp,
  onResize,
}) {
  if (!host || !renderer) return
  if (renderer.domElement.parentElement !== host) {
    host.innerHTML = ''
    host.appendChild(renderer.domElement)
  }
  const canvas = renderer.domElement
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('click', onMouseClick)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  onResize?.()
}

export function resizeThreeRenderer({ host, renderer, camera }) {
  if (!host || !renderer || !camera) return
  const width = host.clientWidth || 1
  const height = host.clientHeight || 1
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

export function resetThreeCameraView({ camera, controls }) {
  if (!camera || !controls) return
  camera.position.set(8, -10, 8)
  camera.up.set(0, 0, 1)
  controls.target.set(0, 0, 0)
  controls.update()
}

export function startThreeAnimationLoop({
  clock,
  setAnimationFrameId,
  onFrame,
  renderer,
  scene,
  camera,
}) {
  const animate = () => {
    setAnimationFrameId(window.requestAnimationFrame(animate))
    const elapsed = clock.getElapsedTime()
    onFrame?.(elapsed)
    renderer?.render(scene, camera)
  }
  animate()
}

export function disposeThreeSceneShell({
  renderer,
  controls,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onMouseClick,
  onKeyDown,
  onKeyUp,
}) {
  controls?.dispose()
  if (renderer?.domElement) {
    renderer.domElement.removeEventListener('mousemove', onMouseMove)
    renderer.domElement.removeEventListener('mousedown', onMouseDown)
    renderer.domElement.removeEventListener('mouseup', onMouseUp)
    renderer.domElement.removeEventListener('click', onMouseClick)
  }
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  renderer?.dispose()
  if (renderer?.domElement?.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement)
  }
}
