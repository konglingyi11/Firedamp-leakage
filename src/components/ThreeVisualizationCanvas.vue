<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

// 共享 DRACOLoader 实例：解码 DRACO 压缩的 GLB（如 /采空区/1.glb）
// 解码器文件由 viteStaticCopy 在 dev/build 阶段拷贝到 /draco/gltf/ 下
const sharedDracoLoader = new DRACOLoader()
sharedDracoLoader.setDecoderPath('/draco/gltf/')
sharedDracoLoader.setWorkerLimit(4)
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import volumeCsvWorkerUrl from '@/workers/volumeCsvWorker.js?worker&url'
import { clearGroup, normalizeUrl } from './three/modes/shared'
import { createPlaneMode } from './three/modes/planeMode'
import { createVolumeMode } from './three/modes/volumeMode'
import { createStreamlineMode } from './three/modes/streamlineMode'
import { createParticleMode } from './three/modes/particleMode'
import { createBoundsMode } from './three/modes/boundsMode'
import { createVelocityFieldMode } from './three/modes/velocityFieldMode'
import { createModelDissolve } from './three/threeModelDissolve'
import { createSmokeSystem } from './three/threeSmokeSystem'
import { createPersonHighlight } from './three/threePersonHighlight'
import { createMonitoringPoints } from './three/threeMonitoringPoints'
import { createInfoPopups } from './three/threeInfoPopups'
import {
  createMeetingRoomMode,
  LOCAL_MEETING_ROOM_GEOMETRY_MODEL_URL,
  MEETING_ROOM_STANDING_IDLE_MODEL_URL,
  MEETING_ROOM_SURFACE_ROTATION_X,
  MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z,
  MEETING_ROOM_OVERALL_ROTATION_Z,
  MEETING_ROOM_FLOOR_ROTATION_Z,
} from './three/threeMeetingRoom'
import { isGoafTask } from '@/utils/taskType'
import { GasAccidentController } from '@/utils/gasAccident'
import { createGoafGasLeakSystem } from '@/composables/useGoafGasLeak'
import {
  getScene,
  releaseScene,
  addFrameCallback,
  removeFrameCallback,
  addPostRenderCallback,
  removePostRenderCallback,
} from '@/utils/sceneManager'
import { MAIN_SCENE_TONE_MAPPING_EXPOSURE } from '@/utils/rendererManager'
import { useTaskStore } from '@/stores/task'
import {
  gasNameMap,
  cloudContourOtherVariableLabels,
} from '@/constants/gasVariables'
import { pickPreviewLayer, resolvePreviewFrameUrl } from '@/utils/previewFrame'
import { decodeNormalizedUint16 } from '@/utils/normalizedUint16'
import {
  computePlaneLayerCameraFocus,
  isPlaneFocusableLayer,
} from '@/utils/planeCameraFocus.js'
import {
  resolveParticleFieldGridFromSource,
  resolveParticleEmitterFromField,
  resolveParticleEmitterFromManifest,
} from '@/utils/particleFlowCore'
import {
  buildParticleVelocityDatasetRequest,
  findParticleDatasetSource,
  particleSourceMayContainVelocityManifest,
} from '@/utils/particleVelocitySource'
import { shouldContinueVolumeFrameRequest } from '@/utils/volumeLayerPreload'
import {
  FULL_VOLUME_DATASET_PAYLOAD_KEY,
  hasVolumeDatasetLocator,
} from '@/utils/volumeDatasetCache'
import { resolveVolumeDatasetFrame } from '@/utils/volumeFrameUrl'
import {
  buildRadarVolumeMockApiChunk,
  extractRadarMockVolumeBandId,
  isRadarMockVolumeVariableId,
} from '@/utils/mockRadarVolume3d.js'

const props = defineProps({
  currentTask: {
    type: Object,
    default: null,
  },
  visualizationDimension: {
    type: String,
    default: '2d',
  },
  visualization2DType: {
    type: String,
    default: 'cloud',
  },
  visualization3DType: {
    type: String,
    default: 'volume',
  },
  visualizationOptionsOpen: {
    type: Boolean,
    default: false,
  },
  selectedPlane: {
    type: String,
    default: 'xy',
  },
  planeCoordinate: {
    type: Number,
    default: 0,
  },
  previewImageUrl: {
    type: String,
    default: '',
  },
  generatedVizLayers: {
    type: Array,
    default: () => [],
  },
  selectedLayerId: {
    type: [String, Number, null],
    default: null,
  },
  timelineCurrentStep: {
    type: Number,
    default: 0,
  },
  timelineTimeSteps: {
    type: Array,
    default: () => [],
  },
  timelinePhysicalTimes: {
    type: Array,
    default: () => [],
  },
  isTimelinePlaying: {
    type: Boolean,
    default: false,
  },
  visualization: {
    type: Object,
    default: () => ({}),
  },
  showRadarMaterialInfo: {
    type: Boolean,
    default: false,
  },
  radarMaterialBindings: {
    type: Array,
    default: () => [],
  },
  physicalWidth: {
    type: Number,
    default: null,
  },
  physicalHeight: {
    type: Number,
    default: null,
  },
  geometricCenter: {
    type: Array,
    default: () => [0, 0, 0],
  },
  colorMapCatalog: {
    type: Array,
    default: () => [],
  },
  getVolumeDataset: {
    type: Function,
    default: null,
  },
  getGeometryBounds: {
    type: Function,
    default: null,
  },
})

const emit = defineEmits([
  'update-plane',
  'update-coordinate',
  'add-point',
  'update-point',
  'delete-point',
  'focus-point',
  'volume-csv-progress',
  'volume-person-space-intersect',
  'geometry-selections-update',
  'goaf-gas-sources-updated',
])
const taskStore = useTaskStore()
const USE_PUBLIC_TEST_VOLUME_DATA = false
const PUBLIC_TEST_VOLUME_MANIFEST_URL = '/test-data/manifest.json'

// 采空区任务本地模型路径（geometry 与 real 均使用场景.glb）
const GOAF_GEOMETRY_MODEL_URL = '/采空区/场景.glb'
const GOAF_REAL_MODEL_URL = '/采空区/场景.glb'

if (!THREE.BufferGeometry.prototype.computeBoundsTree) {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
  THREE.Mesh.prototype.raycast = acceleratedRaycast
}

const hostRef = ref(null)
const sceneContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  canAddPoint: false,
  canShowGeometryDetail: false,
  canHideGeometry: false,
})
const volumeCsvProgress = ref({
  visible: false,
  percentage: 0,
  text: '',
  detail: '',
})

// 使用场景管理器单例
let sceneInstance = null
let renderer = null
let scene = null
let camera = null
let controls = null
let raycaster = null
let clock = null

// 场景组（从单例获取）
let rootGroup = null
let planeGroup = null
let volumeGroup = null
let streamlineGroup = null
let particleGroup = null
let smokeGroup = null
let boundsGroup = null
let overlayGroup = null
let axisGroup = null
let modelGroup = null
let monitoringPointsGroup = null
let radarResultPreviewGroup = null
let radarTrailParticles = []
let radarResultTextureLoader = null
const radarResultTextureCache = new Map()

// 采空区瓦斯泄漏系统
let goafGasSystem = null

const volumePayloadPending = new Map()
const geometryBounds = ref(null)
const modelLoading = ref(false)
const AXIS_HELPERS_GROUP_NAME = '__xyzAxisHelpers'
const GROUND_PLANE_BOUNDS_OFFSET = 0.04
let lastVolumeFocusKey = ''

// WASD + QE 键盘控制状态
const keysPressed = {
  w: false,
  a: false,
  s: false,
  d: false,
  q: false,
  e: false,
  shift: false,
  f4: false,
}
const KEYBOARD_MOVE_SPEED = 0.5 // 键盘移动速度
const KEYBOARD_MOVE_SPEED_FAST = 1.5 // Shift 加速时的速度

// GLTF 模型相关
const PERSON_MODEL_TRANSFORM = {
  position: [2.4, -1.1, -1],
  rotation: [Math.PI / 2, Math.PI, 0],
  scale: [1, 1, 1],
  animationFrameTime: 0,
}
const GLTF_MODEL_CONFIGS = [
  {
    key: 'geometry',
    layerKind: 'model',
    url: '/采空区/场景.glb',
    useTaskGlbUrl: true,
    rotation: [Math.PI / 2, 0, 0],
    meetingRoomRotation: [
      MEETING_ROOM_SURFACE_ROTATION_X,
      0,
      MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z + MEETING_ROOM_OVERALL_ROTATION_Z + MEETING_ROOM_FLOOR_ROTATION_Z,
    ],
    scaleToBounds: false,
    matchAxes: true,
    scaleAxisMap: [0, 2, 1],
    scaleMultiplier: [0.7, 0.8, 0.7],
    alignAnchor: 'min',
    positionOffset: [1.5, 1.5, 0],
    hideWhenRealModelVisible: true,
  },
  {
    key: 'real',
    layerKind: 'realModel',
    url: '/采空区/场景.glb',
    useTaskRealModelUrl: true,
    rotation: [Math.PI / 2, 0, 0],
    meetingRoomRotation: [MEETING_ROOM_SURFACE_ROTATION_X, 0, MEETING_ROOM_OVERALL_ROTATION_Z + MEETING_ROOM_FLOOR_ROTATION_Z],
    scaleToBounds: false,
    matchAxes: true,
    scaleAxisMap: [0, 2, 1],
    scaleMultiplier: [0.7, 0.8, 0.7],
    alignAnchor: 'min',
    positionOffset: [1.5, 1.5, 0],
  },
  {
    key: 'meetingRoomStandingIdle',
    layerKind: 'realModel',
    url: MEETING_ROOM_STANDING_IDLE_MODEL_URL,
    disabled: true,
    meetingRoomOnly: true,
    loadWithoutBounds: true,
    rotation: [Math.PI / 2, Math.PI, 0],
    animationFrameTime: 0,
    useRealModelOpacity: true,
    showWithModelLayer: true,
  },
  {
    key: 'personGeometry',
    layerKind: 'model',
    url: '/person.glb',
    disabled: true,
    ...PERSON_MODEL_TRANSFORM,
    hideWhenRealModelVisible: true,
    useSolidMaterial: true,
    solidColor: '#26313f',
  },
  {
    key: 'personReal',
    layerKind: 'realModel',
    url: '/person.glb',
    disabled: true,
    ...PERSON_MODEL_TRANSFORM,
    useRealModelOpacity: true,
  },
]

function pickFirstUrl(...values) {
  for (const value of values) {
    const url = normalizeUrl(value)
    if (url) {
      if (/^(https?:)?\/\//i.test(url) || url.startsWith('/') || url.startsWith('blob:')) {
        return url
      }
      return `/${url.replace(/^\.?\//, '')}`
    }
  }
  return ''
}

function resolveLocalRealModelUrlForTask(task = props.currentTask) {
  if (isGoafTask(task)) return GOAF_REAL_MODEL_URL
  return ''
}

function resolveLocalGeometryModelUrlForTask(task = props.currentTask) {
  if (isMeetingRoomTask(task)) return LOCAL_MEETING_ROOM_GEOMETRY_MODEL_URL
  if (isGoafTask(task)) return GOAF_GEOMETRY_MODEL_URL
  return ''
}

function resolveGeometryModelUrl() {
  const task = props.currentTask || {}
  const modelInfo = task.modelInfo || task.model_info || {}
  const model = task.model || {}
  const metadata = task.metadata || modelInfo.metadata || {}
  return pickFirstUrl(
    resolveLocalGeometryModelUrlForTask(task),
    task.geometry_model_url,
    task.geometry_model_file,
    task.geometryModelUrl,
    task.glb_url,
    task.glbUrl,
    task.geometry_glb_url,
    task.geometryGlbUrl,
    task.model_glb_url,
    task.modelGlbUrl,
    task.params?.geometry_model_url,
    task.params?.geometry_model_file,
    task.params?.glb_url,
    task.params?.geometry_glb_url,
    model.geometry_model_url,
    model.geometry_model_file,
    model.geometryModelUrl,
    model.glb_url,
    model.glbUrl,
    modelInfo.geometry_model_url,
    modelInfo.geometry_model_file,
    modelInfo.geometryModelUrl,
    modelInfo.glb_url,
    modelInfo.glbUrl,
    modelInfo.glb_file_url,
    modelInfo.glbFileUrl,
    metadata.geometry_model_url,
    metadata.geometry_model_file,
    metadata.geometryModelUrl,
    metadata.glb_url,
    metadata.glbUrl,
    metadata.geometry_glb_url,
    metadata.geometryGlbUrl,
  )
}

function resolveRealModelUrl() {
  const task = props.currentTask || {}
  const modelInfo = task.modelInfo || task.model_info || {}
  const model = task.model || {}
  const metadata = task.metadata || modelInfo.metadata || {}
  return pickFirstUrl(
    resolveLocalRealModelUrlForTask(task),
    task.real_model_url,
    task.real_model_file,
    task.realModelUrl,
    task.params?.real_model_url,
    task.params?.real_model_file,
    model.real_model_url,
    model.real_model_file,
    model.realModelUrl,
    modelInfo.real_model_url,
    modelInfo.real_model_file,
    modelInfo.realModelUrl,
    metadata.real_model_url,
    metadata.real_model_file,
    metadata.realModelUrl,
  )
}

function resolveGLTFModelUrl(config) {
  if (config?.useTaskGlbUrl) {
    return resolveGeometryModelUrl() || normalizeUrl(config.url)
  }
  if (config?.useTaskRealModelUrl) {
    return resolveRealModelUrl() || normalizeUrl(config.url)
  }
  return normalizeUrl(config?.url)
}

function canLoadGLTFModelConfig(config) {
  if (!config) return false
  if (config.disabled) return false
  if (config.meetingRoomOnly && !isMeetingRoomTask()) return false
  if (config.key === 'real' && isMeetingRoomTask()) return false
  if (
    (config.useTaskGlbUrl || config.useTaskRealModelUrl) &&
    resolveGLTFModelUrl(config)
  ) {
    return true
  }
  if (config.loadWithoutBounds && resolveGLTFModelUrl(config)) return true
  return Boolean(normalizeModelBounds(geometryBounds.value))
}

function resolveGLTFModelTransformOptions(config) {
  return {
    matchAxes: config?.matchAxes,
    scaleAxisMap: config?.scaleAxisMap,
    scaleMultiplier: config?.scaleMultiplier,
    alignAnchor: config?.alignAnchor,
    positionOffset: config?.positionOffset,
  }
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
let gltfModels = new Map()
let gltfModelLoadPromises = new Map()
let gltfModelLoadToken = 0
/** 每个任务仅自动对焦真实模型一次，避免覆盖用户手动调整的视角 */
let realModelCameraFocusedTaskKey = ''
let gltfTextureLoader = null
const gltfTextureCache = new Map()

// 模型辅助对象（edges 模式使用）
let modelEdgesGroups = new Map()
let selectedGeometryMesh = null
let selectedGeometryOutline = null
const geometryModelSelections = ref([])
// per-mesh 透明度覆盖：key = mesh selectionName, value = opacity (0-1)
const geometryMeshOpacityOverrides = new Map()
const hiddenGeometryMeshes = shallowRef([])
const isGeometryModelSelectionVisible = ref(false)
const shouldShowHiddenGeometryPanel = computed(
  () => isGeometryModelSelectionVisible.value && hiddenGeometryMeshes.value.length > 0,
)

// 按名称查找/控制模型内部对象显隐（如场景.glb 中的“煤层-002-2.003”）
function findNamedObjects(name) {
  if (!name || !modelGroup) return []
  // 优先使用 getObjectByName 找第一个，再遍历补充同名/包含名对象
  const first = modelGroup.getObjectByName(name)
  const targets = first ? [first] : []
  modelGroup.traverse((child) => {
    if (child !== first && (child.name === name || child.name?.includes(name))) {
      targets.push(child)
    }
  })
  return targets
}

function findNamedObject(name) {
  if (!name || !modelGroup) return null
  return modelGroup.getObjectByName(name)
}

function setNamedObjectVisible(name, visible) {
  const objs = findNamedObjects(name)
  if (objs.length === 0) {
    console.warn('[ThreeCanvas] setNamedObjectVisible: 未找到对象', name)
    return false
  }
  console.log('[ThreeCanvas] 设置对象显隐:', name, visible, '匹配数量:', objs.length)
  objs.forEach((obj) => {
    console.log('  ->', obj.name, '类型:', obj.type, '当前 visible:', obj.visible, '父级:', obj.parent?.name || '无')
    obj.visible = visible
    // 递归同步子对象，避免某些导出结构下子 mesh 独立控制显隐
    obj.traverse((child) => {
      if (child !== obj) child.visible = visible
    })
  })
  return true
}

function getNamedObjectVisible(name) {
  const obj = findNamedObject(name)
  return obj ? obj.visible : undefined
}

function toggleNamedObjectVisibility(name) {
  const obj = findNamedObject(name)
  if (!obj) return false
  const newVisible = !obj.visible
  setNamedObjectVisible(name, newVisible)
  return newVisible
}

function logModelObjectNames() {
  if (!modelGroup) {
    console.log('[ThreeCanvas] modelGroup 未初始化')
    return
  }
  const names = []
  modelGroup.traverse((child) => {
    if (child.name) names.push(`${child.name} (${child.type})`)
  })
  console.log('[ThreeCanvas] 场景模型对象名称列表（共', names.length, '个）:')
  console.log(names.join('\n'))
}

const highlightedGeometryMaterials = new Map()
let sceneMenuPointerOpened = false
let sceneContextMenuMesh = null
let css2dRenderer = null
let css2dResizeObserver = null

function resizeCss2dRenderer() {
  if (!css2dRenderer || !hostRef.value) return
  const w = hostRef.value.clientWidth || 1
  const h = hostRef.value.clientHeight || 1
  css2dRenderer.setSize(w, h)
}

function renderCss2dRendererFrame() {
  if (!css2dRenderer || !scene || !camera) return
  css2dRenderer.render(scene, camera)
}

function ensureCss2dRenderer() {
  if (css2dRenderer || !hostRef.value) return
  css2dRenderer = new CSS2DRenderer()
  const dom = css2dRenderer.domElement
  dom.style.position = 'absolute'
  dom.style.inset = '0'
  dom.style.pointerEvents = 'none'
  hostRef.value.style.position = 'relative'
  hostRef.value.appendChild(dom)
  resizeCss2dRenderer()
  css2dResizeObserver = new ResizeObserver(() => resizeCss2dRenderer())
  css2dResizeObserver.observe(hostRef.value)
  addPostRenderCallback(renderCss2dRendererFrame)
}

function teardownCss2dRenderer() {
  removePostRenderCallback(renderCss2dRendererFrame)
  css2dResizeObserver?.disconnect?.()
  css2dResizeObserver = null
  disposePersonInfoPopup()
  disposeGeometryInfoPopup()
  if (css2dRenderer) {
    css2dRenderer.domElement?.parentNode?.removeChild(css2dRenderer.domElement)
    css2dRenderer = null
  }
}

function getModelMeshMaterialName(mesh) {
  const materials = Array.isArray(mesh?.material)
    ? mesh.material
    : [mesh?.material]
  return materials
    .map((material) => material?.name)
    .find((name) => typeof name === 'string' && name.trim()) || ''
}

function getGeometryMeshSelectionName(mesh) {
  const materialName =
    mesh?.userData?.geometryMaterialName || getModelMeshMaterialName(mesh)
  return (
    mesh?.name ||
    mesh?.parent?.name ||
    mesh?.geometry?.name ||
    materialName ||
    'unnamed'
  )
}

function getGeometryMeshFaceCount(mesh) {
  const position = mesh?.geometry?.attributes?.position
  if (!position) return 0
  return Math.floor((mesh.geometry.index?.count ?? position.count) / 3)
}

function normalizeBoundaryName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^mat[_-]/, '')
}

function getModelBoundaryConditions() {
  const task = props.currentTask || {}
  const modelInfo = task.modelInfo || task.model_info || {}
  return (
    modelInfo?.params?.boundary_conditions ||
    modelInfo?.data?.params?.boundary_conditions ||
    task.model?.params?.boundary_conditions ||
    task.params?.boundary_conditions ||
    []
  )
}

function findBoundaryConditionForMesh(mesh) {
  const conditions = getModelBoundaryConditions()
  if (!Array.isArray(conditions) || conditions.length === 0) return null

  const candidates = [
    mesh?.userData?.geometrySelectionName,
    mesh?.name,
    mesh?.parent?.name,
    mesh?.geometry?.name,
    mesh?.userData?.geometryMaterialName,
    getModelMeshMaterialName(mesh),
  ]
    .map(normalizeBoundaryName)
    .filter(Boolean)

  return (
    conditions.find((item) =>
      candidates.includes(normalizeBoundaryName(item?.name)),
    ) || null
  )
}

function collectGeometryModelSelections(model) {
  const items = []
  if (!model) {
    geometryModelSelections.value = items
    emit('geometry-selections-update', items)
    return items
  }
  model.traverse((child) => {
    if (!child?.isMesh || !child.geometry) return
    child.geometry.computeBoundingBox?.()
    child.geometry.computeBoundingSphere?.()

    const materialName = getModelMeshMaterialName(child)
    child.userData.geometryMaterialName = materialName
    const name = getGeometryMeshSelectionName(child)
    child.userData.geometrySelectionName = name
    child.userData.geometrySelectable = true
    child.updateWorldMatrix(true, false)
    const worldBox = new THREE.Box3().setFromObject(child)
    const center = worldBox.getCenter(new THREE.Vector3())
    const size = worldBox.getSize(new THREE.Vector3())
    items.push({
      name,
      material: materialName,
      faces: getGeometryMeshFaceCount(child),
      node: child.parent?.name || '',
      mesh: child.name || child.geometry?.name || '',
      bounds: {
        xmin: worldBox.min.x,
        xmax: worldBox.max.x,
        ymin: worldBox.min.y,
        ymax: worldBox.max.y,
        zmin: worldBox.min.z,
        zmax: worldBox.max.z,
      },
      center: { x: center.x, y: center.y, z: center.z },
      size: { x: size.x, y: size.y, z: size.z },
    })
  })
  geometryModelSelections.value = items.sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  emit('geometry-selections-update', geometryModelSelections.value)
  return geometryModelSelections.value
}

const {
  DISSOLVE_MODEL_KEYS,
  applyModelDissolveSettings,
  setModelVisibilityWithDissolve,
  disposeModelDissolveStates,
  disposeModelDissolveParticles,
  ensureModelDissolveState,
  getModelDissolveState,
  deleteModelDissolveState,
} = createModelDissolve({
  getGltfModels: () => gltfModels,
  getModelGroup: () => modelGroup,
  getRenderer: () => renderer,
  getClock: () => clock,
  addFrameCallback,
  removeFrameCallback,
  getVisualization: () => props.visualization,
})

const {
  createPersonInfoPopup,
  disposePersonInfoPopup,
  createGeometryInfoPopup,
  disposeGeometryInfoPopup,
} = createInfoPopups({
  getScene: () => scene,
  ensureCss2dRenderer,
  addFrameCallback,
  removeFrameCallback,
  getModelMeshMaterialName,
  getGeometryMeshSelectionName,
  findBoundaryConditionForMesh,
  hideGeometryMesh,
  clearGeometryModelSelection,
  getRadarMaterialBindings: () => props.radarMaterialBindings,
  getShowRadarMaterialInfo: () => props.showRadarMaterialInfo,
})

const {
  findExistingPersonModel,
  setPersonModelVisible,
  isPersonModelVisible,
  clampPersonModelOpacity,
  resolveConfiguredModelOpacity,
  clearPersonModelHighlight,
  disposePersonScanOverlay,
  disposePersonVolumeIntersectEdges,
  attachPersonVolumeIntersectEdges,
  setVolumePersonIntersectHighlight,
  getPersonModelForHighlight,
  classifyBone,
  buildSkeletonStickman,
  setPersonSkeletonVisible,
  updatePersonScanOverlayOpacity,
  createPersonScanOverlay,
  setPersonScanOverlayVisible,
  applyPersonModelMaterialHighlight,
  highlightPersonModel,
  resolveAnimationTrackNodeName,
  findAnimatedTargetObject,
  getAnimatedModelTargetForHighlight,
  highlightAnimatedModelTarget,
  disposeSkeletonForModel,
  disposePersonHighlight,
} = createPersonHighlight({
  getGltfModels: () => gltfModels,
  getModelGroup: () => modelGroup,
  getScene: () => scene,
  getVisualization: () => props.visualization,
  disposeModelObject,
  focusCameraOnObject,
  ensureGLTFModelLoaded,
  findGLTFModelKeyForObject,
  resolveOpacityForModelKey,
  createPersonInfoPopup,
  disposePersonInfoPopup,
  applyModelBaseTransform,
  personModelTransform: PERSON_MODEL_TRANSFORM,
})

function disposeModelObject(model) {
  if (!model) return
  model.userData?.disposeSplatViewer?.()
  // Clean up skeleton overlay group if it belongs to this model
  disposeSkeletonForModel(model)
  model.traverse((child) => {
    if (child.geometry) child.geometry.dispose()
    if (child._originalMaterial) {
      if (Array.isArray(child._originalMaterial)) {
        child._originalMaterial.forEach((m) => m.dispose())
      } else {
        child._originalMaterial.dispose()
      }
      delete child._originalMaterial
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose())
      } else {
        child.material.dispose()
      }
    }
  })
}

function clearGLTFModel() {
  gltfModelLoadToken += 1
  realModelCameraFocusedTaskKey = ''
  clearPersonModelHighlight()
  clearGeometryModelSelection()
  disposeMeetingRoomStandingIdleDebugGroup()
  disposeMeetingRoomSplatDebugGroup()
  disposeModelDissolveStates()
  for (const model of gltfModels.values()) {
    modelGroup?.remove(model)
    disposeModelObject(model)
  }
  for (const edgesGroup of modelEdgesGroups.values()) {
    edgesGroup?.removeFromParent?.()
  }
  // 清理人员高亮模块状态（骨骼叠加层、人员模型等）
  disposePersonHighlight()
  gltfModels = new Map()
  gltfModelLoadPromises = new Map()
  modelEdgesGroups = new Map()
  geometryModelSelections.value = []
  geometryMeshOpacityOverrides.clear()
  emit('geometry-selections-update', [])
  hiddenGeometryMeshes.value = []
  isGeometryModelSelectionVisible.value = false
  resetMeetingRoomHumanBodyCache()
}

function unloadGLTFModelByKey(key) {
  if (!key) return
  const model = gltfModels.get(key)
  if (model) {
    modelGroup?.remove(model)
    disposeModelObject(model)
    gltfModels.delete(key)
  }
  const state = getModelDissolveState(key)
  if (state) {
    disposeModelDissolveParticles(state)
    deleteModelDissolveState(key)
  }
  const edgesGroup = modelEdgesGroups.get(key)
  if (edgesGroup) {
    edgesGroup.removeFromParent?.()
    modelEdgesGroups.delete(key)
  }
  gltfModelLoadPromises.delete(key)
  if (key === 'geometry') {
    clearGeometryModelSelection()
  }
}

function refreshGLTFModelsForResolvedUrls() {
  if (!modelGroup) return

  let invalidated = false
  for (const config of GLTF_MODEL_CONFIGS) {
    if (config.disabled) continue
    if (!config.useTaskGlbUrl && !config.useTaskRealModelUrl) continue

    const nextUrl = resolveGLTFModelUrl(config)
    const currentModel = gltfModels.get(config.key)
    const currentUrl = currentModel?.userData?.gltfModelUrl || ''
    if (currentModel && currentUrl !== nextUrl) {
      unloadGLTFModelByKey(config.key)
      invalidated = true
    }
  }

  if (invalidated) {
    gltfModelLoadToken += 1
  }
  ensureGLTFModelLoaded()
  syncModelVisibility()
}

let sceneContextMenuPoint = null

/** 防止 layers watcher 在自动加载期间高频触发导致递归更新 */
let layersSyncDebounceTimer = null
let layersSyncDepth = 0
const MAX_LAYERS_SYNC_DEPTH = 3
const pendingPointMove = ref(null)

const runtimeState = ref({
  animationSpeed: 1,
  visibleLayerIds: new Set(),
  layerPayloads: new Map(),
  activeLayerId: null,
  focusLayerId: null,
  volumePayloads: new Map(),
  streamlinePayload: null,
  /** 防止 layers watcher 与 syncSceneForCurrentMode 之间形成循环更新 */
  layersUpdating: false,
})
const SHARED_VOLUME_PAYLOAD_KEY = '__shared_volume_payload__'
const sceneMode = computed(() => {
  if (props.visualizationDimension === '2d') {
    return props.visualization2DType === 'vector' ? 'vector' : 'cloud'
  }
  return props.visualization3DType === 'streamline' ? 'streamline' : 'volume'
})

function isLayerVisible(layer) {
  if (!layer?.id) return false
  // 优先使用图层自身的 visible 属性
  if (layer.visible === false) return false
  // 如果 runtimeState 中有显隐记录，以它为准
  const visibleIds = runtimeState.value.visibleLayerIds
  if (visibleIds instanceof Set && visibleIds.size > 0) {
    return visibleIds.has(String(layer.id))
  }
  // 默认情况下图层可见
  return true
}

function syncVisibleLayerIdsFromProps() {
  const nextIds = new Set()
  for (const layer of props.generatedVizLayers || []) {
    if (layer?.id == null) continue
    if (layer.visible !== false) {
      nextIds.add(String(layer.id))
    }
  }
  // 仅当可见图层 ID 真正变化时才更新，避免触发不必要的响应式循环
  const currentIds = runtimeState.value.visibleLayerIds
  const isSame =
    currentIds instanceof Set &&
    currentIds.size === nextIds.size &&
    [...nextIds].every((id) => currentIds.has(id))
  if (!isSame) {
    runtimeState.value.visibleLayerIds = nextIds
  }
}

function findFirstVisibleLayerByKinds(kinds) {
  return (
    (props.generatedVizLayers || []).find(
      (layer) => kinds.includes(layer?.kind) && isLayerVisible(layer),
    ) || null
  )
}

const visible2DLayers = computed(() =>
  (props.generatedVizLayers || []).filter(
    (layer) =>
      !isRadarResultPreviewLayer(layer) &&
      (
        ['contour', 'cloud', 'radar_cloud', 'radar_wave', 'vector'].includes(
          layer?.kind,
        )
      ) &&
      isLayerVisible(layer),
  ),
)

const visibleBoundsLayer = computed(() =>
  (props.generatedVizLayers || []).find(
    (layer) => layer?.kind === 'bounds' && isLayerVisible(layer),
  ),
)

const visibleVolumeLayers = computed(() =>
  (props.generatedVizLayers || []).filter(
    (layer) => layer?.kind === 'volume' && isLayerVisible(layer),
  ),
)

const visibleStreamlineLayers = computed(() =>
  (props.generatedVizLayers || []).filter(
    (layer) => layer?.kind === 'streamline' && isLayerVisible(layer),
  ),
)

const visibleParticleLayers = computed(() =>
  (props.generatedVizLayers || []).filter(
    (layer) => layer?.kind === 'particle' && layer.visible === true,
  ),
)

const visibleSmokeLayers = computed(() =>
  (props.generatedVizLayers || []).filter(
    (layer) => layer?.kind === 'smoke' && isLayerVisible(layer),
  ),
)

const activeSmokeLayer = computed(() => {
  const layers = visibleSmokeLayers.value
  if (props.selectedLayerId != null) {
    const selected = layers.find(
      (layer) => String(layer.id) === String(props.selectedLayerId),
    )
    if (selected) return selected
  }
  return layers[0] || null
})

function radarResultPreviewModeForLayer(layer) {
  if (!layer) return ''
  if (layer.previewMode) return String(layer.previewMode)
  if (layer.kind === 'radar_wavefront_cloud') return 'wavefront_cloud'
  if (layer.kind === 'radar_wavefront') return 'wavefront'
  if (layer.kind === 'radar_heatmap') return 'heatmap'
  if (layer.kind === 'radar_trails') return 'trails'
  if (layer.kind === 'radar_structure') return 'structure'
  return ''
}

function isRadarResultPreviewLayer(layer) {
  return Boolean(
    layer?.isRadarResultPreview ||
      radarResultPreviewModeForLayer(layer),
  )
}

const activeRadarResultPreviewLayers = computed(() =>
  (props.generatedVizLayers || []).filter(
    (layer) =>
      isRadarResultPreviewLayer(layer) && isLayerVisible(layer),
  ),
)

const activeRadarResultPreviewLayer = computed(() => {
  const layers = activeRadarResultPreviewLayers.value
  if (!layers.length) return null
  if (props.selectedLayerId != null) {
    const selected = layers.find(
      (layer) => String(layer.id) === String(props.selectedLayerId),
    )
    if (selected) return selected
  }
  return layers[0] || null
})

const activeRadarResultPreviewMode = computed(
  () => radarResultPreviewModeForLayer(activeRadarResultPreviewLayer.value),
)

const activeRadarResultPreviewModes = computed(() =>
  activeRadarResultPreviewLayers.value
    .map((layer) => radarResultPreviewModeForLayer(layer))
    .filter(Boolean),
)

function hasActiveRadarResultPreviewMode(mode) {
  return activeRadarResultPreviewModes.value.includes(mode)
}

