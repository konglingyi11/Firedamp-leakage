<script setup>
import {
  ref,
  computed,
  watch,
  nextTick,
  provide,
  onMounted,
  onBeforeUnmount,
  defineAsyncComponent,
} from 'vue'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import {
  useVisualizationState,
  VIZ_STATE_KEY,
} from '@/composables/useVisualizationState'
import { buildRadarMockVolumeVariableId } from '@/utils/mockRadarVolume3d.js'
import {
  Check,
  Delete,
  Setting,
  View,
  Star,
  Monitor,
  Grid,
  Position,
  Picture,
  Clock,
  CircleCheck,
  Loading,
  Refresh,
  RefreshRight,
  RefreshLeft,
  Plus,
  ArrowLeft,
  ArrowRight,
  DArrowLeft,
  DArrowRight,
  QuestionFilled,
  Reading,
  CaretTop,
  CaretBottom,
  Aim,
} from '@element-plus/icons-vue'
const ThreeVisualizationCanvas = defineAsyncComponent(
  () => import('../components/ThreeVisualizationCanvas.vue'),
)
const ModelGrid = defineAsyncComponent(
  () => import('../components/ModelGrid.vue'),
)
const ParameterSettings = defineAsyncComponent(
  () => import('../components/ParameterSettings.vue'),
)
const TaskList = defineAsyncComponent(
  () => import('../components/TaskList.vue'),
)
const VisualizationSettings = defineAsyncComponent(
  () => import('../components/VisualizationSettings.vue'),
)
const DataStatistics = defineAsyncComponent(
  () => import('../components/DataStatistics.vue'),
)
const AnalysisResults = defineAsyncComponent(
  () => import('../components/AnalysisResults.vue'),
)
const MicroMotionResults = defineAsyncComponent(
  () => import('../components/MicroMotionResults.vue'),
)
const RadarMediumLeftPanel = defineAsyncComponent(
  () => import('../components/RadarMediumLeftPanel.vue'),
)
const RadarMediumRightPanel = defineAsyncComponent(
  () => import('../components/RadarMediumRightPanel.vue'),
)
const LeidaPanelsShell = defineAsyncComponent(
  () => import('../leida/LeidaPanelsShell.vue'),
)
const LeidaViewportChrome = defineAsyncComponent(
  () => import('../leida/components/LeidaViewportChrome.vue'),
)
const GoafGasConfigFloat = defineAsyncComponent(
  () => import('../components/GoafGasConfigFloat.vue'),
)
const TimelineControl = defineAsyncComponent(
  () => import('../components/TimelineControl.vue'),
)
const VisualizationOptions = defineAsyncComponent(
  () => import('../components/VisualizationOptions.vue'),
)
const GasVariableConfigDialog = defineAsyncComponent(
  () => import('../components/GasVariableConfigDialog.vue'),
)
const WorkerSelectDialog = defineAsyncComponent(
  () => import('../components/WorkerSelectDialog.vue'),
)

defineOptions({ name: 'HomeView' })
const StreamlineSettingsDialog = defineAsyncComponent(
  () => import('../components/StreamlineSettingsDialog.vue'),
)
import taskApi from '../api/task.js'
import modelApi from '../api/model.js'
import postProcessingApi from '../api/postProcessing.js'
import ribbonApi from '@/api/ribbon.js'
import { useTaskStore } from '../stores/task.js'
import { getVariableDisplayName } from '@/utils/gas'
import { getBaseUrl, setBaseUrl } from '@/utils/request'
import {
  parseColorToRgba,
  rgbByteToFloat01,
  alphaToFloat01,
} from '@/utils/color'
import {
  sanitizeVectorQualityPreset,
  sanitizeVectorTransparentBackground,
  sanitizeGlyphDensity,
  sanitizeVectorLineWidth,
  resolveAnimationSpeedMultiplier,
} from '@/utils/sanitize'
import { stripBase64ForUE } from '@/utils/ue'
import { useApplySettings } from '@/composables/useApplySettings'
import { useAutoTrigger } from '@/composables/useAutoTrigger'
import { useUeMessageBus } from '@/composables/useUeMessageBus'
import { useHomeGuides } from '@/composables/useHomeGuides'
import { useGeneratedLayers } from '@/composables/useGeneratedLayers'
import { useTimeline } from '@/composables/useTimeline'
import { use2DVisualization } from '@/composables/use2DVisualization'
import { use3DVisualization } from '@/composables/use3DVisualization'
import { useWorkerDialog } from '@/composables/useWorkerDialog'
import { useTaskSelection } from '@/composables/useTaskSelection'
import { useIsosurface } from '@/composables/useIsosurface'
import { useVolumeColorbar } from '@/composables/useVolumeColorbar'
import { useMicroMotionLoading } from '@/composables/useMicroMotionLoading'
import { useHomePanels } from '@/composables/useHomePanels'
import { useHomeNavigation, NAV_MODULES } from '@/composables/useHomeNavigation'
import { useHomeVisualizationState } from '@/composables/home/useHomeVisualizationState'
import { useHomeMonitoringPoints } from '@/composables/home/useHomeMonitoringPoints'
import { useImagePreloader } from '@/composables/useImagePreloader'
import { useHomeBatchLoader } from '@/composables/home/useHomeBatchLoader'
import { useHomeTaskManager } from '@/composables/home/useHomeTaskManager'
import { useModelOpacitySettings } from '@/composables/home/useModelOpacitySettings'
import { isGoafTask } from '@/utils/taskType'
import { useRadarResultPreview } from '@/composables/home/useRadarResultPreview'
import { useGeneratedLayerPaging } from '@/composables/home/useGeneratedLayerPaging'
import { useLayerPreloader } from '@/composables/home/useLayerPreloader'
import {
  cleanPreviewUrl,
  pickPreviewLayer,
  resolvePreviewFrameUrl,
} from '@/utils/previewFrame'
import {
  cleanupDeletedTaskLayers,
  shouldClearCurrentTask,
} from '@/utils/taskDeletionCleanup'
import { readSavedGasColormaps } from '@/utils/gasColormapStorage'
import { applyMonitoringLayerVisibility } from '@/utils/monitoringPointLayers'
import { normalizeMonitoringPointBounds } from '@/utils/monitoringPointDrag'

const SIM_RADAR_PLANE_FRAME_MODULES = import.meta.glob(
  '../../sim/*/frame_*.png',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
)

function parseSimRadarFramePath(path) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const match = normalized.match(/\/sim\/(xy|yz|xz)\/frame_(\d+)\.png$/i)
  if (!match) return null
  return {
    plane: match[1].toLowerCase(),
    frame: Number(match[2]),
  }
}

const SIM_RADAR_FRAME_URLS_BY_PLANE = (() => {
  const buckets = { xy: [], xz: [], yz: [] }
  for (const [path, url] of Object.entries(SIM_RADAR_PLANE_FRAME_MODULES)) {
    const parsed = parseSimRadarFramePath(path)
    if (!parsed) continue
    buckets[parsed.plane].push({
      frame: parsed.frame,
      url: String(url),
    })
  }
  return Object.fromEntries(
    Object.entries(buckets).map(([plane, frames]) => [
      plane,
      frames.sort((a, b) => a.frame - b.frame).map((item) => item.url),
    ]),
  )
})()

function normalizeSimRadarPlane(plane) {
  const key = String(plane || 'xy').toLowerCase()
  return ['xy', 'xz', 'yz'].includes(key) ? key : 'xy'
}

function buildSimRadarFrameImages(plane) {
  const normalizedPlane = normalizeSimRadarPlane(plane)
  const urls = SIM_RADAR_FRAME_URLS_BY_PLANE[normalizedPlane]?.length
    ? SIM_RADAR_FRAME_URLS_BY_PLANE[normalizedPlane]
    : SIM_RADAR_FRAME_URLS_BY_PLANE.xy || []
  return urls.map((url, index) => ({
    time_step: index + 1,
    png_url: url,
    url,
  }))
}

// 初始化 task store
const taskStore = useTaskStore()

// ── 集中可视化状态（33 个 ref + 1 个 composable）──
const vizState = useVisualizationState()
provide(VIZ_STATE_KEY, vizState)

const {
  visualizationDimension,
  visualization2DType,
  visualization3DType,
  selectedPlane,
  planeCoordinate,
  visualization,
  previewImageUrl,
  previewVMin,
  previewVMax,
  previewRows,
  previewCols,
  previewFrameCount,
  previewPhysicalWidth,
  previewPhysicalHeight,
  previewGeometricCenter,
  displayColorbarVMin,
  displayColorbarVMax,
  isBatchLoading,
  batchLoadingText,
  batchLoadProgress,
  batchLoadCurrent,
  batchLoadTotal,
  batchLoadedImages,
  isApplyingSettings,
  selectedLayerId,
  hasAppliedSettings,
  isTimelineCollapsed,
  timelineCurrentStep,
  timelineTotalSteps,
  timelinePhysicalTimes,
  timelineTimeSteps,
  postProcessingTimeStepsTaskId,
  isTimelinePlaying,
  findLoadedImageByTimeStep,
  findLoadedImageByLayerAndTimeStep,
  displayUrlForCachedFrame,
  listCloudContourVariableIds,
  timelineStepsFullyCached,
} = vizState

const {
  visualizationSettingsKey,
  visualizationOptionsDomain,
  generatedLayerPage,
  streamlineSettingsVisible,
  streamlineSettingsLayer,
  particleSettingsVisible,
  particleSettingsLayer,
  gasVariableConfigVisible,
  gasVariableConfigTargetId,
  savedGasColormaps,
  isGasDomain,
  isRadarDomain,
  refreshVisualizationSettings,
  setVisualizationDomain,
  openStreamlineSettings,
  closeStreamlineSettings,
  openParticleSettings,
  closeParticleSettings,
  initGasColormaps,
  syncLocalGasColormaps,
  resolveVolumeLayerVariableId,
  openGasVariableConfig,
  closeGasVariableConfig,
  handleGasChange,
  handleGasColorUpdate,
  handleGasCmapUpdate,
} = useHomeVisualizationState({
  getActiveModule: () => activeModule.value,
  getVisualization: () => visualization.value,
  getVisualizationDimension: () => visualizationDimension.value,
  getVisualization2DType: () => visualization2DType.value,
})

initGasColormaps()

const volumeCsvProgress = ref({
  visible: false,
  percentage: 0,
  text: '',
  detail: '',
})

let homeAutoLoadTimer = null
const homeViewReady = ref(false)
const isHomeViewMounted = ref(false)

const scheduleHomeAutoLoad = (delay = 0) => {
  if (homeAutoLoadTimer) {
    clearTimeout(homeAutoLoadTimer)
  }
  homeAutoLoadTimer = setTimeout(async () => {
    homeAutoLoadTimer = null
    if (isHomeViewMounted.value) {
      await ensureTaskMetadataCached(currentTask.value?.id, 'home-auto-load')
      tryAutoLoadOnHomeEnter()
    }
  }, delay)
}

watch(
  () => taskStore.currentTask?.id || taskStore.currentTaskId || null,
  (taskId, prevTaskId) => {
    if (!taskId || taskId === prevTaskId) return
    if (activeModule.value !== 'home') return
    scheduleHomeAutoLoad()
  },
)

/** 设为 true 时显示顶部「雷达数据」模块；临时下架时保持 false */
const SHOW_RADAR_DATA_MODULE = false

/** 介质衰减模块：云图=二维切面+模拟波纹平面(radar_wave)；体=三维体渲染。默认云图以保持「介质与调制」应用即见波纹切面 */
const radarMediumVizMode = ref('cloud')
/** 「雷达数据 → 介质与调制」云图应用：强制只加载模拟雷达切片，不因左侧已勾选变量而顺带请求气体云图 */
const applyFromRadarMediumCloud = ref(false)
/** 与 RadarMediumRightPanel 的 radar_emitter v-model 同步到 visualization */
const radarEmitterPanelModel = computed({
  get() {
    const r = visualization.value.radar_emitter
    if (r && typeof r === 'object') {
      return {
        x: Number(r.x) || 0,
        y: Number(r.y) || 0,
        z: Number(r.z) || 0,
      }
    }
    return { x: 0, y: 0, z: 0 }
  },
  set(v) {
    visualization.value.radar_emitter = {
      x: Number(v?.x) || 0,
      y: Number(v?.y) || 0,
      z: Number(v?.z) || 0,
    }
  },
})
const microMotionResultsRef = ref(null)

const {
  microMotionLoading,
  showMicroMotionPanel,
  microMotionLoadingStageIndex,
  microMotionLoadingStages,
  microMotionLoadingPercents,
  microMotionLoadingProgress,
  microMotionLoadingStageText,
  startMicroMotionLoading,
  stopMicroMotionLoading,
  finishMicroMotionLoading,
} = useMicroMotionLoading({
  getResultsRef: () => microMotionResultsRef.value,
})

const {
  activeModule,
  returningFromVisualization,
  isRadarEmModule,
  showPanels,
  showModelGrid,
  handleNavClick,
} = useHomeNavigation({
  showRadarDataModule: SHOW_RADAR_DATA_MODULE,
  getCurrentTask: () => currentTask.value,
  onTimelineStop: () => handleTimelineStop(),
  onEnterStatistics: () => {
    if (!microMotionLoading.value) {
      showMicroMotionPanel.value = false
    }
    rightPanelCollapsed.value = true
  },
  onEnterRadarMedium: () => {
    rightPanelCollapsed.value = false
  },
  onEnterVisualization: () => {
    selectCloudVisualizationMode()
    syncLocalGasColormaps()
    if (
      currentTask.value &&
      (timelineTimeSteps.value.length <= 0 || previewFrameCount.value <= 0)
    ) {
      fallbackToRuntimeConfig(currentTask.value)
    }
  },
})

const {
  currentTask,
  selectedModel,
  isMeetingRoomTask,
  isCompletedTask,
  getTaskModelId,
  getModelInfoGeometryUrl,
  getModelInfoRealUrl,
  resolveGeometryModelUrl,
  resolveRealModelUrl,
  taskHasGeometryGlbUrl,
  taskHasLocalRealModelUrl,
  mergeTaskModelInfo,
  loadTaskModelInfo,
  ensureTaskMetadataCached,
  getLatestTaskFromList,
  fetchTaskTimeSteps,
  filterValidTimeSteps,
  setCurrentTask,
  activateSavedTask,
  getTaskStatusType,
  getTaskStatusText,
  extractTaskListItems,
  getTaskLatestTime,
} = useHomeTaskManager({
  onTaskChange: null,
  onTaskLoaded: (task, { completed }) => {
    // 时间步加载逻辑（从内联 activateSavedTask 提取）
    let timeStepsLoaded = false
    if (completed) {
      fetchTaskTimeSteps(task.id).then(({ timeSteps, physicalTimes }) => {
        if (timeSteps.length > 0) {
          const { validTimeSteps, validPhysicalTimes } = filterValidTimeSteps(
            timeSteps,
            physicalTimes,
          )
          if (validTimeSteps.length > 0) {
            timelineTotalSteps.value = validTimeSteps.length - 1
            previewFrameCount.value = validTimeSteps.length
            timelinePhysicalTimes.value =
              validPhysicalTimes.length > 0
                ? validPhysicalTimes
                : validTimeSteps
            timelineTimeSteps.value = validTimeSteps
            postProcessingTimeStepsTaskId.value = task.id
            timeStepsLoaded = true
          }
        }
        if (!timeStepsLoaded) {
          if (completed) {
            fallbackToRuntimeConfig(task)
          } else {
            timelineTotalSteps.value = 0
            previewFrameCount.value = 0
            timelinePhysicalTimes.value = []
            timelineTimeSteps.value = []
            postProcessingTimeStepsTaskId.value = null
          }
        }
        scheduleHomeAutoLoad(500)
      })
    } else {
      timelineTotalSteps.value = 0
      previewFrameCount.value = 0
      timelinePhysicalTimes.value = []
      timelineTimeSteps.value = []
      postProcessingTimeStepsTaskId.value = null
      scheduleHomeAutoLoad(500)
    }
  },
  registerBaseLayers: (task) => ensureCompletedTaskBaseLayers(task),
})

// 调用激活保存的任务
activateSavedTask()

/** 体渲染色带列表：GET /api/v1/color-maps/ -> data.items */
const colorMapCatalogItems = ref([])

async function refreshColorMapCatalog() {
  try {
    const data = await ribbonApi.getRibbons({ page: 1, page_size: 200 })
    colorMapCatalogItems.value = Array.isArray(data?.items) ? data.items : []
    console.log(
      '[color-maps] catalog loaded:',
      colorMapCatalogItems.value.length,
      'items, ids:',
      colorMapCatalogItems.value.map((x) => x?.id).join(','),
    )
  } catch (e) {
    console.warn('[color-maps] list failed:', e)
    colorMapCatalogItems.value = []
  }
}

watch(activeModule, (m) => {
  if (m === 'radarEm') {
    isTimelineCollapsed.value = false
  }
})

const {
  leftPanelCollapsed,
  rightPanelCollapsed,
  leftComponent,
  rightComponent,
  leftTitle,
  rightTitle,
  hasLeftPanel,
  hasRightPanel,
  isVisualizationOptionsOpen,
  toggleLeftPanel,
  toggleRightPanel,
  collapseLeftPanel,
  expandLeftPanel,
  collapseRightPanel,
  expandRightPanel,
} = useHomePanels({
  getActiveModule: () => activeModule.value,
  getVisualizationDimension: () => visualizationDimension.value,
  getVisualization2DType: () => visualization2DType.value,
  getVisualization3DType: () => visualization3DType.value,
  getVisualizationOptionsDomain: () => visualizationOptionsDomain.value,
  getShowMicroMotionPanel: () => showMicroMotionPanel.value,
  getMicroMotionLoading: () => microMotionLoading.value,
  getShowPanels: () => showPanels.value,
})

