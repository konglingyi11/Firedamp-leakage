import { ref, shallowRef, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { resolveRenderPixelRatio } from '@/components/three/renderQuality'
import {
  getScene,
  releaseScene,
  addFrameCallback,
  removeFrameCallback,
  addPostRenderCallback,
  removePostRenderCallback,
} from '@/utils/sceneManager'

let bvhPatched = false

function ensureBvhPatch() {
  if (bvhPatched) return
  if (!THREE.BufferGeometry.prototype.computeBoundsTree) {
    THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
    THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
    THREE.Mesh.prototype.raycast = acceleratedRaycast
  }
  bvhPatched = true
}

export function useThreeScene(options = {}) {
  const {
    background = '#06111d',
    fogColor = '#06111d',
    fogNear = 5000,
    fogFar = 15000,
    cameraFov = 45,
    cameraNear = 0.1,
    cameraFar = 20000,
    cameraPosition = [8, -10, 8],
    cameraUp = [0, 0, 1],
    controlsTarget = [0, 0, 0],
    controlsMinDistance = 0.1,
    controlsMaxDistance = 500,
    gridSize = 12000,
    gridDivisions = 12,
    gridColor1 = '#2c8cb4',
    gridColor2 = '#123144',
    gridOpacity = 0.2,
  } = options

  ensureBvhPatch()

  const hostRef = ref(null)

  const sceneInstance = shallowRef(null)
  const renderer = shallowRef(null)
  const scene = shallowRef(null)
  const camera = shallowRef(null)
  const controls = shallowRef(null)
  const raycaster = shallowRef(null)
  const clock = shallowRef(null)

  const rootGroup = shallowRef(null)
  const planeGroup = shallowRef(null)
  const volumeGroup = shallowRef(null)
  const streamlineGroup = shallowRef(null)
  const particleGroup = shallowRef(null)
  const smokeGroup = shallowRef(null)
  const boundsGroup = shallowRef(null)
  const overlayGroup = shallowRef(null)
  const axisGroup = shallowRef(null)
  const modelGroup = shallowRef(null)
  const monitoringPointsGroup = shallowRef(null)
  const radarResultPreviewGroup = shallowRef(null)

  const geometryBounds = ref(null)
  const AXIS_HELPERS_GROUP_NAME = '__xyzAxisHelpers'
  const GROUND_PLANE_BOUNDS_OFFSET = 0.04

  function createGroups() {
    rootGroup.value = new THREE.Group()
    rootGroup.value.name = 'root'

    planeGroup.value = new THREE.Group()
    planeGroup.value.name = 'plane'

    volumeGroup.value = new THREE.Group()
    volumeGroup.value.name = 'volume'

    streamlineGroup.value = new THREE.Group()
    streamlineGroup.value.name = 'streamline'

    particleGroup.value = new THREE.Group()
    particleGroup.value.name = 'particle'

    smokeGroup.value = new THREE.Group()
    smokeGroup.value.name = 'smoke'

    boundsGroup.value = new THREE.Group()
    boundsGroup.value.name = 'bounds'

    overlayGroup.value = new THREE.Group()
    overlayGroup.value.name = 'overlay'

    axisGroup.value = new THREE.Group()
    axisGroup.value.name = 'axis'

    modelGroup.value = new THREE.Group()
    modelGroup.value.name = 'model'

    monitoringPointsGroup.value = new THREE.Group()
    monitoringPointsGroup.value.name = 'monitoringPoints'

    radarResultPreviewGroup.value = new THREE.Group()
    radarResultPreviewGroup.value.name = 'radarResultPreview'
  }

  function createAxisHelpers(group) {
    const grid = new THREE.GridHelper(
      gridSize,
      gridDivisions,
      gridColor1,
      gridColor2,
    )
    grid.rotation.x = Math.PI / 2
    grid.position.set(0, 0, 0)
    grid.material.opacity = gridOpacity
    grid.material.transparent = true
    grid.name = AXIS_HELPERS_GROUP_NAME
    group.add(grid)
  }

  function ensureScene() {
    if (sceneInstance.value) return sceneInstance.value

    const inst = getScene()
    sceneInstance.value = inst
    scene.value = inst.scene
    renderer.value = inst.renderer
    camera.value = inst.camera
    controls.value = inst.controls
    raycaster.value = inst.raycaster
    clock.value = inst.clock

    scene.value.background = new THREE.Color(background)
    scene.value.fog = new THREE.Fog(fogColor, fogNear, fogFar)

    if (!camera.value) {
      camera.value = new THREE.PerspectiveCamera(
        cameraFov,
        1,
        cameraNear,
        cameraFar,
      )
      camera.value.position.set(...cameraPosition)
      camera.value.up.set(...cameraUp)
      inst.camera = camera.value
    }

    if (!controls.value && renderer.value) {
      controls.value = new OrbitControls(camera.value, renderer.value.domElement)
      controls.value.enableDamping = true
      controls.value.dampingFactor = 0.08
      controls.value.target.set(...controlsTarget)
      controls.value.minDistance = controlsMinDistance
      controls.value.maxDistance = controlsMaxDistance
      inst.controls = controls.value
    }

    if (!raycaster.value) {
      raycaster.value = new THREE.Raycaster()
      inst.raycaster = raycaster.value
    }

    createGroups()

    scene.value.add(rootGroup.value)
    rootGroup.value.add(planeGroup.value)
    rootGroup.value.add(volumeGroup.value)
    rootGroup.value.add(streamlineGroup.value)
    rootGroup.value.add(particleGroup.value)
    rootGroup.value.add(smokeGroup.value)
    rootGroup.value.add(boundsGroup.value)
    rootGroup.value.add(overlayGroup.value)
    rootGroup.value.add(monitoringPointsGroup.value)
    scene.value.add(axisGroup.value)
    scene.value.add(modelGroup.value)

    createAxisHelpers(axisGroup.value)

    renderer.value.setPixelRatio(
      resolveRenderPixelRatio({ devicePixelRatio: window.devicePixelRatio }),
    )
    renderer.value.outputColorSpace = THREE.SRGBColorSpace

    return sceneInstance.value
  }

  function attachRenderer() {
    if (!hostRef.value || !renderer.value) return
    const host = hostRef.value
    if (renderer.value.domElement.parentElement !== host) {
      host.innerHTML = ''
      host.appendChild(renderer.value.domElement)
    }
    resizeRenderer()
  }

  function resizeRenderer() {
    if (!hostRef.value || !renderer.value || !camera.value) return
    const width = hostRef.value.clientWidth || 1
    const height = hostRef.value.clientHeight || 1
    renderer.value.setSize(width, height, false)
    camera.value.aspect = width / height
    camera.value.updateProjectionMatrix()
  }

  function resetCamera() {
    if (!camera.value || !controls.value) return
    camera.value.position.set(...cameraPosition)
    camera.value.up.set(...cameraUp)
    controls.value.target.set(...controlsTarget)
    controls.value.update()
  }

  function dispose() {
    if (sceneInstance.value) {
      releaseScene()
      sceneInstance.value = null
    }
    scene.value = null
    renderer.value = null
    camera.value = null
    controls.value = null
    raycaster.value = null
    clock.value = null
    rootGroup.value = null
    planeGroup.value = null
    volumeGroup.value = null
    streamlineGroup.value = null
    particleGroup.value = null
    smokeGroup.value = null
    boundsGroup.value = null
    overlayGroup.value = null
    axisGroup.value = null
    modelGroup.value = null
    monitoringPointsGroup.value = null
    radarResultPreviewGroup.value = null
  }

  onBeforeUnmount(() => {
    dispose()
  })

  return {
    hostRef,
    sceneInstance,
    renderer,
    scene,
    camera,
    controls,
    raycaster,
    clock,

    rootGroup,
    planeGroup,
    volumeGroup,
    streamlineGroup,
    particleGroup,
    smokeGroup,
    boundsGroup,
    overlayGroup,
    axisGroup,
    modelGroup,
    monitoringPointsGroup,
    radarResultPreviewGroup,

    geometryBounds,
    AXIS_HELPERS_GROUP_NAME,
    GROUND_PLANE_BOUNDS_OFFSET,

    ensureScene,
    attachRenderer,
    resizeRenderer,
    resetCamera,
    dispose,

    addFrameCallback,
    removeFrameCallback,
    addPostRenderCallback,
    removePostRenderCallback,
  }
}