const hasVisibleVolumeLayer = computed(
  () => visibleVolumeLayers.value.length > 0,
)
const hasVisibleStreamlineLayer = computed(
  () => visibleStreamlineLayers.value.length > 0,
)
const hasVisibleParticleLayer = computed(
  () => visibleParticleLayers.value.length > 0,
)
const hasVisibleSmokeLayer = computed(
  () => visibleSmokeLayers.value.length > 0,
)

const active2DLayer = computed(() => {
  const preferredKinds =
    props.visualization2DType === 'vector'
      ? ['vector']
      : ['contour', 'cloud', 'radar_cloud', 'radar_wave']
  return (
    pickPreviewLayer(
      visible2DLayers.value,
      props.selectedLayerId,
      preferredKinds,
    ) ||
    pickPreviewLayer(visible2DLayers.value, null, preferredKinds) ||
    visible2DLayers.value[0] ||
    null
  )
})

function parseLayerPlaneSelection(layer) {
  const id = String(layer?.id || '')
  const parts = id.split(':')
  if (
    parts[0] === 'radar_wave' ||
    parts[0] === 'radar_cloud' ||
    parts[0] === 'radar_wavefront_cloud' ||
    parts[0] === 'radar_wavefront' ||
    parts[0] === 'radar_heatmap'
  ) {
    return {
      plane: String(parts[2] || 'xy').toLowerCase(),
      coordinate: Number(parts[3]),
    }
  }
  if (parts[0] === 'vector' || parts[0] === 'cloud' || parts[0] === 'contour') {
    return {
      plane: String(parts[2] || 'xy').toLowerCase(),
      coordinate: Number(parts[3]),
    }
  }
  return null
}

const shouldForceGhostPlanePreview = computed(() => {
  if (!props.visualizationOptionsOpen) return false
  if (props.visualizationDimension !== '2d') return false
  if (!visible2DLayers.value.length) return false
  const activeLayerSelection = parseLayerPlaneSelection(active2DLayer.value)
  if (!activeLayerSelection) return false

  const selectedPlane = String(props.selectedPlane || 'xy').toLowerCase()
  const selectedCoordinate = Number(props.planeCoordinate)
  const activeCoordinate = Number(activeLayerSelection.coordinate)

  return (
    activeLayerSelection.plane !== selectedPlane ||
    selectedCoordinate !== activeCoordinate
  )
})

const selectedVolumeLayer = computed(() => {
  const preferredKinds = ['volume']
  if (props.selectedLayerId != null) {
    const selected = (props.generatedVizLayers || []).find(
      (layer) => String(layer.id) === String(props.selectedLayerId),
    )
    if (
      selected &&
      preferredKinds.includes(selected?.kind) &&
      isLayerVisible(selected)
    ) {
      return selected
    }
    // 若当前选择的是其它类型图层（例如 2D 图层），允许回退到可见的 3D 图层
    if (selected && !preferredKinds.includes(selected?.kind)) {
      // continue fallback
    } else if (selected) {
      // 当前选择就是 3D 图层，但不可见时不强行回退
      return null
    }
  }
  if (runtimeState.value.activeLayerId != null) {
    const active = (props.generatedVizLayers || []).find(
      (layer) => String(layer.id) === String(runtimeState.value.activeLayerId),
    )
    if (
      active &&
      preferredKinds.includes(active?.kind) &&
      isLayerVisible(active)
    ) {
      return active
    }
  }
  return (
    (props.generatedVizLayers || []).find(
      (layer) => preferredKinds.includes(layer?.kind) && isLayerVisible(layer),
    ) || null
  )
})

const selectedStreamlineLayer = computed(() => {
  const preferredKinds = ['streamline']
  if (props.selectedLayerId != null) {
    const selected = (props.generatedVizLayers || []).find(
      (layer) => String(layer.id) === String(props.selectedLayerId),
    )
    if (
      selected &&
      preferredKinds.includes(selected?.kind) &&
      isLayerVisible(selected)
    ) {
      return selected
    }
    if (selected && !preferredKinds.includes(selected?.kind)) {
      // continue fallback
    } else if (selected) {
      return null
    }
  }
  if (runtimeState.value.activeLayerId != null) {
    const active = (props.generatedVizLayers || []).find(
      (layer) => String(layer.id) === String(runtimeState.value.activeLayerId),
    )
    if (
      active &&
      preferredKinds.includes(active?.kind) &&
      isLayerVisible(active)
    ) {
      return active
    }
  }
  return (
    (props.generatedVizLayers || []).find(
      (layer) => preferredKinds.includes(layer?.kind) && isLayerVisible(layer),
    ) || null
  )
})

function extractVolumeVariableFromLayer(layer) {
  const normalizeVariableKey = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-:()]/g, '')
  const resolveVariableWithMetadata = (raw) => {
    const source = String(raw || '').trim()
    if (!source) return ''
    const metadataVars = Array.isArray(taskStore.variableNames)
      ? taskStore.variableNames
      : []
    if (!metadataVars.length) return source
    const aliasToCanonical = new Map()
    const pushAlias = (alias, canonical) => {
      const key = normalizeVariableKey(alias)
      if (!key || !canonical) return
      if (!aliasToCanonical.has(key)) aliasToCanonical.set(key, canonical)
    }
    for (const canonical of metadataVars) {
      pushAlias(canonical, canonical)
      const gasMeta = gasNameMap?.[canonical]
      if (gasMeta?.zh) pushAlias(gasMeta.zh, canonical)
      if (gasMeta?.en) pushAlias(gasMeta.en, canonical)
      const otherZh = cloudContourOtherVariableLabels?.[canonical]
      if (otherZh) pushAlias(otherZh, canonical)
    }
    return aliasToCanonical.get(normalizeVariableKey(source)) || source
  }
  if (!layer) return ''
  const id = String(layer.id || '')
  const parts = id.split(':')
  if (parts[0] === 'radar_wave') return ''
  if (
    ['volume', 'cloud', 'contour', 'radar_cloud', 'radar_wave', 'vector'].includes(
      String(parts[0] || '').toLowerCase(),
    ) &&
    parts.length >= 3
  ) {
    if (parts[0] === 'volume') {
      return resolveVariableWithMetadata(
        String(parts.slice(2).join(':')).trim(),
      )
    }
  }
  if (layer.variable != null && String(layer.variable).trim() !== '') {
    return resolveVariableWithMetadata(String(layer.variable).trim())
  }
  const label = String(layer.label || layer.name || '').trim()
  if (label && label.includes('-')) {
    const maybeVar = label.split('-').slice(1).join('-').trim()
    if (maybeVar) return resolveVariableWithMetadata(maybeVar)
  }
  if (
    ['volume', 'cloud', 'contour', 'radar_cloud', 'radar_wave', 'vector'].includes(
      String(parts[0] || '').toLowerCase(),
    ) &&
    parts.length >= 3
  ) {
    return resolveVariableWithMetadata(String(parts.slice(2).join(':')).trim())
  }
  return ''
}

function findVolumePayloadByVariable(variableName) {
  const target = normalizeVolumeKey(variableName)
  if (!target) return null
  for (const payload of runtimeState.value.volumePayloads.values()) {
    if (volumePayloadCanProvideVariable(payload, variableName)) return payload
  }
  return null
}

function normalizeVolumeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:()]+/g, '')
}

function volumePayloadCanProvideVariable(payload, variableName) {
  if (!payload || typeof payload !== 'object') return false
  const target = normalizeVolumeKey(variableName)
  if (!target) return true
  const payloadVariable = normalizeVolumeKey(payload.variable)
  if (!payloadVariable || payloadVariable === target) return true
  return Array.isArray(payload.datasets) && payload.datasets.length > 0
}

function deriveVolumePayloadForLayer(
  sourcePayload,
  layer,
  variableName,
  targetTimeStep = currentTimeStep.value,
) {
  if (!sourcePayload || typeof sourcePayload !== 'object') return null
  const resolvedVariable = String(
    variableName || sourcePayload.variable || '',
  ).trim()
  if (!resolvedVariable) return sourcePayload

  const normalizedPayload = {
    ...sourcePayload,
    variable: resolvedVariable,
    ...(layer?.id != null && {
      id: layer.id,
      local_id: layer.id,
      layer_id: layer.id,
    }),
  }
  const idCandidates = [layer?.id, resolvedVariable].filter(
    (value) => value != null && String(value).trim() !== '',
  )

  if (
    Array.isArray(normalizedPayload.datasets) &&
    normalizedPayload.datasets.length > 0
  ) {
    return cacheVolumePayload(normalizedPayload, idCandidates, targetTimeStep)
  }
  if (
    Array.isArray(normalizedPayload.volume_dataset_frames) &&
    normalizedPayload.volume_dataset_frames.length > 0
  ) {
    const framePayload = resolveVolumeDatasetFramePayload(
      normalizedPayload,
      targetTimeStep,
    )
    if (framePayload) {
      return cacheVolumePayload(framePayload, idCandidates, targetTimeStep)
    }
  }
  return normalizedPayload
}

function resolveVolumeVariableFileUrl(variable) {
  if (!variable || typeof variable !== 'object') return ''
  return String(
    variable.file_url ??
      variable.bin_url ??
      variable.file ??
      variable.url ??
      variable.data_url ??
      variable.volume_url ??
      '',
  ).trim()
}

function resolveVolumeDatasetBinUrl(dataset, variableName) {
  if (!dataset || typeof dataset !== 'object') return ''
  const target = normalizeVolumeKey(variableName)
  const matchedVar = Array.isArray(dataset.variables)
    ? dataset.variables.find((item) => {
        const name = normalizeVolumeKey(item?.name)
        const slug = normalizeVolumeKey(item?.slug)
        return name === target || slug === target
      })
    : null
  const legacyUrl = resolveVolumeVariableFileUrl(matchedVar)
  if (legacyUrl) return legacyUrl

  const binUrls = dataset.bin_urls
  if (!binUrls || typeof binUrls !== 'object') return ''
  for (const [key, url] of Object.entries(binUrls)) {
    if (!target || normalizeVolumeKey(key) === target) {
      const resolvedUrl = String(url || '').trim()
      if (resolvedUrl) return resolvedUrl
    }
  }
  return ''
}

function hasVolumeDataLocator(payload) {
  if (!payload || typeof payload !== 'object') return false
  if (
    typeof payload.manifest_url === 'string' &&
    payload.manifest_url.trim() !== ''
  ) {
    return true
  }
  if (
    Array.isArray(payload.volume_dataset_frames) &&
    payload.volume_dataset_frames.length > 0
  ) {
    return true
  }
  // 新接口返回 datasets 数组（包含所有时间步），也视为有数据定位器
  if (Array.isArray(payload.datasets) && payload.datasets.length > 0) {
    return true
  }
  const listKeys = [
    'csv_urls',
    'urls_csv',
    'urls',
    'volume_urls',
    'volume_frame_urls',
    'data_urls',
    'frame_urls',
    'positions_urls',
    'colors_urls',
  ]
  if (
    listKeys.some(
      (key) => Array.isArray(payload[key]) && payload[key].length > 0,
    )
  ) {
    return true
  }
  const singleKeys = ['csv_url', 'url', 'csv', 'positions_url', 'colors_url']
  return singleKeys.some(
    (key) => typeof payload[key] === 'string' && payload[key].trim() !== '',
  )
}

function hasVolumeManifestLocator(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    ((typeof payload.manifest_url === 'string' &&
      payload.manifest_url.trim() !== '') ||
      (Array.isArray(payload.volume_dataset_frames) &&
        payload.volume_dataset_frames.length > 0) ||
      (Array.isArray(payload.datasets) && payload.datasets.length > 0)),
  )
}

function resolveVolumeDatasetFramePayload(payload, targetTimeStep) {
  const frames = Array.isArray(payload?.volume_dataset_frames)
    ? payload.volume_dataset_frames
    : []
  if (!frames.length) return null
  const target = String(targetTimeStep)
  const matched =
    frames.find((item) => String(item?.time_step) === target) || frames[0]
  const manifestUrl = String(matched?.manifest_url || '').trim()
  const binUrl = String(matched?.bin_url || '').trim()
  if (!manifestUrl || !binUrl) return null
  return {
    ...payload,
    manifest_url: manifestUrl,
    bin_url: binUrl,
    source_time_step: matched?.time_step ?? targetTimeStep,
    time_step: [Number(matched?.time_step ?? targetTimeStep)],
    dimensions: matched?.dimensions ?? payload?.dimensions,
    origin: matched?.origin ?? payload?.origin,
    spacing: matched?.spacing ?? payload?.spacing,
    value_type: matched?.value_type ?? payload?.value_type,
    normalized: matched?.normalized ?? payload?.normalized,
    normalize_mode: matched?.normalize_mode ?? payload?.normalize_mode,
    original_value_range:
      matched?.original_value_range ?? payload?.original_value_range,
    vmin:
      matched?.vmin != null
        ? matched.vmin
        : (payload?.vmin ?? payload?.val_min),
    vmax:
      matched?.vmax != null
        ? matched.vmax
        : (payload?.vmax ?? payload?.val_max),
  }
}

function resolveVolumeSourceUrlForLayer(
  payload,
  forceFirstFrame = false,
  targetTimeStep = currentTimeStep.value,
) {
  if (!payload || typeof payload !== 'object') return ''
  const safeIndex = forceFirstFrame
    ? 0
    : Math.max(0, Number(targetTimeStep) || 0)
  const candidateLists = [
    payload.csv_urls,
    payload.urls_csv,
    payload.urls,
    payload.volume_urls,
    payload.volume_frame_urls,
    payload.data_urls,
    payload.frame_urls,
  ]
  for (const list of candidateLists) {
    if (Array.isArray(list) && list.length > 0) {
      const url = safeIndex < list.length ? list[safeIndex] : list[0]
      return normalizeUrl(url)
    }
  }
  const singleKeys = ['csv_url', 'url', 'csv']
  for (const key of singleKeys) {
    if (typeof payload[key] === 'string' && payload[key].trim() !== '') {
      return normalizeUrl(payload[key])
    }
  }
  return ''
}

function resolveVolumeManifestOverrideUrl() {
  const raw =
    props.visualization?.testManifestUrl ||
    (USE_PUBLIC_TEST_VOLUME_DATA ? PUBLIC_TEST_VOLUME_MANIFEST_URL : '')
  return typeof raw === 'string' && raw.trim() ? raw.trim() : ''
}

function resolveVolumeVariableRange(variable) {
  if (!variable || typeof variable !== 'object') return []
  if (Array.isArray(variable.original_value_range)) {
    return variable.original_value_range
  }
  if (Array.isArray(variable.originalValueRange)) {
    return variable.originalValueRange
  }
  return []
}

function findFirstVolumePayloadWithData() {
  for (const payload of runtimeState.value.volumePayloads.values()) {
    if (hasVolumeDataLocator(payload)) return payload
  }
  return null
}

function isPayloadForVisibleVolumeLayer(payload, idCandidates = []) {
  const visibleLayers = visibleVolumeLayers.value || []
  if (!visibleLayers.length || !payload || typeof payload !== 'object') {
    return false
  }

  const ids = new Set()
  idCandidates.forEach((value) => {
    if (value == null) return
    const sid = String(value).trim()
    if (sid) ids.add(sid)
  })
  ;[payload.id, payload.local_id, payload.layer_id].forEach((value) => {
    if (value == null) return
    const sid = String(value).trim()
    if (sid) ids.add(sid)
  })

  const payloadVariable = normalizeVolumeKey(payload.variable)
  return visibleLayers.some((layer) => {
    if (layer?.id != null && ids.has(String(layer.id))) return true
    const layerVariable = normalizeVolumeKey(extractVolumeVariableFromLayer(layer))
    return payloadVariable && layerVariable && payloadVariable === layerVariable
  })
}

function cacheVolumePayload(
  payload,
  idCandidates = [],
  targetTimeStep = currentTimeStep.value,
) {
  if (!payload || typeof payload !== 'object') return null
  const resolved = { ...payload }
  const manifestOverrideUrl = resolveVolumeManifestOverrideUrl()

  // 新接口返回 datasets（所有时间步），规范化为 volume_dataset_frames 供下游函数使用
  if (Array.isArray(resolved.datasets) && resolved.datasets.length > 0) {
    const timeSteps = resolved.time_step || []
    const targetVar = resolved.variable || ''
    const normalizedVar = normalizeVolumeKey(targetVar)
    resolved.volume_dataset_frames = resolved.datasets
      .map((dataset, index) => {
        if (!dataset || typeof dataset !== 'object') return null
        const matchedVar = Array.isArray(dataset.variables)
          ? dataset.variables.find((item) => {
              const name = normalizeVolumeKey(item?.name)
              const slug = normalizeVolumeKey(item?.slug)
              return name === normalizedVar || slug === normalizedVar
            })
          : null
        const manifestUrl = String(
          manifestOverrideUrl || dataset.manifest_url || '',
        ).trim()
        const binUrl = resolveVolumeDatasetBinUrl(dataset, targetVar)
        if (!manifestUrl || !binUrl) return null
        const range = resolveVolumeVariableRange(matchedVar)
        const rawTimeStep =
          dataset.time_step ??
          dataset.timeStep ??
          dataset.step ??
          dataset.simulation_time_step ??
          timeSteps[index]
        const parsedTimeStep = Number(rawTimeStep)
        return {
          time_step: Number.isFinite(parsedTimeStep) ? parsedTimeStep : index,
          manifest_url: manifestUrl,
          bin_url: binUrl,
          dimensions: Array.isArray(dataset.dimensions)
            ? dataset.dimensions
            : [],
          origin: Array.isArray(dataset.origin) ? dataset.origin : [],
          spacing: Array.isArray(dataset.spacing) ? dataset.spacing : [],
          value_type: matchedVar?.value_type ?? matchedVar?.valueType,
          normalized: matchedVar?.normalized,
          normalize_mode:
            matchedVar?.normalize_mode ?? matchedVar?.normalizeMode,
          original_value_range: range,
          vmin: range[0] != null ? Number(range[0]) : null,
          vmax: range[1] != null ? Number(range[1]) : null,
        }
      })
      .filter((item) => item != null)

    const currentFrame = resolveVolumeDatasetFrame(resolved, targetTimeStep)
    if (currentFrame) {
      resolved.manifest_url = currentFrame.manifest_url
      resolved.bin_url = currentFrame.bin_url
      resolved.source_time_step = currentFrame.time_step
      resolved.dimensions = currentFrame.dimensions
      resolved.origin = currentFrame.origin
      resolved.spacing = currentFrame.spacing
      resolved.value_type = currentFrame.value_type
      resolved.normalized = currentFrame.normalized
      resolved.normalize_mode = currentFrame.normalize_mode
      resolved.original_value_range = currentFrame.original_value_range
      if (currentFrame.vmin != null) resolved.vmin = currentFrame.vmin
      if (currentFrame.vmax != null) resolved.vmax = currentFrame.vmax
    }
  } else if (
    Array.isArray(resolved.volume_dataset_frames) &&
    resolved.volume_dataset_frames.length > 0
  ) {
    const currentFrame = resolveVolumeDatasetFrame(resolved, targetTimeStep)
    if (currentFrame) {
      resolved.manifest_url = currentFrame.manifest_url
      resolved.bin_url = currentFrame.bin_url
      resolved.source_time_step = currentFrame.time_step
      resolved.dimensions = currentFrame.dimensions ?? resolved.dimensions
      resolved.origin = currentFrame.origin ?? resolved.origin
      resolved.spacing = currentFrame.spacing ?? resolved.spacing
      resolved.value_type = currentFrame.value_type ?? resolved.value_type
      resolved.normalized = currentFrame.normalized ?? resolved.normalized
      resolved.normalize_mode =
        currentFrame.normalize_mode ?? resolved.normalize_mode
      resolved.original_value_range =
        currentFrame.original_value_range ?? resolved.original_value_range
      if (currentFrame.vmin != null) resolved.vmin = currentFrame.vmin
      if (currentFrame.vmax != null) resolved.vmax = currentFrame.vmax
    }
  } else if (manifestOverrideUrl) {
    resolved.manifest_url = manifestOverrideUrl
  }

  // 从 metadata 注入全局 vmin/vmax（跨时间步一致的归一化值域）
  // volume-dataset 接口的 original_value_range 优先；缺失时再回退 metadata。
  if (resolved.variable) {
    const range = taskStore.getVariableRange(resolved.variable)
    console.log('[VolumePayload] cacheVolumePayload 注入值域:', {
      variable: resolved.variable,
      range,
      existingVmin: resolved.vmin,
      existingVmax: resolved.vmax,
    })
    if (
      (resolved.vmin == null || resolved.vmax == null) &&
      range &&
      range.vmin != null &&
      range.vmax != null
    ) {
      resolved.vmin = range.vmin
      resolved.vmax = range.vmax
    }
  }

  const keys = new Set([SHARED_VOLUME_PAYLOAD_KEY])
  idCandidates.forEach((value) => {
    if (value == null) return
    const sid = String(value).trim()
    if (sid) keys.add(sid)
  })
  if (resolved.id != null && String(resolved.id).trim()) {
    keys.add(String(resolved.id).trim())
  }
  if (resolved.local_id != null && String(resolved.local_id).trim()) {
    keys.add(String(resolved.local_id).trim())
  }
  if (resolved.layer_id != null && String(resolved.layer_id).trim()) {
    keys.add(String(resolved.layer_id).trim())
  }
  if (resolved.variable != null && String(resolved.variable).trim()) {
    keys.add(String(resolved.variable).trim())
  }
  if (resolved.task_id != null && resolved.variable != null) {
    keys.add(`volume:${resolved.task_id}:${resolved.variable}`)
  }
  keys.forEach((key) => {
    if (key) runtimeState.value.volumePayloads.set(key, resolved)
  })

  // 触发预加载：如果 payload 包含 CSV URL，立即开始后台解析
  console.log('[VolumePayload] 检查预加载条件:', {
    hasVariable: !!resolved.variable,
    hasSchedulePreload: !!volumeModeDelegate?.schedulePreload,
    hasCsvUrls:
      Array.isArray(resolved.csv_urls) && resolved.csv_urls.length > 0,
    hasUrlsCsv:
      Array.isArray(resolved.urls_csv) && resolved.urls_csv.length > 0,
    hasVolumeUrls:
      Array.isArray(resolved.volume_urls) && resolved.volume_urls.length > 0,
    hasCsvUrl: !!resolved.csv_url,
    hasUrl: !!resolved.url,
    hasCsv: !!resolved.csv,
    csvUrlValue: resolved.csv_url,
    urlValue: resolved.url,
    csvValue: resolved.csv,
    payloadKeys: Object.keys(resolved),
  })

  if (
    resolved.variable &&
    volumeModeDelegate?.schedulePreload &&
    isPayloadForVisibleVolumeLayer(resolved, idCandidates)
  ) {
    const globalValueRange =
      resolved.vmin != null && resolved.vmax != null
        ? [Number(resolved.vmin), Number(resolved.vmax)]
        : null
    const candidateList = Array.from(idCandidates || [])
    const preloadLayerKey =
      candidateList
        .map((value) => String(value || '').trim())
        .find((id) =>
          visibleVolumeLayers.value.some((layer) => String(layer?.id) === id),
        ) ||
      String(resolved.layer_id || resolved.id || '').trim()

    // manifest/bin datasets：与勾选图层时的预加载一致
    if (hasVolumeDatasetLocator(resolved)) {
      void volumeModeDelegate.schedulePreload(
        [],
        resolved.variable,
        globalValueRange,
        resolved,
        { layerKey: preloadLayerKey },
      )
      return resolved
    }

    // 收集 CSV URL 预加载
    const urlsToPreload = []

    const csvUrlLists = [
      resolved.volume_urls, // ← 最优先：你们 API 实际返回的字段
      resolved.csv_urls,
      resolved.urls_csv,
      resolved.volume_frame_urls,
      resolved.data_urls,
      resolved.frame_urls,
    ]

    // 先检查数组形式的 URL 列表
    for (const list of csvUrlLists) {
      if (Array.isArray(list) && list.length > 0) {
        urlsToPreload.push(...list)
        console.log('[VolumePayload] 找到数组 URL:', list.length)
        break // 只使用第一个找到的 URL 列表
      }
    }

    // 如果没有数组，检查单个 URL
    if (urlsToPreload.length === 0) {
      const singleUrls = [resolved.csv_url, resolved.url, resolved.csv]
      console.log('[VolumePayload] 检查单个 URL:', singleUrls)
      for (const url of singleUrls) {
        console.log('[VolumePayload] 检查 URL:', {
          url,
          type: typeof url,
          trimmed: url?.trim?.(),
        })
        if (url && typeof url === 'string' && url.trim()) {
          urlsToPreload.push(url.trim())
          console.log('[VolumePayload] 找到单个 URL:', url.trim())
          break
        }
      }
    }

    if (urlsToPreload.length > 0) {
      console.log('[VolumePayload] 触发预加载:', {
        variable: resolved.variable,
        urlCount: urlsToPreload.length,
        globalValueRange,
        firstUrl: urlsToPreload[0]?.substring(
          urlsToPreload[0].lastIndexOf('/') + 1,
        ),
      })
      volumeModeDelegate.schedulePreload(
        urlsToPreload,
        resolved.variable,
        globalValueRange,
        resolved,
        { layerKey: preloadLayerKey },
      )
    } else {
      console.log('[VolumePayload] 未找到可预加载的 URL')
    }
  }

  return resolved
}

function getTaskPregenVolumeConfig() {
  const pregen =
    props.currentTask?.pregen_config || props.currentTask?.params?.pregen_config
  if (!pregen || typeof pregen !== 'object') return null
  return pregen.volume_texture || pregen.volume || null
}

function resolveLayerUsePregen(layer) {
  if (layer?.usePregen !== undefined) return Boolean(layer.usePregen)
  if (props.visualization?.usePregen !== undefined) {
    return Boolean(props.visualization.usePregen)
  }
  return true
}

function payloadMatchesLayerUsePregen(payload, layer) {
  if (!payload || layer?.usePregen === undefined) return true
  if (payload.use_pregen === undefined) return true
  return Boolean(payload.use_pregen) === Boolean(layer.usePregen)
}

function payloadCoversTimeline(payload) {
  if (!payload || typeof payload !== 'object') return false
  const frameCount = Array.isArray(payload.datasets)
    ? payload.datasets.length
    : Array.isArray(payload.volume_dataset_frames)
      ? payload.volume_dataset_frames.length
      : 0
  if (frameCount <= 0) return false
  const timelineCount = Array.isArray(props.timelineTimeSteps)
    ? props.timelineTimeSteps.filter((step) => Number.isFinite(Number(step))).length
    : 0
  return timelineCount <= 0 ? frameCount > 1 : frameCount >= timelineCount
}

function buildVolumeRequestParamsFromTask(variable, layer = null) {
  const taskId = props.currentTask?.id
  if (!taskId || !variable) return null

  const rawTimeSteps =
    Array.isArray(props.timelineTimeSteps) && props.timelineTimeSteps.length > 0
      ? props.timelineTimeSteps
      : []
  const timeSteps = rawTimeSteps
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (timeSteps.length === 0) return null

  const usePregen = resolveLayerUsePregen(layer)
  const volumeConfig = usePregen ? getTaskPregenVolumeConfig() : null
  const visualizationMode = props.visualization?.volume_res_mode || 'resolution'
  const resolution = Number(
    usePregen
      ? volumeConfig?.resolution
      : props.visualization?.volume_resolution,
  )
  const samplingRatio = Number(
    usePregen
      ? volumeConfig?.sampling_ratio
      : visualizationMode === 'sampling'
        ? props.visualization?.sampling_ratio
        : null,
  )
  const params = {
    task_id: taskId,
    time_step: timeSteps,
    variable,
    use_pregen: usePregen,
  }

  if (Number.isFinite(samplingRatio) && samplingRatio > 0) {
    params.sampling_ratio = samplingRatio
  }
  if (Number.isFinite(resolution) && resolution > 0) {
    params.resolution = Math.max(8, Math.min(512, Math.round(resolution)))
  }

  return params
}

function summarizeVolumePayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  return {
    keys: Object.keys(payload),
    variable: payload.variable ?? null,
    volume_dataset_frames: Array.isArray(payload.volume_dataset_frames)
      ? payload.volume_dataset_frames.length
      : 0,
    csv_urls: Array.isArray(payload.csv_urls) ? payload.csv_urls.length : 0,
    urls_csv: Array.isArray(payload.urls_csv) ? payload.urls_csv.length : 0,
    urls: Array.isArray(payload.urls) ? payload.urls.length : 0,
    volume_urls: Array.isArray(payload.volume_urls)
      ? payload.volume_urls.length
      : 0,
    volume_frame_urls: Array.isArray(payload.volume_frame_urls)
      ? payload.volume_frame_urls.length
      : 0,
    data_urls: Array.isArray(payload.data_urls) ? payload.data_urls.length : 0,
    frame_urls: Array.isArray(payload.frame_urls)
      ? payload.frame_urls.length
      : 0,
    positions_urls: Array.isArray(payload.positions_urls)
      ? payload.positions_urls.length
      : 0,
    colors_urls: Array.isArray(payload.colors_urls)
      ? payload.colors_urls.length
      : 0,
    csv_url: payload.csv_url || null,
    url: payload.url || null,
    csv: payload.csv || null,
    positions_url: payload.positions_url || null,
    colors_url: payload.colors_url || null,
  }
}