const {
  TASK_GUIDE_Z_INDEX,
  VIZ_GUIDE_Z_INDEX,
  STATS_GUIDE_Z_INDEX,
  taskGuideVisible,
  taskGuideCurrent,
  taskGuideAutoSwitching,
  vizGuideVisible,
  vizGuideCurrent,
  statsGuideVisible,
  statsGuideCurrent,
  isTaskGuideDone,
  isVizGuideDone,
  isStatsGuideDone,
  taskGuideContentStyle,
  taskGuideDialogContentStyle,
  taskGuideSteps,
  vizGuideSteps,
  statsGuideSteps,
  startTaskManageGuide,
  startVizGuide,
  startStatsGuide,
  handleTaskGuideClose,
  handleTaskGuideSkip,
  handleTaskGuideFinish,
  handleVizGuideClose,
  handleVizGuideSkip,
  handleVizGuideFinish,
  handleVizGuideChange,
  handleStatsGuideClose,
  handleStatsGuideSkip,
  handleStatsGuideFinish,
  handleStatsGuideChange,
  handleTaskGuideChange,
} = useHomeGuides({
  activeModule,
  selectedModel,
  handleNavClick,
  rightPanelCollapsed,
  showMicroMotionPanel,
})

const leidaHasDataPanel = ref(false)

const radarEmModelName = computed(() => {
  const task = currentTask.value
  if (!task) return '掩埋空间_01'
  return task.name || String(task.id) || '掩埋空间_01'
})

const radarEmTaskId = computed(() => {
  const task = currentTask.value
  if (!task) return 'EM2025072101'
  return String(task.id || task.name || 'EM2025072101')
})

const radarEmGeometryBounds = ref(null)
const radarEmGeometrySelections = ref([])
const radarEmMediumBindings = ref([])
let radarEmBoundsRequestId = 0

async function refreshRadarEmGeometryBounds() {
  const requestId = ++radarEmBoundsRequestId
  if (!isRadarEmModule.value) {
    radarEmGeometryBounds.value = null
    return
  }

  const cached = playerRef.value?.getCachedGeometryBounds?.()
  if (normalizeMonitoringPointBounds(cached)) {
    radarEmGeometryBounds.value = cached
    syncRadarEmGeometrySelections()
    return
  }

  const taskId = currentTask.value?.id
  if (taskId == null || String(taskId).trim() === '') {
    radarEmGeometryBounds.value = null
    return
  }

  try {
    const res = await postProcessingApi.getGeometryBounds(taskId)
    const bounds = res?.data ?? res
    if (requestId !== radarEmBoundsRequestId) return
    radarEmGeometryBounds.value = normalizeMonitoringPointBounds(bounds)
      ? bounds
      : null
  } catch (error) {
    if (requestId !== radarEmBoundsRequestId) return
    console.warn('[radar-em] geometry bounds load failed:', error)
    radarEmGeometryBounds.value = null
  }
}

watch(
  [isRadarEmModule, radarEmTaskId],
  () => {
    void nextTick(refreshRadarEmGeometryBounds)
  },
  { immediate: true },
)

// 后端地址配置弹窗（F2）
const baseUrlDialogVisible = ref(false)
const baseUrlInput = ref(getBaseUrl())
const openBaseUrlDialog = () => {
  baseUrlInput.value = getBaseUrl()
  baseUrlDialogVisible.value = true
}
const applyBaseUrl = () => {
  setBaseUrl(baseUrlInput.value)
  baseUrlDialogVisible.value = false
  ElMessage.success('后端地址已更新，刷新页面后生效')
}
const tutorialItems = [
  // {
  //   command: 'task-list',
  //   title: '任务管理',
  //   description: '查看任务状态并切换当前任务。',
  // },
  // {
  //   command: 'visualization',
  //   title: '可视化操作',
  //   description: '进入可视化页面并调整显示参数。',
  // },
  {
    command: 'statistics',
    title: '数据统计',
    description: '进入数据统计面板查看监测点数据和图表。',
  },
]

const handleTutorialCommand = (command) => {
  switch (command) {
    case 'quick-start':
      handleNavClick('model')
      ElMessage.info('已切到模型选择。请选择模型后继续。')
      break
    case 'task-list':
      startTaskManageGuide()
      break
    case 'visualization':
      if (!currentTask.value) {
        handleNavClick('tasks')
        ElMessage.warning('请先在任务列表选择任务，再进入可视化。')
        return
      }
      startVizGuide()
      break
    case 'statistics':
      if (!currentTask.value) {
        handleNavClick('tasks')
        ElMessage.warning('请先在任务列表选择任务，再进入数据统计。')
        return
      }
      startStatsGuide()
      break
    default:
      break
  }
}

const selectCloudVisualizationMode = () => {
  visualizationDimension.value = '2d'
  visualization2DType.value = 'cloud'
}

const openVisualizationOptionsPanel = () => {
  selectCloudVisualizationMode()
  rightPanelCollapsed.value = false
}

// 应用可视化设置
// applyVisualizationSettings body extracted to composables/useApplySettings.js

// batchLoadTimeSteps 已提取至 useHomeBatchLoader composable

// 重置可视化设置
// resetVisualizationSettings 已抽取至 useTaskSelection composable

function ensureCompletedTaskBaseLayers(task) {
  const completed = isCompletedTask(task)
  const hasGeometryGlb = taskHasGeometryGlbUrl(task)
  const hasLocalRealModel = taskHasLocalRealModelUrl(task)
  if (!completed && !hasGeometryGlb && !hasLocalRealModel) return
  if (completed || hasGeometryGlb) {
    registerGeneratedLayer('model', {
      label: '几何模型',
      visible: completed ? false : hasGeometryGlb && !completed,
      ready: true,
      loaded: true,
    })
  }
  if (completed || hasLocalRealModel) {
    registerGeneratedLayer('realModel', {
      label: '真实模型',
      visible: true,
      ready: true,
      loaded: true,
    })
  }
  if (completed) {
    registerGeneratedLayer('bounds', {
      label: '计算包围盒',
      visible: false,
      ready: true,
      loaded: true,
    })
  }
  if (!completed) return
  ensureParticleSettings()
  registerGeneratedLayer('particle', {
    label: '粒子图层',
    visible: false,
    ready: true,
    loaded: true,
    isMock: true,
  })
  // 采空区任务不需要通用的烟雾层/人体烟雾层/视频骨骼识别层
  if (!isGoafTask(task)) {
    registerGeneratedLayer('smoke', {
      smokeTotal: true,
      visible: false,
      ready: true,
      loaded: true,
      loadSource: 'base',
    })
    registerGeneratedLayer('smoke', {
      label: '烟雾层-人体层',
      smokePersonLayer: true,
      smokeReleaseZoneName: 'head-release-zone',
      visible: false,
      ready: true,
      loaded: true,
      loadSource: 'base',
    })
    registerGeneratedLayer('video', {
      label: '视频.mp4',
      visible: false,
      ready: true,
      loaded: true,
    })
  }
}

const taskListRef = ref(null)
const parameterSettingsRef = ref(null)
const playerRef = ref(null)
const goafGasConfigFloatRef = ref(null)

function readGeometryModelSelections() {
  const exposed = playerRef.value?.geometryModelSelections
  if (Array.isArray(exposed)) return exposed
  if (exposed && typeof exposed === 'object' && 'value' in exposed) {
    return Array.isArray(exposed.value) ? exposed.value : []
  }
  return []
}

function syncRadarEmGeometrySelections() {
  radarEmGeometrySelections.value = readGeometryModelSelections()
}

function handleLeidaSelectGeometryPart(partName) {
  if (!partName) return
  playerRef.value?.selectGeometryMeshByName?.(partName)
}

function handleGeometrySelectionsUpdate(list) {
  if (!isRadarEmModule.value) return
  radarEmGeometrySelections.value = Array.isArray(list) ? list : []
}

// === 图层右键菜单：per-mesh 透明度调节 ===
const layerContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  layer: null,
})

// 当前图层的 mesh 列表（含 per-mesh 透明度）
const contextMenuMeshList = ref([])

function onLayerContextMenu(event, layer) {
  // 仅几何模型/真实模型支持 per-mesh 透明度
  if (!layer || (layer.kind !== 'model' && layer.kind !== 'realModel')) return
  const selections = readGeometryModelSelections()
  if (!selections.length) return
  // 读取当前覆盖
  const overrides = playerRef.value?.getGeometryMeshOpacityOverrides?.() || {}
  contextMenuMeshList.value = selections.map((s) => ({
    name: s.name,
    material: s.material,
    opacity: overrides[s.name] !== undefined ? overrides[s.name] : null,
  }))
  // 防止菜单超出屏幕右下边缘
  const menuW = 360
  const menuH = Math.min(selections.length * 50 + 40, window.innerHeight * 0.6)
  const x = Math.min(event.clientX, window.innerWidth - menuW - 8)
  const y = Math.min(event.clientY, window.innerHeight - menuH - 8)
  layerContextMenu.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    layer,
  }
}

function closeLayerContextMenu() {
  layerContextMenu.value.visible = false
}

function onContextMenuMeshOpacityChange(mesh) {
  if (mesh.opacity === null || mesh.opacity === undefined) return
  playerRef.value?.setGeometryMeshOpacity?.(mesh.name, mesh.opacity)
}

function onContextMenuMeshReset(mesh) {
  mesh.opacity = null
  playerRef.value?.resetGeometryMeshOpacity?.(mesh.name)
}

function onContextMenuResetAll() {
  contextMenuMeshList.value.forEach((m) => (m.opacity = null))
  playerRef.value?.resetAllGeometryMeshOpacity?.()
}

// 全局点击关闭右键菜单
watch(
  () => layerContextMenu.value.visible,
  (v) => {
    if (v) {
      nextTick(() => {
        document.addEventListener('pointerdown', closeLayerContextMenu, {
          once: true,
        })
      })
    }
  },
)

watch(
  isRadarEmModule,
  (active) => {
    if (!active) radarEmGeometrySelections.value = []
    else syncRadarEmGeometrySelections()
  },
  { immediate: true },
)

const ueMsg = useUeMessageBus(playerRef)
const emitResetLevelToUE = ueMsg.resetLevel
const {
  KIND_LABELS,
  generatedVizLayers,
  vizLayersListCollapsed,
  buildGeneratedLayerId,
  buildGeneratedLayerLabel,
  registerGeneratedLayer,
  upsertGeneratedVizLayer,
  vizLayerTypeName,
  vizLayerKindForUE,
  vizLayerIdForUE,
  buildVizLayerPayloadEntry,
  sendVizLayerVisibilityToUE,
  onGeneratedLayerCheckboxChange: syncGeneratedLayerCheckboxChange,
  removeGeneratedLayer,
  purgeExcludedGeneratedLayers: purgeExcludedGeneratedLayersFromStore,
} = useGeneratedLayers({
  playerRef,
  currentTask,
  visualization,
  selectedPlane,
  planeCoordinate,
})

const purgeExcludedGeneratedLayers =
  typeof purgeExcludedGeneratedLayersFromStore === 'function'
    ? purgeExcludedGeneratedLayersFromStore
    : () => {}

async function onGeneratedLayerCheckboxChange(layer, visible) {
  if (!layer) return
  const nextVisible =
    typeof visible === 'boolean' ? visible : layer?.visible !== false
  layer.visible = nextVisible
  syncExclusiveModelLayerVisibility(layer, nextVisible)
  syncGeneratedLayerCheckboxChange(layer)

  if (nextVisible) {
    if (isGeneratedLayerSelectable(layer)) {
      selectedLayerId.value = layer.id
    }
    if (isGeneratedLayerPlaneFocusable(layer)) {
      handleGeneratedLayerPlaneFocus(layer)
    }
    await preloadVisibleVolumeLayer(layer)
    await preloadVisible2DLayer(layer)
    return
  }

  if (
    selectedLayerId.value != null &&
    String(selectedLayerId.value) === String(layer.id)
  ) {
    selectedLayerId.value = null
  }
}

function isExclusiveModelGeneratedLayer(layer) {
  return layer?.kind === 'model' || layer?.kind === 'realModel'
}

function resolveLayerTaskKey(layer) {
  return String(layer?.id ?? '').split(':')[1] || ''
}

function syncExclusiveModelLayerVisibility(layer, visible) {
  if (!visible || !isExclusiveModelGeneratedLayer(layer)) return

  const peerKind = layer.kind === 'model' ? 'realModel' : 'model'
  const taskKey = resolveLayerTaskKey(layer)
  const peer = generatedVizLayers.value.find(
    (candidate) =>
      candidate?.kind === peerKind &&
      (!taskKey || resolveLayerTaskKey(candidate) === taskKey),
  )

  if (!peer || peer.visible === false) return
  peer.visible = false
  syncGeneratedLayerCheckboxChange(peer)
}

async function focusGeometryModelForMediumParams() {
  if (!isRadarEmModule.value) return

  if (currentTask.value) {
    ensureCompletedTaskBaseLayers(currentTask.value)
  }

  const geometryLayer = generatedVizLayers.value.find(
    (layer) => layer.kind === 'model',
  )
  if (!geometryLayer) return

  const realModelLayer = generatedVizLayers.value.find(
    (layer) => layer.kind === 'realModel',
  )

  if (realModelLayer?.visible !== false) {
    await onGeneratedLayerCheckboxChange(realModelLayer, false)
  }
  if (geometryLayer.visible === false) {
    await onGeneratedLayerCheckboxChange(geometryLayer, true)
  } else {
    syncGeneratedLayerCheckboxChange(geometryLayer)
  }

  await nextTick()
  syncRadarEmGeometrySelections()
}

function handleLeidaMediumNavActive() {
  void focusGeometryModelForMediumParams()
}

function isGeneratedLayerSelectable(layer) {
  return (
    layer?.kind === 'vector' ||
    layer?.kind === 'contour' ||
    layer?.kind === 'cloud' ||
    layer?.kind === 'radar_cloud' ||
    layer?.kind === 'radar_wave' ||
    layer?.kind === 'radar_wavefront_cloud' ||
    layer?.kind === 'radar_wavefront' ||
    layer?.kind === 'radar_heatmap' ||
    layer?.kind === 'radar_trails' ||
    layer?.kind === 'radar_structure' ||
    layer?.kind === 'volume' ||
    layer?.kind === 'streamline'
  )
}

function syncSelectedGeneratedLayerAfterBatch(preferredLayer = null) {
  if (
    preferredLayer?.visible !== false &&
    isGeneratedLayerSelectable(preferredLayer)
  ) {
    selectedLayerId.value = preferredLayer.id
    return
  }

  const currentSelected = generatedVizLayers.value.find(
    (layer) => String(layer?.id) === String(selectedLayerId.value),
  )
  if (
    currentSelected?.visible !== false &&
    isGeneratedLayerSelectable(currentSelected)
  ) {
    return
  }

  const fallbackLayer = generatedVizLayers.value.find(
    (layer) => layer.visible !== false && isGeneratedLayerSelectable(layer),
  )
  selectedLayerId.value = fallbackLayer?.id ?? null
}

const resolvedPreviewImageFor2D = computed(() => {
  const is2DPreview =
    visualizationDimension.value === '2d' &&
    (visualization2DType.value === 'cloud' ||
      visualization2DType.value === 'vector')
  if (!is2DPreview) return cleanPreviewUrl(previewImageUrl.value)

  const allowedKinds =
    visualization2DType.value === 'cloud'
      ? ['cloud', 'contour', 'radar_cloud']
      : ['vector']
  const rawPhysicalTime =
    timelinePhysicalTimes.value?.[timelineCurrentStep.value]
  const physicalTime = Number(rawPhysicalTime)
  const layer = pickPreviewLayer(
    generatedVizLayers.value,
    selectedLayerId.value,
    allowedKinds,
  )

  const simStep =
    timelineTimeSteps.value.length > timelineCurrentStep.value
      ? timelineTimeSteps.value[timelineCurrentStep.value]
      : null
  return (
    resolvePreviewFrameUrl({
      layer,
      currentStep: timelineCurrentStep.value,
      currentPhysicalTime: Number.isFinite(physicalTime) ? physicalTime : null,
      simulationTimeStep:
        simStep != null && Number.isFinite(Number(simStep))
          ? Number(simStep)
          : simStep,
    }) || cleanPreviewUrl(previewImageUrl.value)
  )
})
const {
  QUALITY_2D_FIXED,
  MAX_2D_TIME_STEPS_FOR_UE,
  latest2DVMin,
  latest2DVMax,
  resolveSelectedCmap,
  resolveContourColormapParams,
  applyContourColormapToPayload,
  build2DParamsForUE,
  send2DParamsToUE,
} = use2DVisualization({
  playerRef,
  currentTask,
  visualization,
  visualization2DType,
  selectedPlane,
  planeCoordinate,
  layers: { buildGeneratedLayerId, buildGeneratedLayerLabel },
  colorMapCatalog: colorMapCatalogItems,
})
const dataStatisticsRef = ref(null)

// 监测点管理（CRUD、bounds 解析、图层同步、UE 通信等）
const {
  monitoringPointStore,
  monitoringPoints,
  radarMediumProbeFallback,
  getCachedMonitoringPointBounds,
  resolveMonitoringPointBounds,
  normalizeMonitoringPointsForCurrentBounds,
  normalizeMonitoringPointForCommit,
  syncMonitoringPointsToStore,
  syncMonitoringPointLayers,
  syncMonitoringPointsToPanel,
  syncPointsToThree,
  setMonitoringPoints,
  clearMonitoringPointsState,
  handleAddPoint,
  handleUpdatePoint,
  handlePreviewPoint,
  handleDeletePoint,
  isMonitoringGeneratedLayer,
  handleMonitoringLayerVisibilityChange,
  handleMonitoringLayerFocus,
  handleUeFocusPoint,
  handleFocusPoint,
  handleMicroMotionTargetFocus,
  isGeneratedLayerPlaneFocusable,
  handleGeneratedLayerPlaneFocus,
} = useHomeMonitoringPoints({
  getCurrentTask: () => currentTask.value,
  getPlayerRef: () => playerRef,
  getDataStatisticsRef: () => dataStatisticsRef,
  getGeneratedVizLayers: () => generatedVizLayers.value,
  setGeneratedVizLayers: (layers) => {
    generatedVizLayers.value = layers
  },
  getUeMsg: () => ueMsg,
  getActiveModule: () => activeModule.value,
  setActiveModule: (module) => {
    activeModule.value = module
  },
  buildGeneratedLayerLabel,
  vizLayerIdForUE,
})