async function requestVolumePayloadForLayer(layer, options = {}) {
  if (!layer || layer.kind !== 'volume') return null
  const variable = extractVolumeVariableFromLayer(layer)
  if (!variable) return null
  const targetTimeStep =
    options.timeStep != null ? options.timeStep : currentTimeStep.value
  const preferFullTimeline = options.preferFullTimeline === true

  const testManifestUrl = String(
    props.visualization?.testManifestUrl ||
      (USE_PUBLIC_TEST_VOLUME_DATA ? PUBLIC_TEST_VOLUME_MANIFEST_URL : ''),
  ).trim()
  const testVolumeDatasetFrames = Array.isArray(
    props.visualization?.testVolumeDatasetFrames,
  )
    ? props.visualization.testVolumeDatasetFrames
    : []
  const testVolumeCsvUrl = String(
    props.visualization?.testVolumeCsvUrl || '',
  ).trim()

  if (testManifestUrl) {
    // 直接使用 manifest.json + bin 渲染（与 TestBinVolumeView 一致）
    const directPayload = {
      id: layer.id,
      local_id: layer.id,
      layer_id: layer.id,
      task_id: props.currentTask?.id ?? null,
      variable,
      time_step: testVolumeDatasetFrames.length
        ? testVolumeDatasetFrames.map((frame) => frame.time_step)
        : Array.isArray(props.timelineTimeSteps) && props.timelineTimeSteps.length
          ? props.timelineTimeSteps
          : [currentTimeStep.value],
      manifest_url: testManifestUrl,
      volume_dataset_frames: testVolumeDatasetFrames,
    }
    return cacheVolumePayload(directPayload, [layer.id, variable], targetTimeStep)
  }

  if (testVolumeCsvUrl) {
    const directPayload = {
      id: layer.id,
      local_id: layer.id,
      layer_id: layer.id,
      task_id: props.currentTask?.id ?? null,
      variable,
      time_step:
        Array.isArray(props.timelineTimeSteps) && props.timelineTimeSteps.length
          ? props.timelineTimeSteps
          : [currentTimeStep.value],
      csv_url: testVolumeCsvUrl,
    }

    return cacheVolumePayload(directPayload, [layer.id, variable], targetTimeStep)
  }

  if (isRadarMockVolumeVariableId(variable)) {
    const rawSteps =
      Array.isArray(props.timelineTimeSteps) && props.timelineTimeSteps.length > 0
        ? props.timelineTimeSteps
        : []
    let timeSteps = rawSteps.map((t) => Number(t)).filter((t) => Number.isFinite(t))
    if (!timeSteps.length) {
      const one = Number(currentTimeStep.value)
      timeSteps = Number.isFinite(one) ? [one] : []
    }
    if (!timeSteps.length) {
      return null
    }
    const chunk = buildRadarVolumeMockApiChunk({
      visualization: props.visualization,
      taskId: props.currentTask?.id,
      timeSteps,
      radarBandId: extractRadarMockVolumeBandId(variable),
    })
    const directPayload = {
      id: layer.id,
      local_id: layer.id,
      layer_id: layer.id,
      task_id: props.currentTask?.id ?? null,
      variable: chunk.variable || variable,
      time_step: timeSteps,
      val_min: chunk.val_min,
      val_max: chunk.val_max,
      vmin: chunk.vmin,
      vmax: chunk.vmax,
      datasets: chunk.datasets,
      use_pregen: resolveLayerUsePregen(layer),
    }
    return cacheVolumePayload(directPayload, [layer.id, variable], targetTimeStep)
  }

  let existingCandidate =
    getVolumePayloadByIdLoose(layer.id) || findVolumePayloadByVariable(variable)
  if (
    existingCandidate &&
    normalizeVolumeKey(existingCandidate.variable) !==
      normalizeVolumeKey(variable) &&
    Array.isArray(existingCandidate.datasets) &&
    existingCandidate.datasets.length > 0
  ) {
    existingCandidate = deriveVolumePayloadForLayer(
      existingCandidate,
      layer,
      variable,
    )
  }
  const existing = volumePayloadCanProvideVariable(existingCandidate, variable)
    ? existingCandidate
    : null
  console.log('[VolumePayload] requestVolumePayloadForLayer 查找缓存:', {
    layerId: layer.id,
    variable,
    existingFound: !!existing,
    existingHasManifest: hasVolumeManifestLocator(existing),
    existingHasData: hasVolumeDataLocator(existing),
    existingVariable: existing?.variable,
    cacheSize: runtimeState.value.volumePayloads.size,
  })
  if (!preferFullTimeline) {
    const datasetPayload = resolveVolumeDatasetFramePayload(existing, targetTimeStep)
    if (datasetPayload && payloadMatchesLayerUsePregen(existing, layer)) {
      return cacheVolumePayload(
        datasetPayload,
        [layer.id, variable],
        targetTimeStep,
      )
    }
  }

  // 新接口返回的 datasets 已包含所有时间步，直接使用缓存，不再请求 API
  if (
    payloadMatchesLayerUsePregen(existing, layer) &&
    payloadCoversTimeline(existing)
  ) {
    console.log('[VolumePayload] 使用缓存 datasets (所有时间步已预加载):', {
      variable,
      datasetsLength: existing.datasets?.length,
      frameCount: existing.volume_dataset_frames?.length,
    })
    return cacheVolumePayload(existing, [layer.id, variable], targetTimeStep)
  }

  const fullDatasetPayload = runtimeState.value.volumePayloads.get(
    FULL_VOLUME_DATASET_PAYLOAD_KEY,
  )
  if (
    payloadMatchesLayerUsePregen(fullDatasetPayload, layer) &&
    payloadCoversTimeline(fullDatasetPayload)
  ) {
    const derivedPayload = cacheVolumePayload(
      {
        ...fullDatasetPayload,
        task_id: fullDatasetPayload.task_id ?? props.currentTask?.id ?? null,
        variable,
        id: layer.id,
        local_id: layer.id,
        layer_id: layer.id,
      },
      [layer.id, variable],
      targetTimeStep,
    )
    if (hasVolumeDataLocator(derivedPayload)) {
      console.log(
        '[VolumePayload] 使用自动加载完整 datasets 派生图层 payload:',
        {
          variable,
          datasetsLength: fullDatasetPayload.datasets.length,
        },
      )
      return derivedPayload
    }
  }

  const existingSourceUrl = resolveVolumeSourceUrlForLayer(
    existing,
    false,
    targetTimeStep,
  )
  const existingHasManifest =
    hasVolumeManifestLocator(existing) &&
    String(existing?.source_time_step ?? '') === String(targetTimeStep) &&
    existing?.source_volume_url === existingSourceUrl

  // 如果缓存中有数据定位器（无论单帧还是多帧），直接使用
  if (
    !preferFullTimeline &&
    existingHasManifest &&
    payloadMatchesLayerUsePregen(existing, layer)
  ) {
    return cacheVolumePayload(existing, [layer.id, variable], targetTimeStep)
  }
  if (
    !preferFullTimeline &&
    payloadMatchesLayerUsePregen(existing, layer) &&
    hasVolumeDataLocator(existing) &&
    existingSourceUrl &&
    !/\.csv(\?|$)/i.test(existingSourceUrl)
  ) {
    console.log('[VolumePayload] 使用缓存 payload (避免重复请求):', {
      variable,
      hasVolumeUrls: Array.isArray(existing.volume_urls),
      volumeUrlsLength: existing.volume_urls?.length,
      hasCsvUrls: Array.isArray(existing.csv_urls),
      csvUrlsLength: existing.csv_urls?.length,
      hasSingleUrl: !!existing.csv_url || !!existing.url || !!existing.csv,
    })
    // 直接返回缓存，不再重新请求 API
    return cacheVolumePayload(existing, [layer.id, variable], targetTimeStep)
  }

  const requestParams = buildVolumeRequestParamsFromTask(variable, layer)
  if (!requestParams) {
    console.warn('[VolumeAutoLoad] skip request: invalid params', {
      layerId: layer.id,
      variable,
      taskId: props.currentTask?.id ?? null,
      currentTimeStep: currentTimeStep.value,
      timelineTimeSteps: props.timelineTimeSteps || [],
    })
    return null
  }

  const requestMode = preferFullTimeline ? 'full' : 'frame'
  const requestKey = `${requestMode}::${requestParams.task_id}::${String(layer.id)}::${variable}::${String(targetTimeStep)}::${String(requestParams.use_pregen)}`
  if (volumePayloadPending.has(requestKey)) {
    return volumePayloadPending.get(requestKey)
  }

  const pending = (async () => {
    const volumeRequest = {
      task_id: requestParams.task_id,
      time_step: requestParams.time_step,
      variables: [variable],
      use_pregen: requestParams.use_pregen,
    }
    if (requestParams.resolution !== undefined) {
      volumeRequest.resolution = requestParams.resolution
    }
    if (requestParams.sampling_ratio !== undefined) {
      volumeRequest.sampling_ratio = requestParams.sampling_ratio
    }

    if (!props.getVolumeDataset) {
      console.warn('[VolumePayload] skip request: getVolumeDataset 未配置')
      return null
    }

    const volumeResponse = await props.getVolumeDataset(volumeRequest)
    const volumePayload = volumeResponse?.data || volumeResponse

    console.log('[VolumePayload] API 返回:', {
      hasDatasets: Array.isArray(volumePayload?.datasets),
      datasetsLength: volumePayload?.datasets?.length,
      payloadKeys: Object.keys(volumePayload || {}),
      firstManifestUrl: volumePayload?.datasets?.[0]?.manifest_url || null,
    })

    if (!hasVolumeDataLocator(volumePayload)) return null
    return cacheVolumePayload(
      {
        ...volumePayload,
        task_id: requestParams.task_id,
        variable,
        id: layer.id,
        local_id: layer.id,
        layer_id: layer.id,
        time_step: requestParams.time_step,
        use_pregen: requestParams.use_pregen,
      },
      [layer.id, variable],
      targetTimeStep,
    )
  })()

  volumePayloadPending.set(requestKey, pending)
  try {
    return await pending
  } finally {
    volumePayloadPending.delete(requestKey)
  }
}

function getVolumePayloadByIdLoose(layerId) {
  if (layerId == null) return null
  const sid = String(layerId)
  if (runtimeState.value.volumePayloads.has(sid)) {
    return runtimeState.value.volumePayloads.get(sid)
  }
  const target = normalizeVolumeKey(sid)
  if (!target) return null
  for (const [key, payload] of runtimeState.value.volumePayloads.entries()) {
    if (normalizeVolumeKey(key) === target) return payload
  }
  return null
}

const currentTimeStep = computed(() => {
  const raw = props.timelineTimeSteps?.[props.timelineCurrentStep]
  if (raw == null) return props.timelineCurrentStep
  return Number.isFinite(Number(raw)) ? Number(raw) : raw
})

const currentPhysicalTime = computed(() => {
  const raw = props.timelinePhysicalTimes?.[props.timelineCurrentStep]
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
})

function resolveFrameUrlFromLayer(layer) {
  return normalizeUrl(
    resolvePreviewFrameUrl({
      layer,
      currentStep: props.timelineCurrentStep,
      currentPhysicalTime: currentPhysicalTime.value,
      simulationTimeStep: currentTimeStep.value,
    }),
  )
}

// 创建 XYZ 轴线标识（仅显示，无交互）
// 坐标轴固定在世界坐标原点 (0,0,0)，不随平面坐标变化而移动
// bounds: 可选，几何包围盒原始数据（可能含 .data 包装），标签将放在包围盒外面
function createAxisHelpers(parentGroup, rawBounds) {
  const axisLength = 6000
  const axisOrigin = new THREE.Vector3(0, 0, 0)

  // 解析包围盒数据（与 scaleModelToBounds 一致）
  const b = rawBounds?.data || rawBounds
  const bounds =
    b && (b.xmin != null || b.x_max != null)
      ? {
          xmin: (b.xmin ?? b.x_min ?? 0) / 100,
          xmax: (b.xmax ?? b.x_max ?? 0) / 100,
          ymin: (b.ymin ?? b.y_min ?? 0) / 100,
          ymax: (b.ymax ?? b.y_max ?? 0) / 100,
          zmin: (b.zmin ?? b.z_min ?? 0) / 100,
          zmax: (b.zmax ?? b.z_max ?? 0) / 100,
        }
      : null

  // X轴 - 红色
  const xGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(axisLength, 0, 0),
  ])
  const xMaterial = new THREE.LineBasicMaterial({
    color: '#ff4444',
    linewidth: 2,
  })
  const xAxis = new THREE.Line(xGeometry, xMaterial)
  xAxis.position.copy(axisOrigin)
  parentGroup.add(xAxis)

  // Y轴 - 绿色
  const yGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, axisLength, 0),
  ])
  const yMaterial = new THREE.LineBasicMaterial({
    color: '#44ff44',
    linewidth: 2,
  })
  const yAxis = new THREE.Line(yGeometry, yMaterial)
  yAxis.position.copy(axisOrigin)
  parentGroup.add(yAxis)

  // Z轴 - 蓝色（朝上）
  const zGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, axisLength),
  ])
  const zMaterial = new THREE.LineBasicMaterial({
    color: '#4444ff',
    linewidth: 2,
  })
  const zAxis = new THREE.Line(zGeometry, zMaterial)
  zAxis.position.copy(axisOrigin)
  parentGroup.add(zAxis)

  // 坐标轴 X/Y/Z 大标签已移除，仅保留三色轴线
}

function refreshAxisHelpers(bounds = null) {
  if (!axisGroup) return

  updateGroundPlanePosition(bounds)

  const existing = axisGroup.children.find(
    (child) => child?.name === AXIS_HELPERS_GROUP_NAME,
  )
  if (existing) {
    axisGroup.remove(existing)
    clearGroup(existing)
  }

  const helpersGroup = new THREE.Group()
  helpersGroup.name = AXIS_HELPERS_GROUP_NAME
  createAxisHelpers(helpersGroup, bounds)
  axisGroup.add(helpersGroup)
}

function updateGroundPlanePosition(rawBounds = null) {
  const groundPlane = axisGroup?.children.find(
    (child) => child?.name === 'realistic-scene-ground',
  )
  if (!groundPlane) return

  const bounds = normalizeModelBounds(rawBounds)
  const bottomZ = bounds ? bounds.min[2] / 100 : 0
  groundPlane.position.z = bottomZ - GROUND_PLANE_BOUNDS_OFFSET
}

const {
  addMonitoringPoint,
  updateMonitoringPoint,
  deleteMonitoringPoint,
  selectMonitoringPoint,
  focusMonitoringPoint,
  renderMonitoringPointVisuals,
  setAddingPointMode,
  getMonitoringPoints,
  syncMonitoringPoints,
  pickMonitoringPointGroup,
  resolveMonitoringPointFromCurrentRay,
  updateDraggedMonitoringPointFromRay,
  finishMonitoringPointDrag,
  confirmPendingPointMove,
  cancelPendingPointMove,
  beginMonitoringPointDrag,
  consumeSuppressNextPointClick,
  isAddingPointMode,
  isDraggingPoint,
  disposeMonitoringPoints,
} = createMonitoringPoints({
  getMonitoringPointsGroup: () => monitoringPointsGroup,
  getRaycaster: () => raycaster,
  getCamera: () => camera,
  getControls: () => controls,
  hostRef,
  setRaycasterFromClient: (event) => setRaycasterFromClient(event),
  collectPointPlacementTargets: () => collectPointPlacementTargets(),
  normalizeModelBounds: (rawBounds) => normalizeModelBounds(rawBounds),
  geometryBounds,
  pendingPointMove,
  emit,
})

function setRaycasterFromClient(event) {
  if (!raycaster || !camera || !hostRef.value) return false
  const rect = hostRef.value.getBoundingClientRect()
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(mouse, camera)
  return true
}

function collectPointPlacementTargets() {
  const targets = []
  for (const group of [
    modelGroup,
    planeGroup,
    volumeGroup,
    streamlineGroup,
    particleGroup,
    boundsGroup,
  ]) {
    if (group?.visible !== false) targets.push(group)
  }
  return targets
}

function focusCameraOnObject(object) {
  if (!camera || !controls || !object) return
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  const radius = Math.max(size.x, size.y, size.z, 1)
  const direction = camera.position.clone().sub(controls.target)
  if (direction.lengthSq() < 0.0001) direction.set(1, 1, 1)
  direction.normalize()
  camera.position.copy(center.clone().add(direction.multiplyScalar(radius * 2.2)))
  controls.target.copy(center)
  camera.lookAt(controls.target)
  camera.updateProjectionMatrix?.()
  controls.update?.()
}

function focusCameraOnModelAtAngle(modelKey) {
  if (!camera || !controls) return false
  const model = gltfModels.get(modelKey)
  if (!model) return false

  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return false

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.5)
  const fovRad = (camera.fov * Math.PI) / 360
  const distance = (maxDim / (2 * Math.tan(fovRad))) * 1.55
  const direction = new THREE.Vector3(1, -1, 0.72).normalize()

  controls.target.copy(center)
  camera.position.copy(center).add(direction.multiplyScalar(distance))
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(camera.far || 0, distance * 80, maxDim * 40, 500)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.maxDistance = Math.max(controls.maxDistance || 0, distance * 6)
  controls.update()
  return true
}

function scheduleModelCameraFocus(modelKey) {
  if (!camera || !controls || !DISSOLVE_MODEL_KEYS.has(modelKey)) return
  window.requestAnimationFrame(() => {
    focusCameraOnModelAtAngle(modelKey)
  })
}

function isRealModelCurrentlyVisible() {
  const taskId = props.currentTask?.id
  if (!taskId) return false
  const realModel = gltfModels.get('real')
  if (!realModel?.visible) return false
  return runtimeState.value.visibleLayerIds.has(`realModel:${taskId}`)
}

/**
 * 真实模型首次出现时拉近到侧视构图（与 TestObj/TestGlb 页一致，但距离更近）。
 */
function focusCameraOnRealModelInitial() {
  if (!camera || !controls) return false
  const taskId = props.currentTask?.id
  if (!taskId) return false
  const taskKey = String(taskId)
  if (realModelCameraFocusedTaskKey === taskKey) return false
  if (!isRealModelCurrentlyVisible()) return false

  const realModel = gltfModels.get('real')
  if (!realModel) return false

  realModel.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(realModel)
  if (box.isEmpty()) return false

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.5)
  const fovRad = (camera.fov * Math.PI) / 360
  const distance = (maxDim / (2 * Math.tan(fovRad))) * 0.35

  controls.target.copy(center)
  // 正面视角：从 -Y 方向看向模型中心（Z 轴为竖直向上）
  camera.position.set(
    center.x,
    center.y - distance,
    center.z,
  )
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(camera.far || 0, distance * 80, maxDim * 40, 500)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.maxDistance = Math.max(controls.maxDistance || 0, distance * 6)
  controls.update()

  realModelCameraFocusedTaskKey = taskKey
  console.log('[RealModelCamera] 已对齐真实模型初始视角（正面）:', {
    taskId,
    center: center.toArray(),
    distance,
  })
  return true
}

function scheduleRealModelCameraFocus() {
  if (!camera || !controls) return
  window.requestAnimationFrame(() => {
    focusCameraOnRealModelInitial()
  })
}

function focusCameraOnPlaneLayer(layer) {
  if (!camera || !controls || !isPlaneFocusableLayer(layer)) return false
  const focus = computePlaneLayerCameraFocus({
    layer,
    geometryBounds: geometryBounds.value,
  })
  if (!focus) return false

  const target = new THREE.Vector3().fromArray(focus.target)
  const normal = new THREE.Vector3().fromArray(focus.position).sub(target)
  const distance = normal.length()
  if (distance > 1e-6) {
    normal.divideScalar(distance)
  } else {
    normal.set(0, 0, 1)
  }

  controls.target.copy(target)
  camera.position.copy(target).add(normal.multiplyScalar(focus.distance))
  camera.updateProjectionMatrix()
  controls.update()

  console.log('[PlaneCamera] 已平移视角至切面:', {
    layerId: layer?.id,
    plane: focus.plane,
    coordinateCm: focus.coordinateCm,
  })
  return true
}

function resolveFrameUrlFromRuntimeLayer(layer) {
  if (!layer?.id) return ''
  const payload = runtimeState.value.layerPayloads.get(String(layer.id))
  if (!payload) return ''
  const urls = Array.isArray(payload.urls) ? payload.urls : []
  const steps = Array.isArray(payload.time_step) ? payload.time_step : []
  if (!urls.length) return ''
  const byTimeStepIndex = steps.findIndex(
    (item) => Number(item) === Number(currentTimeStep.value),
  )
  if (byTimeStepIndex >= 0 && urls[byTimeStepIndex]) {
    return normalizeUrl(urls[byTimeStepIndex])
  }
  const safeIndex = Math.min(
    Math.max(props.timelineCurrentStep, 0),
    Math.max(urls.length - 1, 0),
  )
  return normalizeUrl(urls[safeIndex] || urls[0])
}

function getTextureUrlFor2DLayer(layer) {
  return (
    resolveFrameUrlFromLayer(layer) ||
    resolveFrameUrlFromRuntimeLayer(layer) ||
    ''
  )
}

const activeTextureUrl = computed(() => {
  // 依赖 currentTimeStep 以确保时间轴变化时重新计算
  const _timeStep = currentTimeStep.value
  if (!visible2DLayers.value.length) return ''
  return (
    getTextureUrlFor2DLayer(active2DLayer.value) ||
    normalizeUrl(props.previewImageUrl)
  )
})

const visible2DTextureSignature = computed(() => {
  return visible2DLayers.value
    .map((layer) => `${layer?.id}:${getTextureUrlFor2DLayer(layer) || ''}`)
    .join('|')
})

watch(
  () => [
    sceneMode.value,
    props.selectedLayerId,
    active2DLayer.value?.id ?? null,
    currentTimeStep.value,
    currentPhysicalTime.value,
    activeTextureUrl.value,
    normalizeUrl(props.previewImageUrl),
  ],
  ([
    mode,
    selectedLayerId,
    activeLayerId,
    timeStep,
    physicalTime,
    planeUrl,
    previewUrl,
  ]) => {
    if (mode !== 'cloud' && mode !== 'vector') return
  },
  { immediate: true },
)

const activeVolumePayload = computed(() => {
  const explicitSelectedLayerRaw =
    props.selectedLayerId != null
      ? (props.generatedVizLayers || []).find(
          (layer) => String(layer.id) === String(props.selectedLayerId),
        ) || null
      : null
  const explicitSelectedLayer =
    explicitSelectedLayerRaw &&
    explicitSelectedLayerRaw.kind === 'volume' &&
    isLayerVisible(explicitSelectedLayerRaw) &&
    explicitSelectedLayerRaw.loaded !== false
      ? explicitSelectedLayerRaw
      : null
  const variableSourceLayer =
    explicitSelectedLayer ||
    selectedVolumeLayer.value ||
    findFirstVisibleLayerByKinds(['volume'])
  const layerPayload = getVolumePayloadForLayer(variableSourceLayer)
  if (layerPayload) return layerPayload
  const selectedVariable = extractVolumeVariableFromLayer(variableSourceLayer)
  const sharedPayload =
    runtimeState.value.volumePayloads.get(SHARED_VOLUME_PAYLOAD_KEY) ||
    findFirstVolumePayloadWithData()
  if (
    !sharedPayload ||
    !payloadMatchesLayerUsePregen(sharedPayload, variableSourceLayer) ||
    !volumePayloadCanProvideVariable(sharedPayload, selectedVariable)
  ) {
    return null
  }
  const resolvedVariable = String(
    selectedVariable || sharedPayload.variable || '',
  ).trim()
  if (!resolvedVariable) return sharedPayload
  if (String(sharedPayload.variable || '').trim() === resolvedVariable) {
    return deriveVolumePayloadForLayer(
      sharedPayload,
      variableSourceLayer,
      resolvedVariable,
    )
  }
  return deriveVolumePayloadForLayer(
    sharedPayload,
    variableSourceLayer,
    resolvedVariable,
  )
})

const {
  syncSmokeToScene,
  tickSmokeLayer,
  clearSmokeScene,
  isPersonSmokeLayer,
  disposeSmokeTexture,
} = createSmokeSystem({
  getScene: () => scene,
  getSmokeGroup: () => smokeGroup,
  getGltfModels: () => gltfModels,
  getVisualization: () => props.visualization,
  getCurrentTask: () => props.currentTask,
  getTimelineCurrentStep: () => props.timelineCurrentStep,
  currentTimeStep,
  activeSmokeLayer,
  hasVisibleSmokeLayer,
  selectedVolumeLayer,
  activeVolumePayload,
  extractVolumeVariableFromLayer,
  findFirstVolumePayloadWithData,
  hasVolumeManifestLocator,
  hasVolumeDataLocator,
  cacheVolumePayload,
  requestVolumePayloadForLayer,
  volumePayloadCanProvideVariable,
  getModelMeshMaterialName,
})

function getVolumePayloadForLayer(layer, targetTimeStep = currentTimeStep.value) {
  if (!layer || layer.kind !== 'volume' || !isLayerVisible(layer)) return null
  const variable = extractVolumeVariableFromLayer(layer)
  const explicitCandidate =
    getVolumePayloadByIdLoose(layer.id) || findVolumePayloadByVariable(variable)
  const explicitPayload = volumePayloadCanProvideVariable(
    explicitCandidate,
    variable,
  )
    ? explicitCandidate
    : null
  if (
    payloadMatchesLayerUsePregen(explicitPayload, layer) &&
    (hasVolumeDataLocator(explicitPayload) ||
      hasVolumeManifestLocator(explicitPayload))
  ) {
    console.log('[VolumePayload] getVolumePayloadForLayer 命中缓存:', {
      layerId: layer.id,
      variable: explicitPayload?.variable,
      hasManifest: !!explicitPayload?.manifest_url,
      hasBin: !!explicitPayload?.bin_url,
      hasDatasetFrames: Array.isArray(explicitPayload?.volume_dataset_frames),
    })
    return deriveVolumePayloadForLayer(
      explicitPayload,
      layer,
      variable,
      targetTimeStep,
    )
  }

  const sharedPayload =
    runtimeState.value.volumePayloads.get(SHARED_VOLUME_PAYLOAD_KEY) ||
    findFirstVolumePayloadWithData()
  if (
    !sharedPayload ||
    !payloadMatchesLayerUsePregen(sharedPayload, layer) ||
    !volumePayloadCanProvideVariable(sharedPayload, variable)
  ) {
    console.log('[VolumePayload] getVolumePayloadForLayer 无可用 payload:', {
      layerId: layer.id,
      variable,
      cacheSize: runtimeState.value.volumePayloads.size,
    })
    return null
  }

  const resolvedVariable = String(
    variable || sharedPayload.variable || '',
  ).trim()
  console.log('[VolumePayload] getVolumePayloadForLayer 使用共享缓存:', {
    layerId: layer.id,
    variable: resolvedVariable,
    sharedHasManifest: !!sharedPayload?.manifest_url,
    sharedHasBin: !!sharedPayload?.bin_url,
    sharedHasFrames: Array.isArray(sharedPayload?.volume_dataset_frames),
  })
  if (!resolvedVariable) return sharedPayload
  if (String(sharedPayload.variable || '').trim() === resolvedVariable) {
    return deriveVolumePayloadForLayer(
      sharedPayload,
      layer,
      resolvedVariable,
      targetTimeStep,
    )
  }
  return deriveVolumePayloadForLayer(
    sharedPayload,
    layer,
    resolvedVariable,
    targetTimeStep,
  )
}

const activeStreamlinePayload = computed(() => {
  return hasVisibleStreamlineLayer.value
    ? runtimeState.value.streamlinePayload || null
    : null
})

const particleVelocityFieldCache = new Map()

function resolveParticleSettings() {
  const particle = props.visualization?.particle || {}
  return { ...particle }
}

function resolveParticleVariableUrl(source, variableName) {
  if (!source || typeof source !== 'object') return ''
  const target = normalizeVolumeKey(variableName)
  const direct =
    source?.bin_urls?.[variableName] ||
    source?.binUrls?.[variableName] ||
    source?.velocity_urls?.[variableName] ||
    source?.velocityUrls?.[variableName]
  if (direct) return String(direct)
  for (const map of [
    source?.bin_urls,
    source?.binUrls,
    source?.velocity_urls,
    source?.velocityUrls,
  ]) {
    if (!map || typeof map !== 'object') continue
    for (const [key, url] of Object.entries(map)) {
      if (normalizeVolumeKey(key) === target && url) return String(url)
    }
  }
  const variables = Array.isArray(source.variables) ? source.variables : []
  const hit = variables.find((item) => {
    const name = normalizeVolumeKey(item?.name)
    const slug = normalizeVolumeKey(item?.slug)
    return name === target || slug === target
  })
  return String(
    hit?.file_url ||
      hit?.bin_url ||
      hit?.file ||
      hit?.url ||
      hit?.data_url ||
      '',
  )
}

function resolveParticleVariableRange(source, variableName) {
  const target = normalizeVolumeKey(variableName)
  const variables = Array.isArray(source?.variables) ? source.variables : []
  const hit = variables.find((item) => {
    const name = normalizeVolumeKey(item?.name)
    const slug = normalizeVolumeKey(item?.slug)
    return name === target || slug === target
  })
  return (
    hit?.originalValueRange ||
    hit?.original_value_range ||
    hit?.valueRange ||
    hit?.value_range || [-0.0003, 0.0003]
  )
}

async function fetchParticleManifest(source) {
  const manifestUrl = String(
    source?.manifest_url || source?.manifestUrl || '',
  ).trim()
  if (!manifestUrl) return null
  const response = await fetch(normalizeUrl(manifestUrl))
  if (!response.ok)
    throw new Error(`粒子速度场 manifest 加载失败: ${response.status}`)
  const manifest = await response.json()
  return {
    manifest,
    baseUrl: normalizeUrl(manifestUrl).replace(/[^/]*$/, ''),
  }
}