// 图片预加载（2D 帧图片缓存）
const {
  preloadingCount: imagePreloadingCount,
  preloadedCount: imagePreloadedCount,
  resolve2DFrameImageUrl,
  preloadBrowserImage,
  preload2DFrameImageUrls,
  isUrlPreloaded,
  clearPreloadCache: clearImagePreloadCache,
} = useImagePreloader()

const {
  batchLoadTimeSteps,
  ensureTaskMetadataCached: batchLoaderEnsureTaskMetadataCached,
  getLatestTaskFromList: batchLoaderGetLatestTaskFromList,
} = useHomeBatchLoader({
  getCurrentTask: () => currentTask.value,
  getVisualization: () => visualization.value,
  getSelectedPlane: () => selectedPlane.value,
  getPlaneCoordinate: () => planeCoordinate.value,
  getVisualization2DType: () => visualization2DType.value,
  setTimelineTimeSteps: (v) => {
    timelineTimeSteps.value = v
  },
  setTimelinePhysicalTimes: (v) => {
    timelinePhysicalTimes.value = v
  },
  setTimelineTotalSteps: (v) => {
    timelineTotalSteps.value = v
  },
  setPreviewFrameCount: (v) => {
    previewFrameCount.value = v
  },
  setPreviewImageUrl: (v) => {
    previewImageUrl.value = v
  },
  setPreviewPhysicalWidth: (v) => {
    previewPhysicalWidth.value = v
  },
  setPreviewPhysicalHeight: (v) => {
    previewPhysicalHeight.value = v
  },
  setPreviewGeometricCenter: (v) => {
    previewGeometricCenter.value = v
  },
  setBatchLoading: (v) => {
    isBatchLoading.value = v
  },
  setBatchLoadProgress: (v) => {
    batchLoadProgress.value = v
  },
  setBatchLoadCurrent: (v) => {
    batchLoadCurrent.value = v
  },
  setBatchLoadTotal: (v) => {
    batchLoadTotal.value = v
  },
  setBatchLoadedImages: (images) => {
    batchLoadedImages.value = images
  },
  setPreviewLayout: (rows, cols) => {
    previewRows.value = rows
    previewCols.value = cols
  },
  listCloudContourVariableIds,
  buildGeneratedLayerId,
  registerGeneratedLayer,
  applyContourColormapToPayload,
  resolveContourColormapParams,
  displayUrlForCachedFrame,
  onLayerRegistered: (layerId, kind, opts) => {
    const existingLayer = generatedVizLayers.value.find(
      (l) => String(l.id) === String(layerId),
    )
    if (existingLayer) {
      existingLayer.images = []
      existingLayer.physicalTimes = []
      existingLayer.physicalWidth = null
      existingLayer.physicalHeight = null
      existingLayer.vmin = null
      existingLayer.vmax = null
    }
  },
  onFrameLoaded: (frameEntry, layerId, isPrimary) => {
    const layer = generatedVizLayers.value.find(
      (l) => String(l.id) === String(layerId),
    )
    if (layer) {
      if (
        !layer.images.find(
          (img) => Number(img.time_step) === Number(frameEntry.time_step),
        )
      ) {
        layer.images.push(frameEntry)
        layer.ready = true
      }
    }
  },
  onBatchComplete: ({
    effectivePhysicalTimes,
    layerIds,
    visualization2DType,
  }) => {
    const syncContourLayerMeta = (lid) => {
      const layer = generatedVizLayers.value.find(
        (l) => String(l.id) === String(lid),
      )
      if (!layer) return
      layer.images.sort((a, b) => Number(a.time_step) - Number(b.time_step))
      layer.physicalTimes = [...effectivePhysicalTimes]
      const first = layer.images[0]
      if (first?.data) {
        const physicalWidthNum = Number(
          first.data.physical_width ?? first.data.physicalWidth,
        )
        const physicalHeightNum = Number(
          first.data.physical_height ?? first.data.physicalHeight,
        )
        const vminNum = Number(first.data.vmin ?? first.data.v_min)
        const vmaxNum = Number(first.data.vmax ?? first.data.v_max)
        if (Number.isFinite(physicalWidthNum) && physicalWidthNum > 0) {
          layer.physicalWidth = physicalWidthNum
        }
        if (Number.isFinite(physicalHeightNum) && physicalHeightNum > 0) {
          layer.physicalHeight = physicalHeightNum
        }
        if (Number.isFinite(vminNum)) layer.vmin = vminNum
        if (Number.isFinite(vmaxNum)) layer.vmax = vmaxNum
        if (first.data.cmap) layer.cmap = first.data.cmap
      }
    }
    layerIds.forEach((lid) => syncContourLayerMeta(lid))
  },
})

watch(
  () => currentTask.value?.id,
  (id, prevId) => {
    if (id !== prevId) {
      postProcessingTimeStepsTaskId.value = null
    }
    if (prevId != null && id != null && id !== prevId) {
      generatedVizLayers.value = []
      ensureCompletedTaskBaseLayers(currentTask.value)
    }
  },
)

// 时间轴播放控制（状态 + play/pause/stop/seek）由 useTimeline composable 提供
const {
  timelineCurrentStep: timelineCurrentStepRef,
  timelineTotalSteps: timelineTotalStepsRef,
  timelinePhysicalTimes: timelinePhysicalTimesRef,
  timelineTimeSteps: timelineTimeStepsRef,
  isTimelinePlaying: isTimelinePlayingRef,
  isTimelineCollapsed: isTimelineCollapsedRef,
  hasAppliedSettings: hasAppliedSettingsRef,
  handleTimelinePlay,
  handleTimelinePause,
  handleTimelineStop,
  handleTimelineSeek,
  handleTimelineToggle,
} = useTimeline(vizState)

const { preloadVisibleVolumeLayer, preloadVisible2DLayer } = useLayerPreloader({
  currentTask,
  playerRef,
  selectedPlane,
  planeCoordinate,
  visualization,
  timelineCurrentStep,
  timelineTimeSteps,
  timelinePhysicalTimes,
  isBatchLoading,
  batchLoadingText,
  batchLoadCurrent,
  batchLoadTotal,
  batchLoadProgress,
  batchLoadedImages,
  handleTimelinePause,
  sanitizeVectorQualityPreset,
  sanitizeVectorTransparentBackground,
  sanitizeGlyphDensity,
  sanitizeVectorLineWidth,
  applyContourColormapToPayload,
  resolveContourColormapParams,
  resolve2DFrameImageUrl,
  isUrlPreloaded,
  preload2DFrameImageUrls,
})

const shouldShowSharedTimeline = computed(
  () =>
    (activeModule.value === 'visualization' ||
      activeModule.value === 'home' ||
      activeModule.value === 'radarEm') &&
    (timelineTotalSteps.value > 0 || timelineTimeSteps.value.length > 0) &&
    (activeModule.value !== 'home' || hasAppliedSettings.value),
)
const {
  listVolumeVariableIdsForUE,
  volumeColorEntryForUE,
  getVolumeTextureCommonFieldsForUE,
  cleanUrlList,
  extractVolumeUrlsFromChunk,
  buildVolumeTextureChunkUePayload,
  buildVolumeTextureParamsForUE,
  resolveSimulationTimeStepAtSlideIndex,
  buildStreamlineUeParams,
  buildStreamlineApiParams,
} = use3DVisualization({
  currentTask,
  visualization,
  timelineTimeSteps,
  layers: { buildGeneratedLayerId, buildGeneratedLayerLabel },
  resolveSelectedCmap,
  colorMapCatalog: colorMapCatalogItems,
})

const handleRemoveGeneratedLayer = (layer) => {
  const name = layer?.label ?? layer?.id ?? '未命名图层'
  ElMessageBox.confirm(`确认移除图层「${name}」吗？`, '确认移除', {
    type: 'warning',
    confirmButtonText: '移除',
    cancelButtonText: '取消',
  })
    .then(() => {
      if (
        selectedLayerId.value != null &&
        String(selectedLayerId.value) === String(layer.id)
      ) {
        selectedLayerId.value = null
      }
      removeGeneratedLayer(layer)
      ElMessage.success('已移除该图层')
    })
    .catch(() => {})
}

const isModelGeneratedLayer = (layer) =>
  layer?.kind === 'model' || layer?.kind === 'realModel'

const isStreamlineGeneratedLayer = (layer) => layer?.kind === 'streamline'
const isParticleGeneratedLayer = (layer) => layer?.kind === 'particle'
const isVolumeGeneratedLayer = (layer) => layer?.kind === 'volume'
const isVideoGeneratedLayer = (layer) => layer?.kind === 'video'
const toggleVideoSkeletonVisible = (layer) => {
  if (!layer || layer.kind !== 'video') return
  layer.skeletonVisible = layer.skeletonVisible !== true
  generatedVizLayers.value = generatedVizLayers.value.map((item) =>
    item?.id === layer.id
      ? { ...item, skeletonVisible: layer.skeletonVisible }
      : item,
  )
  // 直接调用 ThreeVisualizationCanvas 的骨骼方法
  playerRef.value?.setPersonSkeletonVisible?.(layer.skeletonVisible)
  ElMessage.success(layer.skeletonVisible ? '已显示视频骨骼' : '已隐藏视频骨骼')
}

const personModelVisible = ref(false)
const togglePersonModelVisible = () => {
  if (isGoafTask(currentTask.value)) {
    ElMessage.info('采空区任务暂不支持人物模型')
    return
  }
  personModelVisible.value = !personModelVisible.value
  playerRef.value?.setPersonModelVisible?.(personModelVisible.value)
  ElMessage.success(
    personModelVisible.value ? '已显示人物模型' : '已隐藏人物模型',
  )
}


const toggleStreamlineSmoke = (layer) => {
  if (!layer || layer.kind !== 'streamline') return
  layer.streamlineSmokeEnabled = layer.streamlineSmokeEnabled !== true
  if (!visualization.value.streamline) visualization.value.streamline = {}
  visualization.value.streamline.smoke_enabled = layer.streamlineSmokeEnabled
  generatedVizLayers.value = generatedVizLayers.value.map((item) =>
    item?.id === layer.id
      ? { ...item, streamlineSmokeEnabled: layer.streamlineSmokeEnabled }
      : item,
  )
  ElMessage.success(
    layer.streamlineSmokeEnabled ? '已打开流线烟雾效果' : '已关闭流线烟雾效果',
  )
}
const toggleStreamlineLineVisibility = (layer) => {
  if (!layer || layer.kind !== 'streamline') return
  layer.streamlineLineVisible = layer.streamlineLineVisible === false
  generatedVizLayers.value = generatedVizLayers.value.map((item) =>
    item?.id === layer.id
      ? { ...item, streamlineLineVisible: layer.streamlineLineVisible }
      : item,
  )
  ElMessage.success(
    layer.streamlineLineVisible === false ? '已隐藏流线' : '已显示流线',
  )
}
const isColorbarGeneratedLayer = (layer) =>
  layer?.kind === 'volume' ||
  layer?.kind === 'cloud' ||
  layer?.kind === 'contour'
const {
  colorbarOverlayVisible,
  selectedColorbarOverlayLayerId,
  toggleColorbarOverlay,
  closeColorbarOverlay,
  handleColorbarLayerSelectChange,
  colorbarOverlayLayers,
  selectedColorbarOverlayLayer,
  resolveVolumeLayerDisplayName,
  volumeLayerCmapStyle,
  getVolumeColorbarStops,
  getVolumeColorStopInputValue,
  updateVolumeColorStopValue,
  commitVolumeColorStopValue,
  updateVolumeColorStopPosition,
  addVolumeColorStop,
  removeVolumeColorStop,
  resetVolumeColorStops,
  volumeColorbarTicks,
  getVolumeColorbarBaseRange,
  resetVolumeColorbarRange,
} = useVolumeColorbar({
  colorMapCatalogItems,
  currentTask,
  ensureTaskMetadataCached,
  generatedVizLayers,
  onRangeUpdated: () => {
    nextTick(() => {
      playerRef.value?.setVolumeDisplayRanges?.()
    })
  },
  resolveVolumeLayerVariableId,
  selectedLayerId,
  taskStore,
  visualization,
})

const canEditVolumeColorbarRange = computed(() => {
  const layer = selectedColorbarOverlayLayer.value
  if (!layer) return false
  const base = getVolumeColorbarBaseRange(layer)
  return Boolean(
    base &&
    Number.isFinite(Number(base.vmin)) &&
    Number.isFinite(Number(base.vmax)) &&
    Number(base.vmax) > Number(base.vmin),
  )
})

const resolveVolumeColorbarPointerPosition = (event) => {
  const track = event.currentTarget?.closest?.('.vcbar-scale')
  const gradient = track?.querySelector?.('.vcbar-gradient')
  const rect = gradient?.getBoundingClientRect?.()
  if (!rect || rect.height <= 0) return 0.5
  return Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height))
}

const handleVolumeColorbarAddStop = (layer, event) => {
  addVolumeColorStop(layer, resolveVolumeColorbarPointerPosition(event))
}

const beginVolumeColorStopDrag = (layer, index, event) => {
  event.preventDefault()
  event.stopPropagation()
  const gradient = event.currentTarget
    ?.closest?.('.vcbar-scale')
    ?.querySelector?.('.vcbar-gradient')
  const rect = gradient?.getBoundingClientRect?.()
  if (!rect || rect.height <= 0) return

  const updateFromPointer = (pointerEvent) => {
    const bandPosition = Math.max(
      0,
      Math.min(1, 1 - (pointerEvent.clientY - rect.top) / rect.height),
    )
    updateVolumeColorStopPosition(layer, index, bandPosition)
  }
  const stopDrag = () => {
    window.removeEventListener('pointermove', updateFromPointer)
    window.removeEventListener('pointerup', stopDrag)
    window.removeEventListener('pointercancel', stopDrag)
  }

  updateFromPointer(event)
  window.addEventListener('pointermove', updateFromPointer)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}
const handleOpenStreamlineSettings = (layer) => {
  streamlineSettingsLayer.value = layer
  streamlineSettingsVisible.value = true
}

const ensureParticleSettings = () => {
  if (!visualization.value.particle) {
    visualization.value.particle = {
      emitRate: 5,
      maxParticles: 2000,
      minLife: 100,
      maxLife: 200,
      velocityScale: 300,
      turbulenceStrength: 0.0002,
      turbulenceSmoothing: 0.18,
      initialVx: 0,
      initialVy: 0,
      initialVz: 0,
      fieldInfluence: 0.08,
      pointSize: 3,
      trailLength: 30,
      showTrails: true,
      color: '#22d3ff',
    }
  }
  const particle = visualization.value.particle
  particle.initialVx ??= 0
  particle.initialVy ??= 0
  particle.initialVz ??= 0
  particle.fieldInfluence ??= 0.08
  if (
    !particle.velocityScaleMigrated &&
    Number(particle.velocityScale ?? particle.velocity_scale ?? 0) <= 10
  ) {
    particle.velocityScale = 300
    particle.velocityScaleMigrated = true
  }
  return visualization.value.particle
}

const handleOpenParticleSettings = (layer) => {
  ensureParticleSettings()
  particleSettingsLayer.value = layer
  particleSettingsVisible.value = true
}

const {
  getIsoValueRange,
  getIsoState,
  getIsoSliderValue,
  getIsoDisplayValue,
  toggleIsosurfaceForLayer,
  updateIsosurfaceValueForLayer,
  refreshIsosurfaceRangeForLayer,
} = useIsosurface({
  currentTask,
  generatedVizLayers,
  playerRef,
  taskStore,
})

const handleStreamlineSettingsApply = (settings) => {
  console.log('[流线图设置] 应用新设置:', settings)
  if (!visualization.value.streamline) visualization.value.streamline = {}
  visualization.value.streamline.smoke_enabled = Boolean(
    settings?.smoke_enabled,
  )

  const layer = streamlineSettingsLayer.value
  if (layer?.kind === 'streamline') {
    generatedVizLayers.value = generatedVizLayers.value.map((item) =>
      item?.id === layer.id
        ? {
            ...item,
            streamlineSmokeEnabled: Boolean(settings?.smoke_enabled),
          }
        : item,
    )
  }
}

const {
  modelOpacityPercent,
  realModelOpacityPercent,
  meetingRoomGaussianScaleValue,
  personModelOpacityPercent,
  personRealModelOpacityPercent,
  resolveModelLayerOpacityPercent,
  ensureRealModelOpacityValue,
  ensurePersonModelOpacityValue,
  ensureModelOpacityValues,
  ensureModelDissolveSettings,
  modelDisplayModes,
} = useModelOpacitySettings({ visualization })

// 云图 / 矢量切换时清空上次接口回填的预览范围，避免子组件 base 仍回落到旧云图 vmin/vmax
watch(visualization2DType, () => {
  if (visualizationDimension.value !== '2d') return
  latest2DVMin.value = null
  latest2DVMax.value = null
  previewVMin.value = 0
  previewVMax.value = 0
  if (visualization2DType.value !== 'cloud') {
    visualization.value.cloud_variables = []
  }
})

const {
  autoTriggerVolumeIfNeeded: _autoTriggerVolume,
  autoTriggerStreamlineIfNeeded: _autoTriggerStreamline,
  autoTriggerVectorIfNeeded: _autoTriggerVector,
  tryAutoLoadOnHomeEnter: _tryAutoLoadOnHomeEnter,
  resetAutoLoadState,
} = useAutoTrigger({
  taskStore,
  vizStore: {
    visualization,
    visualizationDimension,
    visualization2DType,
    visualization3DType,
    isBatchLoading,
    batchLoadingText,
    batchLoadCurrent,
    batchLoadTotal,
    batchLoadProgress,
    previewFrameCount,
  },
  ueMsg,
  timeline: {
    timelineTimeSteps,
    timelinePhysicalTimes,
    timelineTotalSteps,
    timelineCurrentStep,
    hasAppliedSettings,
    isTimelineCollapsed,
  },
  layers: {
    generatedVizLayers,
    registerGeneratedLayer,
    removeGeneratedLayer,
    buildGeneratedLayerId,
    vizLayerIdForUE,
    sendVizLayerVisibilityToUE,
    purgeExcludedGeneratedLayers,
  },
  viz3d: {
    listVolumeVariableIdsForUE,
    extractVolumeUrlsFromChunk,
    buildVolumeTextureChunkUePayload,
    resolveSimulationTimeStepAtSlideIndex,
    buildStreamlineUeParams,
    buildStreamlineApiParams,
  },
  sendTimelineStepToUE: (step) => {
    if (typeof sendTimelineStepToUE === 'function') sendTimelineStepToUE(step)
  },
  playerRef,
  isMounted: () => isHomeViewMounted.value,
})

/**
 * 后处理 time-steps 接口已为该任务拉取过（与 timelineTimeSteps 对应）。
 * 切换任务时清空；应用设置时若与当前任务一致则不再请求 time-steps。
 */

/**
 * 进入首页时，根据当前任务的预生成配置自动加载流线图或体渲染。
 * - 仅在有当前任务、且预生成配置存在时触发
 * - 必须首页没有任何面板（leftComponent === null）时才触发，避免点击任务列表时自动加载。
 * - activateSavedTask 初始加载 / handleTaskSelect 已触发，此处仅处理从其他 Tab 切回首页的场景。
 */
const tryAutoLoadOnHomeEnter = async () => {
  if (!isHomeViewMounted.value) {
    return
  }
  if (!homeViewReady.value) {
    scheduleHomeAutoLoad(50)
    return
  }
  if (leftComponent.value !== null) {
    return
  }
  await _tryAutoLoadOnHomeEnter()
}

const handleGlobalKeydown = (e) => {
  if (e.key === 'F2') {
    e.preventDefault()
    openBaseUrlDialog()
  }
}

onMounted(async () => {
  await nextTick()
  isHomeViewMounted.value = true
  homeViewReady.value = true
  // 页面挂载时立即加载色带目录，确保体渲染创建时 colorMapCatalog 已有数据
  refreshColorMapCatalog()
  if (activeModule.value === 'home') {
    scheduleHomeAutoLoad()
  }
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  isHomeViewMounted.value = false
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (homeAutoLoadTimer) {
    clearTimeout(homeAutoLoadTimer)
    homeAutoLoadTimer = null
  }
})

watch(
  () => activeModule.value,
  async (mod, prevMod) => {
    if (mod === 'visualization') refreshColorMapCatalog()
    // 切换离开 home 时也要清理定时器，避免组件卸载后仍触发自动加载
    if (prevMod === 'home' && homeAutoLoadTimer) {
      clearTimeout(homeAutoLoadTimer)
      homeAutoLoadTimer = null
    }
    if (mod === 'home') scheduleHomeAutoLoad()
  },
  { immediate: true },
)

/** 时间轴拖动时发给 UE 的防抖定时器，避免拖动过程中频繁发送 */
let timelineToUEDebounceTimer = null
const TIMELINE_TO_UE_DEBOUNCE_MS = 200

/** animationUpdate 载荷：2D 云图在 UE 侧为 contour，与 vizLayerVisibility / update2DContourParams 一致 */
function getAnimationUpdateType() {
  if (visualizationDimension.value === '2d') {
    return visualization2DType.value === 'vector' ? 'vector' : 'contour'
  }
  if (visualizationDimension.value === '3d') {
    if (visualization3DType.value === 'volume') return 'volume'
    if (visualization3DType.value === 'streamline') return 'streamline'
  }
  return 'unknown'
}

// handleTimelineToggle / Play / Pause / Stop / Seek 已由 useTimeline composable 提供

// 把当前时间轴步进立即发给 UE（播放时逐帧发送会调用这里）
const sendTimelineStepToUE = (step) => {
  if (!playerRef.value) return
  const timeStep =
    timelineTimeSteps.value.length > step ? timelineTimeSteps.value[step] : step
  const safeTimeStep = Number(timeStep) === 0 ? 1 : timeStep

  const physicalTime =
    timelinePhysicalTimes.value.length > step
      ? timelinePhysicalTimes.value[step]
      : null

  const baseFields = {
    currentStep: step,
    index: step, // 当前时间步在时间步数组中的序号（与 currentStep 一致）
    totalSteps: timelineTotalSteps.value,
    // UE 约定：time_step 为当前帧的仿真时间步数值（避免发送 0）
    time_step: safeTimeStep,
    ...(physicalTime != null && { physical_time: physicalTime }),
    speed: resolveAnimationSpeedMultiplier(visualization.value.animationSpeed),
    timestamp: Date.now(),
  }

  // 3D 体渲染：每个变量各发一次 updateCloud（与 apply 时多次 updateCloudTexture 对应）；随后与其它图层一样发 animationUpdate
  if (
    visualizationDimension.value === '3d' &&
    visualization3DType.value === 'volume'
  ) {
    for (const vid of listVolumeVariableIdsForUE()) {
      const volumePayload = buildVolumeTextureParamsForUE(timeStep, vid)
      if (!volumePayload) continue
      ueMsg.updateCloud(volumePayload)
    }
  }

  const layers = generatedVizLayers.value
  if (layers.length > 0) {
    for (const layer of layers) {
      const ueKind = vizLayerKindForUE(layer.kind)
      const ueLayerId = vizLayerIdForUE(layer)
      const sc = visualization.value.streamline
      const isStreamlineLayer = ueKind === 'streamline'
      const streamlineParams = isStreamlineLayer
        ? {
            line_width: sc?.line_width ?? 0.38,
            display_time: sc?.display_time ?? 5,
            color: sc?.color ?? '#ffffff',
          }
        : {}
      const payload = {
        ...baseFields,
        update_type: ueKind,
        id: ueLayerId,
        name: layer.label ?? layer.name ?? '',
        ...streamlineParams,
      }
      ueMsg.animationUpdate(payload)
    }
    return
  }

  // 无已登记图层时：按当前视图发一条（兼容旧行为）
  const updateType = getAnimationUpdateType()
  if (updateType === 'volume') {
    for (const vid of listVolumeVariableIdsForUE()) {
      const payload = {
        ...baseFields,
        update_type: 'volume',
        id: buildGeneratedLayerId('volume', { volumeVariable: vid }),
        name: buildGeneratedLayerLabel('volume', { volumeVariable: vid }),
      }
      ueMsg.animationUpdate(payload)
    }
    return
  }

  // 流线图：附加请求参数
  const streamlineParams =
    updateType === 'streamline'
      ? (() => {
          const sc = visualization.value.streamline
          return {
            line_width: sc?.line_width ?? 0.38,
            display_time: sc?.display_time ?? 5,
            color: sc?.color ?? '#ffffff',
          }
        })()
      : {}

  const payload = {
    ...baseFields,
    update_type: updateType,
    ...(updateType === 'contour'
      ? {
          id: buildGeneratedLayerId('contour'),
          name: buildGeneratedLayerLabel('contour'),
        }
      : updateType === 'vector'
        ? {
            id: buildGeneratedLayerId('vector'),
            name: buildGeneratedLayerLabel('vector'),
          }
        : {}),
    ...streamlineParams,
  }
  ueMsg.animationUpdate(payload)
}

// 监听动画速度变化，更新模拟定时器
watch(
  () => visualization.value.animationSpeed,
  (newSpeed) => {
    // 实时同步速度到 UE（转换为浮点数）
    if (playerRef.value) {
      ueMsg.updateAnimationSpeed({
        speed: resolveAnimationSpeedMultiplier(newSpeed),
      })
    }

    if (isTimelinePlaying.value) {
      handleTimelinePause()
      handleTimelinePlay()
    }
  },
)