async function readParticleVariableBuffer(source, manifestInfo, variableName) {
  const manifest = manifestInfo?.manifest
  const mergedSource = manifest || source
  const rawUrl =
    resolveParticleVariableUrl(source, variableName) ||
    resolveParticleVariableUrl(manifest, variableName)
  if (!rawUrl) throw new Error(`粒子速度场缺少 ${variableName}`)
  const url =
    /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('/')
      ? normalizeUrl(rawUrl)
      : normalizeUrl(`${manifestInfo?.baseUrl || ''}${rawUrl}`)
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`${variableName} 加载失败: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const range = resolveParticleVariableRange(mergedSource, variableName)
  return { buffer, range }
}

function decodeParticleBuffer(buffer, range, total) {
  if (buffer.byteLength === total * 4) {
    return new Float32Array(buffer)
  }
  const raw = new Uint16Array(buffer)
  return decodeNormalizedUint16(raw, range, total)
}

function findParticleVelocitySource(timeStep) {
  const candidates = [
    runtimeState.value.volumePayloads.get(FULL_VOLUME_DATASET_PAYLOAD_KEY),
    runtimeState.value.volumePayloads.get(SHARED_VOLUME_PAYLOAD_KEY),
    findFirstVolumePayloadWithData(),
  ]
  for (const payload of candidates) {
    const source = findParticleDatasetSource(payload, timeStep)
    if (source) return source
  }
  return null
}

function buildParticleVelocityRequest(layer) {
  const usePregen = resolveLayerUsePregen(layer)
  const volumeConfig = usePregen ? getTaskPregenVolumeConfig() : null
  const visualizationMode = props.visualization?.volume_res_mode || 'resolution'
  const rawTimeSteps =
    Array.isArray(props.timelineTimeSteps) && props.timelineTimeSteps.length > 0
      ? props.timelineTimeSteps
      : [currentTimeStep.value]
  return buildParticleVelocityDatasetRequest({
    taskId: props.currentTask?.id,
    timeSteps: rawTimeSteps,
    usePregen,
    resolution: usePregen
      ? volumeConfig?.resolution
      : props.visualization?.volume_resolution,
    samplingRatio: usePregen
      ? volumeConfig?.sampling_ratio
      : visualizationMode === 'sampling'
        ? props.visualization?.sampling_ratio
        : null,
  })
}

async function requestParticleVelocitySourceFromBackend(layer, timeStep) {
  if (!props.getVolumeDataset) return null
  const request = buildParticleVelocityRequest(layer)
  if (!request) return null
  const response = await props.getVolumeDataset(request)
  const payload = response?.data || response
  if (!payload || typeof payload !== 'object') return null
  const cached = {
    ...payload,
    task_id: request.task_id,
    id: layer?.id || `particle:${request.task_id}`,
    local_id: layer?.id || `particle:${request.task_id}`,
    layer_id: layer?.id || `particle:${request.task_id}`,
    use_pregen: request.use_pregen,
  }
  runtimeState.value.volumePayloads.set('particleVelocity', cached)
  if (layer?.id) runtimeState.value.volumePayloads.set(String(layer.id), cached)
  const directSource = findParticleDatasetSource(cached, timeStep)
  if (directSource) return directSource

  const datasets = Array.isArray(cached.datasets) ? cached.datasets : []
  const targetStep = String(timeStep)
  return (
    datasets.find((dataset) => {
      const raw =
        dataset?.time_step ??
        dataset?.timeStep ??
        dataset?.step ??
        dataset?.simulation_time_step
      return (
        String(raw) === targetStep &&
        particleSourceMayContainVelocityManifest(dataset)
      )
    }) ||
    datasets.find((dataset) => particleSourceMayContainVelocityManifest(dataset)) ||
    (particleSourceMayContainVelocityManifest(cached) ? cached : null)
  )
}

async function loadParticleVelocityFieldFromSource(source) {
  const manifestInfo = await fetchParticleManifest(source)
  const manifest = manifestInfo?.manifest || null
  const { dims, origin, spacing } = resolveParticleFieldGridFromSource(
    manifest || source,
  )
  const total = dims[0] * dims[1] * dims[2]

  const [r0, r1, r2] = await Promise.all([
    readParticleVariableBuffer(source, manifestInfo, 'velocity0'),
    readParticleVariableBuffer(source, manifestInfo, 'velocity1'),
    readParticleVariableBuffer(source, manifestInfo, 'velocity2'),
  ])
  const vx = decodeParticleBuffer(r0.buffer, r0.range, total)
  const vy = decodeParticleBuffer(r1.buffer, r1.range, total)
  const vz = decodeParticleBuffer(r2.buffer, r2.range, total)

  const field = {
    dims,
    origin,
    spacing,
    bounds: {
      min: [...origin],
      max: origin.map((v, i) => v + spacing[i] * (dims[i] - 1)),
    },
    vx, vy, vz,
  }

  const emitter =
    resolveParticleEmitterFromManifest(manifest) ||
    resolveParticleEmitterFromField(field)
  if (emitter) field.emitter = emitter

  return { field, manifest }
}

function createMockVelocityField() {
  const nx = 48, ny = 48, nz = 48
  // 原始数据坐标（cm），覆盖整个场景，和 manifest 一致
  const centerCm = [220, -180, 30]
  const halfSpan = 250  // ±250cm = ±2.5m，总跨度 5m
  const originCm = [
    centerCm[0] - halfSpan,
    centerCm[1] - halfSpan,
    centerCm[2] - halfSpan,
  ]
  const spanCm = halfSpan * 2
  const spacingCm = [spanCm / (nx - 1), spanCm / (ny - 1), spanCm / (nz - 1)]
  const total = nx * ny * nz
  const vx = new Float32Array(total)
  const vy = new Float32Array(total)
  const vz = new Float32Array(total)
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const px = originCm[0] + ix * spacingCm[0]
        const py = originCm[1] + iy * spacingCm[1]
        const pz = originCm[2] + iz * spacingCm[2]
        const dx = px - centerCm[0]
        const dy = py - centerCm[1]
        const dz = pz - centerCm[2]
        const idx = iz * ny * nx + iy * nx + ix
        // 归一化坐标 [-1, 1]
        const u = dx / halfSpan
        const v = dy / halfSpan
        const w = dz / halfSpan
        // velocityScale=100, dt=1.6，场值 ~0.3 → 速度 ~0.5m/s
        vx[idx] = 0.3 + w * 0.15 - v * 0.05
        vy[idx] = 0.1 + u * 0.05
        vz[idx] = -u * 0.15 + w * 0.08
      }
    }
  }
  // origin/spacing/bounds 转米，emitter 转米，和体数据/监测点映射规则一致
  const toM = (v) => v / 100
  const origin = originCm.map(toM)
  const spacing = spacingCm.map(toM)
  return {
    dims: [nx, ny, nz],
    origin,
    spacing,
    bounds: {
      min: origin,
      max: origin.map((v, i) => v + spacing[i] * ([nx, ny, nz][i] - 1)),
    },
    vx, vy, vz,
    emitter: centerCm.map(toM),
  }
}

async function requestParticleVelocityField(layer) {
  const timeStep = layer?.time_step ?? layer?.timeStep ?? null
  const cacheKey = `${props.currentTask?.id ?? ''}:${String(timeStep ?? currentTimeStep.value ?? '')}:${String(resolveLayerUsePregen(layer))}`
  if (particleVelocityFieldCache.has(cacheKey)) return particleVelocityFieldCache.get(cacheKey)

  let source = findParticleVelocitySource(timeStep)
  if (!source) {
    try {
      source = await requestParticleVelocitySourceFromBackend(layer, timeStep)
    } catch (error) {
      console.warn('[ParticleVelocityField] backend velocity request failed:', error)
    }
  }
  if (!source) {
    console.warn('[ParticleVelocityField] no velocity source found, falling back to mock')
    return createMockVelocityField()
  }

  try {
    let loaded
    try {
      loaded = await loadParticleVelocityFieldFromSource(source)
    } catch (error) {
      const backendSource = await requestParticleVelocitySourceFromBackend(
        layer,
        timeStep,
      )
      if (!backendSource || backendSource === source) throw error
      loaded = await loadParticleVelocityFieldFromSource(backendSource)
    }
    const { field } = loaded

    particleVelocityFieldCache.set(cacheKey, field)
    console.log('[ParticleVelocityField] real field loaded:', 'dims:', field.dims, 'origin:', field.origin, 'bounds:', field.bounds, 'emitter:', field.emitter)
    return field
  } catch (error) {
    console.warn('[ParticleVelocityField] failed to load real velocity data:', error)
    return createMockVelocityField()
  }
}

const isStreamlineLayerVisible = computed(() => {
  return Boolean(
    selectedStreamlineLayer.value || visibleStreamlineLayers.value[0],
  )
})

let volumeModeDelegate = null
let volumeSyncPromise = null
let volumeSyncQueued = false
let volumeTimelineSyncPromise = null
let volumeTimelineSyncQueued = false
let volumeTimelineSyncPendingStep = null
let volumeTimelineSyncToken = 0
let streamlineSyncPromise = null
let streamlineSyncQueued = false

function formatVolumeProgressCount(current, total) {
  const safeCurrent = Number.isFinite(current) ? current : 0
  const safeTotal = Number.isFinite(total) ? total : 0
  if (safeTotal > 0) {
    return `${safeCurrent.toLocaleString()} / ${safeTotal.toLocaleString()}`
  }
  return `${safeCurrent.toLocaleString()}`
}

function updateVolumeCsvProgress(progress) {
  if (!progress) return

  const phase = String(progress.phase || '')
  const offset = Number(progress.offset)
  const size = Number(progress.size)
  let percentage = 0
  let text = '正在解析体渲染 CSV...'
  let detail = ''

  if (phase === 'detecting') {
    const ratio = Number.isFinite(size) && size > 0 ? offset / size : 0
    percentage = Math.round(Math.max(0, Math.min(1, ratio)) * 35)
    text = '正在识别 CSV 列与采样网格...'
    detail =
      Number.isFinite(size) && size > 0
        ? `已读取 ${formatVolumeProgressCount(offset, size)} 字节`
        : '正在扫描表头与样本'
  } else if (phase === 'grid') {
    const ratio = Number.isFinite(size) && size > 0 ? offset / size : 0
    percentage = 35 + Math.round(Math.max(0, Math.min(1, ratio)) * 10)
    text = '正在构建体素网格坐标...'
    detail =
      Number.isFinite(size) && size > 0
        ? `已读取 ${formatVolumeProgressCount(offset, size)} 字节`
        : '正在收集 x/y/z 唯一坐标'
  } else if (phase === 'scanning') {
    const ratio = Number.isFinite(size) && size > 0 ? offset / size : 0
    percentage = 45 + Math.round(Math.max(0, Math.min(1, ratio)) * 25)
    text = '正在统计体渲染值域...'
    detail =
      Number.isFinite(size) && size > 0
        ? `已读取 ${formatVolumeProgressCount(offset, size)} 字节`
        : '正在扫描数值范围'
  } else if (phase === 'voxelizing') {
    const ratio = Number.isFinite(size) && size > 0 ? offset / size : 0
    percentage = 70 + Math.round(Math.max(0, Math.min(1, ratio)) * 29)
    text = '正在生成 3D 体素纹理...'
    detail =
      Number.isFinite(size) && size > 0
        ? `已处理 ${formatVolumeProgressCount(offset, size)} 行`
        : '正在写入体素数据'
  } else if (phase === 'complete') {
    percentage = 100
    text = '体渲染 CSV 解析完成'
    detail = '正在上传 3D 纹理到 GPU'
  } else if (progress.type === 'error') {
    percentage = 0
    text = '体渲染 CSV 解析失败'
    detail = String(progress.error || '未知错误')
  } else {
    return
  }

  volumeCsvProgress.value = {
    visible: true,
    percentage: Math.max(0, Math.min(100, percentage)),
    text,
    detail,
  }
  emit('volume-csv-progress', { ...volumeCsvProgress.value })

  // 完成状态不显示进度卡片，直接隐藏
  if (phase === 'complete') {
    return
  }
  if (progress.type === 'error') {
    window.setTimeout(() => {
      volumeCsvProgress.value = {
        visible: false,
        percentage: 0,
        text: '',
        detail: '',
      }
      emit('volume-csv-progress', { ...volumeCsvProgress.value })
    }, 1800)
  }
}

const requestVolumeModeSync = () => {
  void syncVolumeToScene()
}

function focusCameraOnVolumeTransform(transform) {
  if (!camera || !controls || !transform?.center || !transform?.size) return
  const center = transform.center.clone()
  const size = transform.size.clone()
  const focusKey = [center.x, center.y, center.z, size.x, size.y, size.z]
    .map((value) => Number(value).toFixed(4))
    .join(':')
  if (focusKey === lastVolumeFocusKey) return
  lastVolumeFocusKey = focusKey

  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const dist = Math.max(20, maxDim * 2.4)
  camera.position.set(center.x + dist, center.y + dist * 0.8, center.z + dist)
  camera.near = 0.01
  camera.far = Math.max(camera.far || 0, dist * 20, maxDim * 20, 10000)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.maxDistance = Math.max(controls.maxDistance || 0, dist * 4)
  controls.update()
  console.log('[VolumeCamera] 已对齐 raymarch 体数据视角:', {
    center: center.toArray(),
    size: size.toArray(),
    distance: dist,
  })
}

/** 雷达切面 alpha：与当前屏幕上可见 GLB 一致（优先真实模型） */
function collectMeshesForRadarSliceMask() {
  if (!modelGroup) return []
  const real = gltfModels.get('real')
  const geometry = gltfModels.get('geometry')
  let root = null
  if (real?.visible) root = real
  else if (geometry?.visible) root = geometry
  else root = real || geometry
  if (!root?.visible) return []

  const meshes = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if (!o.visible) return
    if (!o.isMesh || !o.geometry?.attributes?.position) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    if (mats.length && mats.every((m) => m && m.visible === false)) return
    meshes.push(o)
  })
  return meshes
}

const planeModeDelegate = createPlaneMode({
  getDynamicGroup: () => planeGroup,
  getSceneMode: () => sceneMode.value,
  getVisualization: () => props.visualization,
  getGhostPlaneEnabled: () => props.visualizationOptionsOpen,
  getVisibleLayers: () => visible2DLayers.value,
  getTextureUrlForLayer: (layer) => getTextureUrlFor2DLayer(layer),
  getRenderer: () => renderer,
  getPhysicalWidth: () => props.physicalWidth,
  getPhysicalHeight: () => props.physicalHeight,
  getActiveLayer: () => active2DLayer.value,
  getSelectedPlane: () => props.selectedPlane,
  getPlaneCoordinate: () => props.planeCoordinate,
  getGeometricCenter: () => props.geometricCenter,
  getGeometryBounds: () => geometryBounds.value,
  getMeshesForRadarSliceMask: () => collectMeshesForRadarSliceMask(),
  getIsPlaying: () => props.isTimelinePlaying,
  getRadarWaveTime: () => {
    const idx = Math.max(0, Number(props.timelineCurrentStep) || 0)
    const pts = props.timelinePhysicalTimes
    if (Array.isArray(pts) && pts.length > idx) {
      const t = Number(pts[idx])
      if (Number.isFinite(t)) return t
    }
    const steps = props.timelineTimeSteps
    if (Array.isArray(steps) && steps.length > idx) {
      const s = Number(steps[idx])
      if (Number.isFinite(s)) return s * 0.35
    }
    return idx * 0.35
  },
})

volumeModeDelegate = createVolumeMode({
  getDynamicGroup: () => volumeGroup,
  getSceneMode: () => sceneMode.value,
  getIsEnabled: () => hasVisibleVolumeLayer.value,
  getVisualization: () => props.visualization,
  getCurrentTimeStep: () => currentTimeStep.value,
  getCurrentStepIndex: () => props.timelineCurrentStep,
  getIsPlaying: () => props.isTimelinePlaying,
  getActiveVolumePayload: () => activeVolumePayload.value,
  getVisibleVolumeLayers: () => visibleVolumeLayers.value,
  getVolumePayloadForLayer,
  getRenderer: () => renderer,
  getCamera: () => camera,
  getModelGroup: () => modelGroup,
  getSelectedLayer: () => selectedVolumeLayer.value,
  getGeometryBounds: () => geometryBounds.value,
  getCurrentTask: () => props.currentTask,
  workerUrl: volumeCsvWorkerUrl,
  requestSync: requestVolumeModeSync,
  getColorMapCatalog: () => props.colorMapCatalog,
  onWorkerProgress: updateVolumeCsvProgress,
  onVolumeTransformReady: null,
  onVolumePersonSpaceIntersect: (payload) => {
    emit('volume-person-space-intersect', payload)
  },
  setVolumePersonIntersectHighlight,
})

const streamlineModeDelegate = createStreamlineMode({
  getDynamicGroup: () => streamlineGroup,
  getSceneMode: () => sceneMode.value,
  getIsEnabled: () => hasVisibleStreamlineLayer.value,
  getVisualization: () => props.visualization,
  getCurrentTimeStep: () => currentTimeStep.value,
  getCurrentStepIndex: () => props.timelineCurrentStep,
  getIsPlaying: () => props.isTimelinePlaying,
  // 直接读取 runtimeState 中的 streamlinePayload，避免 activeStreamlinePayload 的
  // computed 依赖 hasVisibleStreamlineLayer 导致图层显隐切换时 payload 误判为 null
  getActiveStreamlinePayload: () =>
    runtimeState.value.streamlinePayload || null,
  getIsVisible: () => isStreamlineLayerVisible.value,
  getActiveStreamlineLayer: () => selectedStreamlineLayer.value,
})

const particleModeDelegate = createParticleMode({
  getDynamicGroup: () => particleGroup,
  getIsEnabled: () => hasVisibleParticleLayer.value,
  getVisibleParticleLayers: () => visibleParticleLayers.value,
  getParticleSettings: resolveParticleSettings,
  requestVelocityField: requestParticleVelocityField,
})

const velocityFieldModeDelegate = createVelocityFieldMode({
  getDynamicGroup: () => particleGroup,
  requestVelocityField: requestParticleVelocityField,
})

const boundsModeDelegate = createBoundsMode({
  getDynamicGroup: () => boundsGroup,
  getGeometryBounds: (taskId) => props.getGeometryBounds?.(taskId),
  getVisibleLayers: () => props.generatedVizLayers,
})

function setGeometryBounds(bounds) {
  geometryBounds.value = bounds
  if (bounds) {
    boundsModeDelegate?.setBoundsData(bounds)
  }
}

function computeLoadedGltfBoundsCm() {
  if (!modelGroup || gltfModels.size === 0) return null
  const box = new THREE.Box3()
  let hasModel = false
  for (const model of gltfModels.values()) {
    if (!model) continue
    model.updateMatrixWorld(true)
    const modelBox = new THREE.Box3().setFromObject(model)
    if (modelBox.isEmpty()) continue
    if (!hasModel) {
      box.copy(modelBox)
      hasModel = true
    } else {
      box.union(modelBox)
    }
  }
  if (!hasModel) return null
  return {
    min: [box.min.x * 100, box.min.y * 100, box.min.z * 100],
    max: [box.max.x * 100, box.max.y * 100, box.max.z * 100],
  }
}

function shouldPreferModelBoundsForCurrentTask() {
  return Boolean(props.currentTask?.isSimulated) || isGoafTask(props.currentTask)
}

function applyModelBoundsAsGeometryBounds() {
  if (!shouldPreferModelBoundsForCurrentTask() && normalizeModelBounds(geometryBounds.value)) {
    return
  }
  const bounds = computeLoadedGltfBoundsCm()
  if (bounds) {
    setGeometryBounds(bounds)
    console.log('[ThreeCanvas] 使用 GLTF 模型整体包围盒 (cm):', bounds)
  }
}

async function syncVolumeToScene() {
  if (!volumeModeDelegate) return
  if (volumeSyncPromise) {
    volumeSyncQueued = true
    return volumeSyncPromise
  }
  volumeSyncPromise = (async () => {
    try {
      await volumeModeDelegate.sync()
    } finally {
      volumeSyncPromise = null
      if (volumeSyncQueued) {
        volumeSyncQueued = false
        void syncVolumeToScene()
      }
    }
  })()
  return volumeSyncPromise
}

async function runVolumeTimelineSync(
  token,
  targetTimeStep = currentTimeStep.value,
  { playback = false } = {},
) {
  if (
    runtimeState.value.layersUpdating ||
    sceneSyncInProgress ||
    !hasVisibleVolumeLayer.value
  ) {
    return
  }

  const layers = visibleVolumeLayers.value.filter((l) => l?.kind === 'volume')

  if (!playback) {
    volumeModeDelegate?.invalidateSync?.()
    volumeModeDelegate?.clearInternalCaches?.()
  }

  for (const layer of layers) {
    const newPayload = await requestVolumePayloadForLayer(layer, {
      timeStep: targetTimeStep,
    })
    if (
      !shouldContinueVolumeFrameRequest(token, () => volumeTimelineSyncToken)
    ) {
      return
    }
    if (newPayload) {
      const variable = extractVolumeVariableFromLayer(layer)
      for (const [key, cached] of runtimeState.value.volumePayloads.entries()) {
        if (
          cached !== newPayload &&
          variable &&
          String(cached?.variable || '')
            .trim()
            .toLowerCase() === String(variable).trim().toLowerCase()
        ) {
          runtimeState.value.volumePayloads.delete(key)
        }
      }
    }
  }

  if (!shouldContinueVolumeFrameRequest(token, () => volumeTimelineSyncToken)) {
    return
  }

  if (playback && volumeModeDelegate?.syncPlaybackFrame) {
    const didUpdate = await volumeModeDelegate.syncPlaybackFrame({
      isStale: () => token !== volumeTimelineSyncToken,
    })
    if (didUpdate || volumeModeDelegate.hasVolumeMeshes?.()) return
  }

  await syncVolumeToScene()
}

async function performVolumeTimelineSync(
  targetTimeStep = currentTimeStep.value,
  options = {},
) {
  const token = ++volumeTimelineSyncToken
  return runVolumeTimelineSync(token, targetTimeStep, options)
}

async function requestLatestVolumeTimelineSync(
  targetTimeStep = currentTimeStep.value,
  options = {},
) {
  volumeTimelineSyncPendingStep = targetTimeStep
  volumeTimelineSyncToken += 1
  if (volumeTimelineSyncPromise) {
    volumeTimelineSyncQueued = true
    return volumeTimelineSyncPromise
  }

  volumeTimelineSyncPromise = (async () => {
    try {
      do {
        volumeTimelineSyncQueued = false
        const nextStep =
          volumeTimelineSyncPendingStep != null
            ? volumeTimelineSyncPendingStep
            : targetTimeStep
        volumeTimelineSyncPendingStep = null
        await performVolumeTimelineSync(nextStep, options)
      } while (volumeTimelineSyncQueued)
    } finally {
      volumeTimelineSyncPromise = null
      volumeTimelineSyncPendingStep = null
      if (volumeTimelineSyncQueued) {
        volumeTimelineSyncQueued = false
        void requestLatestVolumeTimelineSync(undefined, options)
      }
    }
  })()
  return volumeTimelineSyncPromise
}

async function syncStreamlineToScene() {
  if (!streamlineModeDelegate) return
  if (streamlineSyncPromise) {
    streamlineSyncQueued = true
    return streamlineSyncPromise
  }
  streamlineSyncPromise = (async () => {
    try {
      await streamlineModeDelegate.sync()
    } finally {
      streamlineSyncPromise = null
      if (streamlineSyncQueued) {
        streamlineSyncQueued = false
        void syncStreamlineToScene()
      }
    }
  })()
  return streamlineSyncPromise
}

function closeSceneContextMenu() {
  sceneContextMenu.value.visible = false
  sceneContextMenuPoint = null
  sceneContextMenuMesh = null
}

function showSceneContextMenu(left, top) {
  if (!hostRef.value) return
  const rect = hostRef.value.getBoundingClientRect()
  const menuWidth = 176
  const geometryActionCount = sceneContextMenuMesh ? 2 : 0
  const menuHeight =
    (hiddenGeometryMeshes.value.length > 0 ? 204 : 172) + geometryActionCount * 30
  const x = Math.min(Math.max(8, left), Math.max(8, rect.width - menuWidth - 8))
  const y = Math.min(Math.max(8, top), Math.max(8, rect.height - menuHeight - 8))

  sceneContextMenu.value = {
    visible: true,
    x,
    y,
    canAddPoint: Boolean(sceneContextMenuPoint),
    canShowGeometryDetail: Boolean(sceneContextMenuMesh),
    canHideGeometry: Boolean(sceneContextMenuMesh),
  }
}

function openSceneContextMenu(event) {
  if (!hostRef.value) return
  event.preventDefault()
  event.stopPropagation()
  if (setRaycasterFromClient(event)) {
    sceneContextMenuPoint = resolveMonitoringPointFromCurrentRay()
    sceneContextMenuMesh = pickGeometrySelectionMesh()
  } else {
    sceneContextMenuPoint = null
    sceneContextMenuMesh = null
  }
  const rect = hostRef.value.getBoundingClientRect()
  showSceneContextMenu(event.clientX - rect.left, event.clientY - rect.top)
}

function handleSceneMenuPointer(event) {
  if (event.button === 2) {
    sceneMenuPointerOpened = true
    openSceneContextMenu(event)
    return
  }
  sceneMenuPointerOpened = false
  closeSceneContextMenu()
}

function resetMainCameraView() {
  if (!camera || !controls) return
  if (gltfModels.get('real') && isRealModelCurrentlyVisible()) {
    realModelCameraFocusedTaskKey = ''
    if (focusCameraOnRealModelInitial()) {
      closeSceneContextMenu()
      return
    }
  }
  const box = new THREE.Box3()
  if (rootGroup) {
    rootGroup.updateMatrixWorld(true)
    box.setFromObject(rootGroup)
  }
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()

  if (!box.isEmpty()) {
    box.getCenter(center)
    box.getSize(size)
  } else {
    center.set(0, 0, 0)
    size.set(6, 6, 6)
  }

  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const dist = Math.max(6, maxDim * 0.8)
  // 正面视角：从 -Y 方向看向模型中心
  camera.position.set(center.x, center.y - dist, center.z)
  camera.near = 0.01
  camera.far = Math.max(camera.far || 0, dist * 20, maxDim * 20, 10000)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.maxDistance = Math.max(controls.maxDistance || 0, dist * 4)
  controls.update()
  closeSceneContextMenu()
}

function showAllHiddenGeometryMeshesFromMenu() {
  showAllHiddenGeometryMeshes()
  closeSceneContextMenu()
}

function addMonitoringPointFromSceneMenu() {
  const point = sceneContextMenuPoint ? { ...sceneContextMenuPoint } : null
  closeSceneContextMenu()
  if (!point) return
  addMonitoringPoint(point)
}

function showGeometryDetailFromSceneMenu() {
  const mesh = sceneContextMenuMesh
  closeSceneContextMenu()
  if (!mesh) return
  selectGeometryMesh(mesh, { showPopup: true })
}

function hideGeometryMeshFromSceneMenu() {
  const mesh = sceneContextMenuMesh
  closeSceneContextMenu()
  if (!mesh) return
  hideGeometryMesh(mesh)
}

function copyMainCameraParams() {
  if (!camera || !controls) return
  const data = {
    position: camera.position.toArray().map((value) => Number(value.toFixed(3))),
    target: controls.target.toArray().map((value) => Number(value.toFixed(3))),
    dimension: props.visualizationDimension,
    type2d: props.visualization2DType,
    type3d: props.visualization3DType,
  }
  navigator.clipboard?.writeText(JSON.stringify(data, null, 2))
  closeSceneContextMenu()
}

function downloadMainViewportSnapshot() {
  if (!renderer || !scene || !camera) return
  renderer.render(scene, camera)
  const link = document.createElement('a')
  link.href = renderer.domElement.toDataURL('image/png')
  link.download = `main-scene-${Date.now()}.png`
  link.click()
  closeSceneContextMenu()
}

function handleSceneContextMenuKeydown(event) {
  if (event.key === 'Escape') closeSceneContextMenu()
}

// 鼠标移动处理（高亮效果）
function onMouseMove(event) {
  if (!raycaster || !camera || !hostRef.value) return

  setRaycasterFromClient(event)

  if (isDraggingPoint()) {
    updateDraggedMonitoringPointFromRay()
    if (hostRef.value) {
      hostRef.value.style.cursor = 'grabbing'
    }
    event.preventDefault()
    return
  }

  if (goafGasSystem?.isSourceDragging?.()) {
    goafGasSystem.updateSourceDrag(raycaster)
    if (hostRef.value) {
      hostRef.value.style.cursor = 'grabbing'
    }
    event.preventDefault()
    return
  }

  const adding = isAddingPointMode()
  const hoveredPointGroup = adding ? null : pickMonitoringPointGroup()
  const hoveredGasSource =
    adding || hoveredPointGroup ? null : goafGasSystem?.pickGasSourceVisual?.(raycaster)
  const hoveredGeometryMesh =
    !adding && !hoveredPointGroup && !hoveredGasSource
      ? pickGeometrySelectionMesh()
      : null
  if (hostRef.value) {
    hostRef.value.style.cursor = adding
      ? 'crosshair'
      : hoveredPointGroup || hoveredGasSource
        ? 'grab'
        : hoveredGeometryMesh
          ? 'pointer'
          : 'default'
  }
}

// 鼠标点击处理
function onMouseClick(event) {
  if (!raycaster || !camera || !hostRef.value) return
  if (event.button === 2 || sceneMenuPointerOpened) {
    sceneMenuPointerOpened = false
    event.preventDefault()
    return
  }
  if (consumeSuppressNextPointClick()) {
    event.preventDefault()
    return
  }
  if (goafGasSystem?.consumeSuppressNextClick?.()) {
    event.preventDefault()
    return
  }

  setRaycasterFromClient(event)

  // 添加点模式：在点击位置添加监测点
  if (isAddingPointMode()) {
    const point = resolveMonitoringPointFromCurrentRay()
    if (point) addMonitoringPoint(point)
    return
  }

  const pointGroup = pickMonitoringPointGroup()
  if (pointGroup?.userData?.pointId) {
    selectMonitoringPoint(pointGroup.userData.pointId)
    return
  }

  const geometryMesh = pickGeometrySelectionMesh()
  if (geometryMesh) {
    selectGeometryMesh(geometryMesh, { showPopup: false })
    event.preventDefault()
  }
}

// 鼠标按下处理
function onMouseDown(event) {
  if (!raycaster || !camera || !hostRef.value) return
  if (event.button === 2 || sceneMenuPointerOpened) {
    sceneMenuPointerOpened = false
    event.preventDefault()
    return
  }
  if (event.button !== 0 || isAddingPointMode()) return

  setRaycasterFromClient(event)

  if (beginMonitoringPointDrag()) {
    if (controls) {
      controls.enabled = false
    }
    if (hostRef.value) {
      hostRef.value.style.cursor = 'grabbing'
    }
    event.preventDefault()
    return
  }

  if (goafGasSystem?.beginSourceDrag?.(raycaster)) {
    if (controls) {
      controls.enabled = false
    }
    if (hostRef.value) {
      hostRef.value.style.cursor = 'grabbing'
    }
    event.preventDefault()
  }
}

// 鼠标释放处理（结束拖拽）
function onMouseUp() {
  finishMonitoringPointDrag()
  goafGasSystem?.finishSourceDrag?.()
  if (controls && !isDraggingPoint() && !goafGasSystem?.isSourceDragging?.()) {
    controls.enabled = true
  }
}

const CAMERA_MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e'])

function shouldHandleCameraKeyboard(event) {
  const target = event.target
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  ) {
    return false
  }
  return true
}

// 键盘按下处理（WASD 移动，QE 升降）
function onKeyDown(event) {
  if (!shouldHandleCameraKeyboard(event)) return

  if (event.key === 'Shift') {
    keysPressed.shift = true
  }

  const key = event.key.toLowerCase()
  // F6 切换速度场显示
  if (key === 'f6') {
    const wasVisible = velocityFieldModeDelegate?.isVisible?.() ?? false
    const nowVisible = !wasVisible
    // 如果速度场还未构建，强制触发加载（不依赖粒子图层）
    if (nowVisible && !velocityFieldModeDelegate?._built) {
      ;(async () => {
        const field = await requestParticleVelocityField(null)
        await velocityFieldModeDelegate?.sync(field)
        velocityFieldModeDelegate?.setVisible(true)
      })()
    } else {
      velocityFieldModeDelegate?.setVisible(nowVisible)
    }
    console.log('[VelocityField] F6 toggled:', nowVisible ? 'ON' : 'OFF')
    return
  }
  if (keysPressed.hasOwnProperty(key)) {
    keysPressed[key] = true
    if (CAMERA_MOVE_KEYS.has(key)) {
      event.preventDefault()
    }
  }
}

// 键盘释放处理（WASD 移动，QE 升降）
function onKeyUp(event) {
  if (event.key === 'Shift') {
    keysPressed.shift = false
  }

  const key = event.key.toLowerCase()
  if (keysPressed.hasOwnProperty(key)) {
    keysPressed[key] = false
  }
}

function getCameraKeyboardMoveAxes() {
  const direction = new THREE.Vector3()
  const right = new THREE.Vector3()

  // 获取相机朝向，按当前视角真实前进/后退
  camera.getWorldDirection(direction)
  direction.normalize()

  // 计算相机的右向量
  right.crossVectors(direction, camera.up).normalize()
  return { direction, right }
}

// 根据键盘输入移动相机
function updateCameraFromKeyboard() {
  if (!camera || !controls) return

  // 检查是否有按键被按下
  const hasKeyPressed = Object.values(keysPressed).some((v) => v)
  if (!hasKeyPressed) return

  const { direction, right } = getCameraKeyboardMoveAxes()

  // 移动速度（支持 Shift 加速）
  const isFast = keysPressed.shift
  const speed = isFast ? KEYBOARD_MOVE_SPEED_FAST : KEYBOARD_MOVE_SPEED

  // 计算移动向量
  const moveVector = new THREE.Vector3()

  if (keysPressed.w) {
    moveVector.add(direction.clone().multiplyScalar(speed))
  }
  if (keysPressed.s) {
    moveVector.add(direction.clone().multiplyScalar(-speed))
  }
  if (keysPressed.a) {
    moveVector.add(right.clone().multiplyScalar(-speed))
  }
  if (keysPressed.d) {
    moveVector.add(right.clone().multiplyScalar(speed))
  }
  if (keysPressed.q) {
    moveVector.add(camera.up.clone().multiplyScalar(speed))
  }
  if (keysPressed.e) {
    moveVector.add(camera.up.clone().multiplyScalar(-speed))
  }

  // 应用移动
  camera.position.add(moveVector)
  controls.target.add(moveVector)
  controls.update()
}

function ensureScene() {
  if (sceneInstance) return

  console.log('[ThreeCanvas] 获取全局场景实例')

  // 从场景管理器获取单例
  sceneInstance = getScene(hostRef.value)

  // 解构获取所有引用
  scene = sceneInstance.scene
  camera = sceneInstance.camera
  controls = sceneInstance.controls
  renderer = sceneInstance.renderer
  raycaster = sceneInstance.raycaster
  clock = sceneInstance.clock

  // 获取所有组的引用
  rootGroup = sceneInstance.groups.root
  planeGroup = sceneInstance.groups.plane
  volumeGroup = sceneInstance.groups.volume
  streamlineGroup = sceneInstance.groups.streamline
  particleGroup = new THREE.Group()
  particleGroup.name = '__particleLayerGroup'
  rootGroup.add(particleGroup)
  smokeGroup = new THREE.Group()
  smokeGroup.name = '__smokeLayerGroup'
  rootGroup.add(smokeGroup)
  radarResultPreviewGroup = new THREE.Group()
  radarResultPreviewGroup.name = '__radarResultPreviewGroup'
  rootGroup.add(radarResultPreviewGroup)
  boundsGroup = sceneInstance.groups.bounds
  overlayGroup = sceneInstance.groups.overlay
  axisGroup = sceneInstance.groups.axis
  modelGroup = sceneInstance.groups.model
  monitoringPointsGroup = sceneInstance.groups.monitoringPoints
  renderMonitoringPointVisuals()

  refreshAxisHelpers(geometryBounds.value)

  // GLTF 可先加载；包围盒返回后再做对齐，避免首次进入等待包围盒接口。
  ensureGLTFModelLoaded()

  ensureCss2dRenderer()

  // 添加控制器事件监听
  if (controls && volumeModeDelegate) {
    controls.addEventListener('start', volumeModeDelegate.onControlStart)
    controls.addEventListener('end', volumeModeDelegate.onControlEnd)
  }

  // 添加 WebGL 上下文丢失和恢复的事件监听
  const canvas = renderer.domElement
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      console.warn('[WebGL] Context Lost - 阻止默认行为以尝试恢复')
      event.preventDefault()
    },
    false,
  )

  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      console.log('[WebGL] Context Restored - 重新初始化场景')
      if (!renderer) {
        console.warn('[WebGL] Renderer 已被销毁，无法恢复上下文')
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = MAIN_SCENE_TONE_MAPPING_EXPOSURE
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      rebuildSceneByMode()
    },
    false,
  )
}

function buildTaskModelTargetBounds() {
  const modelBounds = normalizeModelBounds(geometryBounds.value)
  if (!modelBounds) return null

  const { min, max } = modelBounds
  return {
    min: [min[0] / 100, min[1] / 100, min[2] / 100],
    max: [max[0] / 100, max[1] / 100, max[2] / 100],
  }
}

/** 加载后打印人物 GLB 在世界空间的轴对齐包围盒（米 + cm，便于与后处理域对比） */
function logPersonModelWorldBoundingBox(model, gltfKey) {
  if (!model || (gltfKey !== 'personGeometry' && gltfKey !== 'personReal')) return
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const min = box.min
  const max = box.max
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const f4 = (n) => (Number.isFinite(n) ? n.toFixed(4) : String(n))
  const f2cm = (n) => (Number.isFinite(n) ? (n * 100).toFixed(2) : String(n))
  console.log(
    `[人物模型 AABB] ${gltfKey} 世界空间 (米) min=(${f4(min.x)}, ${f4(min.y)}, ${f4(min.z)}) max=(${f4(max.x)}, ${f4(max.y)}, ${f4(max.z)})`,
  )
  console.log(
    `[人物模型 AABB] ${gltfKey} 中心(米)=(${f4(center.x)}, ${f4(center.y)}, ${f4(center.z)}) 尺寸 WxHxD(米)=(${f4(size.x)}, ${f4(size.y)}, ${f4(size.z)})`,
  )
  console.log(
    `[人物模型 AABB] ${gltfKey} 与仿真域同单位 (cm) xmin=${f2cm(min.x)} xmax=${f2cm(max.x)} ymin=${f2cm(min.y)} ymax=${f2cm(max.y)} zmin=${f2cm(min.z)} zmax=${f2cm(max.z)}`,
  )
}

function applyModelBaseTransform(model, config) {
  const meetingRoomRotation =
    isMeetingRoomTask() && Array.isArray(config?.meetingRoomRotation)
      ? config.meetingRoomRotation
      : null
  const rotation =
    meetingRoomRotation || (Array.isArray(config?.rotation) ? config.rotation : null)
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
    const scaleX = Number.isFinite(Number(scale[0])) ? Number(scale[0]) : 1
    const scaleY = Number.isFinite(Number(scale[1])) ? Number(scale[1]) : 1
    const scaleZ = Number.isFinite(Number(scale[2])) ? Number(scale[2]) : 1
    model.scale.set(scaleX, scaleY, scaleZ)
  }
}

function applyModelAnimationFrame(model, animations, config) {
  if (!model || !Array.isArray(animations) || animations.length === 0) return

  const clip = animations[0]
  const configuredFrameTime = Number(config?.animationFrameTime)
  const targetFrameTime = Number.isFinite(configuredFrameTime) ? configuredFrameTime : 0
  const frameTime = Math.max(
    0,
    Math.min(targetFrameTime, clip.duration || 0),
  )
  const mixer = new THREE.AnimationMixer(model)
  const action = mixer.clipAction(clip)
  action.play()
  mixer.setTime(frameTime)
  action.paused = true
  model.updateMatrixWorld(true)
}

function applySolidModelMaterial(model, config) {
  if (!model || !config?.useSolidMaterial) return
  const color = config.solidColor || '#26313f'
  model.traverse((child) => {
    if (!child?.isMesh) return
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.())
      } else {
        child.material.dispose?.()
      }
    }
    child.material = new THREE.MeshBasicMaterial({
      color,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    })
  })
}

function applyHighlightModelMaterial(model, config) {
  if (!model || !config?.useHighlightMaterial) return
  const color = config.highlightColor || '#ff2f92'
  model.renderOrder = 1000
  model.traverse((child) => {
    if (!child?.isMesh) return
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.())
      } else {
        child.material.dispose?.()
      }
    }
    child.renderOrder = 1000
    child.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  })
}

function getUnrotatedModelSize(model) {
  const savedPosition = model.position.clone()
  const savedRotation = model.rotation.clone()
  const savedScale = model.scale.clone()

  model.position.set(0, 0, 0)
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  model.updateMatrixWorld(true)
  const size = new THREE.Box3()
    .setFromObject(model)
    .getSize(new THREE.Vector3())

  model.position.copy(savedPosition)
  model.rotation.copy(savedRotation)
  model.scale.copy(savedScale)
  model.updateMatrixWorld(true)
  return size
}

function scaleModelToTargetBounds(model, targetBounds, options = {}) {
  if (!model || !targetBounds) return

  const { min, max } = targetBounds

  const targetSizes = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ]
  const [boundsWidth, boundsHeight, boundsDepth] = targetSizes
  const targetSize = Math.max(boundsWidth, boundsHeight, boundsDepth)
  if (!Number.isFinite(targetSize) || targetSize <= 0) return

  const targetAnchor =
    options.alignAnchor === 'min'
      ? new THREE.Vector3(min[0], min[1], min[2])
      : new THREE.Vector3(
          (min[0] + max[0]) / 2,
          (min[1] + max[1]) / 2,
          (min[2] + max[2]) / 2,
        )

  model.position.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const modelSize = box.getSize(new THREE.Vector3())
  const modelCenter = new THREE.Vector3()
  box.getCenter(modelCenter)

  const modelMaxDim = Math.max(modelSize.x, modelSize.y, modelSize.z)
  const scale = modelMaxDim > 0 ? targetSize / modelMaxDim : 1
  const localModelSize = options.matchAxes ? getUnrotatedModelSize(model) : modelSize
  const modelSizes = [localModelSize.x, localModelSize.y, localModelSize.z]
  const scaleAxisMap = Array.isArray(options.scaleAxisMap)
    ? options.scaleAxisMap
    : [0, 1, 2]
  const scaleX =
    options.matchAxes && modelSizes[0] > 0
      ? targetSizes[scaleAxisMap[0]] / modelSizes[0]
      : scale
  const scaleY =
    options.matchAxes && modelSizes[1] > 0
      ? targetSizes[scaleAxisMap[1]] / modelSizes[1]
      : scale
  const scaleZ =
    options.matchAxes && modelSizes[2] > 0
      ? targetSizes[scaleAxisMap[2]] / modelSizes[2]
      : scale
  const scaleMultiplier = Array.isArray(options.scaleMultiplier)
    ? options.scaleMultiplier
    : [options.scaleMultiplier, options.scaleMultiplier, options.scaleMultiplier]
  const scaleMultiplierX = Number.isFinite(Number(scaleMultiplier[0]))
    ? Number(scaleMultiplier[0])
    : 1
  const scaleMultiplierY = Number.isFinite(Number(scaleMultiplier[1]))
    ? Number(scaleMultiplier[1])
    : 1
  const scaleMultiplierZ = Number.isFinite(Number(scaleMultiplier[2]))
    ? Number(scaleMultiplier[2])
    : 1

  model.scale.set(
    scaleX * scaleMultiplierX,
    scaleY * scaleMultiplierY,
    scaleZ * scaleMultiplierZ,
  )
  model.updateMatrixWorld(true)

  const scaledBox = new THREE.Box3().setFromObject(model)
  const scaledAnchor =
    options.alignAnchor === 'min'
      ? scaledBox.min.clone()
      : scaledBox.getCenter(new THREE.Vector3())
  model.position.add(targetAnchor.sub(scaledAnchor))
  const positionOffset = Array.isArray(options.positionOffset)
    ? options.positionOffset
    : null
  if (positionOffset) {
    model.position.add(
      new THREE.Vector3(
        Number(positionOffset[0]) || 0,
        Number(positionOffset[1]) || 0,
        Number(positionOffset[2]) || 0,
      ),
    )
  }
  model.updateMatrixWorld(true)
}

const {
  isMeetingRoomTask,
  syncMeetingRoomSplatForTask,
  disposeMeetingRoomSplat,
  disposeMeetingRoomStandingIdleDebugGroup,
  disposeMeetingRoomSplatDebugGroup,
  updateMeetingRoomSplatDebugGroup,
  alignMeetingRoomSplatRightFaceToGeometry,
  alignMeetingRoomStandingIdleModelToHumanBody,
  applyMeetingRoomGaussianScale,
  resetMeetingRoomHumanBodyCache,
} = createMeetingRoomMode({
  getGltfModels: () => gltfModels,
  getModelGroup: () => modelGroup,
  getCamera: () => camera,
  getControls: () => controls,
  getRenderer: () => renderer,
  getCurrentTask: () => props.currentTask,
  getVisualization: () => props.visualization,
  getRuntimeState: () => runtimeState,
  syncVisibleLayerIdsFromProps,
  GLTF_MODEL_CONFIGS,
  buildTaskModelTargetBounds,
  applyModelBaseTransform,
  scaleModelToTargetBounds,
  resolveGLTFModelTransformOptions,
  disposeModelObject,
  addFrameCallback,
  removeFrameCallback,
})

function alignModelBottomToTargetBounds(model, targetBounds) {
  if (!model || !targetBounds) return false
  const targetBottom = Number(targetBounds.min?.[2])
  if (!Number.isFinite(targetBottom)) return false

  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty() || !Number.isFinite(box.min.z)) return false

  const delta = new THREE.Vector3(0, 0, targetBottom - box.min.z)
  if (isMeetingRoomTask()) {
    const targetBox = new THREE.Box3(
      new THREE.Vector3(...targetBounds.min),
      new THREE.Vector3(...targetBounds.max),
    )
    const targetCenter = targetBox.getCenter(new THREE.Vector3())
    const modelCenter = box.getCenter(new THREE.Vector3())
    delta.x = targetCenter.x - modelCenter.x
    delta.y = targetCenter.y - modelCenter.y
  }
  if (delta.lengthSq() < 1e-8) return false
  model.position.add(delta)
  model.updateMatrixWorld(true)
  return true
}

function scaleModelToBounds() {
  const taskTargetBounds = buildTaskModelTargetBounds()
  if (!taskTargetBounds) return
  let didMoveModel = false

  const geometryModel = gltfModels.get('geometry')
  if (geometryModel) {
    const geometryConfig = GLTF_MODEL_CONFIGS.find(
      (config) => config.key === 'geometry',
    )
    if (geometryConfig?.scaleToBounds !== false) {
      scaleModelToTargetBounds(
        geometryModel,
        taskTargetBounds,
        resolveGLTFModelTransformOptions(geometryConfig),
      )
    }
    didMoveModel = alignModelBottomToTargetBounds(geometryModel, taskTargetBounds) || didMoveModel
  }

  const realModel = gltfModels.get('real')
  if (realModel) {
    const realConfig = GLTF_MODEL_CONFIGS.find((config) => config.key === 'real')
    if (realConfig?.scaleToBounds !== false) {
      scaleModelToTargetBounds(
        realModel,
        taskTargetBounds,
        resolveGLTFModelTransformOptions(realConfig),
      )
    }
    didMoveModel = alignModelBottomToTargetBounds(realModel, taskTargetBounds) || didMoveModel
  }
  for (const [key, model] of gltfModels.entries()) {
    if (DISSOLVE_MODEL_KEYS.has(key) && !model?.userData?.isGaussianSplatModel) {
      const state = getModelDissolveState(key)
      disposeModelDissolveParticles(state)
      ensureModelDissolveState(key, model)
    }
  }
  if (didMoveModel) {
    alignMeetingRoomSplatRightFaceToGeometry()
  }
  alignMeetingRoomStandingIdleModelToHumanBody()
}

function ensureGLTFModelLoaded() {
  if (!modelGroup) return null
  const loadableConfigs = GLTF_MODEL_CONFIGS.filter(canLoadGLTFModelConfig)
  if (!loadableConfigs.length) return null
  if (loadableConfigs.every((config) => gltfModels.has(config.key))) {
    syncModelVisibility()
    return Promise.resolve(loadableConfigs.map((config) => gltfModels.get(config.key)))
  }

  const loadToken = gltfModelLoadToken
  modelLoading.value = true
  const promises = loadableConfigs.map((config) => {
    const existingPromise = gltfModelLoadPromises.get(config.key)
    if (gltfModels.has(config.key)) return Promise.resolve(gltfModels.get(config.key))
    if (existingPromise) return existingPromise

    const promise = loadGLTFModel(config, loadToken)
      .catch(() => null)
      .finally(() => {
        gltfModelLoadPromises.delete(config.key)
      })
    gltfModelLoadPromises.set(config.key, promise)
    return promise
  })
  return Promise.all(promises)
    .then((models) => {
      syncModelVisibility()
      return models
    })
    .finally(() => {
      modelLoading.value = false
    })
}

function normalizeModelBounds(rawBounds) {
  const bounds = rawBounds?.data || rawBounds
  if (!bounds || typeof bounds !== 'object') return null

  const min = Array.isArray(bounds.min)
    ? bounds.min
    : [
        bounds.xmin ?? bounds.x_min,
        bounds.ymin ?? bounds.y_min,
        bounds.zmin ?? bounds.z_min,
      ]
  const max = Array.isArray(bounds.max)
    ? bounds.max
    : [
        bounds.xmax ?? bounds.x_max,
        bounds.ymax ?? bounds.y_max,
        bounds.zmax ?? bounds.z_max,
      ]

  const normalized = {
    min: min.map((value) => Number(value)),
    max: max.map((value) => Number(value)),
  }

  if (
    normalized.min.length !== 3 ||
    normalized.max.length !== 3 ||
    normalized.min.some((value) => !Number.isFinite(value)) ||
    normalized.max.some((value) => !Number.isFinite(value))
  ) {
    return null
  }

  return normalized
}

/**
 * 计算三维模型（geometry/real GLTF 合并包围盒）与当前切片平面在「仿真域包围盒」内的相交矩形，
 * 映射到平面纹理 UV（与 PlaneGeometry：u、v 沿两条切面轴正向递增），供平面雷达占位图画白色叠加。
 */
function getRadarMockFootprintUvRect(opts = {}) {
  const plane = String(opts.plane ?? 'xy').toLowerCase()
  const planeOffsetCmRaw = Number(opts.planeOffsetCm)
  const offset =
    Number.isFinite(planeOffsetCmRaw) ? planeOffsetCmRaw : Number.NaN

  const nb = normalizeModelBounds(geometryBounds.value)
  if (!nb || !Number.isFinite(offset)) return null

  const xmin = nb.min[0]
  const ymin = nb.min[1]
  const zmin = nb.min[2]
  const xmax = nb.max[0]
  const ymax = nb.max[1]
  const zmax = nb.max[2]

  const pwXY = xmax - xmin
  const phXY = ymax - ymin
  const pwXZ = xmax - xmin
  const phXZ = zmax - zmin
  const pwYZ = ymax - ymin
  const phYZ = zmax - zmin

  if (
    !(pwXY > 0 && phXY > 0) ||
    !(pwXZ > 0 && phXZ > 0) ||
    !(pwYZ > 0 && phYZ > 0)
  ) {
    return null
  }

  const modelBox = new THREE.Box3()
  let hasMesh = false
  for (const key of ['geometry', 'real']) {
    const model = gltfModels.get(key)
    if (!model) continue
    const b = new THREE.Box3().setFromObject(model)
    if (!hasMesh) {
      modelBox.copy(b)
      hasMesh = true
    } else {
      modelBox.union(b)
    }
  }
  if (!hasMesh) return null

  const mMin = modelBox.min.clone().multiplyScalar(100)
  const mMax = modelBox.max.clone().multiplyScalar(100)

  const clamp01 = (t) => Math.max(0, Math.min(1, t))

  if (plane === 'xy') {
    if (offset < zmin || offset > zmax) return null
    const ix0 = Math.max(xmin, mMin.x)
    const ix1 = Math.min(xmax, mMax.x)
    const iy0 = Math.max(ymin, mMin.y)
    const iy1 = Math.min(ymax, mMax.y)
    if (!(ix1 > ix0 && iy1 > iy0)) return null
    return {
      u0: clamp01((ix0 - xmin) / pwXY),
      u1: clamp01((ix1 - xmin) / pwXY),
      v0: clamp01((iy0 - ymin) / phXY),
      v1: clamp01((iy1 - ymin) / phXY),
    }
  }

  if (plane === 'xz') {
    if (offset < ymin || offset > ymax) return null
    const ix0 = Math.max(xmin, mMin.x)
    const ix1 = Math.min(xmax, mMax.x)
    const iz0 = Math.max(zmin, mMin.z)
    const iz1 = Math.min(zmax, mMax.z)
    if (!(ix1 > ix0 && iz1 > iz0)) return null
    return {
      u0: clamp01((ix0 - xmin) / pwXZ),
      u1: clamp01((ix1 - xmin) / pwXZ),
      v0: clamp01((iz0 - zmin) / phXZ),
      v1: clamp01((iz1 - zmin) / phXZ),
    }
  }

  if (plane === 'yz') {
    if (offset < xmin || offset > xmax) return null
    const iy0 = Math.max(ymin, mMin.y)
    const iy1 = Math.min(ymax, mMax.y)
    const iz0 = Math.max(zmin, mMin.z)
    const iz1 = Math.min(zmax, mMax.z)
    if (!(iy1 > iy0 && iz1 > iz0)) return null
    return {
      u0: clamp01((iy0 - ymin) / pwYZ),
      u1: clamp01((iy1 - ymin) / pwYZ),
      v0: clamp01((iz0 - zmin) / phYZ),
      v1: clamp01((iz1 - zmin) / phYZ),
    }
  }

  return null
}

async function loadGaussianPlyModel(config, loadToken, modelUrl) {
  const model = new GaussianSplats3D.DropInViewer({
    gpuAcceleratedSort: false,
    sharedMemoryForWorkers: false,
    integerBasedSort: false,
    halfPrecisionCovariancesOnGPU: false,
    sphericalHarmonicsDegree: 0,
    kernel2DSize: 0.05,
    maxScreenSpaceSplatSize: 512,
    sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
    splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
    logLevel: GaussianSplats3D.LogLevel.None,
  })

  await model.addSplatScene(modelUrl, {
    format: GaussianSplats3D.SceneFormat.Ply,
    progressiveLoad: false,
    showLoadingUI: false,
    splatAlphaRemovalThreshold: 5,
  })

  if (loadToken !== gltfModelLoadToken) {
    model.dispose?.()
    return null
  }

  const existingModel = gltfModels.get(config.key)
  if (existingModel) {
    modelGroup.remove(existingModel)
    disposeModelObject(existingModel)
  }

  model.name = config.layerKind
  model.userData.layerKind = config.layerKind
  model.userData.gltfModelKey = config.key
  model.userData.gltfModelUrl = modelUrl
  model.userData.isGaussianSplatModel = true
  model.userData.disposeSplatViewer = () => model.dispose?.()
  model.visible = !DISSOLVE_MODEL_KEYS.has(config.key)
  model.scale.setScalar(0.01)
  gltfModels.set(config.key, model)
  modelGroup.add(model)
  syncModelVisibility()
  if (config.key === 'real') {
    scheduleRealModelCameraFocus()
  }
  return model
}

function loadGLTFModel(config, loadToken) {
  const modelUrl = resolveGLTFModelUrl(config)
  if (!modelUrl) {
    return Promise.reject(new Error(`GLTF 模型 URL 为空: ${config?.key || ''}`))
  }
  if (/\.ply(?:$|[?#])/i.test(modelUrl)) {
    return loadGaussianPlyModel(config, loadToken, modelUrl)
  }
  const loader = new GLTFLoader()
  loader.setDRACOLoader(sharedDracoLoader)
  return new Promise((resolve, reject) => {
    loader.load(
      modelUrl,
      (gltf) => {
        if (
          loadToken !== gltfModelLoadToken ||
          (!config.useTaskGlbUrl &&
            !config.useTaskRealModelUrl &&
            !config.loadWithoutBounds &&
            !normalizeModelBounds(geometryBounds.value))
        ) {
          disposeModelObject(gltf.scene)
          resolve(null)
          return
        }
        const existingModel = gltfModels.get(config.key)
        if (existingModel) {
          modelGroup.remove(existingModel)
          disposeModelObject(existingModel)
        }

        const model = gltf.scene
        model.name = config.layerKind
        model.userData.layerKind = config.layerKind
        model.userData.gltfModelKey = config.key
        model.userData.gltfModelUrl = modelUrl
        model.userData.gltfAnimations = Array.isArray(gltf.animations)
          ? gltf.animations
          : []
        model.visible = !DISSOLVE_MODEL_KEYS.has(config.key)
        applyModelBaseTransform(model, config)
        applyModelAnimationFrame(model, gltf.animations, config)
        applySolidModelMaterial(model, config)
        applyHighlightModelMaterial(model, config)
        if (config.key === 'real') {
          applyRealModelTextures(model)
        }
        model.traverse((child) => {
          if (!child?.isMesh) return
          child.castShadow = true
          child.receiveShadow = true
        })
        if (config.key === 'geometry') {
          collectGeometryModelSelections(model)
        }
        gltfModels.set(config.key, model)
        applyModelOpacity()
        modelGroup.add(model)

        scaleModelToBounds()
        // 当没有后端仿真域包围盒时，使用已加载 GLTF 模型的整体包围盒
        applyModelBoundsAsGeometryBounds()
        // 采空区任务模型加载后重新初始化瓦斯泄漏系统，使泄漏源贴合模型包围盒
        // geometry（3.glb）和 real（1.glb）朝向不同，任一加载完成都需重建围岩层，
        // buildSurroundingLayers 内部会根据当前可见的模型 URL 选择正确轴向
        if (isGoafTask(props.currentTask) && (config.key === 'geometry' || config.key === 'real')) {
          goafGasSystem?.setup()
        }
        if (config.key === 'geometry') {
          alignMeetingRoomSplatRightFaceToGeometry()
        }
        ensureModelDissolveState(config.key, model)
        if (config.key === 'personGeometry' || config.key === 'personReal') {
          logPersonModelWorldBoundingBox(model, config.key)
        }
        syncModelVisibility()
        // 如果视频图层的骨骼已开启，模型加载后重新附加 skeleton helper
        {
          const _vl = (props.generatedVizLayers || []).find((l) => l.kind === 'video')
          if (_vl?.visible !== false && _vl?.skeletonVisible === true) {
            setPersonSkeletonVisible(true)
          }
        }
        if (
          hasVisibleSmokeLayer.value &&
          visibleSmokeLayers.value.some((layer) => isPersonSmokeLayer(layer))
        ) {
          clearSmokeScene()
          void syncSmokeToScene()
        }
        if (config.key === 'real') {
          scheduleRealModelCameraFocus()
        }
        resolve(model)
      },
      (progress) => {
        const percent = (progress.loaded / progress.total) * 100
      },
      (error) => {
        console.error(`[GLTF] 模型加载失败 ${modelUrl}:`, error)
        reject(error)
      },
    )
  })
}

function syncModelVisibility() {
  if (!modelGroup) return
  syncVisibleLayerIdsFromProps()
  const taskId = props.currentTask?.id || 'default'
  const visibleLayerIds = runtimeState.value.visibleLayerIds
  const realModelVisible = visibleLayerIds.has(`realModel:${taskId}`)
  const modelLayerVisible = visibleLayerIds.has(`model:${taskId}`)
  modelGroup.visible = true
  for (const config of GLTF_MODEL_CONFIGS) {
    const model = gltfModels.get(config.key)
    if (model) {
      let layerVisible = visibleLayerIds.has(`${config.layerKind}:${taskId}`)
      if (config.showWithModelLayer && isMeetingRoomTask()) {
        layerVisible = layerVisible || modelLayerVisible
      }
      const shouldVisible = config.hideWhenRealModelVisible
        ? layerVisible && !realModelVisible
        : layerVisible
      const state = getModelDissolveState(config.key)
      const isGaussianSplatModel = Boolean(model.userData?.isGaussianSplatModel)
      const willFocusModel =
        DISSOLVE_MODEL_KEYS.has(config.key) &&
        !isGaussianSplatModel &&
        shouldVisible &&
        (!state?.hasSyncedVisibility || state.targetVisible !== shouldVisible)
      setModelVisibilityWithDissolve(config.key, model, shouldVisible, {
        animate: DISSOLVE_MODEL_KEYS.has(config.key) && !isGaussianSplatModel,
      })
      if (willFocusModel) {
        scheduleModelCameraFocus(config.key)
      }
    }
  }
  if (!getVisibleGeometryModelForSelection()) {
    clearGeometryModelSelection()
  }
  isGeometryModelSelectionVisible.value = Boolean(
    getVisibleGeometryModelForSelection(),
  )
  if (realModelVisible) {
    scheduleRealModelCameraFocus()
  }
  if (!alignMeetingRoomSplatRightFaceToGeometry()) {
    void syncMeetingRoomSplatForTask(props.currentTask)
  }

  // 采空区任务：geometry/real 可见性切换后，围岩层需按当前可见模型重建（轴向可能不同）
  if (isGoafTask(props.currentTask) && goafGasSystem) {
    goafGasSystem.requestRebuildSurrounding()
  }

}

function applyModelOpacity() {
  if (gltfModels.size === 0) return
  clearGeometryModelSelection()
  const displayMode = props.visualization?.model_display_mode || 'solid'

  // 线框模式：备份原始材质，替换为 MeshBasicMaterial 以确保线条可见
  if (displayMode === 'wireframe') {
    for (const [key, model] of gltfModels.entries()) {
      const config = GLTF_MODEL_CONFIGS.find((item) => item.key === key)
      const opacity = resolveConfiguredModelOpacity(config)
      model.traverse((child) => {
        if (!child?.isMesh || !child.material) return

        // 保存原始材质（仅首次）
        if (!child._originalMaterial) {
          child._originalMaterial = child.material
        }

        // 从原始材质提取颜色，确保线框可见
        const origMats = Array.isArray(child._originalMaterial)
          ? child._originalMaterial
          : [child._originalMaterial]
        const baseColor = extractMaterialColor(origMats)

        const wireMat = new THREE.MeshBasicMaterial({
          color: baseColor,
          wireframe: true,
          transparent: opacity < 1,
          opacity: Math.max(opacity, 0.6),
          depthWrite: config?.key === 'real' || opacity >= 1,
        })
        child.material = wireMat
      })
    }
  } else {
    // 非线框模式：恢复原始材质
    for (const [key, model] of gltfModels.entries()) {
      const config = GLTF_MODEL_CONFIGS.find((item) => item.key === key)
      const opacity = resolveConfiguredModelOpacity(config)
      model.traverse((child) => {
        if (!child?.isMesh) return

        if (child._originalMaterial) {
          child.material = child._originalMaterial
          delete child._originalMaterial
        }

        if (!child.material) return
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material]

        materials.forEach((material) => {
          // 边线模式：隐藏实体 mesh
          if (displayMode === 'edges') {
            material.visible = false
            return
          }
          material.visible = true
          material.wireframe = false
          material.transparent = opacity < 1
          material.opacity = opacity
          material.depthWrite = config?.key === 'real' || opacity >= 1
          material.needsUpdate = true
        })
      })
    }
  }

  // 边线辅助对象
  for (const [key, model] of gltfModels.entries()) {
    const config = GLTF_MODEL_CONFIGS.find((item) => item.key === key)
    const opacity = resolveConfiguredModelOpacity(config)
    updateModelEdges(key, model, displayMode, opacity)
  }
  // 应用 per-mesh 透明度覆盖（在全局透明度之后）
  applyGeometryMeshOpacityOverrides()
  updatePersonScanOverlayOpacity()
  applyModelDissolveSettings()
}

/** 将 per-mesh 透明度覆盖应用到对应 mesh */
function applyGeometryMeshOpacityOverrides() {
  if (geometryMeshOpacityOverrides.size === 0) return
  for (const [key, model] of gltfModels.entries()) {
    model.traverse((child) => {
      if (!child?.isMesh || !child.material) return
      const name = child.userData?.geometrySelectionName
      if (!name) return
      const override = geometryMeshOpacityOverrides.get(name)
      if (override === undefined) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        material.transparent = override < 1
        material.opacity = override
        material.depthWrite = override >= 1
        material.needsUpdate = true
      })
    })
  }
}

/** 设置单个 mesh 的透明度覆盖 */
function setGeometryMeshOpacity(name, opacity) {
  if (!name) return
  const clamped = Math.max(0, Math.min(1, opacity))
  geometryMeshOpacityOverrides.set(name, clamped)
  applyGeometryMeshOpacityOverrides()
}

/** 重置单个 mesh 的透明度覆盖（恢复全局透明度） */
function resetGeometryMeshOpacity(name) {
  if (!name) return
  geometryMeshOpacityOverrides.delete(name)
  applyModelOpacity()
}

/** 重置所有 per-mesh 透明度覆盖 */
function resetAllGeometryMeshOpacity() {
  if (geometryMeshOpacityOverrides.size === 0) return
  geometryMeshOpacityOverrides.clear()
  applyModelOpacity()
}

/** 获取所有 per-mesh 透明度覆盖的快照 */
function getGeometryMeshOpacityOverrides() {
  const result = {}
  for (const [name, opacity] of geometryMeshOpacityOverrides) {
    result[name] = opacity
  }
  return result
}

/** 从材质数组中提取代表颜色，优先取明亮色 */
function extractMaterialColor(materials) {
  for (const mat of materials) {
    if (mat.color) {
      const c = mat.color
      // 如果材质颜色足够亮，直接用
      if (c.r + c.g + c.b > 0.3) return c.clone()
    }
  }
  // 回退：用亮青色确保可见
  return new THREE.Color(0x00d4ff)
}

function disposeEdgesGroup(edgesGroup) {
  if (!edgesGroup) return
  const edgeLines = Array.isArray(edgesGroup.userData?.edgeLines)
    ? edgesGroup.userData.edgeLines
    : []
  edgeLines.forEach((line) => {
    line.parent?.remove(line)
    if (line.geometry) line.geometry.dispose()
    if (line.material) line.material.dispose()
  })
  edgesGroup.parent?.remove(edgesGroup)
  edgesGroup.traverse((child) => {
    if (child.geometry) child.geometry.dispose()
    if (child.material) child.material.dispose()
  })
}

function getGLTFTextureLoader() {
  if (!gltfTextureLoader) {
    gltfTextureLoader = new THREE.TextureLoader()
  }
  return gltfTextureLoader
}

function loadModelTexture(url, colorSpace = THREE.NoColorSpace) {
  if (!url) return null
  const normalizedUrl = encodeURI(url)
  if (gltfTextureCache.has(normalizedUrl)) {
    return gltfTextureCache.get(normalizedUrl)
  }
  const texture = getGLTFTextureLoader().load(normalizedUrl)
  texture.colorSpace = colorSpace
  texture.flipY = false
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  gltfTextureCache.set(normalizedUrl, texture)
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

function applyRealModelTextures(model) {
  if (!model) return
  model.traverse((child) => {
    if (!child?.isMesh || !child.material) return
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material]
    for (const material of materials) {
      applyTextureSetToMaterial(material, REAL_MODEL_TEXTURES[material.name])
    }
  })
}

// Watch video layer visible changes — 自动跟随图层显隐
watch(
  () => {
    const videoLayer = (props.generatedVizLayers || []).find((l) => l.kind === 'video')
    return videoLayer?.visible !== false
  },
  (visible) => {
    setPersonSkeletonVisible(visible)
  },
)

function findGLTFModelKeyForObject(object) {
  let current = object
  while (current) {
    const key = current.userData?.gltfModelKey
    if (key) {
      return key
    }
    current = current.parent
  }
  return ''
}

function resolveOpacityForModelKey(key, fallback = 1) {
  const config = GLTF_MODEL_CONFIGS.find((item) => item.key === key)
  if (config) return resolveConfiguredModelOpacity(config)
  return fallback
}

function restoreHighlightedGeometryMaterials() {
  for (const [material, original] of highlightedGeometryMaterials.entries()) {
    if (!material) continue
    if (material.color && original.color) {
      material.color.copy(original.color)
    }
    if (material.emissive && original.emissive) {
      material.emissive.copy(original.emissive)
    }
    if ('emissiveIntensity' in material) {
      material.emissiveIntensity = original.emissiveIntensity
    }
    if ('visible' in material) {
      material.visible = original.visible
    }
    if ('transparent' in material) {
      material.transparent = original.transparent
    }
    if ('opacity' in material) {
      material.opacity = original.opacity
    }
    material.needsUpdate = true
  }
  highlightedGeometryMaterials.clear()
}

function disposeGeometrySelectionOutline() {
  if (!selectedGeometryOutline) return
  selectedGeometryOutline.parent?.remove(selectedGeometryOutline)
  selectedGeometryOutline.geometry?.dispose?.()
  const material = selectedGeometryOutline.material
  if (Array.isArray(material)) {
    material.forEach((m) => m?.dispose?.())
  } else {
    material?.dispose?.()
  }
  selectedGeometryOutline = null
}

function clearGeometryModelSelection() {
  disposeGeometryInfoPopup()
  disposeGeometrySelectionOutline()
  restoreHighlightedGeometryMaterials()
  selectedGeometryMesh = null
}

function getHiddenGeometryMeshName(mesh) {
  return (
    findBoundaryConditionForMesh(mesh)?.name ||
    mesh?.userData?.geometrySelectionName ||
    getGeometryMeshSelectionName(mesh)
  )
}

function hideGeometryMesh(mesh) {
  if (!mesh || !mesh.userData?.geometrySelectable) return false
  clearGeometryModelSelection()
  mesh.visible = false
  if (!hiddenGeometryMeshes.value.some((item) => item.mesh === mesh)) {
    hiddenGeometryMeshes.value = [
      ...hiddenGeometryMeshes.value,
      {
        id: `${Date.now()}-${hiddenGeometryMeshes.value.length}`,
        name: getHiddenGeometryMeshName(mesh),
        mesh,
      },
    ]
  }
  return true
}

function showGeometryMesh(item) {
  const mesh = item?.mesh
  if (!mesh) return
  mesh.visible = true
  hiddenGeometryMeshes.value = hiddenGeometryMeshes.value.filter(
    (current) => current.mesh !== mesh,
  )
}

function showAllHiddenGeometryMeshes() {
  hiddenGeometryMeshes.value.forEach((item) => {
    if (item?.mesh) item.mesh.visible = true
  })
  hiddenGeometryMeshes.value = []
}

function applyGeometryMeshMaterialHighlight(mesh) {
  if (!mesh?.material) return 0
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const highlightColor = new THREE.Color(0xffd166)
  let count = 0
  for (const material of materials) {
    if (!material || highlightedGeometryMaterials.has(material)) continue
    highlightedGeometryMaterials.set(material, {
      color: material.color?.clone?.() || null,
      emissive: material.emissive?.clone?.() || null,
      emissiveIntensity: material.emissiveIntensity,
      visible: material.visible,
      transparent: material.transparent,
      opacity: material.opacity,
    })
    if (material.color) {
      material.color.copy(highlightColor)
    }
    if (material.emissive) {
      material.emissive.copy(highlightColor)
      material.emissiveIntensity = Math.max(
        Number(material.emissiveIntensity) || 0,
        0.65,
      )
    }
    material.visible = true
    if ('opacity' in material) {
      material.transparent = true
      material.opacity = Math.max(Number(material.opacity) || 0, 0.86)
    }
    material.needsUpdate = true
    count += 1
  }
  return count
}

function attachGeometrySelectionOutline(mesh) {
  if (!mesh?.geometry) return null
  const edgesGeometry = new THREE.EdgesGeometry(mesh.geometry, 18)
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xfff1a8,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
    depthWrite: false,
  })
  const outline = new THREE.LineSegments(edgesGeometry, edgeMaterial)
  outline.name = '__geometrySelectionOutline'
  outline.userData.isGeometrySelectionOutline = true
  outline.renderOrder = 1300
  outline.raycast = () => {}
  mesh.add(outline)
  selectedGeometryOutline = outline
  return outline
}

function selectGeometryMesh(mesh, options = {}) {
  if (!mesh || !mesh.userData?.geometrySelectable) return false
  clearGeometryModelSelection()
  selectedGeometryMesh = mesh
  applyGeometryMeshMaterialHighlight(mesh)
  attachGeometrySelectionOutline(mesh)
  if (options.showPopup !== false) {
    createGeometryInfoPopup(mesh)
  }
  return true
}

function selectGeometryMeshByName(name) {
  if (!name) return false
  const model = getVisibleGeometryModelForSelection()
  if (!model) return false
  let target = null
  model.traverse((child) => {
    if (target) return
    if (child.isMesh && child.userData?.geometrySelectionName === name) {
      target = child
    }
  })
  if (!target) return false
  return selectGeometryMesh(target)
}

function getVisibleGeometryModelForSelection() {
  const model = gltfModels.get('geometry') || null
  if (!model?.parent || !model.visible) return null
  return model
}

function resolveSelectableGeometryMesh(object, rootModel) {
  let current = object
  while (current && current !== rootModel) {
    if (current.userData?.isGeometrySelectionOutline) return null
    if (current.isMesh && current.userData?.geometrySelectable) {
      return current
    }
    current = current.parent
  }
  return null
}

function isGeometryMeshVisibleForSelection(mesh, rootModel) {
  let current = mesh
  while (current && current !== rootModel) {
    if (current.visible === false) return false
    current = current.parent
  }
  return true
}

function pickGeometrySelectionMesh() {
  const model = getVisibleGeometryModelForSelection()
  if (!raycaster || !model) return null
  const hits = raycaster.intersectObjects(model.children, true)
  for (const hit of hits) {
    const mesh = resolveSelectableGeometryMesh(hit.object, model)
    if (mesh && isGeometryMeshVisibleForSelection(mesh, model)) return mesh
  }
  return null
}

/** 根据展示模式创建/移除模型边线辅助对象 */
function updateModelEdges(modelKey, model, displayMode, opacity = 1) {
  const existingEdgesGroup = modelEdgesGroups.get(modelKey)
  if (existingEdgesGroup) {
    disposeEdgesGroup(existingEdgesGroup)
    modelEdgesGroups.delete(modelKey)
  }

  if (!model) return

  const needEdges = displayMode === 'edges'
  if (!needEdges) return

  const edgesGroup = new THREE.Group()
  edgesGroup.name = '__modelEdges'
  edgesGroup.userData.edgeLines = []

  model.traverse((child) => {
    if (!child?.isMesh || !child.geometry) return

    const edgesGeometry = new THREE.EdgesGeometry(child.geometry, 15)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: Math.min(opacity + 0.2, 1),
      depthWrite: false,
    })
    const lineSegments = new THREE.LineSegments(edgesGeometry, lineMaterial)
    lineSegments.name = '__modelEdgesLine'
    lineSegments.raycast = () => {}
    // 边线挂到原 mesh 上，继承完整的父级矩阵链，避免多层 GLTF 节点下发生偏移。
    child.add(lineSegments)
    edgesGroup.userData.edgeLines.push(lineSegments)
  })

  // 仅作为清理用的注册节点；实际边线挂在对应 mesh 下以保持对齐。
  model.add(edgesGroup)
  modelEdgesGroups.set(modelKey, edgesGroup)
}

function attachRenderer() {
  if (!hostRef.value || !renderer) return
  // 场景管理器已经处理了容器绑定，这里只需要添加事件监听
  const canvas = renderer.domElement
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('click', onMouseClick)
  canvas.addEventListener('contextmenu', openSceneContextMenu)
  canvas.addEventListener('pointerdown', handleSceneMenuPointer, true)
  canvas.addEventListener('mousedown', handleSceneMenuPointer, true)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', handleSceneContextMenuKeydown)
  window.addEventListener('resize', closeSceneContextMenu)
  // 添加键盘事件监听（WASD 控制）
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
}

function resizeRenderer() {
  // 场景管理器会自动处理 resize
  // 这里保留空函数以兼容现有代码
}

function buildPlaneScene() {
  planeModeDelegate.buildScene()
}

function clearPlaneScene() {
  planeModeDelegate.dispose()
  clearGroup(planeGroup)
}

function buildVolumeSceneFallback() {
  if (!volumeModeDelegate) return
  volumeModeDelegate.buildFallback()
}

function clearVolumeScene() {
  volumeModeDelegate?.dispose()
  clearGroup(volumeGroup)
  lastVolumeFocusKey = ''
}

function clearRadarResultPreviewScene() {
  if (!radarResultPreviewGroup) return
  radarTrailParticles = []
  clearGroup(radarResultPreviewGroup)
}

function makeRadarPreviewMat(color, options = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: options.opacity == null ? false : options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.DoubleSide,
    depthWrite: options.depthWrite ?? false,
  })
}

function addRadarPreviewLabel(text, position) {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(5, 14, 24, 0.72)'
  ctx.fillRect(0, 16, 384, 56)
  ctx.strokeStyle = 'rgba(106, 255, 255, 0.8)'
  ctx.strokeRect(1, 17, 382, 54)
  ctx.fillStyle = '#eaffff'
  ctx.font = '600 28px Microsoft YaHei, Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 192, 45)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  )
  sprite.position.copy(position)
  sprite.scale.set(1.4, 0.35, 1)
  radarResultPreviewGroup.add(sprite)
}

function encodeRadarPreviewSvgDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function createRadarPreviewSvgTexture(svg) {
  const texture = new THREE.TextureLoader().load(encodeRadarPreviewSvgDataUrl(svg))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function loadRadarResultTexture(url) {
  const cleanUrl = normalizeUrl(url)
  if (!cleanUrl) return null
  const cached = radarResultTextureCache.get(cleanUrl)
  if (cached) return cached
  if (!radarResultTextureLoader) radarResultTextureLoader = new THREE.TextureLoader()
  const texture = radarResultTextureLoader.load(cleanUrl)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.center.set(0.5, 0.5)
  texture.rotation = -Math.PI / 2
  texture.needsUpdate = true
  radarResultTextureCache.set(cleanUrl, texture)
  return texture
}

function drawRadarHeatmapCanvas(ctx, width, height, phase = 0) {
  const p = ((Number(phase) || 0) % 1 + 1) % 1
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(4, 12, 35, 0.18)'
  ctx.fillRect(0, 0, width, height)

  const sourceX = 170
  const sourceY = 418
  const travelX = 310 + p * 470
  const travelY = 340 - p * 190 + Math.sin(p * Math.PI * 2) * 28
  const echoX = 780 - p * 240
  const echoY = 150 + p * 120

  const source = ctx.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, 170)
  source.addColorStop(0, 'rgba(255,255,230,0.98)')
  source.addColorStop(0.18, 'rgba(50,245,255,0.92)')
  source.addColorStop(0.48, 'rgba(23,115,255,0.55)')
  source.addColorStop(1, 'rgba(4,14,45,0)')
  ctx.fillStyle = source
  ctx.fillRect(0, 0, width, height)

  const waveBand = ctx.createLinearGradient(60 + p * 180, 430, 910 + p * 80, 130)
  waveBand.addColorStop(0, 'rgba(20, 190, 255, 0)')
  waveBand.addColorStop(0.24, 'rgba(31, 215, 255, 0.36)')
  waveBand.addColorStop(0.46, 'rgba(255, 225, 82, 0.5)')
  waveBand.addColorStop(0.66, 'rgba(255, 122, 54, 0.42)')
  waveBand.addColorStop(1, 'rgba(255, 60, 42, 0)')
  ctx.save()
  ctx.globalAlpha = 0.9
  ctx.fillStyle = waveBand
  ctx.beginPath()
  ctx.moveTo(68 + p * 82, 390 - p * 32)
  ctx.bezierCurveTo(265, 250, 440 + p * 80, 205, 895, 96 + p * 28)
  ctx.lineTo(948, 180 + p * 24)
  ctx.bezierCurveTo(520 + p * 58, 272, 305, 335, 96 + p * 92, 470 - p * 22)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  const hot = ctx.createRadialGradient(travelX, travelY, 0, travelX, travelY, 230)
  hot.addColorStop(0, 'rgba(255,245,180,1)')
  hot.addColorStop(0.2, 'rgba(255,52,38,0.95)')
  hot.addColorStop(0.46, 'rgba(255,208,63,0.68)')
  hot.addColorStop(0.72, 'rgba(45,220,255,0.32)')
  hot.addColorStop(1, 'rgba(4,14,45,0)')
  ctx.fillStyle = hot
  ctx.fillRect(0, 0, width, height)

  const echo = ctx.createRadialGradient(echoX, echoY, 0, echoX, echoY, 180)
  echo.addColorStop(0, 'rgba(255, 238, 138, 0.5)')
  echo.addColorStop(0.34, 'rgba(255, 128, 64, 0.32)')
  echo.addColorStop(1, 'rgba(4,14,45,0)')
  ctx.fillStyle = echo
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.globalAlpha = 0.62
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(235,255,255,0.72)'
  ctx.beginPath()
  ctx.ellipse(travelX, travelY, 90 + p * 72, 50 + p * 38, -0.08, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.32
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.ellipse(travelX, travelY, 155 + p * 112, 92 + p * 58, -0.08, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 0.38 + 0.18 * Math.sin(p * Math.PI * 2)
  ctx.strokeStyle = 'rgba(226, 255, 255, 0.88)'
  ctx.lineWidth = 4
  for (let i = 0; i < 3; i += 1) {
    const lanePhase = (p + i * 0.18) % 1
    ctx.beginPath()
    ctx.moveTo(72 + lanePhase * 70, 350 + i * 34 - lanePhase * 22)
    ctx.bezierCurveTo(
      238,
      250 + i * 20,
      420 + lanePhase * 90,
      210 + i * 8,
      888,
      150 + i * 28,
    )
    ctx.stroke()
  }
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 0.12
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  for (let x = 120; x < width; x += 120) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 90; y < height; y += 90) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

function createRadarHeatmapCanvasTexture(phase = 0) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 576
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  drawRadarHeatmapCanvas(ctx, canvas.width, canvas.height, phase)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function drawRadarWavefrontCloudCanvas(ctx, width, height, phase = 0) {
  const p = ((Number(phase) || 0) % 1 + 1) % 1
  ctx.clearRect(0, 0, width, height)

  const bg = ctx.createLinearGradient(0, 0, width, height)
  bg.addColorStop(0, 'rgba(5, 20, 48, 0.86)')
  bg.addColorStop(0.42, 'rgba(10, 76, 116, 0.82)')
  bg.addColorStop(0.72, 'rgba(12, 150, 160, 0.62)')
  bg.addColorStop(1, 'rgba(4, 22, 44, 0.82)')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  const sourceX = width * 0.16
  const sourceY = height * 0.72
  const waveX = width * (0.2 + p * 0.66)
  const waveY = height * (0.68 - p * 0.34 + Math.sin(p * Math.PI * 2) * 0.035)

  const source = ctx.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, width * 0.18)
  source.addColorStop(0, 'rgba(235, 255, 255, 0.95)')
  source.addColorStop(0.22, 'rgba(72, 235, 255, 0.86)')
  source.addColorStop(0.58, 'rgba(24, 138, 255, 0.42)')
  source.addColorStop(1, 'rgba(4, 14, 45, 0)')
  ctx.fillStyle = source
  ctx.fillRect(0, 0, width, height)

  const band = ctx.createLinearGradient(sourceX, sourceY, width * 0.92, height * 0.18)
  band.addColorStop(0, 'rgba(30, 210, 255, 0)')
  band.addColorStop(Math.max(0, p - 0.18), 'rgba(40, 226, 255, 0.1)')
  band.addColorStop(p, 'rgba(255, 232, 96, 0.72)')
  band.addColorStop(Math.min(1, p + 0.16), 'rgba(65, 225, 255, 0.28)')
  band.addColorStop(1, 'rgba(20, 90, 255, 0)')
  ctx.save()
  ctx.globalAlpha = 0.96
  ctx.fillStyle = band
  ctx.beginPath()
  ctx.moveTo(width * 0.05, height * 0.78)
  ctx.bezierCurveTo(width * 0.28, height * 0.48, width * 0.47, height * 0.36, width * 0.92, height * 0.2)
  ctx.lineTo(width * 0.96, height * 0.36)
  ctx.bezierCurveTo(width * 0.54, height * 0.46, width * 0.31, height * 0.58, width * 0.08, height * 0.9)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = 'rgba(232, 255, 255, 0.72)'
  ctx.lineWidth = 4
  for (let i = 0; i < 4; i += 1) {
    const local = (p + i * 0.17) % 1
    const x = width * (0.18 + local * 0.66)
    const y = height * (0.7 - local * 0.33)
    ctx.globalAlpha = 0.52 * (1 - local * 0.42)
    ctx.beginPath()
    ctx.ellipse(x, y, width * (0.065 + local * 0.09), height * (0.055 + local * 0.08), -0.28, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  const crest = ctx.createRadialGradient(waveX, waveY, 0, waveX, waveY, width * 0.2)
  crest.addColorStop(0, 'rgba(255, 240, 138, 0.72)')
  crest.addColorStop(0.34, 'rgba(38, 232, 255, 0.48)')
  crest.addColorStop(1, 'rgba(4, 14, 45, 0)')
  ctx.fillStyle = crest
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.globalAlpha = 0.13
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  for (let x = 120; x < width; x += 120) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 90; y < height; y += 90) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

function createRadarWavefrontCloudCanvasTexture(phase = 0) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 576
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  drawRadarWavefrontCloudCanvas(ctx, canvas.width, canvas.height, phase)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function resolveRadarPreviewPlaybackPhase(elapsed = 0) {
  const step = Math.max(0, Number(props.timelineCurrentStep) || 0)
  const total = Math.max(
    1,
    Array.isArray(props.timelineTimeSteps) && props.timelineTimeSteps.length
      ? props.timelineTimeSteps.length
      : Array.isArray(props.timelinePhysicalTimes) && props.timelinePhysicalTimes.length
        ? props.timelinePhysicalTimes.length
        : 96,
  )
  const speed = Math.max(
    0.1,
    Number(runtimeState.value.animationSpeed) ||
      Number(props.visualization?.animationSpeed) ||
      1,
  )
  const timelinePhase = (step % total) / total
  const livePhase = props.isTimelinePlaying ? elapsed * speed * 0.08 : 0
  return (timelinePhase + livePhase) % 1
}

function clampRadarPreviewValue(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function resolveRadarPreviewLayout() {
  const normalized = normalizeModelBounds(geometryBounds.value)
  const min = normalized
    ? new THREE.Vector3(normalized.min[0] / 100, normalized.min[1] / 100, normalized.min[2] / 100)
    : new THREE.Vector3(-2, 0, -1.5)
  const max = normalized
    ? new THREE.Vector3(normalized.max[0] / 100, normalized.max[1] / 100, normalized.max[2] / 100)
    : new THREE.Vector3(2, 1.5, 1.5)
  const box = new THREE.Box3(min, max)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const safeSize = new THREE.Vector3(
    Math.max(size.x, 0.2),
    Math.max(size.y, 0.2),
    Math.max(size.z, 0.2),
  )
  const inset = Math.max(0.03, Math.min(safeSize.x * 0.06, 0.18))
  const panelThickness = Math.max(0.025, Math.min(safeSize.x * 0.035, 0.08))
  const rawEmitter = props.visualization?.radar_emitter
  const emitterCm = rawEmitter && typeof rawEmitter === 'object'
    ? {
        x: Number(rawEmitter.x),
        y: Number(rawEmitter.y),
        z: Number(rawEmitter.z),
      }
    : null
  const hasCustomEmitter =
    emitterCm &&
    [emitterCm.x, emitterCm.y, emitterCm.z].every(Number.isFinite) &&
    Math.hypot(emitterCm.x, emitterCm.y, emitterCm.z) > 1e-6
  const emitterWorld = hasCustomEmitter
    ? new THREE.Vector3(emitterCm.x / 100, emitterCm.y / 100, emitterCm.z / 100)
    : new THREE.Vector3(
        min.x + inset + panelThickness * 0.5,
        center.y,
        center.z,
      )
  emitterWorld.set(
    clampRadarPreviewValue(emitterWorld.x, min.x + panelThickness * 0.5, max.x - panelThickness * 0.5),
    clampRadarPreviewValue(emitterWorld.y, min.y + safeSize.y * 0.08, max.y - safeSize.y * 0.08),
    clampRadarPreviewValue(emitterWorld.z, min.z + safeSize.z * 0.08, max.z - safeSize.z * 0.08),
  )
  return {
    box,
    min,
    max,
    size: safeSize,
    center,
    emitterWorld,
    emitterCm: {
      x: emitterWorld.x * 100,
      y: emitterWorld.y * 100,
      z: emitterWorld.z * 100,
    },
    panelThickness,
    panelHeight: Math.max(0.12, Math.min(safeSize.y * 0.36, 0.62)),
    panelDepth: Math.max(0.12, Math.min(safeSize.z * 0.36, 0.72)),
  }
}

function resolveRadarPreviewPlaneSelection(layout, layer = activeRadarResultPreviewLayer.value) {
  const layerSelection = parseLayerPlaneSelection(layer)
  const plane = String(layerSelection?.plane || props.selectedPlane || 'xy').toLowerCase()
  const rawCoordinate = Number(
    Number.isFinite(layerSelection?.coordinate)
      ? layerSelection.coordinate
      : props.planeCoordinate,
  )
  const coordinate = Number.isFinite(rawCoordinate) ? rawCoordinate : null
  return {
    plane: ['xy', 'xz', 'yz'].includes(plane) ? plane : 'xy',
    coordinate,
    layout,
  }
}

function buildRadarPreviewPlaneGeometry(layout, selection) {
  const { min, max, center } = layout
  const plane = selection?.plane || 'xy'
  const coordinate = selection?.coordinate
  const eps = Math.max(0.002, Math.min(layout.size.x, layout.size.y, layout.size.z) * 0.002)
  let vertices
  if (plane === 'xz') {
    const y = clampRadarPreviewValue(
      coordinate == null ? center.y : coordinate,
      min.y,
      max.y,
    ) + eps
    vertices = [
      min.x, y, min.z,
      max.x, y, min.z,
      max.x, y, max.z,
      min.x, y, max.z,
    ]
  } else if (plane === 'yz') {
    const x = clampRadarPreviewValue(
      coordinate == null ? center.x : coordinate,
      min.x,
      max.x,
    ) + eps
    vertices = [
      x, min.y, min.z,
      x, max.y, min.z,
      x, max.y, max.z,
      x, min.y, max.z,
    ]
  } else {
    const z = clampRadarPreviewValue(
      coordinate == null ? center.z : coordinate,
      min.z,
      max.z,
    ) + eps
    vertices = [
      min.x, min.y, z,
      max.x, min.y, z,
      max.x, max.y, z,
      min.x, max.y, z,
    ]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  )
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}

function addRadarPreviewSource(layout) {
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(layout.panelThickness, layout.panelHeight, layout.panelDepth),
    makeRadarPreviewMat('#24424d', { opacity: 0.92 }),
  )
  panel.position.copy(layout.emitterWorld)
  radarResultPreviewGroup.add(panel)
  const elemMat = makeRadarPreviewMat('#72e6ff', { opacity: 0.85 })
  for (let y = 0; y < 4; y += 1) {
    for (let z = 0; z < 6; z += 1) {
      const patch = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(0.006, layout.panelThickness * 0.22),
          layout.panelHeight / 7,
          layout.panelDepth / 9,
        ),
        elemMat,
      )
      patch.position.set(
        layout.emitterWorld.x + layout.panelThickness * 0.52,
        layout.emitterWorld.y - layout.panelHeight * 0.28 + y * layout.panelHeight * 0.19,
        layout.emitterWorld.z - layout.panelDepth * 0.34 + z * layout.panelDepth * 0.136,
      )
      radarResultPreviewGroup.add(patch)
    }
  }
}

function addRadarPreviewBounds(layout) {
  const boxSize = layout.box.getSize(new THREE.Vector3())
  const boxCenter = layout.box.getCenter(new THREE.Vector3())
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z),
    makeRadarPreviewMat('#aeb8b4', { opacity: 0.045 }),
  )
  shell.position.copy(boxCenter)
  radarResultPreviewGroup.add(shell)
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z)),
    new THREE.LineBasicMaterial({ color: '#c8f5ff', transparent: true, opacity: 0.5 }),
  )
  edge.position.copy(boxCenter)
  radarResultPreviewGroup.add(edge)
}

function buildRadarWavefrontPreview() {
  const layout = resolveRadarPreviewLayout()
  addRadarPreviewSource(layout)
  addRadarPreviewBounds(layout)
  const colors = ['#79e8ff', '#c7fbff', '#ffd45a', '#ff9b4b']
  const spanX = Math.max(layout.max.x - layout.emitterWorld.x, 0.1)
  const stepX = spanX / 8
  const maxRadiusY = layout.size.y * 0.42
  const maxRadiusZ = layout.size.z * 0.42
  const waveRadiusScale = maxRadiusZ / Math.max(maxRadiusY, 1e-6)
  for (let i = 0; i < 8; i += 1) {
    const progress = (i + 1) / 8
    const radius = Math.max(0.035, Math.min(maxRadiusY, maxRadiusZ) * progress)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, Math.max(0.004, radius * 0.028), 8, 96),
      makeRadarPreviewMat(colors[i % colors.length], { opacity: 0.52 - i * 0.035 }),
    )
    ring.position.set(
      clampRadarPreviewValue(layout.emitterWorld.x + stepX * (i + 0.7), layout.min.x, layout.max.x),
      layout.emitterWorld.y,
      layout.emitterWorld.z,
    )
    ring.rotation.y = Math.PI / 2
    ring.scale.z = waveRadiusScale
    ring.userData.radarWavefrontPreview = {
      kind: 'direct',
      offset: i / 8,
      emitterX: layout.emitterWorld.x,
      spanX: spanX * 0.94,
      y: layout.emitterWorld.y,
      z: layout.emitterWorld.z,
      minX: layout.min.x,
      maxX: layout.max.x,
      zScale: waveRadiusScale,
      baseOpacity: 0.58,
    }
    radarResultPreviewGroup.add(ring)
  }
  const wallX = layout.max.x - 0.004
  const middleWallX = clampRadarPreviewValue(
    layout.emitterWorld.x + spanX * 0.54,
    layout.min.x + layout.size.x * 0.12,
    layout.max.x - layout.size.x * 0.18,
  )
  const impactCenter = new THREE.Vector3(
    wallX,
    clampRadarPreviewValue(layout.emitterWorld.y, layout.min.y, layout.max.y),
    clampRadarPreviewValue(layout.emitterWorld.z, layout.min.z, layout.max.z),
  )
  const impactRadius = Math.max(
    0.08,
    Math.min(layout.size.y, layout.size.z) * 0.22,
  )
  const impactGlow = new THREE.Mesh(
    new THREE.CircleGeometry(impactRadius * 1.18, 64),
    makeRadarPreviewMat('#ffd45a', { opacity: 0.18, depthWrite: false }),
  )
  impactGlow.position.copy(impactCenter)
  impactGlow.rotation.y = Math.PI / 2
  impactGlow.scale.y = waveRadiusScale
  impactGlow.userData.radarWavefrontPreview = {
    kind: 'impact',
    offset: 0,
    hitPhase: 0.94,
    baseScale: impactGlow.scale.clone(),
    baseOpacity: 0.28,
  }
  radarResultPreviewGroup.add(impactGlow)

  for (let i = 0; i < 3; i += 1) {
    const radius = impactRadius * (0.72 + i * 0.34)
    const wallRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius, Math.max(0.004, radius * 0.025), 8, 96),
      makeRadarPreviewMat(i === 0 ? '#fff1a6' : '#ff9b4b', {
        opacity: 0.5 - i * 0.11,
      }),
    )
    wallRing.position.copy(impactCenter)
    wallRing.rotation.y = Math.PI / 2
    wallRing.scale.z = waveRadiusScale
    wallRing.userData.radarWavefrontPreview = {
      kind: 'impact',
      offset: i * 0.09,
      hitPhase: 0.94,
      baseScale: wallRing.scale.clone(),
      baseOpacity: 0.52 - i * 0.1,
    }
    radarResultPreviewGroup.add(wallRing)
  }

  const hitSparkMat = makeRadarPreviewMat('#fff4c8', { opacity: 0.78 })
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.008, impactRadius * 0.035), 10, 8),
      hitSparkMat,
    )
    spark.position.set(
      wallX - layout.size.x * (0.01 + (i % 3) * 0.006),
      clampRadarPreviewValue(
        impactCenter.y + Math.sin(angle) * impactRadius * (0.25 + (i % 3) * 0.18),
        layout.min.y,
        layout.max.y,
      ),
      clampRadarPreviewValue(
        impactCenter.z + Math.cos(angle) * impactRadius * (0.35 + (i % 2) * 0.16),
        layout.min.z,
        layout.max.z,
      ),
    )
    radarResultPreviewGroup.add(spark)
  }

  const reflectedColors = ['#ffb36a', '#ffd45a', '#9beeff']
  for (let i = 0; i < 3; i += 1) {
    const radius = Math.max(0.035, impactRadius * (0.95 - i * 0.18))
    const reflectedRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius, Math.max(0.003, radius * 0.022), 8, 72),
      makeRadarPreviewMat(reflectedColors[i], { opacity: 0.24 - i * 0.045 }),
    )
    reflectedRing.position.set(
      clampRadarPreviewValue(wallX - stepX * (0.45 + i * 0.55), layout.min.x, layout.max.x),
      impactCenter.y,
      impactCenter.z,
    )
    reflectedRing.rotation.y = Math.PI / 2
    reflectedRing.scale.z = waveRadiusScale
    reflectedRing.userData.radarWavefrontPreview = {
      kind: 'echo',
      offset: i * 0.18,
      hitPhase: 0.94,
      impactX: wallX,
      returnSpan: spanX * 0.72,
      y: impactCenter.y,
      z: impactCenter.z,
      minX: layout.min.x,
      maxX: layout.max.x,
      zScale: waveRadiusScale,
      baseOpacity: 0.44 - i * 0.06,
    }
    radarResultPreviewGroup.add(reflectedRing)
  }

  const middleImpactCenter = new THREE.Vector3(
    middleWallX,
    impactCenter.y,
    impactCenter.z,
  )
  const middleImpactRadius = impactRadius * 0.78
  const middleHitPhase = THREE.MathUtils.clamp(
    (middleWallX - layout.emitterWorld.x) / Math.max(spanX * 0.94, 1e-6),
    0.08,
    0.88,
  )

  const middleGlow = new THREE.Mesh(
    new THREE.CircleGeometry(middleImpactRadius * 1.08, 56),
    makeRadarPreviewMat('#fff1a6', { opacity: 0.16, depthWrite: false }),
  )
  middleGlow.position.copy(middleImpactCenter)
  middleGlow.rotation.y = Math.PI / 2
  middleGlow.scale.y = waveRadiusScale
  middleGlow.userData.radarWavefrontPreview = {
    kind: 'impact',
    offset: 0,
    hitPhase: middleHitPhase,
    baseScale: middleGlow.scale.clone(),
    baseOpacity: 0.32,
  }
  radarResultPreviewGroup.add(middleGlow)

  for (let i = 0; i < 2; i += 1) {
    const radius = middleImpactRadius * (0.72 + i * 0.32)
    const middleRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius, Math.max(0.004, radius * 0.026), 8, 80),
      makeRadarPreviewMat(i === 0 ? '#fff4c8' : '#ffb36a', {
        opacity: 0.46 - i * 0.12,
      }),
    )
    middleRing.position.copy(middleImpactCenter)
    middleRing.rotation.y = Math.PI / 2
    middleRing.scale.z = waveRadiusScale
    middleRing.userData.radarWavefrontPreview = {
      kind: 'impact',
      offset: i * 0.1,
      hitPhase: middleHitPhase,
      baseScale: middleRing.scale.clone(),
      baseOpacity: 0.5 - i * 0.12,
    }
    radarResultPreviewGroup.add(middleRing)
  }

  for (let i = 0; i < 3; i += 1) {
    const radius = Math.max(0.03, middleImpactRadius * (0.84 - i * 0.14))
    const middleEcho = new THREE.Mesh(
      new THREE.TorusGeometry(radius, Math.max(0.003, radius * 0.024), 8, 72),
      makeRadarPreviewMat(reflectedColors[i % reflectedColors.length], {
        opacity: 0.34 - i * 0.055,
      }),
    )
    middleEcho.position.set(
      clampRadarPreviewValue(middleWallX - stepX * (0.28 + i * 0.45), layout.min.x, layout.max.x),
      middleImpactCenter.y,
      middleImpactCenter.z,
    )
    middleEcho.rotation.y = Math.PI / 2
    middleEcho.scale.z = waveRadiusScale
    middleEcho.userData.radarWavefrontPreview = {
      kind: 'echo',
      offset: i * 0.16,
      hitPhase: middleHitPhase,
      impactX: middleWallX,
      returnSpan: Math.max(0.1, middleWallX - layout.emitterWorld.x),
      y: middleImpactCenter.y,
      z: middleImpactCenter.z,
      minX: layout.min.x,
      maxX: layout.max.x,
      zScale: waveRadiusScale,
      baseOpacity: 0.4 - i * 0.055,
    }
    radarResultPreviewGroup.add(middleEcho)
  }
  addRadarPreviewLabel(
    '波前传播动画',
    new THREE.Vector3(layout.center.x, layout.max.y + layout.size.y * 0.08, layout.min.z),
  )
}

function buildRadarHeatmapPreview() {
  const layout = resolveRadarPreviewLayout()
  addRadarPreviewSource(layout)
  addRadarPreviewBounds(layout)
  const planeSelection = resolveRadarPreviewPlaneSelection(layout)
  const heatmapTexture = createRadarHeatmapCanvasTexture(
    resolveRadarPreviewPlaybackPhase(),
  )
  const heatmapSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="bg" x1="0" x2="1">
          <stop offset="0" stop-color="#14335f"/>
          <stop offset=".42" stop-color="#1aa7c0"/>
          <stop offset=".7" stop-color="#ffd34d"/>
          <stop offset="1" stop-color="#55261e"/>
        </linearGradient>
        <radialGradient id="hot" cx="68%" cy="46%" r="26%">
          <stop offset="0" stop-color="#ff2e24"/>
          <stop offset=".35" stop-color="#ffd24d"/>
          <stop offset=".75" stop-color="#36d7ff" stop-opacity=".35"/>
          <stop offset="1" stop-color="#071521" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="source" cx="18%" cy="72%" r="12%">
          <stop offset="0" stop-color="#eaffff"/>
          <stop offset=".3" stop-color="#31eaff"/>
          <stop offset="1" stop-color="#071521" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="640" height="360" fill="#071521" opacity=".18"/>
      <rect x="18" y="34" width="604" height="292" fill="url(#bg)" opacity=".78"/>
      <circle cx="430" cy="164" r="130" fill="url(#hot)"/>
      <circle cx="118" cy="250" r="78" fill="url(#source)" opacity=".86"/>
      <ellipse cx="430" cy="164" rx="72" ry="42" fill="none" stroke="#fff2a8" stroke-width="4" opacity=".72"/>
      <ellipse cx="430" cy="164" rx="120" ry="74" fill="none" stroke="#fff2a8" stroke-width="2" opacity=".36"/>
      <path d="M64 245 C184 170 306 138 502 120" fill="none" stroke="#dffaff" stroke-width="3" opacity=".42"/>
      <path d="M42 208 H598" stroke="#ffffff" stroke-width="2" stroke-dasharray="9 9" opacity=".35"/>
      <g opacity=".18" stroke="#ffffff">
        <path d="M100 34V326"/><path d="M180 34V326"/><path d="M260 34V326"/><path d="M340 34V326"/><path d="M420 34V326"/><path d="M500 34V326"/>
        <path d="M18 92H622"/><path d="M18 150H622"/><path d="M18 208H622"/><path d="M18 266H622"/>
      </g>
    </svg>
  `
  const plane = new THREE.Mesh(
    buildRadarPreviewPlaneGeometry(layout, planeSelection),
    new THREE.MeshBasicMaterial({
      map: heatmapTexture || createRadarPreviewSvgTexture(heatmapSvg),
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  plane.renderOrder = 610
  if (heatmapTexture?.image) {
    plane.userData.radarHeatmapPreview = {
      texture: heatmapTexture,
      lastPhase: -1,
    }
  }
  radarResultPreviewGroup.add(plane)
  addRadarPreviewLabel(
    '场强热力图',
    new THREE.Vector3(layout.center.x, layout.max.y + layout.size.y * 0.08, layout.min.z),
  )
}

function buildRadarWavefrontCloudPreview(layer) {
  const layout = resolveRadarPreviewLayout()
  addRadarPreviewSource(layout)
  addRadarPreviewBounds(layout)
  const planeSelection = resolveRadarPreviewPlaneSelection(layout, layer)
  const frameUrl = resolveFrameUrlFromLayer(layer)
  const fallbackTexture = frameUrl
    ? null
    : createRadarWavefrontCloudCanvasTexture(resolveRadarPreviewPlaybackPhase())
  const texture = loadRadarResultTexture(frameUrl) || fallbackTexture
  const plane = new THREE.Mesh(
    buildRadarPreviewPlaneGeometry(layout, planeSelection),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  plane.renderOrder = 608
  plane.userData.radarWavefrontCloudPreview = {
    layer,
    texture,
    currentUrl: frameUrl,
    fallbackCanvas: fallbackTexture?.image || null,
    lastPhase: -1,
  }
  radarResultPreviewGroup.add(plane)
  addRadarPreviewLabel(
    '波前云图',
    new THREE.Vector3(layout.center.x, layout.max.y + layout.size.y * 0.14, layout.min.z),
  )
}

function buildRadarTrailsPreview() {
  const layout = resolveRadarPreviewLayout()
  addRadarPreviewSource(layout)
  addRadarPreviewBounds(layout)
  const sc = props.visualization?.radar_trails || {}
  const primaryColor = sc.color || '#74eaff'
  const colors = [primaryColor, '#ffd45a', '#8cffc9']
  const trailCount = Math.max(
    3,
    Math.min(10, Math.round((Number(sc.seed_count) || 24) / 8)),
  )
  const particlesPerTrail = Math.max(
    2,
    Math.min(5, Math.round((Number(sc.points_per_streamline) || 36) / 18)),
  )
  const particleRadius = Math.max(
    0.018,
    Math.min(layout.size.x, layout.size.y, layout.size.z) * 0.016,
  )
  const spanX = Math.max(layout.max.x - layout.emitterWorld.x, 0.1)
  for (let i = 0; i < trailCount; i += 1) {
    const pts = []
    for (let k = 0; k <= 52; k += 1) {
      const t = k / 52
      const lane = i - (trailCount - 1) / 2
      pts.push(new THREE.Vector3(
        clampRadarPreviewValue(layout.emitterWorld.x + t * spanX * 0.92, layout.min.x, layout.max.x),
        clampRadarPreviewValue(layout.emitterWorld.y + Math.sin(t * Math.PI * 1.7 + i) * layout.size.y * 0.12, layout.min.y, layout.max.y),
        clampRadarPreviewValue(layout.emitterWorld.z + lane * layout.size.z * 0.05 + Math.sin(t * Math.PI * 2.3 + i * 0.35) * layout.size.z * 0.06, layout.min.z, layout.max.z),
      ))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.78 }),
    )
    radarResultPreviewGroup.add(line)
    for (let p = 0; p < particlesPerTrail; p += 1) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(particleRadius, 16, 10),
        makeRadarPreviewMat(colors[i % colors.length], { opacity: 0.96 }),
      )
      dot.userData.radarTrailParticle = {
        curve,
        offset: (p / particlesPerTrail + i * 0.071) % 1,
        speed: 0.075 + (i % 4) * 0.012,
        baseScale: 0.9 + p * 0.14,
      }
      dot.renderOrder = 620
      radarTrailParticles.push(dot)
      radarResultPreviewGroup.add(dot)
    }
  }
  addRadarPreviewLabel(
    '能量轨迹线',
    new THREE.Vector3(layout.center.x, layout.max.y + layout.size.y * 0.08, layout.min.z),
  )
}