// 监听当前步骤变化：发往 UE 做防抖，预览图立即更新
watch(timelineCurrentStep, async (newStep, oldStep) => {
  const timeStep =
    timelineTimeSteps.value.length > newStep
      ? timelineTimeSteps.value[newStep]
      : newStep

  // 流线图：时间轴变化时只同步当前仿真步。
  // 手动应用设置后已经缓存了 csv_urls/csv_time_steps，Three 侧会按当前时间步取对应 CSV。
  if (
    visualizationDimension.value === '3d' &&
    visualization3DType.value === 'streamline' &&
    visualization.value.streamline
  ) {
    visualization.value.streamline.time_step =
      resolveSimulationTimeStepAtSlideIndex(newStep)
  }

  // 发给 UE
  // - 自动播放和 3D 体渲染拖动：逐帧立即发送，保证 raymarch 跟手
  // - 其它手动拖动/跳转：保留防抖，避免请求风暴
  if (playerRef.value) {
    const shouldSendTimelineImmediately =
      isTimelinePlaying.value ||
      (visualizationDimension.value === '3d' &&
        visualization3DType.value === 'volume')
    if (shouldSendTimelineImmediately) {
      if (timelineToUEDebounceTimer) {
        clearTimeout(timelineToUEDebounceTimer)
        timelineToUEDebounceTimer = null
      }
      sendTimelineStepToUE(newStep)
    } else {
      if (timelineToUEDebounceTimer) clearTimeout(timelineToUEDebounceTimer)
      timelineToUEDebounceTimer = setTimeout(() => {
        timelineToUEDebounceTimer = null
        sendTimelineStepToUE(timelineCurrentStep.value)
      }, TIMELINE_TO_UE_DEBOUNCE_MS)
    }
  }

  // 如果是在可视化模块且已经应用过设置，且是 2D 模式，则更新预览图（立即更新，不防抖）
  if (
    (activeModule.value === 'visualization' || activeModule.value === 'home') &&
    hasAppliedSettings.value &&
    visualizationDimension.value === '2d' &&
    currentTask.value
  ) {
    try {
      const loadedImage =
        findLoadedImageByLayerAndTimeStep(
          selectedLayerId.value,
          timeStep,
          generatedVizLayers.value,
        ) || findLoadedImageByTimeStep(timeStep, generatedVizLayers.value)

      if (loadedImage) {
        const du = displayUrlForCachedFrame(loadedImage)
        previewImageUrl.value = du
        previewRows.value = 1
        previewCols.value = 1

        return
      }

      let res
      if (visualization2DType.value === 'cloud') {
        const contourVid =
          listCloudContourVariableIds()[0] ||
          visualization.value.variable ||
          'VelocityMagnitude'
        const params = {
          task_id: currentTask.value.id,
          plane_type: selectedPlane.value.toLowerCase(),
          plane_offset: planeCoordinate.value,
          time_step: timeStep,
          variable: contourVid,
          quality_preset: sanitizeVectorQualityPreset(
            visualization.value.quality_preset,
          ),
          transparent_background: sanitizeVectorTransparentBackground(
            visualization.value.transparent_background,
          ),
        }
        applyContourColormapToPayload(
          params,
          resolveContourColormapParams(contourVid),
        )

        res = await postProcessingApi.getContourByTimeStep(params)
      } else if (visualization2DType.value === 'vector') {
        const params = {
          task_id: currentTask.value.id,
          plane_type: selectedPlane.value.toLowerCase(),
          plane_offset: planeCoordinate.value,
          time_step: timeStep,
          // 后端新版矢量接口参数（完整字段）
          quality_preset: sanitizeVectorQualityPreset(
            visualization.value.quality_preset,
          ),
          transparent_background: sanitizeVectorTransparentBackground(
            visualization.value.transparent_background,
          ),
          glyph_density: sanitizeGlyphDensity(
            visualization.value.glyph_density,
          ),
          line_width: sanitizeVectorLineWidth(
            visualization.value.vectorLineWidth,
          ),
          color: visualization.value.vectorColor || '#ffffff',
          vmin: visualization.value.vmin,
          vmax: visualization.value.vmax,
        }
        res = await postProcessingApi.getVectorByTimeStep(params)
      }

      if (res) {
        const data = res.data || res
        // 兼容不同 URL 字段
        const url =
          data.contour_frame_url ||
          data.contour_url ||
          data.vector_url ||
          data.url ||
          (data.data && data.data.url)

        if (url) {
          previewImageUrl.value = url.replace(/[`\s]/g, '')

          // 单帧获取时，重置行列数为 1，确保显示完整的单张图片
          previewRows.value = 1
          previewCols.value = 1

          const tw = Number(data.physical_width)
          const th = Number(data.physical_height)
          if (Number.isFinite(tw) && Number.isFinite(th) && tw > 0 && th > 0) {
            previewPhysicalWidth.value = tw
            previewPhysicalHeight.value = th
          }
          // 设置几何中心
          if (data.geometric_center && Array.isArray(data.geometric_center)) {
            previewGeometricCenter.value = data.geometric_center
          }
        }
      }
    } catch (error) {
      console.error('Failed to update preview for step:', newStep, error)
    }
  }
})

// Worker 选择对话框相关（由 useWorkerDialog composable 提供）
const runtimeConfig = ref({
  time_steps: 100,
  time_step_size: 0.01,
  iterations_per_time_step: 20,
  processes: 1,
  image_generation_granularity: 10,
})
const {
  workerDialogVisible,
  workers,
  selectedWorkerId,
  loadingWorkers,
  pendingTaskId,
  fetchWorkers,
  handleResetWorker,
  handleStartAnalysis,
  confirmRunTask,
  runTask,
} = useWorkerDialog({ activeModule, runtimeConfig })

// 模型选择处理
const handleModelSelect = (model) => {
  selectedModel.value = model
}

const handleSpawnActor = (model) => {
  if (playerRef.value) {
    // UE 端按 data 的 JSON 字符串解析（与其它消息保持一致）
    const payload = {
      type: 'spawnActor',
      data: JSON.stringify({ name: model.name }),
    }
    playerRef.value.emitMessage(payload)
  } else {
    ElMessage.warning({
      message: 'UE 未连接',
      duration: 1500,
    })
  }
}

// 开始任务：通知 UE 加载模型
const startTask = () => {
  if (!selectedModel.value) {
    return
  }

  // startTask 原有逻辑，现已将 spawnActor 移到 handleSpawnActor
  // 如果这里也需要发，可以调用 handleSpawnActor(selectedModel.value)
  // 但目前需求是由 ModelGrid 点击“开始任务”时触发，所以通过事件传递出来
}

// 任务创建处理
const handleTaskCreated = async (task) => {
  const prevId = currentTask.value?.id
  const nextId = task?.id
  // 创建/切换到另一个 task 时，先让 UE 清空当前场景，避免新任务加载后被旧状态干扰
  if (prevId != null && nextId != null && prevId !== nextId) {
    emitResetLevelToUE()
  }

  // 本地模拟任务（如采空区瓦斯泄漏模拟卡片）：直接接管，不调用后端
  if (task?.isSimulated) {
    const syntheticTask = {
      ...task,
      geometry_model_url: '/采空区/场景.glb',
      real_model_url: '/采空区/场景.glb',
    }
    setCurrentTask(syntheticTask)

    // 新建任务后清空旧任务的时间轴数据，避免时间轴残留
    timelineTimeSteps.value = []
    timelinePhysicalTimes.value = []
    timelineTotalSteps.value = 0
    previewFrameCount.value = 0
    postProcessingTimeStepsTaskId.value = null
    hasAppliedSettings.value = false
    handleTimelineStop()

    // 模拟任务不进入参数设置等依赖后端的模块，直接留在首页展示模型与瓦斯面板
    setTimeout(() => {
      activeModule.value = 'home'
    }, 500)
    return
  }

  let taskDetail = task
  if (nextId) {
    try {
      const detailRes = await taskApi.getTaskDetail(nextId)
      taskDetail = {
        ...task,
        ...(detailRes?.data || detailRes || {}),
      }
    } catch (error) {
      console.warn('刷新新建任务详情失败:', error)
    }
  }
  taskDetail = await loadTaskModelInfo(taskDetail, { showWarning: true })
  setCurrentTask(taskDetail)

  // 新建任务后清空旧任务的时间轴数据，避免时间轴残留
  timelineTimeSteps.value = []
  timelinePhysicalTimes.value = []
  timelineTotalSteps.value = 0
  previewFrameCount.value = 0
  postProcessingTimeStepsTaskId.value = null
  hasAppliedSettings.value = false
  handleTimelineStop()

  // 延迟一点跳转，让用户看清提示
  setTimeout(() => {
    activeModule.value = 'parameters'
  }, 500)
}

const handleTaskRefresh = async (task) => {
  if (!task?.id) return
  const mergedTask = {
    ...(currentTask.value || {}),
    ...task,
  }
  setCurrentTask(await loadTaskModelInfo(mergedTask))
}

/** 参数保存后就地更新任务配置，避免重新拉详情触发 Three.js 重建 */
const handleParamsSaved = (updateData) => {
  if (!currentTask.value || !updateData) return
  if (updateData.params) {
    currentTask.value.params = {
      ...(currentTask.value.params || {}),
      ...updateData.params,
    }
  }
  if (updateData.pregen_config) {
    currentTask.value.pregen_config = updateData.pregen_config
  }
}

const refreshCurrentTaskDetail = async (taskId) => {
  const id = taskId || currentTask.value?.id
  if (!id) return
  try {
    const detailRes = await taskApi.getTaskDetail(id)
    await handleTaskRefresh(detailRes?.data || detailRes)
  } catch (error) {
    console.warn('刷新任务详情失败:', error)
  }
}

const confirmRunTaskWithRefresh = async (payload) => {
  const taskId = payload?.taskId || currentTask.value?.id
  await confirmRunTask({
    ...payload,
    onTaskStarted: async () => {
      await refreshCurrentTaskDetail(taskId)
    },
  })
}

function handleTaskDeleted(taskId) {
  monitoringPointStore.clearPoints(taskId)
  const { remainingLayers, removedCount } = cleanupDeletedTaskLayers(
    generatedVizLayers.value,
    taskId,
  )
  if (removedCount > 0) {
    generatedVizLayers.value = remainingLayers
    if (
      selectedLayerId.value != null &&
      !remainingLayers.some(
        (layer) => String(layer.id) === String(selectedLayerId.value),
      )
    ) {
      selectedLayerId.value = null
    }
    ueMsg.vizLayerVisibility({
      id: '',
      name: '',
      visible: false,
      kind: 'contour',
      layer_type: 'contour',
      layer_type_name: '',
      layer_id: '',
      label: '',
      layers: generatedVizLayers.value
        .filter((layer) => !layer.isMock)
        .map((layer) => buildVizLayerPayloadEntry(layer)),
      reset: generatedVizLayers.value.length === 0,
    })
  }

  if (shouldClearCurrentTask(currentTask.value, taskId)) {
    setCurrentTask(null)
    taskStore.clearTask()
    localStorage.removeItem('activeTaskId')
    postProcessingTimeStepsTaskId.value = null
    timelineTimeSteps.value = []
    timelinePhysicalTimes.value = []
    timelineTotalSteps.value = 0
    previewFrameCount.value = 0
    hasAppliedSettings.value = false
    handleTimelineStop()
    emitResetLevelToUE()
  }
}

// 任务选择处理
// handleTaskSelect 已抽取至 useTaskSelection composable
const fallbackToRuntimeConfig = (task) => {
  const count =
    task.runtime_config?.time_steps ??
    task.params?.runtime_config?.time_steps ??
    0
  if (count > 0) {
    timelinePhysicalTimes.value = [] // 清空物理时间
    // totalSteps 为最大步索引 (0-based)，帧数 = count
    timelineTotalSteps.value = count - 1
    previewFrameCount.value = count
    // 生成 [1,2,...,count] 作为时间步列表，避免 UE 接收 time_step=0
    timelineTimeSteps.value = Array.from({ length: count }, (_, i) => i + 1)
    postProcessingTimeStepsTaskId.value = task?.id ?? null
  }
  // 如果 count <= 0，不修改时间轴数据，保留之前的数据或等待 ensureTimeSteps 设置
}

const isExcludedGeneratedLayer = (layer) =>
  String(layer?.id ?? '')
    .toLowerCase()
    .includes('mass_fraction_of_air')

const readyGeneratedVizLayers = computed(() =>
  (generatedVizLayers.value || []).filter(
    (layer) => layer.ready !== false && !isExcludedGeneratedLayer(layer),
  ),
)

const showGeneratedLayerColorMapManager = computed(
  () =>
    generatedLayerPage.value === 'volume' &&
    readyGeneratedVizLayers.value.some((layer) => layer?.kind === 'volume'),
)

const {
  generatedLayerPages,
  cloudVariableFilter,
  cloudPlaneFilter,
  vectorPlaneFilter,
  cloudGasFilter,
  cloudGasPage,
  parseGeneratedLayerMeta,
  cloudVariableFilterOptions,
  cloudGasFilterOptions,
  cloudCurrentPageCount,
  cloudPlaneFilterOptions,
  vectorPlaneFilterOptions,
  matchesGeneratedLayerFilter,
  pagedGeneratedVizLayers,
  pagedGeneratedVizLayerGroups,
  setGeneratedLayerGroupVisibility,
  hasVolumeLayerInCurrentPage,
  showVolumeRaymarchControls,
  volumeRaymarchSteps,
  volumeRaymarchOpacity,
} = useGeneratedLayerPaging({
  readyGeneratedVizLayers,
  generatedLayerPage,
  generatedVizLayers,
  visualization,
  monitoringPoints,
  getVariableDisplayName,
  applyMonitoringLayerVisibility,
  syncMonitoringPointsToStore,
  syncMonitoringPointLayers,
  syncPointsToThree,
  syncMonitoringPointsToPanel,
  sendVizLayerVisibilityToUE,
  syncSelectedGeneratedLayerAfterBatch,
  isGeneratedLayerSelectable,
  isMonitoringGeneratedLayer,
  KIND_LABELS,
})

const compactBatchLoadingText = computed(() => {
  const text = String(batchLoadingText.value || '').trim()
  if (!text) return '加载中'
  const normalized = text.replace(/\s+/g, ' ')
  const autoMatch = normalized.match(/自动加载\s+\d+\/\d+/)
  if (autoMatch) {
    const parts = normalized
      .split('·')
      .map((part) => part.trim())
      .filter(Boolean)
    const detailParts = parts
      .filter((part) => part !== autoMatch[0])
      .slice(0, 3)
    if (detailParts.length > 0) {
      return detailParts.join(' · ')
    }
    return '加载中'
  }
  return normalized
})

const showVolumeCsvProgress = computed(() => false)

function handleVolumeCsvProgress(progress) {
  volumeCsvProgress.value = {
    visible: Boolean(progress?.visible),
    percentage: Number(progress?.percentage) || 0,
    text: String(progress?.text || ''),
    detail: String(progress?.detail || ''),
  }
}

/** 体渲染包围盒与人物 GLB 包围盒首次重叠时由画布抛出 */
function handleVolumePersonSpaceIntersect({ volumeLabel, personModelKey }) {
  const personName =
    personModelKey === 'personReal'
      ? '人物模型（精细）'
      : personModelKey === 'personGeometry'
        ? '人物模型（几何简模）'
        : '人物模型'
  const vol = volumeLabel || '体渲染区域'
  ElMessageBox.alert(
    `识别到「${vol}」与场景中的 ${personName} 在空间上存在交集（基于包围盒检测）。`,
    '空间识别',
    {
      confirmButtonText: '知道了',
      type: 'warning',
    },
  )
}

const clearTimelineToUEDebounce = () => {
  if (timelineToUEDebounceTimer) {
    clearTimeout(timelineToUEDebounceTimer)
    timelineToUEDebounceTimer = null
  }
}

const {
  loadVisualizationPreset,
  resetVisualizationSettings,
  handleTaskSelect,
} = useTaskSelection({
  refs: {
    currentTask,
    taskListRef,
    visualization,
    visualizationDimension,
    visualization2DType,
    visualization3DType,
    isBatchLoading,
    batchLoadingText,
    batchLoadProgress,
    batchLoadCurrent,
    batchLoadTotal,
    batchLoadedImages,
    hasAppliedSettings,
    isTimelineCollapsed,
    previewImageUrl,
    previewFrameCount,
    previewVMin,
    previewVMax,
    previewPhysicalWidth,
    previewPhysicalHeight,
    previewGeometricCenter,
    previewRows,
    previewCols,
    timelineCurrentStep,
    timelineTimeSteps,
    timelinePhysicalTimes,
    timelineTotalSteps,
    postProcessingTimeStepsTaskId,
    selectedPlane,
    planeCoordinate,
    generatedVizLayers,
    latest2DVMin,
    latest2DVMax,
    playerRef,
    ueMsg,
    activeModule,
    leftPanelCollapsed,
    rightPanelCollapsed,
    vizLayersListCollapsed,
    visualizationSettingsKey,
    returningFromVisualization,
    selectedModel,
  },
  methods: {
    fallbackToRuntimeConfig,
    handleTimelineStop,
    resolveAnimationSpeedMultiplier,
    emitResetLevelToUE,
    showWarning: (message) => ElMessage.warning(message),
    tryAutoLoadOnHomeEnter,
    clearTimelineToUEDebounce,
    loadTaskModelInfo,
  },
  store: {
    taskStore,
  },
})

// 内联 autoTrigger 函数群已抽取到 composables/useAutoTrigger.js
// emitResetLevelToUE 由 useUeMessageBus 统一提供，避免多个生命周期监听重复 reset

const handleResetScene = () => {
  const resetTaskId = currentTask.value?.id
  // 1) 前端状态：回归到初始可视化/时间轴缓存状态（并通知 UE resetSettings）
  resetVisualizationSettings()
  // 补齐初始值语义：场景级重置时不保留 vmin/vmax
  visualization.value.vmin = null
  visualization.value.vmax = null

  // 2) UE 侧：额外做一次 resetLevel（清空相关世界状态）
  if (playerRef.value) {
    emitResetLevelToUE()
  }

  // 3) 全局导航/任务选择状态回归初始
  activeModule.value = 'home'
  leftPanelCollapsed.value = false
  rightPanelCollapsed.value = false
  selectedModel.value = null
  monitoringPointStore.clearPoints(resetTaskId)
  setCurrentTask(null)
  clearMonitoringPointsState()

  // 4) 与任务无关但可能会遗留的执行状态
  isApplyingSettings.value = false

  // 5) 清空自动加载记录，允许重新选同一任务时再次自动加载
  resetAutoLoadState()
}

// 页面生命周期 resetLevel 已由 useUeMessageBus composable 自动处理

// UE 回传 finishVector：补充更新矢量图层（应用设置时分片 update2DVectorParams 已可 upsert）
const handleUeFinishVector = (payload) => {
  const layerId = payload?.id
  if (layerId == null || layerId === '') return

  const variable =
    payload?.variable != null && String(payload.variable).trim() !== ''
      ? String(payload.variable).trim()
      : 'VelocityMagnitude'

  const entry = {
    id: String(layerId),
    kind: 'vector',
    label: buildGeneratedLayerLabel('vector', { vectorVariable: variable }),
    visible: true,
    ready: true,
  }

  const idx = generatedVizLayers.value.findIndex(
    (l) => String(l.id) === String(layerId),
  )
  if (idx >= 0) {
    generatedVizLayers.value[idx] = {
      ...generatedVizLayers.value[idx],
      ...entry,
      visible: true,
      ready: true,
    }
  } else {
    generatedVizLayers.value.push(entry)
  }
}

const handleStartRecognition = () => {
  activeModule.value = 'statistics'
  showMicroMotionPanel.value = true
  rightPanelCollapsed.value = false
  startMicroMotionLoading()
}

// 更新建筑
const handleUpdateBuilding = () => {
  if (playerRef.value) {
    ueMsg.updateBuilding({})
  } else {
  }
}

// 放在 setup 末尾以避免 ReferenceError（确保所有注入的 ref/method 先于此执行）
const { applyVisualizationSettings, applySelectedInputsSettings } =
  useApplySettings({
    refs: {
      currentTask,
      visualization,
      visualizationDimension,
      visualization2DType,
      visualization3DType,
      isBatchLoading,
      batchLoadingText,
      batchLoadProgress,
      batchLoadCurrent,
      batchLoadTotal,
      batchLoadedImages,
      hasAppliedSettings,
      isTimelineCollapsed,
      previewImageUrl,
      previewFrameCount,
      previewVMin,
      previewVMax,
      previewPhysicalWidth,
      previewPhysicalHeight,
      previewGeometricCenter,
      previewRows,
      previewCols,
      timelineCurrentStep,
      timelineTimeSteps,
      timelinePhysicalTimes,
      timelineTotalSteps,
      postProcessingTimeStepsTaskId,
      isTimelinePlaying,
      selectedPlane,
      planeCoordinate,
      generatedVizLayers,
      latest2DVMin,
      latest2DVMax,
      playerRef,
      ueMsg,
      selectedLayerId,
      applyFromRadarMediumCloud,
    },
    methods: {
      listVolumeVariableIdsForUE,
      build2DContourParamsForUE: (steps, opt) => build2DParamsForUE(steps, opt),
      build2DVectorParamsForUE: (steps, opt) => build2DParamsForUE(steps, opt),
      buildVolumeTextureParamsForUE,
      buildStreamlineApiParams,
      buildStreamlineUeParams,
      registerGeneratedLayer,
      upsertGeneratedVizLayer,
      buildGeneratedLayerId,
      buildGeneratedLayerLabel,
      vizLayerIdForUE,
      extractVolumeUrlsFromChunk,
      buildVolumeTextureChunkUePayload,
      resolveSimulationTimeStepAtSlideIndex,
      sendVizLayerVisibilityToUE,
      sendTimelineStepToUE: (step) => {
        if (typeof sendTimelineStepToUE === 'function')
          sendTimelineStepToUE(step)
      },
      handleFocusPoint,
      resolveSelectedCmap,
      resolveContourColormapParams,
      applyContourColormapToPayload,
      send2DParamsToUE,
      listCloudContourVariableIds,
      findLoadedImageByTimeStep,
      displayUrlForCachedFrame,
      handleTimelineStop,
      syncSelectedGeneratedLayerAfterBatch,
    },
  })

const { applyRadarResultPreviewSettings } = useRadarResultPreview({
  visualization,
  selectedPlane,
  planeCoordinate,
  generatedVizLayers,
  selectedLayerId,
  hasAppliedSettings,
  isTimelineCollapsed,
  buildSimRadarFrameImages,
  buildGeneratedLayerId,
  buildRadarMockVolumeVariableId,
  upsertGeneratedVizLayer,
})

/** 介质与调制：与画布云图/体模式对齐后再走统一的应用设置流程；云图成功后补充「雷达波」图层（仅前端） */
function handleRadarMediumApplySettings() {
  if (!currentTask.value) {
    ElMessage.warning('请先选择任务后再应用设置')
    return
  }
  if (radarMediumVizMode.value === 'cloud') {
    visualizationDimension.value = '2d'
    visualization2DType.value = 'cloud'
    applyFromRadarMediumCloud.value = true
  } else {
    visualizationDimension.value = '3d'
    visualization3DType.value = 'volume'
  }
  applyVisualizationSettings({
    afterSuccess: async () => {
      if (radarMediumVizMode.value !== 'cloud') return
      const plane = selectedPlane.value
      const coord = planeCoordinate.value
      const id = buildGeneratedLayerId('radar_wave', {
        plane,
        coordinate: coord,
      })
      const matchCloud =
        generatedVizLayers.value.find((l) => {
          if (l.kind !== 'cloud' && l.kind !== 'contour') return false
          const p = String(l.id).split(':')
          return p[2] === plane && String(p[3]) === String(coord)
        }) ||
        generatedVizLayers.value.find((l) =>
          ['cloud', 'contour'].includes(l.kind),
        )
      upsertGeneratedVizLayer({
        id,
        kind: 'radar_wave',
        label: buildGeneratedLayerLabel('radar_wave', {
          plane,
          coordinate: coord,
        }),
        images:
          matchCloud?.images?.length > 0
            ? matchCloud.images
            : [{ time_step: 0 }],
        physicalTimes: matchCloud?.physicalTimes ?? [],
        physicalWidth: matchCloud?.physicalWidth ?? null,
        physicalHeight: matchCloud?.physicalHeight ?? null,
        loaded: true,
        ready: true,
        visible: true,
        isMock: true,
      })
    },
  })
}
</script>

<template>
  <div class="home-container">
    <!-- 顶部导航 -->
    <header class="top-nav">
      <div class="nav-left">
        <el-button
          :type="activeModule === 'home' ? 'primary' : 'default'"
          plain
          @click="handleNavClick('home')">
          首页
        </el-button>
        <el-button
          :type="activeModule === 'model' ? 'primary' : 'default'"
          plain
          @click="handleNavClick('model')">
          模型选择
        </el-button>
        <el-button
          :type="activeModule === 'tasks' ? 'primary' : 'default'"
          class="nav-btn-tasks"
          plain
          @click="handleNavClick('tasks')">
          任务列表
        </el-button>
        <el-button
          :type="activeModule === 'parameters' ? 'primary' : 'default'"
          plain
          @click="handleNavClick('parameters')">
          参数设置
        </el-button>
      </div>

      <div class="logo">
        <h2>煤矿井下瓦斯监测预警系统</h2>
      </div>

      <div class="nav-right">
        <el-button
          :type="activeModule === 'radarEm' ? 'primary' : 'default'"
          class="nav-btn-radar-em"
          plain
          @click="handleNavClick('radarEm')">
          雷达
        </el-button>
        <el-button
          :type="activeModule === 'visualization' ? 'primary' : 'default'"
          class="nav-btn-visualization"
          plain
          @click="handleNavClick('visualization')">
          可视化设置
        </el-button>

        <el-button
          :type="activeModule === 'statistics' ? 'primary' : 'default'"
          class="nav-btn-statistics"
          plain
          @click="handleNavClick('statistics')">
          数据统计
        </el-button>
        <el-button
          v-if="SHOW_RADAR_DATA_MODULE"
          :type="activeModule === 'radarMedium' ? 'primary' : 'default'"
          class="nav-btn-radar-medium"
          plain
          @click="handleNavClick('radarMedium')">
          雷达数据
        </el-button>
        <!-- <el-button
          :type="activeModule === 'analysis' ? 'primary' : 'default'"
          plain
          @click="handleNavClick('analysis')">
          数据分析
        </el-button> -->

        <el-dropdown
          trigger="click"
          @command="handleTutorialCommand"
          popper-class="tutorial-dropdown-popper"
          class="tutorial-dropdown">
          <el-button type="default" plain>
            <el-icon style="margin-right: 4px"><Reading /></el-icon>
            教程
          </el-button>
          <template #dropdown>
            <el-dropdown-menu class="tutorial-dropdown-menu">
              <el-dropdown-item
                v-for="item in tutorialItems"
                :key="item.command"
                :command="item.command">
                <div class="tutorial-item-title">{{ item.title }}</div>
                <div class="tutorial-item-desc">{{ item.description }}</div>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button type="danger" plain @click="handleResetScene">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>
          重置场景
        </el-button>

        <div class="user-info" v-if="false">
          <el-dropdown>
            <span class="el-dropdown-link">
              管理<el-icon class="el-icon--right"><arrow-down /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item>个人中心</el-dropdown-item>
                <el-dropdown-item>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <!-- 主内容区 -->
    <main
      class="main-content"
      :class="{
        'radar-em-mode': isRadarEmModule,
        'has-leida-data': isRadarEmModule && leidaHasDataPanel,
        'with-timeline': shouldShowSharedTimeline,
        'timeline-collapsed': isTimelineCollapsed,
      }">
      <!-- 当前任务标识 -->
      <div
        v-if="
          currentTask && activeModule !== 'model' && activeModule !== 'radarEm'
        "
        class="current-task-indicator">
        <el-icon><Monitor /></el-icon>
        <span class="task-label">当前任务:</span>
        <span class="task-name">{{ currentTask.name || currentTask.id }}</span>
        <!-- <el-tag
          :type="getTaskStatusType(currentTask.status)"
          size="small"
          effect="dark">
          {{ getTaskStatusText(currentTask.status) }}
        </el-tag> -->
      </div>

      <LeidaPanelsShell
        v-if="isRadarEmModule"
        external-viewport
        embedded
        :model-name="radarEmModelName"
        :task-id="radarEmTaskId"
        :geometry-bounds="radarEmGeometryBounds"
        :geometry-selections="radarEmGeometrySelections"
        :visualization="visualization"
        :dimension="visualizationDimension"
        :type2d="visualization2DType"
        :type3d="visualization3DType"
        :radar-result-mode="visualization.radar_result_mode"
        :radar-frequencies="visualization.radar_frequencies"
        :applying="isApplyingSettings"
        :batch-loading="isBatchLoading"
        @update:radar-frequencies="visualization.radar_frequencies = $event"
        @update:dimension="visualizationDimension = $event"
        @update:type2d="visualization2DType = $event"
        @update:type3d="visualization3DType = $event"
        @update:radar-result-mode="visualization.radar_result_mode = $event"
        @apply-radar-settings="applyRadarResultPreviewSettings"
        @select-geometry-part="handleLeidaSelectGeometryPart"
        @medium-nav-active="handleLeidaMediumNavActive"
        @update:medium-bindings="radarEmMediumBindings = $event"
        @update:has-data-panel="leidaHasDataPanel = $event" />

      <LeidaViewportChrome
        :class="isRadarEmModule ? 'home-leida-viewport' : 'home-center-wrap'"
        :show-chrome="isRadarEmModule"
        :show-toolbar="false"
        :colorbar-placement="isRadarEmModule ? 'left-center' : 'top-left'">
        <section class="pixel-streaming-area viz-guide-canvas">
          <ThreeVisualizationCanvas
            ref="playerRef"
            :current-task="currentTask"
            :visualization-dimension="
              activeModule === 'radarMedium'
                ? radarMediumVizMode === 'cloud'
                  ? '2d'
                  : '3d'
                : visualizationDimension
            "
            :visualization2-d-type="
              activeModule === 'radarMedium' && radarMediumVizMode === 'cloud'
                ? 'cloud'
                : visualization2DType
            "
            :visualization3-d-type="
              activeModule === 'radarMedium' && radarMediumVizMode === 'volume'
                ? 'volume'
                : visualization3DType
            "
            :visualization-options-open="isVisualizationOptionsOpen"
            :selected-plane="selectedPlane"
            :plane-coordinate="planeCoordinate"
            :preview-image-url="resolvedPreviewImageFor2D"
            :generated-viz-layers="generatedVizLayers"
            :selected-layer-id="selectedLayerId"
            :timeline-current-step="timelineCurrentStep"
            :timeline-time-steps="timelineTimeSteps"
            :timeline-physical-times="timelinePhysicalTimes"
            :is-timeline-playing="isTimelinePlaying"
            :visualization="visualization"
            :show-radar-material-info="isRadarEmModule"
            :radar-material-bindings="radarEmMediumBindings"
            :physical-width="previewPhysicalWidth"
            :physical-height="previewPhysicalHeight"
            :geometric-center="previewGeometricCenter"
            :color-map-catalog="colorMapCatalogItems"
            :get-volume-dataset="postProcessingApi.getVolumeDataset"
            :get-geometry-bounds="postProcessingApi.getGeometryBounds"
            @add-point="handleAddPoint"
            @update-point="handleUpdatePoint"
            @delete-point="handleDeletePoint"
            @focus-point="handleFocusPoint"
            @volume-csv-progress="handleVolumeCsvProgress"
            @geometry-selections-update="handleGeometrySelectionsUpdate"
            @volume-person-space-intersect="handleVolumePersonSpaceIntersect"
            @goaf-gas-sources-updated="goafGasConfigFloatRef?.refreshGoafGasSources?.()" />
        </section>
      </LeidaViewportChrome>

      <!-- 模型选择网格 - 全屏覆盖 -->
      <section v-if="showModelGrid" class="model-grid-overlay">
        <ModelGrid
          :initial-selected-id="selectedModel?.id"
          @select="handleModelSelect"
          @spawn-actor="handleSpawnActor"
          @task-created="handleTaskCreated" />
      </section>

      <div v-if="microMotionLoading" class="micro-motion-progress-float">
        <div class="micro-motion-progress-header">
          <span>{{ microMotionLoadingStageText }}</span>
          <strong>{{ microMotionLoadingProgress }}%</strong>
        </div>
        <div class="micro-motion-progress-sub">识别流程进行中，请稍候</div>
        <el-progress
          class="micro-motion-progress-bar"
          :percentage="microMotionLoadingProgress"
          :stroke-width="8"
          :show-text="false"
          color="#00f3ff" />
      </div>

      <!-- 左轨：主左侧面板 + 已生成图层 + 瓦斯参数（flex 横向，左侧面板会把图层往右挤） -->
      <div
        v-if="
          (!isRadarEmModule && showPanels && leftComponent) ||
          readyGeneratedVizLayers.length > 0 ||
          isBatchLoading ||
          isGoafTask(currentTask)
        "
        class="content-left-rail"
        :class="{
          'with-timeline': shouldShowSharedTimeline && !isRadarEmModule,
          'timeline-collapsed': isTimelineCollapsed,
          'in-leida-viewport': isRadarEmModule,
        }">
        <aside
          v-if="showPanels && leftComponent"
          class="left-panel floating-panel"
          :class="{ collapsed: leftPanelCollapsed }">
          <div class="panel-decoration-tr"></div>
          <div class="panel-decoration-bl"></div>
          <div class="panel-side-line"></div>
          <div class="panel-header">
            <h3>{{ leftTitle }}</h3>
            <div class="header-tools">
              <el-button
                class="collapse-btn"
                link
                @click="leftPanelCollapsed = true">
                <el-icon><ArrowLeft /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-content">
            <TaskList
              v-if="leftComponent === 'TaskList'"
              @select-task="handleTaskSelect"
              @task-deleted="handleTaskDeleted"
              @start-analysis="handleStartAnalysis" />
            <ParameterSettings
              ref="parameterSettingsRef"
              v-if="leftComponent === 'ParameterSettings'"
              :task-id="currentTask?.id"
              :model-id="
                selectedModel?.id ||
                currentTask?.model_id ||
                currentTask?.modelId
              "
              :initial-data="currentTask"
              @start-analysis="handleStartAnalysis"
              @refresh="handleTaskRefresh"
              @params-saved="handleParamsSaved"
              @navigate="handleNavClick" />
            <VisualizationSettings
              v-if="leftComponent === 'VisualizationSettings'"
              :key="visualizationSettingsKey"
              :loading="isApplyingSettings || isBatchLoading"
              :batch-loading="isBatchLoading"
              :batch-progress="batchLoadProgress"
              :batch-current="batchLoadCurrent"
              :batch-total="batchLoadTotal"
              :dimension="visualizationDimension"
              :visualization-type="
                visualizationDimension === '2d' ? visualization2DType : 'volume'
              "
              :task-id="currentTask?.id"
              :current-variable="visualization.variable"
              :cloud-variables="visualization.cloud_variables"
              :volume-variables="visualization.volume_variables"
              :radar-frequencies="visualization.radar_frequencies"
              :gas-cmaps="visualization.gasCmaps"
              :color-map-catalog="colorMapCatalogItems"
              :use-pregen="visualization.usePregen"
              @change="handleGasChange"
              @update:radar-frequencies="
                visualization.radar_frequencies = $event
              "
              @update-gas-cmap="handleGasCmapUpdate"
              @request-gas-config-dialog="openGasVariableConfig()"
              @refresh-color-maps="refreshColorMapCatalog" />
            <DataStatistics
              v-if="leftComponent === 'DataStatistics'"
              ref="dataStatisticsRef"
              :current-task="currentTask"
              :monitoring-points="monitoringPoints"
              @add-point="handleAddPoint"
              @update-point="handleUpdatePoint"
              @preview-point="handlePreviewPoint"
              @delete-point="handleDeletePoint"
              @focus-point="handleFocusPoint"
              @sync-points="syncPointsToThree" />
            <AnalysisResults v-if="leftComponent === 'AnalysisResults'" />
            <RadarMediumLeftPanel
              v-if="leftComponent === 'RadarMediumLeftPanel'"
              :probe-point="radarMediumProbeFallback" />
          </div>
        </aside>

        <!-- 已生成图层 + 采空区瓦斯配置：纵向排列的二级容器 -->
        <div
          v-if="
            readyGeneratedVizLayers.length > 0 ||
            isBatchLoading ||
            isGoafTask(currentTask)
          "
          class="content-left-rail-secondary">
          <!-- 已生成图层：勾选显隐时向 UE 发送 vizLayerVisibility -->
          <div
            v-if="readyGeneratedVizLayers.length > 0 || isBatchLoading"
            class="generated-layers-float">
          <button
            type="button"
            class="glf-toggle"
            :class="{ 'is-list-collapsed': vizLayersListCollapsed }"
            title="展开/折叠图层列表"
            @click="vizLayersListCollapsed = !vizLayersListCollapsed">
            <span class="glf-title">已生成图层</span>
            <span v-if="readyGeneratedVizLayers.length" class="glf-count">{{
              readyGeneratedVizLayers.length
            }}</span>
            <el-icon class="glf-caret">
              <CaretTop v-if="vizLayersListCollapsed" />
              <CaretBottom v-else />
            </el-icon>
          </button>
          <div v-show="!vizLayersListCollapsed" class="glf-body">
            <div v-if="showGeneratedLayerColorMapManager" class="glf-toolbar">
              <button
                type="button"
                class="glf-manage-cmap-btn"
                title="管理所有变量色带"
                @click.stop="openGasVariableConfig()">
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round">
                  <path
                    d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.4-4.5-8-10-8z" />
                  <circle
                    cx="7.5"
                    cy="11.5"
                    r="1.5"
                    fill="currentColor"
                    stroke="none" />
                  <circle
                    cx="11.5"
                    cy="7.5"
                    r="1.5"
                    fill="currentColor"
                    stroke="none" />
                  <circle
                    cx="16"
                    cy="11.5"
                    r="1.5"
                    fill="currentColor"
                    stroke="none" />
                </svg>
                <span>色带管理</span>
              </button>
            </div>
            <div v-if="isBatchLoading" class="glf-progress-card">
              <div class="glf-progress-header">
                <span class="glf-progress-title">
                  <el-icon class="glf-progress-icon"><Loading /></el-icon>
                  <span class="glf-progress-text">{{
                    compactBatchLoadingText
                  }}</span>
                </span>
                <span class="glf-progress-meta">
                  {{ batchLoadProgress }}%
                </span>
              </div>
              <el-progress
                :percentage="batchLoadProgress"
                :stroke-width="7"
                :show-text="false"
                color="#00d4ff"
                class="glf-progress-bar" />
            </div>
            <div
              v-if="showVolumeCsvProgress"
              class="glf-progress-card glf-progress-card--volume">
              <div class="glf-progress-header">
                <span class="glf-progress-title">
                  <el-icon class="glf-progress-icon"><Loading /></el-icon>
                  <span class="glf-progress-text">
                    {{ volumeCsvProgress.text }}
                  </span>
                </span>
                <span class="glf-progress-meta">
                  {{ volumeCsvProgress.percentage }}%
                </span>
              </div>
              <el-progress
                :percentage="volumeCsvProgress.percentage"
                :stroke-width="7"
                :show-text="false"
                color="#00d4ff"
                class="glf-progress-bar" />
              <div class="glf-progress-detail">
                {{ volumeCsvProgress.detail }}
              </div>
            </div>
            <div v-if="generatedLayerPages.length > 1" class="glf-tabs">
              <button
                v-for="page in generatedLayerPages"
                :key="page.key"
                type="button"
                class="glf-tab"
                :class="{ 'is-active': generatedLayerPage === page.key }"
                @click="generatedLayerPage = page.key">
                <span class="glf-tab-label">{{ page.label }}</span>
                <span class="glf-tab-count">{{ page.count }}</span>
              </button>
            </div>
            <div
              v-if="
                generatedLayerPage === 'cloud' &&
                cloudGasFilterOptions.length > 0
              "
              class="glf-cloud-row">
              <el-select
                v-model="cloudGasFilter"
                class="glf-filter-select glf-cloud-row-gas"
                popper-class="glf-cloud-pager-popper"
                size="small"
                placeholder="选择气体">
                <el-option
                  v-for="opt in cloudGasFilterOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value" />
              </el-select>
              <el-select
                v-if="cloudPlaneFilterOptions.length > 0"
                v-model="cloudPlaneFilter"
                class="glf-filter-select glf-cloud-row-gas glf-filter-select--plane"
                multiple
                collapse-tags
                collapse-tags-tooltip
                :max-collapse-tags="1"
                size="small"
                popper-class="glf-filter-popper glf-filter-popper--plane"
                placeholder="全部平面">
                <el-option
                  v-for="option in cloudPlaneFilterOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value" />
              </el-select>
              <template v-if="cloudGasFilter === '__all__'">
                <button
                  type="button"
                  class="glf-cloud-nav-btn"
                  :disabled="cloudGasPage <= 0"
                  @click="cloudGasPage--">
                  <el-icon><ArrowLeft /></el-icon>
                </button>
                <span class="glf-cloud-row-count">
                  {{ cloudGasPage + 1 }} /
                  {{ cloudGasFilterOptions.length - 1 }}
                </span>
                <button
                  type="button"
                  class="glf-cloud-nav-btn"
                  :disabled="cloudGasPage >= cloudGasFilterOptions.length - 2"
                  @click="cloudGasPage++">
                  <el-icon><ArrowRight /></el-icon>
                </button>
              </template>
              <span v-else class="glf-cloud-row-count">
                {{ cloudCurrentPageCount }}个切片
              </span>
            </div>
            <div
              v-else-if="
                generatedLayerPage === 'vector' &&
                vectorPlaneFilterOptions.length > 0
              "
              class="glf-filters glf-filters--single">
              <el-select
                v-model="vectorPlaneFilter"
                class="glf-filter-select glf-filter-select--plane"
                multiple
                collapse-tags
                collapse-tags-tooltip
                :max-collapse-tags="1"
                size="small"
                popper-class="glf-filter-popper glf-filter-popper--plane"
                placeholder="全部平面">
                <el-option
                  v-for="option in vectorPlaneFilterOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value" />
              </el-select>
            </div>
            <!-- TODO:渲染 -->
            <div v-if="showVolumeRaymarchControls" class="glf-volume-raymarch">
              <!-- <div class="glf-vr-row">
                <span class="glf-vr-label">渲染精细度</span>
                <span class="glf-vr-value">{{ volumeRaymarchSteps }}</span>
              </div>
              <el-slider
                v-model="volumeRaymarchSteps"
                :min="8"
                :max="256"
                :step="1"
                size="small"
                class="glf-vr-slider" /> -->
              <div class="glf-vr-row">
                <span class="glf-vr-label">透明度</span>
                <span class="glf-vr-value">{{
                  Number(volumeRaymarchOpacity).toFixed(2)
                }}</span>
              </div>
              <el-slider
                v-model="volumeRaymarchOpacity"
                :min="0.1"
                :max="3"
                :step="0.01"
                size="small"
                class="glf-vr-slider" />
            </div>
            <div
              v-for="group in pagedGeneratedVizLayerGroups"
              :key="group.key"
              class="glf-group">
              <div class="glf-group-header">
                <span class="glf-group-title">{{ group.label }}</span>
                <div
                  v-if="
                    group.key !== 'model' &&
                    group.key !== 'realModel' &&
                    group.key !== 'bounds'
                  "
                  class="glf-group-actions">
                  <button
                    type="button"
                    class="glf-group-action-btn"
                    :class="{
                      'is-all-on': group.layers.every((l) => l.visible),
                    }"
                    @click.stop="
                      setGeneratedLayerGroupVisibility(
                        group.layers,
                        group.layers.every((l) => l.visible) ? false : true,
                      )
                    ">
                    {{
                      group.layers.every((l) => l.visible) ? '取消全选' : '全选'
                    }}
                  </button>
                </div>
              </div>
              <div
                v-for="layer in group.layers"
                :key="layer.id"
                class="glf-row glf-layer-row"
                @contextmenu.prevent="onLayerContextMenu($event, layer)">
                <el-checkbox
                  v-if="isExclusiveModelGeneratedLayer(layer)"
                  class="glf-layer-check"
                  :model-value="layer.visible !== false"
                  :title="layer.label"
                  @change="(val) => onGeneratedLayerCheckboxChange(layer, val)">
                  <span class="glf-layer-label">{{ layer.label }}</span>
                </el-checkbox>
                <el-checkbox
                  v-else
                  v-model="layer.visible"
                  class="glf-layer-check"
                  :title="layer.label"
                  @change="
                    (val) =>
                      isMonitoringGeneratedLayer(layer)
                        ? handleMonitoringLayerVisibilityChange(layer, val)
                        : onGeneratedLayerCheckboxChange(layer, val)
                  ">
                  <span class="glf-layer-label">{{ layer.label }}</span>
                </el-checkbox>
                <div class="glf-row-actions">
                  <el-popover
                    v-if="isModelGeneratedLayer(layer)"
                    placement="left"
                    trigger="click"
                    :width="260"
                    popper-class="glf-opacity-popper">
                    <template #reference>
                      <button
                        type="button"
                        class="glf-opacity-btn"
                        :title="
                          layer.kind === 'realModel'
                            ? '真实模型设置'
                            : '几何模型设置'
                        "
                        @mouseenter="ensureModelOpacityValues(layer)"
                        @click.stop>
                        <el-icon><Setting /></el-icon>
                      </button>
                    </template>
                    <div class="glf-opacity-panel" @click.stop>
                      <div class="glf-opacity-header">
                        <span class="glf-opacity-title">{{
                          layer.kind === 'realModel'
                            ? '真实模型透明度'
                            : '几何模型透明度'
                        }}</span>
                        <span class="glf-opacity-value"
                          >{{ resolveModelLayerOpacityPercent(layer) }}%</span
                        >
                      </div>
                      <el-slider
                        v-if="layer.kind === 'realModel'"
                        v-model="visualization.real_model_opacity"
                        :min="0"
                        :max="1"
                        :step="0.01"
                        size="small"
                        class="glf-opacity-slider" />
                      <el-slider
                        v-else
                        v-model="visualization.model_opacity"
                        :min="0"
                        :max="1"
                        :step="0.01"
                        size="small"
                        class="glf-opacity-slider" />
                      <div v-if="layer.kind === 'realModel'">
                        <div
                          class="glf-opacity-header"
                          style="margin-top: 0.25rem">
                          <span class="glf-opacity-title">高斯缩放</span>
                          <span class="glf-opacity-value"
                            >{{ meetingRoomGaussianScaleValue }}x</span
                          >
                        </div>
                        <el-slider
                          v-model="visualization.meeting_room_gaussian_scale"
                          :min="0.5"
                          :max="2"
                          :step="0.05"
                          size="small"
                          class="glf-opacity-slider" />
                        <div
                          class="glf-opacity-header"
                          style="margin-top: 0.25rem">
                          <span class="glf-opacity-title">高斯绿框</span>
                          <el-switch
                            v-model="
                              visualization.meeting_room_gaussian_box_visible
                            "
                            size="small" />
                        </div>
                        <div
                          class="glf-opacity-header"
                          style="margin-top: 0.25rem">
                          <span class="glf-opacity-title">真实人物透明度</span>
                          <span class="glf-opacity-value"
                            >{{ personRealModelOpacityPercent }}%</span
                          >
                        </div>
                        <el-slider
                          v-model="visualization.person_real_model_opacity"
                          :min="0"
                          :max="1"
                          :step="0.01"
                          size="small"
                          class="glf-opacity-slider" />
                      </div>
                      <div v-else>
                        <div
                          class="glf-opacity-header"
                          style="margin-top: 0.25rem">
                          <span class="glf-opacity-title">几何人物透明度</span>
                          <span class="glf-opacity-value"
                            >{{ personModelOpacityPercent }}%</span
                          >
                        </div>
                        <el-slider
                          v-model="visualization.person_model_opacity"
                          :min="0"
                          :max="1"
                          :step="0.01"
                          size="small"
                          class="glf-opacity-slider" />
                      </div>
                      <div
                        class="glf-opacity-header"
                        style="margin-top: 0.25rem">
                        <span class="glf-opacity-title">展示模式</span>
                      </div>
                      <div class="glf-display-mode-group">
                        <button
                          v-for="mode in modelDisplayModes"
                          :key="mode.value"
                          type="button"
                          class="glf-display-mode-btn"
                          :class="{
                            active:
                              visualization.model_display_mode === mode.value,
                          }"
                          :title="mode.label"
                          @click="
                            visualization.model_display_mode = mode.value
                          ">
                          <span>{{ mode.label }}</span>
                        </button>
                      </div>
                      <div
                        class="glf-opacity-header"
                        style="margin-top: 0.25rem">
                        <span class="glf-opacity-title">溶解效果</span>
                        <el-switch
                          v-model="visualization.model_dissolve.enabled"
                          size="small" />
                      </div>
                      <div
                        v-if="visualization.model_dissolve.enabled"
                        class="glf-dissolve-settings">
                        <div class="glf-dissolve-color-row">
                          <span class="glf-opacity-title">颜色</span>
                          <label class="glf-dissolve-color-control">
                            <input
                              v-model="visualization.model_dissolve.color"
                              type="color" />
                            <span
                              class="glf-dissolve-color-swatch"
                              :style="{
                                background:
                                  visualization.model_dissolve.color ||
                                  '#72ff66',
                              }"></span>
                            <strong>{{
                              visualization.model_dissolve.color || '#72ff66'
                            }}</strong>
                          </label>
                        </div>
                        <div class="glf-opacity-header">
                          <span class="glf-opacity-title">时长</span>
                          <span class="glf-opacity-value"
                            >{{
                              Number(
                                visualization.model_dissolve.duration || 1.5,
                              ).toFixed(1)
                            }}s</span
                          >
                        </div>
                        <el-slider
                          v-model="visualization.model_dissolve.duration"
                          :min="0.2"
                          :max="3"
                          :step="0.1"
                          size="small"
                          class="glf-opacity-slider" />
                        <div class="glf-opacity-header">
                          <span class="glf-opacity-title">边缘宽度</span>
                          <span class="glf-opacity-value">{{
                            Number(
                              visualization.model_dissolve.edge_width || 0.045,
                            ).toFixed(3)
                          }}</span>
                        </div>
                        <el-slider
                          v-model="visualization.model_dissolve.edge_width"
                          :min="0.01"
                          :max="0.16"
                          :step="0.005"
                          size="small"
                          class="glf-opacity-slider" />
                        <div class="glf-opacity-header">
                          <span class="glf-opacity-title">粒子强度</span>
                          <span class="glf-opacity-value">{{
                            Number(
                              visualization.model_dissolve.particle_strength ||
                                1.2,
                            ).toFixed(2)
                          }}</span>
                        </div>
                        <el-slider
                          v-model="
                            visualization.model_dissolve.particle_strength
                          "
                          :min="0"
                          :max="2.5"
                          :step="0.05"
                          size="small"
                          class="glf-opacity-slider" />
                      </div>
                    </div>
                  </el-popover>
                  <button
                    v-if="isVolumeGeneratedLayer(layer)"
                    type="button"
                    class="glf-see-through-btn"
                    :class="{ active: layer.seeThrough === true }"
                    :title="
                      layer.seeThrough === true
                        ? '穿透模式: 可看到建筑内部'
                        : '遮挡模式: 被建筑墙体遮挡（默认）'
                    "
                    @click.stop="
                      layer.seeThrough =
                        layer.seeThrough === false ? true : false
                    ">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                      <circle
                        cx="12"
                        cy="12"
                        r="3"
                        :fill="
                          layer.seeThrough === true ? 'currentColor' : 'none'
                        "
                        stroke="currentColor" />
                    </svg>
                  </button>
                  <!-- 色带 overlay 开关 -->
                  <button
                    v-if="
                      isColorbarGeneratedLayer(layer) && layer.visible !== false
                    "
                    type="button"
                    class="glf-colorbar-btn"
                    :class="{
                      active:
                        colorbarOverlayVisible &&
                        String(selectedColorbarOverlayLayerId) ===
                          String(layer.id),
                    }"
                    :title="
                      colorbarOverlayVisible &&
                      String(selectedColorbarOverlayLayerId) ===
                        String(layer.id)
                        ? '当前色带'
                        : '显示该图层色带'
                    "
                    @click.stop="toggleColorbarOverlay(layer)">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round">
                      <rect x="3" y="4" width="4" height="16" rx="1" />
                      <line x1="10" y1="4" x2="21" y2="4" />
                      <line x1="10" y1="12" x2="21" y2="12" />
                      <line x1="10" y1="20" x2="21" y2="20" />
                      <circle
                        cx="12"
                        cy="4"
                        r="1.5"
                        fill="currentColor"
                        stroke="none" />
                      <circle
                        cx="17"
                        cy="12"
                        r="1.5"
                        fill="currentColor"
                        stroke="none" />
                      <circle
                        cx="12"
                        cy="20"
                        r="1.5"
                        fill="currentColor"
                        stroke="none" />
                    </svg>
                  </button>
                  <el-popover
                    v-if="isVolumeGeneratedLayer(layer)"
                    placement="left"
                    trigger="click"
                    :width="220"
                    popper-class="glf-opacity-popper"
                    @show="refreshIsosurfaceRangeForLayer(layer)">
                    <template #reference>
                      <button
                        type="button"
                        class="glf-iso-btn"
                        :class="{ active: getIsoState(layer.id).enabled }"
                        title="等值面提取"
                        @click.stop>
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round">
                          <ellipse cx="12" cy="12" rx="10" ry="4" />
                          <ellipse cx="12" cy="12" rx="6" ry="2.5" />
                          <ellipse cx="12" cy="12" rx="2" ry="1" />
                        </svg>
                      </button>
                    </template>
                    <div class="glf-opacity-panel" @click.stop>
                      <div class="glf-opacity-header">
                        <span class="glf-opacity-title">等值面提取</span>
                        <el-switch
                          :model-value="getIsoState(layer.id).enabled"
                          size="small"
                          @change="toggleIsosurfaceForLayer(layer)" />
                      </div>
                      <div
                        v-if="getIsoState(layer.id).enabled"
                        style="margin-top: 0.375rem">
                        <div class="glf-opacity-header">
                          <span class="glf-opacity-title">等值面值</span>
                          <span class="glf-opacity-value">{{
                            getIsoDisplayValue(layer.id)
                          }}</span>
                        </div>
                        <el-slider
                          :model-value="getIsoSliderValue(layer.id)"
                          :min="getIsoValueRange(layer.id)[0]"
                          :max="getIsoValueRange(layer.id)[1]"
                          :step="
                            (getIsoValueRange(layer.id)[1] -
                              getIsoValueRange(layer.id)[0]) /
                            100
                          "
                          size="small"
                          class="glf-opacity-slider"
                          @input="
                            (val) =>
                              updateIsosurfaceValueForLayer(layer.id, val)
                          " />
                      </div>
                    </div>
                  </el-popover>
                  <button
                    v-if="isStreamlineGeneratedLayer(layer)"
                    type="button"
                    class="glf-streamline-visibility-btn"
                    :class="{ active: layer.streamlineLineVisible !== false }"
                    :title="
                      layer.streamlineLineVisible === false
                        ? '显示流线'
                        : '隐藏流线'
                    "
                    @click.stop="toggleStreamlineLineVisibility(layer)">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round">
                      <path d="M3 12c3-4 6-4 9 0s6 4 9 0" />
                      <path d="M3 17c3-4 6-4 9 0s6 4 9 0" />
                      <circle
                        cx="7"
                        cy="12"
                        r="1.5"
                        :fill="
                          layer.streamlineLineVisible !== false
                            ? 'currentColor'
                            : 'none'
                        " />
                    </svg>
                  </button>
                  <button
                    v-if="isStreamlineGeneratedLayer(layer)"
                    type="button"
                    class="glf-smoke-btn"
                    :class="{ active: layer.streamlineSmokeEnabled === true }"
                    :title="
                      layer.streamlineSmokeEnabled === true
                        ? '关闭烟雾效果'
                        : '打开烟雾效果'
                    "
                    @click.stop="toggleStreamlineSmoke(layer)">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round">
                      <path
                        d="M4 15c1.6-1.5 3.4-1.5 5.4 0 1.9 1.4 3.8 1.4 5.6 0 1.7-1.4 3.4-1.4 5 0" />
                      <path
                        d="M6 11c1.3-1.1 2.7-1.1 4.1 0 1.5 1.1 3 1.1 4.4 0 1.2-1 2.4-1 3.5 0" />
                      <path
                        d="M8 7c.9-.7 1.8-.7 2.8 0 1 .7 2 .7 3 0 .8-.6 1.6-.6 2.2 0" />
                    </svg>
                  </button>
                  <button
                    v-if="isStreamlineGeneratedLayer(layer)"
                    type="button"
                    class="glf-settings-btn"
                    title="流线图设置"
                    @click.stop="handleOpenStreamlineSettings(layer)">
                    <el-icon><Setting /></el-icon>
                  </button>
                  <button
                    v-if="isParticleGeneratedLayer(layer)"
                    type="button"
                    class="glf-settings-btn"
                    title="粒子参数"
                    @click.stop="handleOpenParticleSettings(layer)">
                    <el-icon><Setting /></el-icon>
                  </button>
                  <button
                    v-if="isMonitoringGeneratedLayer(layer)"
                    type="button"
                    class="glf-focus-btn"
                    title="聚焦监测点"
                    @click.stop="handleMonitoringLayerFocus(layer)">
                    <el-icon><Aim /></el-icon>
                  </button>
                  <!-- <button
                  v-if="isGeneratedLayerPlaneFocusable(layer)"
                  type="button"
                  class="glf-focus-btn"
                  title="聚焦图层"
                  @click.stop="handleGeneratedLayerPlaneFocus(layer)">
                  <el-icon><Aim /></el-icon>
                </button> -->
                  <button
                    v-if="
                      isExclusiveModelGeneratedLayer(layer) &&
                      !isGoafTask(currentTask)
                    "
                    type="button"
                    class="glf-skeleton-btn"
                    :class="{ active: personModelVisible }"
                    :title="
                      personModelVisible ? '隐藏人物模型' : '显示人物模型'
                    "
                    @click.stop="togglePersonModelVisible()">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round">
                      <circle cx="12" cy="5" r="3" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="11" x2="16" y2="11" />
                      <line x1="12" y1="16" x2="8" y2="22" />
                      <line x1="12" y1="16" x2="16" y2="22" />
                    </svg>
                  </button>
                  <button
                    v-if="!isMonitoringGeneratedLayer(layer)"
                    type="button"
                    class="glf-remove-btn"
                    title="从列表移除此图层"
                    @click.stop="handleRemoveGeneratedLayer(layer)">
                    <el-icon><Delete /></el-icon>
                  </button>
                </div>
              </div>
            </div>
            <div v-if="pagedGeneratedVizLayers.length === 0" class="glf-empty">
              当前分页下暂无图层
            </div>
          </div>
        </div>

          <!-- 采空区瓦斯泄漏配置面板 -->
          <GoafGasConfigFloat
            v-if="isGoafTask(currentTask)"
            ref="goafGasConfigFloatRef"
            :player-ref="playerRef"
            :current-task="currentTask" />
        </div>
      </div>

      <!-- 左侧折叠触发 -->
      <div
        v-if="showPanels && leftComponent && leftPanelCollapsed"
        class="side-trigger left-trigger"
        :class="{
          'with-timeline': shouldShowSharedTimeline,
          'timeline-collapsed': isTimelineCollapsed,
        }"
        @click="leftPanelCollapsed = false">
        <el-icon><DArrowRight /></el-icon>
        <span class="trigger-text">{{ leftTitle }}</span>
      </div>

      <!-- 画面色带 overlay（多个体渲染图层用选择框切换） -->
      <div
        v-if="selectedColorbarOverlayLayer && !isRadarEmModule"
        class="viewport-colorbar-overlay"
        :class="{
          'with-right-panel':
            showPanels && rightComponent && !rightPanelCollapsed,
        }">
        <div class="vcbar-item">
          <button
            type="button"
            class="vcbar-close-btn"
            title="关闭色带"
            @click="closeColorbarOverlay">
            &times;
          </button>
          <select
            v-if="colorbarOverlayLayers.length > 1"
            v-model="selectedColorbarOverlayLayerId"
            class="vcbar-layer-select"
            aria-label="选择色带图层"
            @change="handleColorbarLayerSelectChange($event.target.value)">
            <option
              v-for="layer in colorbarOverlayLayers"
              :key="layer.id"
              :value="String(layer.id)">
              {{ resolveVolumeLayerDisplayName(layer) }}
            </option>
          </select>
          <div class="vcbar-title">
            {{ resolveVolumeLayerDisplayName(selectedColorbarOverlayLayer) }}
          </div>
          <div class="vcbar-scale">
            <div
              class="vcbar-gradient"
              :style="
                volumeLayerCmapStyle(selectedColorbarOverlayLayer, 'vertical')
              "
              title="点击添加标记点"
              @pointerdown="
                (event) =>
                  handleVolumeColorbarAddStop(
                    selectedColorbarOverlayLayer,
                    event,
                  )
              "></div>
            <div class="vcbar-stop-markers">
              <div
                v-for="(stop, index) in getVolumeColorbarStops(
                  selectedColorbarOverlayLayer,
                )"
                :key="`${index}:${stop.value}:${stop.bandPosition}`"
                class="vcbar-stop-marker"
                :class="{
                  'is-fixed':
                    index === 0 ||
                    index ===
                      getVolumeColorbarStops(selectedColorbarOverlayLayer)
                        .length -
                        1,
                }"
                :style="{ top: `${(1 - stop.bandPosition) * 100}%` }">
                <button
                  type="button"
                  class="vcbar-stop-dot"
                  :class="{
                    fixed:
                      index === 0 ||
                      index ===
                        getVolumeColorbarStops(selectedColorbarOverlayLayer)
                          .length -
                          1,
                  }"
                  :title="
                    index === 0 ||
                    index ===
                      getVolumeColorbarStops(selectedColorbarOverlayLayer)
                        .length -
                        1
                      ? '拖动调整端点在色带上的位置'
                      : '拖动标记点'
                  "
                  @pointerdown="
                    (event) =>
                      beginVolumeColorStopDrag(
                        selectedColorbarOverlayLayer,
                        index,
                        event,
                      )
                  "></button>
                <el-input
                  class="vcbar-stop-inline-input"
                  :class="{
                    'is-readonly':
                      index === 0 ||
                      index ===
                        getVolumeColorbarStops(selectedColorbarOverlayLayer)
                          .length -
                          1,
                  }"
                  :model-value="
                    getVolumeColorStopInputValue(
                      selectedColorbarOverlayLayer,
                      index,
                    )
                  "
                  :readonly="
                    index === 0 ||
                    index ===
                      getVolumeColorbarStops(selectedColorbarOverlayLayer)
                        .length -
                        1
                  "
                  size="small"
                  inputmode="decimal"
                  @update:model-value="
                    (value) =>
                      index === 0 ||
                      index ===
                        getVolumeColorbarStops(selectedColorbarOverlayLayer)
                          .length -
                          1
                        ? null
                        : updateVolumeColorStopValue(
                            selectedColorbarOverlayLayer,
                            index,
                            value,
                          )
                  "
                  @change="
                    (value) =>
                      index === 0 ||
                      index ===
                        getVolumeColorbarStops(selectedColorbarOverlayLayer)
                          .length -
                          1
                        ? null
                        : commitVolumeColorStopValue(
                            selectedColorbarOverlayLayer,
                            index,
                            value,
                          )
                  " />
                <button
                  v-if="
                    index > 0 &&
                    index <
                      getVolumeColorbarStops(selectedColorbarOverlayLayer)
                        .length -
                        1 &&
                    getVolumeColorbarStops(selectedColorbarOverlayLayer)
                      .length > 2
                  "
                  type="button"
                  class="vcbar-stop-mini-remove"
                  title="删除标记点"
                  @pointerdown.stop
                  @click.stop="
                    removeVolumeColorStop(selectedColorbarOverlayLayer, index)
                  ">
                  ×
                </button>
              </div>
            </div>
            <div class="vcbar-ticks">
              <div
                v-for="tick in volumeColorbarTicks(
                  selectedColorbarOverlayLayer,
                )"
                :key="tick.key"
                class="vcbar-tick"
                :class="{
                  'is-editable': canEditVolumeColorbarRange,
                  'is-min': tick.key === 1,
                  'is-max': tick.key === 0,
                }"
                :style="{ top: tick.top }">
                <span class="vcbar-tick-line"></span>
                <span class="vcbar-tick-label">{{ tick.label }}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            class="vcbar-reset-btn"
            @click="resetVolumeColorbarRange(selectedColorbarOverlayLayer)">
            重置
          </button>
          <button
            v-if="isVolumeGeneratedLayer(selectedColorbarOverlayLayer)"
            type="button"
            class="vcbar-edit-btn"
            @click="openGasVariableConfig(selectedColorbarOverlayLayer)">
            修改色带
          </button>
        </div>
      </div>

      <!-- 右侧浮动面板 -->
      <div
        class="content-right-rail"
        :class="{
          'with-timeline': shouldShowSharedTimeline,
          'timeline-collapsed': isTimelineCollapsed,
        }">
        <!-- 悬浮加载进度 - 固定在右侧面板左下方 -->
        <aside
          v-if="showPanels && rightComponent"
          class="right-panel floating-panel"
          :class="{
            collapsed: rightPanelCollapsed,
            'stats-guide-micro-panel': activeModule === 'statistics',
            'with-timeline': shouldShowSharedTimeline,
            'timeline-collapsed': isTimelineCollapsed,
          }">
          <div class="panel-decoration-tr"></div>
          <div class="panel-decoration-bl"></div>
          <div class="panel-side-line"></div>
          <div class="panel-header">
            <h3>{{ rightTitle }}</h3>
            <div class="header-tools">
              <el-button
                class="collapse-btn"
                link
                @click="rightPanelCollapsed = true">
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="panel-content">
            <VisualizationOptions
              v-if="rightComponent === 'VisualizationOptions'"
              :taskId="currentTask?.id"
              :applying="isApplyingSettings"
              :batch-loading="isBatchLoading"
              :batch-progress="batchLoadProgress"
              :batch-current="batchLoadCurrent"
              :batch-total="batchLoadTotal"
              :loading-text="batchLoadingText"
              v-model:dimension="visualizationDimension"
              v-model:type2d="visualization2DType"
              v-model:type3d="visualization3DType"
              v-model:plane="selectedPlane"
              v-model:coordinate="planeCoordinate"
              v-model:visualization="visualization"
              v-model:visual-domain="visualizationOptionsDomain"
              :pregen-config="currentTask?.pregen_config"
              :previewImage="resolvedPreviewImageFor2D"
              :vmin="displayColorbarVMin"
              :vmax="displayColorbarVMax"
              :rows="previewRows"
              :cols="previewCols"
              :frameCount="previewFrameCount"
              :physical-width="previewPhysicalWidth"
              :physical-height="previewPhysicalHeight"
              :physicalTimes="timelinePhysicalTimes"
              :currentStep="timelineCurrentStep"
              :minTimeStep="
                timelineTimeSteps.length > 0
                  ? Number(timelineTimeSteps[0])
                  : null
              "
              :maxTimeStep="
                timelineTimeSteps.length > 0
                  ? Number(timelineTimeSteps[timelineTimeSteps.length - 1])
                  : null
              "
              :layers="generatedVizLayers"
              :gas-cmaps="visualization.gasCmaps"
              :color-map-catalog="colorMapCatalogItems"
              v-model:selectedLayerId="selectedLayerId"
              @update:currentStep="timelineCurrentStep = $event"
              @apply="applySelectedInputsSettings"
              @start-recognition="handleStartRecognition"
              @reset="resetVisualizationSettings"
              @load-preset="loadVisualizationPreset" />
            <RadarMediumRightPanel
              v-if="rightComponent === 'RadarMediumRightPanel'"
              v-model:radar-viz-mode="radarMediumVizMode"
              v-model:plane="selectedPlane"
              v-model:plane-coordinate="planeCoordinate"
              v-model:radar-emitter="radarEmitterPanelModel"
              :applying="isApplyingSettings"
              :batch-loading="isBatchLoading"
              @apply="handleRadarMediumApplySettings" />
            <MicroMotionResults
              ref="microMotionResultsRef"
              v-if="rightComponent === 'MicroMotionResults'"
              :loading="microMotionLoading"
              :loading-progress="microMotionLoadingProgress"
              :current-task="currentTask"
              @focus-target="handleMicroMotionTargetFocus" />
          </div>
        </aside>
      </div>

      <!-- 右侧折叠触发 -->
      <div
        v-if="showPanels && rightComponent && rightPanelCollapsed"
        class="side-trigger right-trigger"
        :class="{
          'with-timeline': shouldShowSharedTimeline,
          'timeline-collapsed': isTimelineCollapsed,
        }"
        @click="rightPanelCollapsed = false">
        <el-icon><DArrowLeft /></el-icon>
        <span class="trigger-text">{{ rightTitle }}</span>
      </div>

      <!-- 时间轴组件（含 3D 流线图：仿真 time_step 与滑块联动） -->
      <TimelineControl
        v-if="shouldShowSharedTimeline"
        class="viz-guide-timeline"
        :class="{ 'viz-guide-timeline--radar': isRadarEmModule }"
        v-model:currentStep="timelineCurrentStep"
        v-model:speed="visualization.animationSpeed"
        v-model:selectedLayerId="selectedLayerId"
        :totalSteps="timelineTotalSteps"
        :physicalTimes="timelinePhysicalTimes"
        :isPlaying="isTimelinePlaying"
        :isCollapsed="isTimelineCollapsed"
        :disabled="isBatchLoading"
        :layers="generatedVizLayers"
        @play="handleTimelinePlay"
        @pause="handleTimelinePause"
        @stop="handleTimelineStop"
        @seek="handleTimelineSeek"
        @toggle-collapse="handleTimelineToggle" />

      <!-- 右下角更新建筑按钮 -->
      <!-- <div class="update-building-btn-container">
        <el-button
          type="primary"
          class="update-building-btn"
          @click="handleUpdateBuilding">
          更新建筑
        </el-button>
      </div> -->
    </main>

    <el-tour
      v-if="taskGuideVisible"
      class="task-guide-tour"
      v-model="taskGuideVisible"
      :current="taskGuideCurrent"
      :show-arrow="true"
      :type="'primary'"
      :z-index="TASK_GUIDE_Z_INDEX"
      :content-style="taskGuideContentStyle"
      :mask="{ color: 'rgba(3, 10, 24, 0.72)' }"
      @change="handleTaskGuideChange"
      @close="handleTaskGuideClose"
      @finish="handleTaskGuideFinish">
      <template #indicators="{ current, total }">
        <div class="task-guide-indicators">
          <div class="task-guide-dots">
            <span
              v-for="item in total"
              :key="`task-guide-dot-${item}`"
              class="task-guide-dot"
              :class="{ 'is-active': item - 1 === current }"></span>
          </div>
          <span class="task-guide-progress">
            {{ current + 1 }}/{{ total }}
          </span>
        </div>
      </template>
      <el-tour-step
        v-for="(step, idx) in taskGuideSteps"
        :key="`task-guide-${idx}`"
        :title="step.title"
        :description="step.description"
        :placement="step.placement"
        :target="step.target"
        :prev-button-props="step.prevButtonProps"
        :next-button-props="step.nextButtonProps">
        <div class="task-guide-body">
          <div class="task-guide-kicker">任务教程</div>
          <p class="task-guide-description">{{ step.description }}</p>
          <button
            type="button"
            class="task-guide-skip"
            @click="handleTaskGuideSkip">
            跳过教程
          </button>
        </div>
      </el-tour-step>
    </el-tour>

    <!-- 可视化操作教程 -->
    <el-tour
      v-if="vizGuideVisible"
      class="viz-guide-tour"
      v-model="vizGuideVisible"
      :current="vizGuideCurrent"
      :show-arrow="true"
      :type="'primary'"
      :z-index="VIZ_GUIDE_Z_INDEX"
      :content-style="taskGuideContentStyle"
      :mask="{ color: 'rgba(3, 10, 24, 0.72)' }"
      @change="handleVizGuideChange"
      @close="handleVizGuideClose"
      @finish="handleVizGuideFinish">
      <template #indicators="{ current, total }">
        <div class="task-guide-indicators">
          <div class="task-guide-dots">
            <span
              v-for="item in total"
              :key="`viz-guide-dot-${item}`"
              class="task-guide-dot"
              :class="{ 'is-active': item - 1 === current }"></span>
          </div>
          <span class="task-guide-progress">
            {{ current + 1 }}/{{ total }}
          </span>
        </div>
      </template>
      <el-tour-step
        v-for="(step, idx) in vizGuideSteps"
        :key="`viz-guide-${idx}`"
        :title="step.title"
        :description="step.description"
        :placement="step.placement"
        :target="step.target"
        :prev-button-props="step.prevButtonProps"
        :next-button-props="step.nextButtonProps">
        <div class="task-guide-body">
          <div class="task-guide-kicker">可视化教程</div>
          <p class="task-guide-description">{{ step.description }}</p>
          <button
            type="button"
            class="task-guide-skip"
            @click="handleVizGuideSkip">
            跳过教程
          </button>
        </div>
      </el-tour-step>
    </el-tour>

    <!-- 数据统计面板教程 -->
    <el-tour
      v-if="statsGuideVisible"
      class="stats-guide-tour"
      v-model="statsGuideVisible"
      :current="statsGuideCurrent"
      :show-arrow="true"
      :type="'primary'"
      :z-index="STATS_GUIDE_Z_INDEX"
      :content-style="taskGuideContentStyle"
      :mask="{ color: 'rgba(3, 10, 24, 0.72)' }"
      @change="handleStatsGuideChange"
      @close="handleStatsGuideClose"
      @finish="handleStatsGuideFinish">
      <template #indicators="{ current, total }">
        <div class="task-guide-indicators">
          <div class="task-guide-dots">
            <span
              v-for="item in total"
              :key="`stats-guide-dot-${item}`"
              class="task-guide-dot"
              :class="{ 'is-active': item - 1 === current }"></span>
          </div>
          <span class="task-guide-progress">
            {{ current + 1 }}/{{ total }}
          </span>
        </div>
      </template>
      <el-tour-step
        v-for="(step, idx) in statsGuideSteps"
        :key="`stats-guide-${idx}`"
        :title="step.title"
        :description="step.description"
        :placement="step.placement"
        :target="step.target"
        :prev-button-props="step.prevButtonProps"
        :next-button-props="step.nextButtonProps">
        <div class="task-guide-body">
          <div class="task-guide-kicker">数据统计教程</div>
          <p class="task-guide-description">{{ step.description }}</p>
          <button
            type="button"
            class="task-guide-skip"
            @click="handleStatsGuideSkip">
            跳过教程
          </button>
        </div>
      </el-tour-step>
    </el-tour>

    <!-- Worker 选择对话框 -->
    <WorkerSelectDialog
      v-model="workerDialogVisible"
      v-model:selected-worker-id="selectedWorkerId"
      :workers="workers"
      :loading="loadingWorkers"
      :show-runtime-config="true"
      :runtime-config="runtimeConfig"
      @refresh="fetchWorkers"
      @confirm="confirmRunTaskWithRefresh" />

    <GasVariableConfigDialog
      v-model="gasVariableConfigVisible"
      :task-id="currentTask?.id || ''"
      :dimension="visualizationDimension"
      :visualization-type="
        visualizationDimension === '2d'
          ? visualization2DType
          : visualization3DType
      "
      :gas-cmaps="visualization.gasCmaps"
      :color-map-catalog="colorMapCatalogItems"
      :gas-colors="visualization.gasColors"
      :target-variable-id="gasVariableConfigTargetId"
      @update-gas-cmap="handleGasCmapUpdate"
      @update-gas-color="handleGasColorUpdate"
      @color-maps-updated="refreshColorMapCatalog"
      @refresh-color-maps="refreshColorMapCatalog" />

    <!-- 流线图设置对话框 -->
    <StreamlineSettingsDialog
      v-model:visible="streamlineSettingsVisible"
      :layer="streamlineSettingsLayer"
      :visualization="visualization"
      :pregen-config="
        currentTask?.pregen_config || currentTask?.params?.pregen_config
      "
      @apply="handleStreamlineSettingsApply" />

    <el-dialog
      v-model="particleSettingsVisible"
      title="粒子图层参数"
      width="520px"
      append-to-body
      class="worker-dialog particle-settings-dialog"
      @open="ensureParticleSettings">
      <el-form v-if="visualization.particle" label-width="110px" size="small">
        <el-form-item label="发射点">
          <div class="particle-vector-row">
            <el-input-number
              v-model="visualization.particle.emitX"
              :step="0.01"
              :precision="3" />
            <el-input-number
              v-model="visualization.particle.emitY"
              :step="0.01"
              :precision="3" />
            <el-input-number
              v-model="visualization.particle.emitZ"
              :step="0.01"
              :precision="3" />
          </div>
        </el-form-item>
        <el-form-item label="初速度">
          <div class="particle-vector-row">
            <el-input-number
              v-model="visualization.particle.initialVx"
              :step="0.01"
              :precision="3" />
            <el-input-number
              v-model="visualization.particle.initialVy"
              :step="0.01"
              :precision="3" />
            <el-input-number
              v-model="visualization.particle.initialVz"
              :step="0.01"
              :precision="3" />
          </div>
        </el-form-item>
        <el-form-item label="发射速率">
          <el-slider
            v-model="visualization.particle.emitRate"
            :min="0"
            :max="60"
            :step="1"
            show-input />
        </el-form-item>
        <el-form-item label="最大粒子">
          <el-slider
            v-model="visualization.particle.maxParticles"
            :min="100"
            :max="10000"
            :step="100"
            show-input />
        </el-form-item>
        <el-form-item label="寿命范围">
          <div class="particle-vector-row">
            <el-input-number
              v-model="visualization.particle.minLife"
              :min="1"
              :max="3000"
              :step="10" />
            <el-input-number
              v-model="visualization.particle.maxLife"
              :min="1"
              :max="3000"
              :step="10" />
          </div>
        </el-form-item>
        <el-form-item label="速度缩放">
          <el-slider
            v-model="visualization.particle.velocityScale"
            :min="0"
            :max="1000"
            :step="10"
            show-input />
        </el-form-item>
        <el-form-item label="流场影响">
          <el-slider
            v-model="visualization.particle.fieldInfluence"
            :min="0"
            :max="1"
            :step="0.01"
            show-input />
        </el-form-item>
        <el-form-item label="扰动强度">
          <el-slider
            v-model="visualization.particle.turbulenceStrength"
            :min="0"
            :max="0.02"
            :step="0.0001"
            show-input />
        </el-form-item>
        <el-form-item label="扰动平滑">
          <el-slider
            v-model="visualization.particle.turbulenceSmoothing"
            :min="0"
            :max="1"
            :step="0.01"
            show-input />
        </el-form-item>
        <el-form-item label="粒子大小">
          <el-slider
            v-model="visualization.particle.pointSize"
            :min="0.5"
            :max="12"
            :step="0.5"
            show-input />
        </el-form-item>
        <el-form-item label="拖尾">
          <div class="particle-vector-row">
            <el-switch v-model="visualization.particle.showTrails" />
            <el-input-number
              v-model="visualization.particle.trailLength"
              :min="2"
              :max="120"
              :step="2" />
          </div>
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker
            v-model="visualization.particle.color"
            color-format="hex"
            :show-alpha="false" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="particleSettingsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 后端地址配置弹窗 (F2) -->
    <el-dialog
      v-model="baseUrlDialogVisible"
      title="后端地址配置"
      width="480px"
      append-to-body
      class="worker-dialog">
      <el-form label-width="80px" size="default">
        <el-form-item label="Base URL">
          <el-input
            v-model="baseUrlInput"
            placeholder="例如 http://192.168.1.100/api"
            clearable
            @keyup.enter="applyBaseUrl" />
        </el-form-item>
        <div style="color: #909399; font-size: 12px; margin-top: -8px">
          当前: {{ baseUrlInput }}
        </div>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="baseUrlDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="applyBaseUrl">应用</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 图层右键菜单：per-mesh 透明度调节 -->
    <div
      v-if="layerContextMenu.visible"
      class="layer-context-menu"
      :style="{
        left: `${layerContextMenu.x}px`,
        top: `${layerContextMenu.y}px`,
      }"
      @pointerdown.stop
      @wheel.stop>
      <div class="layer-context-menu-header">
        <span class="layer-context-menu-title">
          {{ layerContextMenu.layer?.label || '模型' }} - 部件透明度
        </span>
        <button
          v-if="contextMenuMeshList.some((m) => m.opacity !== null)"
          type="button"
          class="layer-context-menu-reset-all"
          @click="onContextMenuResetAll">
          全部重置
        </button>
      </div>
      <div class="layer-context-menu-list">
        <div
          v-for="mesh in contextMenuMeshList"
          :key="mesh.name"
          class="layer-context-menu-item">
          <div class="layer-context-menu-item-label" :title="mesh.name">
            {{ mesh.name }}
          </div>
          <div class="layer-context-menu-item-controls">
            <el-slider
              :model-value="mesh.opacity ?? 1"
              :min="0"
              :max="1"
              :step="0.05"
              size="small"
              class="layer-context-menu-slider"
              @input="
                (val) => {
                  mesh.opacity = val
                  onContextMenuMeshOpacityChange(mesh)
                }
              " />
            <span class="layer-context-menu-value">
              {{
                mesh.opacity !== null
                  ? `${Math.round(mesh.opacity * 100)}%`
                  : '全局'
              }}
            </span>
            <button
              v-if="mesh.opacity !== null"
              type="button"
              class="layer-context-menu-reset"
              title="恢复全局透明度"
              @click="onContextMenuMeshReset(mesh)">
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss" src="@/assets/styles/HomeView.scss"></style>