function tickRadarResultPreview(elapsed = 0) {
  if (hasActiveRadarResultPreviewMode('wavefront') && radarResultPreviewGroup) {
    const timelinePhase =
      Math.max(0, Number(props.timelineCurrentStep) || 0) * 0.045
    const liveElapsed = props.isTimelinePlaying ? elapsed : 0
    radarResultPreviewGroup.traverse((obj) => {
      const state = obj.userData?.radarWavefrontPreview
      if (!state || !obj.material) return
      const phase =
        (liveElapsed * (state.kind === 'echo' ? 0.32 : 0.24) +
          timelinePhase -
          (Number(state.hitPhase) || 0) +
          state.offset +
          1) %
        1
      const fadeIn = Math.min(phase / 0.14, 1)
      const fadeOut = Math.min((1 - phase) / 0.28, 1)
      const envelope = Math.max(0, fadeIn * fadeOut)

      if (state.kind === 'direct') {
        obj.position.set(
          clampRadarPreviewValue(
            state.emitterX + state.spanX * phase,
            state.minX,
            state.maxX,
          ),
          state.y,
          state.z,
        )
        const scale = 0.72 + phase * 0.72
        obj.scale.set(scale, scale, state.zScale * scale)
        obj.material.opacity = state.baseOpacity * envelope
      } else if (state.kind === 'echo') {
        obj.position.set(
          clampRadarPreviewValue(
            state.impactX - state.returnSpan * phase,
            state.minX,
            state.maxX,
          ),
          state.y,
          state.z,
        )
        const scale = 0.58 + phase * 0.88
        obj.scale.set(scale, scale, state.zScale * scale)
        obj.material.opacity = state.baseOpacity * envelope
      } else if (state.kind === 'impact') {
        const pulse = Math.max(0, 1 - phase / 0.36)
        const scale = 0.78 + Math.sin(Math.min(phase / 0.36, 1) * Math.PI) * 1.45
        obj.scale.copy(state.baseScale).multiplyScalar(scale)
        obj.material.opacity = state.baseOpacity * pulse
      }
      obj.material.needsUpdate = true
    })
  }
  if (hasActiveRadarResultPreviewMode('wavefront_cloud') && radarResultPreviewGroup) {
    const phase = resolveRadarPreviewPlaybackPhase(elapsed)
    radarResultPreviewGroup.traverse((obj) => {
      const state = obj.userData?.radarWavefrontCloudPreview
      if (!state || !obj.material) return
      const frameUrl = resolveFrameUrlFromLayer(state.layer)
      if (frameUrl && frameUrl !== state.currentUrl) {
        const texture = loadRadarResultTexture(frameUrl)
        if (texture) {
          obj.material.map = texture
          obj.material.opacity = 0.9
          obj.material.needsUpdate = true
          state.texture = texture
          state.currentUrl = frameUrl
        }
        return
      }
      if (frameUrl) return
      const texture = state.texture
      const canvas = state.fallbackCanvas || texture?.image
      const ctx = canvas?.getContext?.('2d')
      if (!ctx || !texture) return
      if (
        state.lastPhase >= 0 &&
        Math.abs(state.lastPhase - phase) < (props.isTimelinePlaying ? 0.006 : 0.001)
      ) {
        return
      }
      drawRadarWavefrontCloudCanvas(ctx, canvas.width, canvas.height, phase)
      texture.needsUpdate = true
      state.lastPhase = phase
      obj.material.opacity = 0.82 + 0.06 * Math.sin(phase * Math.PI * 2)
      obj.material.needsUpdate = true
    })
  }
  if (hasActiveRadarResultPreviewMode('heatmap') && radarResultPreviewGroup) {
    const phase = resolveRadarPreviewPlaybackPhase(elapsed)
    radarResultPreviewGroup.traverse((obj) => {
      const state = obj.userData?.radarHeatmapPreview
      const texture = state?.texture
      const canvas = texture?.image
      const ctx = canvas?.getContext?.('2d')
      if (!ctx) return
      if (
        state.lastPhase >= 0 &&
        Math.abs(state.lastPhase - phase) < (props.isTimelinePlaying ? 0.006 : 0.001)
      ) {
        return
      }
      drawRadarHeatmapCanvas(ctx, canvas.width, canvas.height, phase)
      texture.needsUpdate = true
      state.lastPhase = phase
      if (obj.material) {
        obj.material.opacity = 0.9 + 0.05 * Math.sin(phase * Math.PI * 2)
        obj.material.needsUpdate = true
      }
    })
  }
  if (!hasActiveRadarResultPreviewMode('trails')) return
  if (!radarTrailParticles.length) return
  radarTrailParticles.forEach((particle, index) => {
    const state = particle.userData?.radarTrailParticle
    const curve = state?.curve
    if (!curve) return
    const progress = (state.offset + elapsed * state.speed) % 1
    particle.position.copy(curve.getPointAt(progress))
    const pulse = 1 + Math.sin(elapsed * 7.2 + index * 0.83) * 0.18
    particle.scale.setScalar((state.baseScale || 1) * pulse)
    if (particle.material) {
      particle.material.opacity = 0.62 + 0.34 * Math.sin(progress * Math.PI)
      particle.material.needsUpdate = true
    }
  })
}

function buildRadarStructurePreview() {
  const layout = resolveRadarPreviewLayout()
  addRadarPreviewSource(layout)
  addRadarPreviewBounds(layout)
  const rebarMat = makeRadarPreviewMat('#1d2b30', { opacity: 0.95 })
  const barRadius = Math.max(0.006, Math.min(layout.size.y, layout.size.z) * 0.012)
  const barLength = layout.size.y * 0.78
  const zStart = layout.min.z + layout.size.z * 0.28
  const zEnd = layout.max.z - layout.size.z * 0.28
  const zStep = Math.max((zEnd - zStart) / 4, 0.01)
  for (let z = zStart; z <= zEnd + 1e-6; z += zStep) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(barRadius, barRadius, barLength, 12), rebarMat)
    bar.position.set(layout.center.x, layout.center.y, z)
    bar.rotation.z = Math.PI / 2
    radarResultPreviewGroup.add(bar)
  }
  const cavity = new THREE.Mesh(
    new THREE.SphereGeometry(Math.min(layout.size.x, layout.size.y, layout.size.z) * 0.11, 28, 14),
    makeRadarPreviewMat('#071018', { opacity: 0.76 }),
  )
  cavity.position.set(
    layout.min.x + layout.size.x * 0.66,
    layout.min.y + layout.size.y * 0.58,
    layout.min.z + layout.size.z * 0.42,
  )
  cavity.scale.set(1.35, 0.75, 1)
  radarResultPreviewGroup.add(cavity)
  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(Math.min(layout.size.y, layout.size.z) * 0.15, Math.max(0.004, barRadius * 0.5), 8, 64),
    makeRadarPreviewMat('#ffe18a', { opacity: 0.9 }),
  )
  marker.position.copy(cavity.position)
  marker.rotation.y = Math.PI / 2
  radarResultPreviewGroup.add(marker)
  addRadarPreviewLabel(
    '介质结构叠加',
    new THREE.Vector3(layout.center.x, layout.max.y + layout.size.y * 0.08, layout.min.z),
  )
}

function buildRadarResultPreviewScene() {
  clearRadarResultPreviewScene()
  const layers = activeRadarResultPreviewLayers.value
  if (!layers.length || !radarResultPreviewGroup) return
  radarResultPreviewGroup.visible = true
  layers.forEach((layer) => {
    const mode = radarResultPreviewModeForLayer(layer)
    if (mode === 'wavefront_cloud') buildRadarWavefrontCloudPreview(layer)
    else if (mode === 'heatmap') buildRadarHeatmapPreview()
    else if (mode === 'trails') buildRadarTrailsPreview()
    else if (mode === 'structure') buildRadarStructurePreview()
    else if (mode === 'wavefront') buildRadarWavefrontPreview()
  })
}

function buildStreamlineSceneFallback() {
  if (!streamlineModeDelegate) return
  streamlineModeDelegate.buildFallback()
}

function rebuildSceneByMode() {
  if (
    !scene ||
    !planeGroup ||
    !volumeGroup ||
    !streamlineGroup ||
    !particleGroup ||
    !smokeGroup ||
    !boundsGroup
  ) {
    // 场景尚未初始化,跳过重建
    return
  }
  if (activeRadarResultPreviewLayers.value.length) {
    clearPlaneScene()
    clearVolumeScene()
    runtimeState.value.streamlinePayload = null
    streamlineModeDelegate?.dispose()
    clearGroup(streamlineGroup)
    particleModeDelegate?.dispose?.()
    clearGroup(particleGroup)
    clearSmokeScene()
    velocityFieldModeDelegate?.dispose?.()
    buildRadarResultPreviewScene()
    boundsModeDelegate.updateBoundsVisibility()
    return
  }
  clearRadarResultPreviewScene()

  if (visible2DLayers.value.length > 0) {
    buildPlaneScene()
  } else {
    clearPlaneScene()
  }

  if (hasVisibleVolumeLayer.value) {
    if (volumeModeDelegate) {
      buildVolumeSceneFallback()
      syncVolumeToScene()
    }
  } else {
    clearVolumeScene()
  }

  if (hasVisibleStreamlineLayer.value) {
    if (streamlineModeDelegate) {
      syncStreamlineToScene()
    }
  } else {
    streamlineModeDelegate?.dispose()
    clearGroup(streamlineGroup)
  }

  particleModeDelegate?.sync()
  if (hasVisibleSmokeLayer.value) {
    void syncSmokeToScene()
  } else {
    clearSmokeScene()
  }
  // F4 速度场：复用粒子速度场加载逻辑，sync 阶段请求
  ;(async () => {
    const layers = visibleParticleLayers.value || []
    if (!layers.length) return
    try {
      await velocityFieldModeDelegate?.sync(layers[0])
    } catch (e) {
      console.warn('[VelocityField] sync failed:', e)
    }
  })()
  boundsModeDelegate.updateBoundsVisibility()
  syncTextureToScene()
}

let sceneSyncInProgress = false

function syncSceneForCurrentMode(previousSignatures = null) {
  if (sceneSyncInProgress) return
  sceneSyncInProgress = true
  if (
    !scene ||
    !planeGroup ||
    !volumeGroup ||
    !streamlineGroup ||
    !particleGroup ||
    !smokeGroup ||
    !boundsGroup
  ) {
    // 场景尚未初始化,跳过同步
    sceneSyncInProgress = false
    return
  }

  const currentSignatures = {
    plane: visible2DLayers.value
      .map((layer) => `${layer?.id}:${layer?.kind}:${layer?.visible !== false}`)
      .join('|'),
    volume: visibleVolumeLayers.value
      .map((layer) => `${layer?.id}:${layer?.visible !== false}`)
      .join('|'),
    streamline: visibleStreamlineLayers.value
      .map(
        (layer) =>
          `${layer?.id}:${layer?.visible !== false}:${layer?.streamlineSmokeEnabled === true}:${layer?.streamlineLineVisible !== false}`,
      )
      .join('|'),
    particle: visibleParticleLayers.value
      .map((layer) => `${layer?.id}:${layer?.visible !== false}`)
      .join('|'),
    smoke: visibleSmokeLayers.value
      .map((layer) => `${layer?.id}:${layer?.visible !== false}`)
      .join('|'),
    radarPreview: activeRadarResultPreviewLayers.value
      .map((layer) => `${layer.id}:${radarResultPreviewModeForLayer(layer)}:${layer.visible !== false}`)
      .join('|'),
  }

  if (!previousSignatures) {
    rebuildSceneByMode()
    sceneSyncInProgress = false
    return
  }

  // 各图层类型的显隐变化独立处理，不依赖 sceneMode
  if (currentSignatures.radarPreview !== previousSignatures.radarPreview) {
    rebuildSceneByMode()
    sceneSyncInProgress = false
    return
  }

  // 云图 / 矢量图图层
  if (currentSignatures.plane !== previousSignatures.plane) {
    if (visible2DLayers.value.length > 0) {
      buildPlaneScene()
    } else {
      clearPlaneScene()
    }
  }
  // layersUpdating 期间跳过 texture sync，避免触发递归更新循环
  if (!runtimeState.value.layersUpdating) {
    syncTextureToScene()
  }

  // 体渲染图层
  if (currentSignatures.volume !== previousSignatures.volume) {
    if (hasVisibleVolumeLayer.value) {
      buildVolumeSceneFallback()
      syncVolumeToScene()
    } else {
      clearVolumeScene()
    }
  }

  // 流线图图层
  if (currentSignatures.streamline !== previousSignatures.streamline) {
    if (hasVisibleStreamlineLayer.value) {
      syncStreamlineToScene()
    } else {
      streamlineModeDelegate?.dispose()
      clearGroup(streamlineGroup)
    }
  }

  if (currentSignatures.smoke !== previousSignatures.smoke) {
    if (hasVisibleSmokeLayer.value) {
      void syncSmokeToScene()
    } else {
      clearSmokeScene()
    }
  }

  boundsModeDelegate.updateBoundsVisibility()
  sceneSyncInProgress = false
}

function syncTextureToScene() {
  planeModeDelegate.syncTexture()
}

// 移除 animate 函数，由场景管理器统一管理

function parsePayloadData(data) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }
  return data
}

function upsertRuntimeLayer(layerId, patch) {
  const id = String(layerId)
  const current = runtimeState.value.layerPayloads.get(id) || {}
  runtimeState.value.layerPayloads.set(id, { ...current, ...patch, id })
  runtimeState.value.activeLayerId = id
}

function handleLayerVisibility(payload) {
  const ids = new Set()
  const layers = Array.isArray(payload?.layers) ? payload.layers : []
  const changedLocalId =
    payload?.local_id != null ? String(payload.local_id) : null
  const changedVisible = payload?.visible !== false
  layers.forEach((layer) => {
    const localId = layer?.local_id ?? layer?.id

    if (layer?.visible !== false && localId != null) ids.add(String(localId))
  })
  // 找出刚刚变成可见的 volume 图层（它们的 payload 可能还未被请求）
  // 保存更新前的可见 ID，用于对比
  const prevIds = new Set(
    Array.from(runtimeState.value.visibleLayerIds || []).map(String),
  )
  runtimeState.value.visibleLayerIds = ids
  const newVolumeLayerIds = new Set()
  for (const layer of props.generatedVizLayers || []) {
    if (layer?.kind === 'volume' && layer?.visible !== false) {
      const lid = String(layer.id)
      if (!prevIds.has(lid) && ids.has(lid)) {
        newVolumeLayerIds.add(lid)
      }
    }
  }

  const resolveCurrent3DKind = () => {
    const activeLayer = (props.generatedVizLayers || []).find(
      (layer) =>
        String(layer?.id) === String(runtimeState.value.activeLayerId || ''),
    )
    if (activeLayer?.kind === 'volume' || activeLayer?.kind === 'streamline') {
      return activeLayer.kind
    }
    if (hasVisibleVolumeLayer.value) return 'volume'
    if (hasVisibleStreamlineLayer.value) return 'streamline'
    return null
  }
  const findVisibleLayerByKind = (kind) =>
    (props.generatedVizLayers || []).find(
      (layer) =>
        layer?.kind === kind &&
        layer?.visible !== false &&
        ids.has(String(layer.id)),
    ) || null

  // 3D 图层显隐联动：
  // - 勾选某个 volume/streamline 图层时，立即切为当前激活层
  // - 取消勾选当前激活层时，仅在同类图层内回退
  if (changedLocalId) {
    const changedLayer = (props.generatedVizLayers || []).find(
      (layer) => String(layer?.id) === changedLocalId,
    )
    if (
      changedLayer?.kind === 'volume' ||
      changedLayer?.kind === 'streamline'
    ) {
      if (changedVisible && ids.has(changedLocalId)) {
        runtimeState.value.activeLayerId = changedLocalId
      } else if (runtimeState.value.activeLayerId === changedLocalId) {
        const fallback = findVisibleLayerByKind(changedLayer.kind)
        runtimeState.value.activeLayerId = fallback ? String(fallback.id) : null
      }
    }
  }

  // 防守式修正：如果当前 activeLayerId 不可见，仅回退到当前模式对应的同类图层
  if (
    runtimeState.value.activeLayerId &&
    !ids.has(String(runtimeState.value.activeLayerId))
  ) {
    const fallbackKind = resolveCurrent3DKind()
    const fallbackVisibleLayer = fallbackKind
      ? findVisibleLayerByKind(fallbackKind)
      : null
    runtimeState.value.activeLayerId = fallbackVisibleLayer
      ? String(fallbackVisibleLayer.id)
      : null
  }

  // 显隐变化可能让平面层/3D 层从无到有或从有到无，需要完整重建
  // 对于刚变为可见的 volume 图层，先把它们的 payload 从缓存取出（或触发请求），
  // 再重建场景，确保 sync() 能拿到 manifest/bin 地址并渲染体数据
  if (newVolumeLayerIds.size > 0) {
    const volLayers = (props.generatedVizLayers || []).filter(
      (l) => l?.kind === 'volume' && newVolumeLayerIds.has(String(l.id)),
    )
    // 先触发请求（不等待），再等第一个完成，最后重建场景
    const requests = volLayers.map((l) => requestVolumePayloadForLayer(l))
    Promise.all(requests).catch(() => {})
    requests[0]?.then?.(() => {
      rebuildSceneByMode()
      syncModelVisibility()
    })
  } else {
    rebuildSceneByMode()
    syncModelVisibility()
  }
}

function applyIncomingPayload(type, data) {
  const payload = parsePayloadData(data)

  if (type === 'resetLevel' || type === 'resetSettings') {
    runtimeState.value.visibleLayerIds = new Set()
    runtimeState.value.layerPayloads = new Map()
    runtimeState.value.volumePayloads = new Map()
    runtimeState.value.streamlinePayload = null
    runtimeState.value.activeLayerId = null
    runtimeState.value.focusLayerId = null
    rebuildSceneByMode()
    return true
  }
  if (type === 'vizLayerVisibility') {
    handleLayerVisibility(payload)
    return true
  }
  if (type === 'deleteLayer' && payload?.id != null) {
    const id = String(payload.id)
    runtimeState.value.layerPayloads.delete(id)
    runtimeState.value.volumePayloads.delete(id)
    const idNorm = normalizeVolumeKey(id)
    for (const key of Array.from(runtimeState.value.volumePayloads.keys())) {
      if (normalizeVolumeKey(key) === idNorm) {
        runtimeState.value.volumePayloads.delete(key)
      }
    }
    runtimeState.value.visibleLayerIds.delete(id)
    if (runtimeState.value.activeLayerId === id) {
      runtimeState.value.activeLayerId = null
    }
    // 同步模型显隐状态
    syncModelVisibility()
    return true
  }
  if (
    type === 'update2DContourParams' ||
    type === 'update2DContourParams1' ||
    type === 'update2DVectorParams'
  ) {
    const urls = Array.isArray(payload?.urls)
      ? payload.urls.map(normalizeUrl)
      : []
    const timeSteps = Array.isArray(payload?.time_step) ? payload.time_step : []
    upsertRuntimeLayer(payload?.id || `${type}-${Date.now()}`, {
      kind: type === 'update2DVectorParams' ? 'vector' : 'contour',
      urls,
      time_step: timeSteps,
      vmin: payload?.vmin,
      vmax: payload?.vmax,
      plane: payload?.plane_type,
      coordinate: payload?.plane_offset,
      payload,
    })
    return true
  }
  if (
    type === 'updateVolumeTextureParams' ||
    type === 'updateCloudTexture' ||
    type === 'updateCloud'
  ) {
    const idCandidates = new Set()
    const pushId = (value) => {
      if (value == null) return
      const sid = String(value).trim()
      if (!sid) return
      idCandidates.add(sid)
    }
    pushId(payload?.id)
    pushId(payload?.local_id)
    pushId(payload?.layer_id)
    pushId(payload?.variable)
    if (payload?.task_id != null && payload?.variable != null) {
      pushId(`volume:${payload.task_id}:${payload.variable}`)
    }
    if (idCandidates.size === 0) {
      pushId('volume')
    }
    const firstId = Array.from(idCandidates)[0]
    const existing =
      getVolumePayloadByIdLoose(firstId) ||
      findVolumePayloadByVariable(payload?.variable) ||
      runtimeState.value.volumePayloads.get(SHARED_VOLUME_PAYLOAD_KEY)
    const locatorInIncoming = hasVolumeDataLocator(payload)
    const existingHasLocator = hasVolumeDataLocator(existing)

    // 时间轴 updateCloud 常常不带 csv_urls/csv_url，不能让它把已有数据源覆盖掉
    // 若当前还没有任何可用 locator，则忽略这条无源消息，等待后续带 URL 的更新
    if (!locatorInIncoming && !existingHasLocator) {
      return true
    }

    const merged =
      existing && !locatorInIncoming
        ? {
            ...existing,
            ...payload,
            time_step:
              Array.isArray(payload?.time_step) && payload.time_step.length > 0
                ? payload.time_step
                : existing.time_step,
          }
        : payload
    cacheVolumePayload(merged, Array.from(idCandidates))
    runtimeState.value.activeLayerId = String(
      payload?.local_id ||
        payload?.id ||
        payload?.layer_id ||
        payload?.variable ||
        'volume',
    )
    // 显式触发场景重建，确保体渲染数据更新后立即同步到 Three.js 场景
    // 与 vizLayerVisibility / updateStreamLine 等消息类型的处理方式保持一致
    if (hasVisibleVolumeLayer.value) {
      rebuildSceneByMode()
    }
    return true
  }
  if (
    type === 'updateStreamLine' ||
    type === 'updateStreamlineParams' ||
    type === 'clearStreamLine'
  ) {
    runtimeState.value.streamlinePayload =
      type === 'clearStreamLine' ? null : payload
    rebuildSceneByMode()
    return true
  }
  if (type === 'focusPlane') {
    const layerId = payload?.id
    if (layerId != null) runtimeState.value.focusLayerId = String(layerId)
    if (
      payload?.kind === 'monitor' ||
      payload?.pointId != null ||
      payload?.x != null ||
      payload?.point
    ) {
      focusMonitoringPoint(payload.point || payload.pointId || payload.id || payload)
      return true
    }
    const matchedLayer = (props.generatedVizLayers || []).find(
      (layer) => String(layer?.id) === String(layerId),
    )
    if (matchedLayer && focusCameraOnPlaneLayer(matchedLayer)) {
      return true
    }
    return true
  }
  if (type === 'animationUpdate') {
    const timeStep = payload?.time_step
    if (
      payload?.update_type === 'contour' ||
      payload?.update_type === 'vector'
    ) {
      const id = payload?.id != null ? String(payload.id) : null
      if (id && runtimeState.value.layerPayloads.has(id)) {
        const current = runtimeState.value.layerPayloads.get(id)
        runtimeState.value.layerPayloads.set(id, {
          ...current,
          currentTimeStep: timeStep,
        })
      }
    }
    return true
  }
  if (type === 'updateAnimationSpeed') {
    runtimeState.value.animationSpeed = Number(payload?.speed) || 1
    return true
  }
  return false
}

function emitMessage(payload) {
  if (!payload || typeof payload !== 'object') return false
  const result = applyIncomingPayload(payload.type, payload.data)

  return result
}

function setStreamlinePayload(payload) {
  runtimeState.value.streamlinePayload = payload || null
  rebuildSceneByMode()
}

function clearStreamlinePayload() {
  runtimeState.value.streamlinePayload = null
  rebuildSceneByMode()
}

async function preloadVolumeLayer(layer) {
  if (!layer || layer.kind !== 'volume') return false
  const payload = await requestVolumePayloadForLayer(layer, {
    preferFullTimeline: true,
  })
  if (!payload) return false
  const variable = extractVolumeVariableFromLayer(layer) || payload.variable
  const globalValueRange =
    payload.vmin != null && payload.vmax != null
      ? [Number(payload.vmin), Number(payload.vmax)]
      : null
  await volumeModeDelegate?.schedulePreload?.(
    [],
    variable,
    globalValueRange,
    payload,
    { preloadAllFrames: true, layerKey: layer.id },
  )
  return true
}

defineExpose({
  emitMessage,
  getCachedGeometryBounds: () => geometryBounds.value,
  geometryModelSelections,
  selectGeometryMeshByName,
  clearGeometryModelSelection,
  // per-mesh 透明度覆盖
  setGeometryMeshOpacity,
  resetGeometryMeshOpacity,
  resetAllGeometryMeshOpacity,
  getGeometryMeshOpacityOverrides,
  getRadarMockFootprintUvRect,
  // 监测点相关方法
  addMonitoringPoint,
  updateMonitoringPoint,
  deleteMonitoringPoint,
  selectMonitoringPoint,
  focusMonitoringPoint,
  focusCameraOnPlaneLayer,
  highlightPersonModel,
  highlightAnimatedModelTarget,
  setAddingPointMode,
  getMonitoringPoints,
  syncMonitoringPoints,
  // 流线图数据方法（直接设置，不走 UE）
  setStreamlinePayload,
  clearStreamlinePayload,
  // 体渲染 payload 缓存（供 autoTrigger 等外部调用写入本地状态）
  cacheVolumePayload,
  preloadVolumeLayer,
  setVolumeDisplayRanges: () =>
    volumeModeDelegate?.updateVolumeDisplayRanges?.(),
  // 等值面方法
  setIsosurfaceEnabled: (enabled) =>
    volumeModeDelegate?.setIsosurfaceEnabled?.(enabled),
  setIsosurfaceValue: (value) =>
    volumeModeDelegate?.setIsosurfaceValue?.(value),
  getVolumeValueRange: () =>
    volumeModeDelegate?.getVolumeValueRange?.() || [0, 1],
  // 骨骼叠加层
  setPersonSkeletonVisible: (visible) => {
    if (isGoafTask(props.currentTask)) return
    setPersonSkeletonVisible(visible)
  },
  setPersonModelVisible: (visible) => {
    if (isGoafTask(props.currentTask)) return
    setPersonModelVisible(visible)
  },
  isPersonModelVisible,
  // 采空区瓦斯泄漏触发
  startGoafGasLeak: (autoIgnite = false) => goafGasSystem?.start(autoIgnite),
  igniteGoafGas: () => goafGasSystem?.ignite(),
  extinguishGoafFlame: () => goafGasSystem?.extinguishFlame(),
  resetGoafGasLeak: () => goafGasSystem?.reset(),
  getGoafGasState: () => goafGasSystem?.getState() || { stage: 'idle' },
  getGoafGasSources: () => goafGasSystem?.getSources() || [],
  setGoafGasSources: (sources) => goafGasSystem?.setSources(sources),
  getGoafGasParams: () => goafGasSystem?.getParams() || {},
  setGoafGasParams: (params) => goafGasSystem?.setParams(params),
  triggerGoafGasExplosion: () => goafGasSystem?.triggerExplosion(),
  // 动态煤/石块 API
    addGoafBlock: (opts) => goafGasSystem?.addBlock(opts),
    updateGoafBlock: (id, opts) => goafGasSystem?.updateBlock(id, opts),
    removeGoafBlock: (id) => goafGasSystem?.removeBlock(id),
    clearGoafBlocks: () => goafGasSystem?.clearBlocks(),
    getGoafBlocks: () => goafGasSystem?.getBlocks() || [],
    getGoafBlockScale: () => goafGasSystem?.getBlockScale() ?? 1,
    setGoafBlockScale: (scale) => goafGasSystem?.setBlockScale(scale),
    // 按名称控制场景模型内部对象显隐
    findNamedObject,
    setNamedObjectVisible,
    getNamedObjectVisible,
    toggleNamedObjectVisibility,
    logModelObjectNames,
  })

watch(
  () => [
    sceneMode.value,
    props.visualization?.glyph_density,
    props.visualization?.vectorColor,
    props.visualization?.density_scale,
    props.visualization?.volume_resolution,
    props.visualization?.volume_render_mode,
    props.visualization?.step_count,
    props.visualization?.streamline?.seed_count,
    props.visualization?.streamline?.line_width,
    props.visualization?.streamline?.color,
    props.visualization?.radar_trails?.seed_count,
    props.visualization?.radar_trails?.line_width,
    props.visualization?.radar_trails?.color,
  ],
  () => {
    rebuildSceneByMode()
  },
  { deep: true },
)

watch(
  () => ({
    all: (props.generatedVizLayers || [])
      .map((layer) => `${layer?.id}:${layer?.kind}:${layer?.visible !== false}`)
      .join('|'),
    plane: visible2DLayers.value
      .map((layer) => `${layer?.id}:${layer?.kind}:${layer?.visible !== false}`)
      .join('|'),
    volume: visibleVolumeLayers.value
      .map((layer) => `${layer?.id}:${layer?.visible !== false}`)
      .join('|'),
    streamline: visibleStreamlineLayers.value
      .map(
        (layer) =>
          `${layer?.id}:${layer?.visible !== false}:${layer?.streamlineSmokeEnabled === true}:${layer?.streamlineLineVisible !== false}`,
      )
      .join('|'),
    particle: visibleParticleLayers.value
      .map((layer) => `${layer?.id}:${layer?.visible !== false}`)
      .join('|'),
    smoke: visibleSmokeLayers.value
      .map((layer) => `${layer?.id}:${layer?.visible !== false}`)
      .join('|'),
    radarPreview: activeRadarResultPreviewLayers.value
      .map((layer) => `${layer.id}:${radarResultPreviewModeForLayer(layer)}:${layer.visible !== false}`)
      .join('|'),
  }),
  (nextValue, previousValue) => {
    // 递归深度保护：防止 watcher 触发的同步操作再次触发自身
    if (layersSyncDepth >= MAX_LAYERS_SYNC_DEPTH) {
      console.warn('[ThreeCanvas] 图层同步递归深度超限，跳过本次同步')
      return
    }
    layersSyncDepth++
    try {
      if (runtimeState.value.layersUpdating) {
        // 自动加载期间批量更新图层时，防抖处理避免递归
        if (layersSyncDebounceTimer) clearTimeout(layersSyncDebounceTimer)
        layersSyncDebounceTimer = setTimeout(() => {
          layersSyncDebounceTimer = null
          layersSyncDepth++
          try {
            syncVisibleLayerIdsFromProps()
            syncSceneForCurrentMode(previousValue)
            syncModelVisibility()
          } finally {
            layersSyncDepth--
          }
        }, 50)
        return
      }
      syncVisibleLayerIdsFromProps()
      syncSceneForCurrentMode(previousValue)
      syncModelVisibility()
    } finally {
      layersSyncDepth--
    }
  },
)

watch(
  () => sceneMode.value,
  (mode) => {
    volumeModeDelegate?.onModeChange(mode)
  },
)

watch(
  () => [
    activeTextureUrl.value,
    currentTimeStep.value,
    visible2DTextureSignature.value,
  ],
  () => {
    if (!runtimeState.value.layersUpdating && !sceneSyncInProgress) {
      syncTextureToScene()
    }
  },
)

watch(
  () => [
    currentTimeStep.value,
    visibleVolumeLayers.value
      .map((layer) => `${layer.id}:${extractVolumeVariableFromLayer(layer)}`)
      .join('||'),
  ],
  () => {
    if (
      runtimeState.value.layersUpdating ||
      sceneSyncInProgress ||
      !hasVisibleVolumeLayer.value
    )
      return
    if (props.isTimelinePlaying) {
      void requestLatestVolumeTimelineSync(currentTimeStep.value, {
        playback: true,
      })
    } else {
      void requestLatestVolumeTimelineSync(currentTimeStep.value)
    }
  },
  { deep: true },
)

watch(
  () => [
    props.currentTask?.id ?? null,
    visibleVolumeLayers.value
      .map((layer) => `${layer.id}:${layer.visible !== false}`)
      .join('|'),
  ],
  async ([taskId]) => {
    if (!taskId || !hasVisibleVolumeLayer.value) return
    const layers = visibleVolumeLayers.value.filter(
      (layer) => layer?.kind === 'volume',
    )
    if (!layers.length) return
    let hasPayloadUpdate = false
    for (const layer of layers) {
      const payload = await requestVolumePayloadForLayer(layer)
      if (payload && hasVisibleVolumeLayer.value) {
        hasPayloadUpdate = true
      }
    }
    if (hasPayloadUpdate && hasVisibleVolumeLayer.value) {
      if (
        props.isTimelinePlaying &&
        volumeModeDelegate?.hasVolumeMeshes?.()
      ) {
        void volumeModeDelegate.syncPlaybackFrame({ isStale: () => false })
      } else {
        syncVolumeToScene()
      }
    }
  },
  { immediate: true },
)

watch(
  () => [
    activeStreamlinePayload.value,
    currentTimeStep.value,
    isStreamlineLayerVisible.value,
    props.isTimelinePlaying,
  ],
  () => {
    if (
      !runtimeState.value.layersUpdating &&
      !sceneSyncInProgress &&
      hasVisibleStreamlineLayer.value
    ) {
      syncStreamlineToScene()
    }
  },
  { deep: false }, // 改为 false，避免深度监听导致不必要的触发
)

watch(
  () => [
    currentTimeStep.value,
    hasVisibleParticleLayer.value,
    JSON.stringify(props.visualization?.particle || {}),
  ],
  () => {
    if (!runtimeState.value.layersUpdating && !sceneSyncInProgress) {
      particleModeDelegate?.sync()
    }
  },
)

watch(
  () => [
    currentTimeStep.value,
    hasVisibleSmokeLayer.value,
    visibleSmokeLayers.value
      .map((layer) => `${layer.id}:${layer.visible !== false}`)
      .join('|'),
    props.visualization?.smoke_variable,
    props.visualization?.smoke_manifest_url,
    props.visualization?.smoke_data_scale,
    props.visualization?.smoke_world_scale,
    JSON.stringify(props.visualization?.smoke_config || {}),
    JSON.stringify(props.visualization?.smoke_particles || {}),
  ],
  () => {
    if (!runtimeState.value.layersUpdating && !sceneSyncInProgress) {
      if (hasVisibleSmokeLayer.value) {
        void syncSmokeToScene()
      } else {
        clearSmokeScene()
      }
    }
  },
)

// 监听流线设置变化（颜色和粗细）
watch(
  () => [
    props.visualization?.streamline?.line_width,
    props.visualization?.streamline?.color,
  ],
  () => {
    if (hasVisibleStreamlineLayer.value && streamlineModeDelegate) {
      // 直接更新材质，不需要重新加载数据
      streamlineModeDelegate.updateStreamlineMaterials?.()
    }
  },
  { deep: false },
)

watch(
  () => [
    activeRadarResultPreviewLayers.value
      .map((layer) => `${layer.id}:${radarResultPreviewModeForLayer(layer)}:${layer.visible !== false}`)
      .join('|'),
    props.visualization?.radar_emitter?.x,
    props.visualization?.radar_emitter?.y,
    props.visualization?.radar_emitter?.z,
    geometryBounds.value,
    props.visualization?.radar_trails?.seed_count,
    props.visualization?.radar_trails?.points_per_streamline,
    props.visualization?.radar_trails?.maximum_streamline_length,
    props.visualization?.radar_trails?.line_width,
    props.visualization?.radar_trails?.color,
    props.visualization?.radar_transmit_mode,
  ],
  () => {
    if (!activeRadarResultPreviewLayers.value.length) return
    if (runtimeState.value.layersUpdating || sceneSyncInProgress) return
    buildRadarResultPreviewScene()
  },
  { deep: false },
)

// 监听气体色带变化，重新同步体渲染（不重新加载数据，只更新材质）
watch(
  () => props.visualization?.gasCmaps,
  (newVal) => {
    console.log('[VolumeCmapWatcher] gasCmaps 变化:', JSON.stringify(newVal))
    if (hasVisibleVolumeLayer.value && volumeModeDelegate) {
      volumeModeDelegate.updateVolumePalettes?.()
    }
  },
  { deep: true },
)

// 监听色带目录加载完成，当本地存储的色带 ID 无法被解析时，目录加载完成后重新同步
watch(
  () => props.colorMapCatalog,
  (catalog) => {
    console.log(
      '[VolumeCmapWatcher] colorMapCatalog 变化:',
      Array.isArray(catalog)
        ? `数组长度=${catalog.length}, ids=${catalog.map((x) => x?.id).join(',')}`
        : catalog,
    )
    if (
      Array.isArray(catalog) &&
      catalog.length > 0 &&
      hasVisibleVolumeLayer.value &&
      volumeModeDelegate
    ) {
      // 色带目录加载完成，检查是否有 gasCmaps 需要重新解析
      const gasCmaps = props.visualization?.gasCmaps
      if (gasCmaps && Object.keys(gasCmaps).length > 0) {
        console.log(
          '[VolumeCmapWatcher] colorMapCatalog 加载完成且有 gasCmaps，触发重新同步',
        )
        volumeModeDelegate.updateVolumePalettes?.()
      }
    }
  },
  { immediate: true },
)

watch(
  () =>
    visibleVolumeLayers.value
      .map(
        (layer) =>
          `${layer.id}:${layer.display_vmin ?? ''}:${layer.display_vmax ?? ''}:${JSON.stringify(layer.volume_color_stops || [])}`,
      )
      .join('|'),
  () => {
    if (hasVisibleVolumeLayer.value && volumeModeDelegate) {
      volumeModeDelegate.updateVolumeDisplayRanges?.()
    }
  },
)

watch(
  () => props.geometricCenter,
  () => {
    if (rootGroup) {
      rootGroup.position.set(0, 0, 0)
    }
  },
  { immediate: true },
)

watch(
  () => props.selectedPlane,
  (plane) => {
    emit('update-plane', plane)
  },
)

watch(
  () => props.planeCoordinate,
  (coordinate) => {
    emit('update-coordinate', coordinate)
  },
)

watch(
  () => [
    shouldForceGhostPlanePreview.value,
    props.visualizationOptionsOpen,
    String(props.selectedPlane || 'xy').toLowerCase(),
    Number(props.planeCoordinate),
  ],
  ([shouldPreview]) => {
    if (planeGroup) {
      planeModeDelegate?.previewGhostPlane(shouldPreview)
    }
  },
  { immediate: true },
)

// 监听 currentTask 变化，同步模型显隐并加载几何包围盒
watch(
  () => props.currentTask,
  async (newTask) => {
    syncModelVisibility()
    if (newTask?.id) {
      setGeometryBounds(null)
      clearGLTFModel()
      ensureGLTFModelLoaded()

      if (newTask.status === 'completed') {
        // 加载仿真域包围盒数据；采空区/本地模拟任务 fallback 到 GLTF 模型整体包围盒
        const boundsData = await boundsModeDelegate.loadBounds(newTask.id)
        if (boundsData) {
          setGeometryBounds(boundsData)
          console.log('[ThreeCanvas] 仿真域包围盒数据已加载:', boundsData)
        }
      }
      rebuildSceneByMode()
      void syncMeetingRoomSplatForTask(newTask)

      // 采空区任务：初始化瓦斯泄漏系统
      if (goafGasSystem) {
        goafGasSystem.teardown()
        goafGasSystem = null
      }
      if (isGoafTask(newTask)) {
        goafGasSystem = createGoafGasLeakSystem({
          // currentTask watcher 是 immediate，会在 setup 阶段执行，
          // 此时 scene/modelGroup/rootGroup 尚未在 onMounted 中赋值（为 null）。
          // 用 getter 传入，setup() 时再解析最新的 three.js 对象。
          getScene: () => scene,
          getModelGroup: () => modelGroup,
          getRootGroup: () => rootGroup,
          getCamera: () => camera,
          addFrameCallback,
          removeFrameCallback,
          getCurrentTask: () => props.currentTask,
          // 不同模型朝向不同：1.glb 左右为 Z 轴，3.glb 左右为 X 轴。
          // 用 getter 让围岩层根据当前可见的模型自动选择正确的轴向。
          getActiveModelUrl: () => {
            // 优先返回可见模型的 URL（用户可能切换 geometry/real 显示）
            const real = gltfModels.get('real')
            if (real?.visible && real?.userData?.gltfModelUrl) return real.userData.gltfModelUrl
            const geom = gltfModels.get('geometry')
            if (geom?.visible && geom?.userData?.gltfModelUrl) return geom.userData.gltfModelUrl
            // 都不可见时回退到任一已加载的 URL
            if (real?.userData?.gltfModelUrl) return real.userData.gltfModelUrl
            if (geom?.userData?.gltfModelUrl) return geom.userData.gltfModelUrl
            return ''
          },
          // 泄漏源在 setup()/setSources() 后变化时通知宿主刷新 UI 列表，
          // 否则 HomeView 的 goafGasSources 在模型异步加载完成后仍为空，无法定义泄漏源。
          onSourcesUpdated: () => emit('goaf-gas-sources-updated'),
        })
        // 模型可能已经在 goafGasSystem 创建前加载完成（时序竞争），
        // 此时 loadGLTFModel 回调里的 setup 不会触发，需手动调用
        if (gltfModels.size > 0) {
          goafGasSystem.setup()
        }
      }
    } else {
      setGeometryBounds(null)
      clearGLTFModel()
      disposeMeetingRoomSplat()
      boundsModeDelegate.dispose()
      if (goafGasSystem) {
        goafGasSystem.teardown()
        goafGasSystem = null
      }
      rebuildSceneByMode()
    }
  },
  { immediate: true },
)

watch(
  () => [
    props.currentTask?.id || '',
    props.currentTask?.name || '',
    resolveGeometryModelUrl(),
    resolveRealModelUrl(),
  ].join('|'),
  () => {
    refreshGLTFModelsForResolvedUrls()
  },
  { immediate: true },
)

// 当几何包围盒加载完成后，重新缩放模型使其与包围盒匹配，并更新轴标签位置
watch(
  () => geometryBounds.value,
  (bounds) => {
    // 更新轴标签位置；bounds 为空时也保留默认 XYZ 轴
    refreshAxisHelpers(bounds)
    if (!bounds) return
    ensureGLTFModelLoaded()
    if (gltfModels.size === 0) {
      return
    }
    scaleModelToBounds()
  },
)

watch(
  () => props.visualization?.model_opacity,
  () => {
    applyModelOpacity()
  },
)

watch(
  () => props.visualization?.real_model_opacity,
  () => {
    applyModelOpacity()
  },
)

watch(
  () => props.visualization?.meeting_room_gaussian_scale,
  () => {
    applyMeetingRoomGaussianScale()
  },
)

watch(
  () => props.visualization?.meeting_room_gaussian_box_visible,
  () => {
    updateMeetingRoomSplatDebugGroup()
  },
)

watch(
  () => props.visualization?.person_model_opacity,
  () => {
    applyModelOpacity()
  },
)

watch(
  () => props.visualization?.person_real_model_opacity,
  () => {
    applyModelOpacity()
  },
)

watch(
  () => props.visualization?.model_display_mode,
  () => {
    applyModelOpacity()
  },
)

watch(
  () => props.visualization?.model_dissolve,
  () => {
    applyModelDissolveSettings()
    syncModelVisibility()
  },
  { deep: true },
)

onMounted(async () => {
  ensureScene()
  attachRenderer()
  rebuildSceneByMode()
  void syncMeetingRoomSplatForTask(props.currentTask)
  // 注册帧回调：流线粒子动画 + 体渲染 uniform 更新
  if (streamlineModeDelegate?.tick) {
    addFrameCallback(streamlineModeDelegate.tick)
  }
  if (planeModeDelegate?.tick) {
    addFrameCallback(planeModeDelegate.tick)
  }
  if (volumeModeDelegate?.tick) {
    addFrameCallback(volumeModeDelegate.tick)
  }
  if (particleModeDelegate?.tick) {
    addFrameCallback(particleModeDelegate.tick)
  }
  addFrameCallback(tickRadarResultPreview)
  addFrameCallback(tickSmokeLayer)
  addFrameCallback(updateCameraFromKeyboard)
  // 场景管理器会自动启动动画循环

  // 暴露到全局，方便开发环境诊断
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__volumeModeDelegate = volumeModeDelegate
    window.__testVolumePreload = (urls, variable, valueRange) => {
      if (volumeModeDelegate?.schedulePreload) {
        volumeModeDelegate.schedulePreload(urls, variable, valueRange)
        console.log('✅ 预加载已触发，请查看控制台日志')
      } else {
        console.error('❌ volumeModeDelegate.schedulePreload 不可用')
      }
    }
    window.__debugVolumeState = () => {
      const threeCanvas =
        document.querySelector('.three-canvas')?.__vueParentComponent?.ctx
      if (!threeCanvas) {
        console.error('❌ 未找到 ThreeVisualizationCanvas 实例')
        return
      }
      console.log('🔍 体渲染状态诊断:', {
        // 基础状态
        hasVolumeModeDelegate: !!threeCanvas.volumeModeDelegate,
        hasVisibleVolumeLayer: threeCanvas.hasVisibleVolumeLayer?.value,
        visibleVolumeLayers: threeCanvas.visibleVolumeLayers?.value?.map(
          (l) => ({
            id: l.id,
            kind: l.kind,
            visible: l.visible,
            variable: l.variable,
          }),
        ),
        selectedVolumeLayer: threeCanvas.selectedVolumeLayer?.value,

        // Payload 状态
        activeVolumePayload: threeCanvas.activeVolumePayload?.value,
        volumePayloadsMap: Array.from(
          threeCanvas.runtimeState?.volumePayloads?.entries() || [],
        ).map(([k, v]) => ({
          key: k,
          variable: v?.variable,
          hasCsvUrls: Array.isArray(v?.csv_urls) && v.csv_urls.length > 0,
          csvUrlsCount: v?.csv_urls?.length,
          hasVolumeUrls:
            Array.isArray(v?.volume_urls) && v.volume_urls.length > 0,
          volumeUrlsCount: v?.volume_urls?.length,
        })),

        // 缓存状态
        volumeVoxelCacheSize:
          threeCanvas.volumeModeDelegate?.volumeVoxelCache?.size,
        volumeVoxelPendingSize:
          threeCanvas.volumeModeDelegate?.volumeVoxelPendingCache?.size,

        // Worker 状态
        volumeWorkerExists: !!threeCanvas.volumeModeDelegate?.volumeWorker,
      })
      console.log(
        '💡 提示：手动触发同步查看日志',
        threeCanvas.volumeModeDelegate?.sync?.(),
      )
    }
    window.__debugVolumeScene = () => {
      const summarize = (obj) => ({
        name: obj?.name || obj?.type || '',
        type: obj?.type || '',
        visible: obj?.visible,
        children: obj?.children?.length || 0,
        position: obj?.position?.toArray?.(),
        scale: obj?.scale?.toArray?.(),
        material: obj?.material?.type,
        uniforms: obj?.material?.uniforms
          ? Object.keys(obj.material.uniforms)
          : [],
        volumeMeta: obj?.userData?.volumeMeta || null,
      })
      const volumeChildren = volumeGroup?.children || []
      console.log('[DEBUG] Volume Scene:', {
        hasVolumeGroup: !!volumeGroup,
        volumeGroupChildren: volumeChildren.length,
        volumeChildren: volumeChildren.map(summarize),
        camera: {
          position: camera?.position?.toArray?.(),
          target: controls?.target?.toArray?.(),
          near: camera?.near,
          far: camera?.far,
        },
        renderer: {
          webgl2: renderer?.capabilities?.isWebGL2,
          info: renderer?.info,
        },
      })
    }
    console.log(
      '[ThreeCanvas] 全局调试函数已注册:',
      'window.__debugVolumeState() - 查看体渲染状态',
      'window.__debugVolumeScene() - 查看体渲染场景对象',
      'window.__testVolumePreload(urls, variable, range) - 测试预加载',
    )
  }

  await nextTick()
})

onBeforeUnmount(() => {
  console.log('[ThreeCanvas] 组件卸载，开始清理...')
  teardownCss2dRenderer()
  clearGeometryModelSelection()
  disposeMeetingRoomSplat()
  disposeModelDissolveStates()
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    delete window.__volumeModeDelegate
    delete window.__testVolumePreload
    delete window.__debugVolumeState
    delete window.__debugVolumeScene
  }

  // 1. 清理控制器事件监听
  if (controls && volumeModeDelegate) {
    if (volumeModeDelegate.onControlStart) {
      controls.removeEventListener('start', volumeModeDelegate.onControlStart)
    }
    if (volumeModeDelegate.onControlEnd) {
      controls.removeEventListener('end', volumeModeDelegate.onControlEnd)
    }
  }

  // 2. 清理模式代理
  planeModeDelegate?.dispose()
  volumeModeDelegate?.dispose()
  if (streamlineModeDelegate?.tick) {
    removeFrameCallback(streamlineModeDelegate.tick)
  }
  if (volumeModeDelegate?.tick) {
    removeFrameCallback(volumeModeDelegate.tick)
  }
  if (particleModeDelegate?.tick) {
    removeFrameCallback(particleModeDelegate.tick)
  }
  removeFrameCallback(tickRadarResultPreview)
  removeFrameCallback(tickSmokeLayer)
  removeFrameCallback(updateCameraFromKeyboard)
  streamlineModeDelegate?.dispose()
  particleModeDelegate?.dispose()
  clearSmokeScene()
  disposeSmokeTexture()
  velocityFieldModeDelegate?.dispose()
  boundsModeDelegate?.dispose()

  // 3. 清理所有组（但不销毁，因为是单例）
  if (planeGroup) clearGroup(planeGroup)
  if (volumeGroup) clearGroup(volumeGroup)
  if (streamlineGroup) clearGroup(streamlineGroup)
  if (particleGroup) clearGroup(particleGroup)
  if (smokeGroup) clearGroup(smokeGroup)
  if (radarResultPreviewGroup) clearGroup(radarResultPreviewGroup)
  if (boundsGroup) clearGroup(boundsGroup)
  if (overlayGroup) clearGroup(overlayGroup)
  if (monitoringPointsGroup) clearGroup(monitoringPointsGroup)

  // 4. 移除事件监听器
  if (renderer?.domElement) {
    const canvas = renderer.domElement
    canvas.removeEventListener('mousemove', onMouseMove)
    canvas.removeEventListener('mousedown', onMouseDown)
    canvas.removeEventListener('mouseup', onMouseUp)
    canvas.removeEventListener('click', onMouseClick)
    canvas.removeEventListener('contextmenu', openSceneContextMenu)
    canvas.removeEventListener('pointerdown', handleSceneMenuPointer, true)
    canvas.removeEventListener('mousedown', handleSceneMenuPointer, true)
  }
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', handleSceneContextMenuKeydown)
  window.removeEventListener('resize', closeSceneContextMenu)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)

  // 5. 释放场景引用（使用单例管理器）
  if (sceneInstance) {
    releaseScene()
    console.log('[ThreeCanvas] 场景引用已释放')
  }

  // 6. 清理人员高亮模块状态（骨骼叠加层、人员模型、扫描叠加等）
  disposePersonHighlight()

  // 7. 清空本地引用
  sceneInstance = null
  renderer = null
  scene = null
  camera = null
  controls = null
  raycaster = null
  clock = null
  radarResultPreviewGroup = null
  gltfModels = new Map()
  gltfModelLoadPromises = new Map()
  modelEdgesGroups = new Map()

  rootGroup = null
  planeGroup = null
  volumeGroup = null
  streamlineGroup = null
  particleGroup = null
  smokeGroup = null
  boundsGroup = null
  overlayGroup = null
  axisGroup = null
  modelGroup = null
  monitoringPointsGroup = null

  disposeMonitoringPoints()

  // 清理 debounce timer
  if (layersSyncDebounceTimer) {
    clearTimeout(layersSyncDebounceTimer)
    layersSyncDebounceTimer = null
  }

  console.log('[ThreeCanvas] 清理完成')
})

// 辅助函数：清理材质及其纹理
function disposeMaterial(material) {
  if (!material) return

  // 清理所有纹理
  const textures = [
    'map',
    'lightMap',
    'bumpMap',
    'normalMap',
    'specularMap',
    'envMap',
    'alphaMap',
    'aoMap',
    'displacementMap',
    'emissiveMap',
    'gradientMap',
    'metalnessMap',
    'roughnessMap',
  ]

  textures.forEach((textureName) => {
    if (material[textureName]) {
      material[textureName].dispose()
    }
  })

  // 清理 shader 材质的 uniforms 中的纹理
  if (material.uniforms) {
    Object.values(material.uniforms).forEach((uniform) => {
      if (
        uniform.value?.dispose &&
        typeof uniform.value.dispose === 'function'
      ) {
        uniform.value.dispose()
      }
    })
  }

  material.dispose()
}
</script>

<template>
  <div class="three-shell">
    <div ref="hostRef" class="three-canvas"></div>
    <div v-if="modelLoading" class="three-model-loading">
      <div class="three-model-loading__spinner"></div>
      <div class="three-model-loading__text">模型加载中...</div>
    </div>
    <div
      v-if="sceneContextMenu.visible"
      class="main-scene-context-menu"
      :style="{
        left: `${sceneContextMenu.x}px`,
        top: `${sceneContextMenu.y}px`,
      }"
      @mousedown.stop
      @pointerdown.stop
      @click.stop>
      <button type="button" @click="resetMainCameraView">重置当前视角</button>
      <button
        type="button"
        :disabled="!sceneContextMenu.canAddPoint"
        @click="addMonitoringPointFromSceneMenu">
        在此添加监测点
      </button>
      <button
        v-if="sceneContextMenu.canShowGeometryDetail"
        type="button"
        @click="showGeometryDetailFromSceneMenu">
        详情
      </button>
      <button
        v-if="sceneContextMenu.canHideGeometry"
        type="button"
        @click="hideGeometryMeshFromSceneMenu">
        隐藏
      </button>
      <button
        v-if="shouldShowHiddenGeometryPanel"
        type="button"
        @click="showAllHiddenGeometryMeshesFromMenu">
        显示全部隐藏面
      </button>
      <button type="button" @click="copyMainCameraParams">复制相机参数</button>
      <button type="button" @click="downloadMainViewportSnapshot">
        导出视口截图
      </button>
    </div>
    <div
      v-if="pendingPointMove"
      class="point-move-confirm"
      :style="{
        left: `${pendingPointMove.screen?.x ?? 24}px`,
        top: `${pendingPointMove.screen?.y ?? 24}px`,
      }"
      @mousedown.stop
      @mousemove.stop
      @click.stop>
      <div class="point-move-confirm__title">是否确认更改位置？</div>
      <div class="point-move-confirm__coords">
        X {{ Number(pendingPointMove.point.x).toFixed(1) }} / Y
        {{ Number(pendingPointMove.point.y).toFixed(1) }} / Z
        {{ Number(pendingPointMove.point.z).toFixed(1) }}
      </div>
      <div class="point-move-confirm__actions">
        <button type="button" @click="cancelPendingPointMove">取消</button>
        <button type="button" class="primary" @click="confirmPendingPointMove">
          确认
        </button>
      </div>
    </div>
    <div
      v-if="shouldShowHiddenGeometryPanel"
      class="hidden-geometry-panel"
      @mousedown.stop
      @mousemove.stop
      @click.stop>
      <div class="hidden-geometry-panel__header">
        <span>已隐藏面</span>
        <button type="button" @click="showAllHiddenGeometryMeshes">
          全部显示
        </button>
      </div>
      <div class="hidden-geometry-panel__list">
        <button
          v-for="item in hiddenGeometryMeshes"
          :key="item.id"
          type="button"
          class="hidden-geometry-panel__item"
          @click="showGeometryMesh(item)">
          <span>{{ item.name }}</span>
          <strong>显示</strong>
        </button>
      </div>
    </div>
    <div class="scene-hint">
      <span>WASD 移动视角</span>
      <span>Q/E 上升下降</span>
      <span>Shift+左键平移</span>
      <span>拖拽旋转</span>
      <span>滚轮缩放</span>
      <span v-if="visualizationDimension === '2d'">
        {{ selectedPlane.toUpperCase() }} @ {{ planeCoordinate }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.three-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background:
    radial-gradient(circle at top, rgba(25, 86, 128, 0.28), transparent 36%),
    linear-gradient(180deg, #091522 0%, #040b13 100%);
}

.three-canvas {
  width: 100%;
  height: 100%;
}

.three-canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.main-scene-context-menu {
  position: absolute;
  z-index: 8;
  width: 176px;
  padding: 6px;
  border: 1px solid rgba(91, 213, 255, 0.42);
  border-radius: 6px;
  background: rgba(5, 17, 28, 0.94);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.38),
    inset 0 0 18px rgba(91, 213, 255, 0.1);
  color: rgba(232, 248, 255, 0.94);
  backdrop-filter: blur(10px);
}

.main-scene-context-menu button {
  display: block;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(232, 248, 255, 0.9);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.main-scene-context-menu button:hover {
  background: rgba(91, 213, 255, 0.16);
  color: #ffffff;
}

.main-scene-context-menu button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.main-scene-context-menu button:disabled:hover {
  background: transparent;
  color: rgba(224, 243, 255, 0.88);
}

.point-move-confirm {
  position: absolute;
  z-index: 6;
  min-width: 12rem;
  padding: 0.65rem 0.7rem;
  transform: translate(0, -50%);
  border: 1px solid rgba(91, 213, 255, 0.42);
  border-radius: 8px;
  background: rgba(5, 17, 28, 0.92);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
  color: rgba(232, 248, 255, 0.94);
  backdrop-filter: blur(10px);
}

.point-move-confirm__title {
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.25;
}

.point-move-confirm__coords {
  margin-top: 0.35rem;
  color: rgba(202, 232, 244, 0.72);
  font-size: 0.72rem;
  line-height: 1.35;
}

.point-move-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  margin-top: 0.55rem;
}

.point-move-confirm__actions button {
  height: 1.7rem;
  padding: 0 0.65rem;
  border: 1px solid rgba(132, 197, 224, 0.28);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(232, 248, 255, 0.86);
  font-size: 0.74rem;
  cursor: pointer;
}

.point-move-confirm__actions button:hover {
  border-color: rgba(91, 213, 255, 0.55);
  background: rgba(91, 213, 255, 0.12);
}

.point-move-confirm__actions .primary {
  border-color: rgba(91, 213, 255, 0.72);
  background: rgba(28, 156, 220, 0.78);
  color: #ffffff;
}

.hidden-geometry-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 5;
  width: min(220px, calc(100% - 24px));
  max-height: min(280px, calc(100% - 96px));
  padding: 8px;
  border: 1px solid rgba(255, 209, 102, 0.34);
  border-radius: 8px;
  background: rgba(7, 13, 22, 0.88);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32);
  color: rgba(255, 250, 235, 0.94);
  backdrop-filter: blur(10px);
  pointer-events: auto;
}

.hidden-geometry-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 209, 102, 0.18);
  font-size: 12px;
  font-weight: 650;
}

.hidden-geometry-panel__header button,
.hidden-geometry-panel__item {
  border: 1px solid rgba(255, 209, 102, 0.3);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 250, 235, 0.92);
  cursor: pointer;
}

.hidden-geometry-panel__header button {
  flex-shrink: 0;
  padding: 3px 7px;
  font-size: 11px;
}

.hidden-geometry-panel__list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 220px;
  margin-top: 7px;
  overflow: auto;
}

.hidden-geometry-panel__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 5px 7px;
  font-size: 12px;
  text-align: left;
}

.hidden-geometry-panel__item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-geometry-panel__item strong {
  flex-shrink: 0;
  color: rgba(255, 226, 139, 0.95);
  font-size: 11px;
}

.hidden-geometry-panel__header button:hover,
.hidden-geometry-panel__item:hover {
  border-color: rgba(255, 209, 102, 0.72);
  background: rgba(255, 209, 102, 0.16);
}

.scene-hint {
  position: absolute;
  right: 1.25rem;
  bottom: 1.25rem;
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: min(28rem, 60vw);
  pointer-events: none;
}

.scene-hint span {
  padding: 0.38rem 0.65rem;
  border-radius: 999px;
  background: rgba(6, 16, 27, 0.72);
  border: 1px solid rgba(84, 196, 255, 0.22);
  color: rgba(223, 246, 255, 0.78);
  font-size: 0.72rem;
}

@media (max-width: 768px) {
  .scene-badge {
    top: 0.8rem;
    left: 0.8rem;
    padding: 0.65rem 0.8rem;
  }

  .scene-hint {
    right: 0.8rem;
    bottom: 0.8rem;
    max-width: calc(100vw - 1.6rem);
  }

  .volume-debug-panel {
    top: 0.8rem;
    right: 0.8rem;
    width: calc(100vw - 1.6rem);
    max-height: 32vh;
  }
}
</style>

<style>
/* CSS2D 动态挂载 DOM，不使用 Vue scoped */
.person-scan-info-popup {
  min-width: 168px;
  max-width: 240px;
  padding: 0;
  border: 1px solid rgba(0, 243, 255, 0.42);
  border-radius: 8px;
  background: rgba(5, 17, 28, 0.92);
  box-shadow:
    0 0 0 1px rgba(0, 243, 255, 0.08),
    0 12px 36px rgba(0, 0, 0, 0.45);
  color: rgba(230, 247, 255, 0.95);
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  font-size: 12px;
  line-height: 1.35;
  backdrop-filter: blur(10px);
  transform-origin: bottom center;
}

.person-scan-info-popup__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 6px;
  border-bottom: 1px solid rgba(0, 243, 255, 0.18);
}

.person-scan-info-popup__name {
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.person-scan-info-popup__close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(132, 197, 224, 0.35);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(232, 248, 255, 0.88);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.person-scan-info-popup__close:hover {
  border-color: rgba(0, 243, 255, 0.55);
  background: rgba(0, 243, 255, 0.12);
}

.person-scan-info-popup__body {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.person-scan-info-popup__row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.person-scan-info-popup__k {
  color: rgba(164, 210, 230, 0.72);
  flex-shrink: 0;
}

.person-scan-info-popup__v {
  text-align: right;
  color: rgba(223, 246, 255, 0.92);
  word-break: break-word;
}

.geometry-selection-popup {
  min-width: 220px;
  max-width: min(340px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid rgba(255, 209, 102, 0.52);
  border-radius: 8px;
  background: rgba(10, 16, 24, 0.94);
  box-shadow:
    0 0 0 1px rgba(255, 209, 102, 0.1),
    0 12px 34px rgba(0, 0, 0, 0.45);
  color: rgba(255, 250, 235, 0.96);
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  font-size: 12px;
  line-height: 1.35;
  backdrop-filter: blur(10px);
  transform-origin: bottom center;
}

.geometry-selection-popup__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 6px;
  border-bottom: 1px solid rgba(255, 209, 102, 0.2);
}

.geometry-selection-popup__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
  font-size: 13px;
}

.geometry-selection-popup__close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(255, 229, 158, 0.36);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 250, 235, 0.9);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.geometry-selection-popup__close:hover {
  border-color: rgba(255, 209, 102, 0.72);
  background: rgba(255, 209, 102, 0.14);
}

.geometry-selection-popup__body {
  padding: 8px 10px 7px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.geometry-selection-popup__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  margin-top: 2px;
  border-top: 1px solid rgba(255, 209, 102, 0.16);
}

.geometry-selection-popup__section-title {
  color: rgba(255, 229, 158, 0.82);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.geometry-selection-popup__row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}

.geometry-selection-popup__k {
  color: rgba(255, 229, 158, 0.72);
  white-space: nowrap;
}

.geometry-selection-popup__row--section .geometry-selection-popup__k {
  color: rgba(255, 229, 158, 0.66);
}

.geometry-selection-popup__v {
  text-align: right;
  color: rgba(255, 250, 235, 0.92);
  word-break: break-word;
  min-width: 0;
}

.geometry-selection-popup__row--stacked {
  grid-template-columns: 1fr;
  gap: 5px;
  padding-top: 2px;
  border-top: 1px solid rgba(255, 209, 102, 0.14);
}

.geometry-selection-popup__row--stacked .geometry-selection-popup__v {
  text-align: left;
}

.geometry-selection-popup__v--species {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.geometry-selection-popup__species-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.geometry-selection-popup__species-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border: 1px solid rgba(255, 209, 102, 0.16);
  border-radius: 5px;
  background: rgba(255, 209, 102, 0.07);
}

.geometry-selection-popup__species-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 250, 235, 0.9);
}

.geometry-selection-popup__species-item strong {
  color: rgba(255, 238, 181, 0.98);
  font-weight: 700;
}

.geometry-selection-popup__species-note {
  color: rgba(255, 250, 235, 0.58);
  font-size: 11px;
}

.geometry-selection-popup__empty {
  color: rgba(255, 250, 235, 0.72);
}

.geometry-selection-popup__hide {
  display: block;
  width: calc(100% - 20px);
  margin: 0 10px 10px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 209, 102, 0.38);
  border-radius: 6px;
  background: rgba(255, 209, 102, 0.12);
  color: rgba(255, 250, 235, 0.94);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.three-model-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
  z-index: 10;
}

.three-model-loading__spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #00f3ff;
  border-radius: 50%;
  animation: three-model-loading-spin 0.8s linear infinite;
}

.three-model-loading__text {
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  letter-spacing: 0.5px;
}

@keyframes three-model-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

.geometry-selection-popup__hide:hover {
  border-color: rgba(255, 209, 102, 0.78);
  background: rgba(255, 209, 102, 0.22);
}
</style>
