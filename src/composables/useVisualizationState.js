import { ref, computed } from 'vue'

/**
 * 可视化核心状态 composable
 * 
 * 集中管理所有可视化相关的响应式状态，替代原来散落在 HomeView.vue 中的 33 个独立 ref。
 * 通过 provide/inject 供子组件直接访问，消除 props drilling。
 * 
 * 使用方式:
 *   父组件: const vizState = useVisualizationState(); provide('vizState', vizState)
 *   子组件: const vizState = inject('vizState')
 */
export function useVisualizationState() {
  // ── 模式选择 ──
  const visualizationDimension = ref('2d')         // '2d' | '3d'
  const visualization2DType = ref('cloud')         // 'cloud' | 'vector'
  const visualization3DType = ref('volume')         // 'volume' | 'streamline'
  const selectedPlane = ref('xy')                   // 'xy' | 'xz' | 'yz'
  const planeCoordinate = ref(0)

  // ── 核心可视化配置 ──
  const visualization = ref({
    colorScheme: 'default',
    variable: '',
    transparency: 100,
    resolution: 'medium',
    volume_resolution: 64,
    volume_res_mode: 'resolution',
    volume_render_mode: 'raymarch',
    useMockVolumeData: false,
    model_opacity: 0.35,
    real_model_opacity: 1,
    meeting_room_gaussian_scale: 1,
    meeting_room_gaussian_box_visible: true,
    person_model_opacity: 1,
    person_real_model_opacity: 1,
    model_display_mode: 'solid', // 'solid' | 'wireframe' | 'edges'
    model_dissolve: {
      enabled: true,
      duration: 1.5,
      edge_width: 0.045,
      particle_strength: 1.2,
      color: '#72ff66',
    },
    testVolumeCsvUrl: '',
    sampling_ratio: 1,
    density_scale: 100,
    step_count: 128,
    volume_raymarch_steps: 160,
    /** 0~1：稀疏区域沿射线加大步长，提升性能并略减空洞区采样 */
    volume_raymarch_ess: 0.55,
    volume_raymarch_opacity: 0.1,
      animationSpeed: 24,
    layers: ['temperature', 'humidity'],
    customColormap: '',
    manualColors: ['#3b4cc0', '#dddddd', '#b40426'],
    startTimeStep: null,
    endTimeStep: null,
    vmin: null,
    vmax: null,
    autoRange: true,
    vectorColor: '#ffffff',
    quality_preset: '1k',
    transparent_background: true,
    glyph_density: 4,
    vectorLineWidth: 1,
    usePregen: true,
    gasColors: {},
    gasCmaps: {},
    volume_variables: [],
    cloud_variables: [],
    /** 可视化设置雷达类型（多选），与 constants/radarFrequencies.js 中 id 对应 */
    radar_frequencies: [],
    /** 雷达结果可视化模式，独立于气体云图/矢量图/体渲染/流线图模式 */
    radar_result_mode: 'wavefront',
    /** 波前传播动画输出维度：二维平面云图与三维空间波前可叠加 */
    radar_wavefront_dimensions: ['3d'],
    /** 介质衰减 / 雷达波：三维发射点（与监测点等同类型长度单位，默认 cm） */
    radar_emitter: { x: 0, y: 0, z: 0 },
    /** 雷达能量轨迹线配置，独立于气体流线图 streamline 配置 */
    radar_trails: {
      seed_count: 28,
      points_per_streamline: 36,
      line_width: 0.38,
      display_time: 5,
      color: '#ff3b30',
    },
    volume_csv: {
      enable_frame_memory_cache: false,
      frame_memory_cache_max_frames: 1,
      enable_prefetch: false,
      prefetch_ahead_frames: 0,
      prefetch_max_concurrent_requests: 1,
      warmup_prefetch_frames_at_init: 0,
      prefetch_all_frames_at_init: false,
      preserve_csv_cache_on_reinit: false,
    },
    streamline: {
      time_step: 0,
      seed_count: 50,
      points_per_streamline: 40,
      line_width: 0.38,
      display_time: 5,
      color: '#ff3b30',
    },
  })

  // ── 预览状态 ──
  const previewImageUrl = ref('')
  const previewVMin = ref(0)
  const previewVMax = ref(0)
  const previewRows = ref(1)
  const previewCols = ref(1)
  const previewFrameCount = ref(0)
  const previewPhysicalWidth = ref(null)
  const previewPhysicalHeight = ref(null)
  const previewGeometricCenter = ref([0, 0, 0])

  const displayColorbarVMin = computed(() => {
    const user = Number(visualization.value?.vmin)
    if (Number.isFinite(user)) return user
    return Number.isFinite(Number(previewVMin.value)) ? Number(previewVMin.value) : 0
  })

  const displayColorbarVMax = computed(() => {
    const user = Number(visualization.value?.vmax)
    if (Number.isFinite(user)) return user
    return Number.isFinite(Number(previewVMax.value)) ? Number(previewVMax.value) : 0
  })

  // ── 批量加载进度 ──
  const isBatchLoading = ref(false)
  const batchLoadingText = ref('批量加载中...')
  const batchLoadProgress = ref(0)
  const batchLoadCurrent = ref(0)
  const batchLoadTotal = ref(0)
  const batchLoadedImages = ref([])

  // ── 步数与时间轴 ──
  const timelineCurrentStep = ref(0)
  const timelineTimeSteps = ref([])
  const timelinePhysicalTimes = ref([])
  const timelineTotalSteps = ref(0)
  const postProcessingTimeStepsTaskId = ref(null)
  const isTimelinePlaying = ref(false)

  // ── 应用状态 ──
  const isApplyingSettings = ref(false)
  const selectedLayerId = ref(null)
  const hasAppliedSettings = ref(false)
  const isTimelineCollapsed = ref(true)



  function findLoadedImageByTimeStep(rawStep, layers = []) {
    const list = batchLoadedImages.value
    const n = Number(rawStep)
    
    if (!list?.length && !layers?.length) return undefined
    if (list?.length) {
      if (Number.isFinite(n)) {
        const hit = list.find(img => Number(img.time_step) === n)
        if (hit) return hit
      }
      const fallback = list.find(img => img.time_step === rawStep)
      if (fallback) return fallback
    }
    for (const layer of layers) {
      
      if (!layer?.images?.length) continue
      if (Number.isFinite(n)) {
        const layerHit = layer.images.find(img => Number(img.time_step) === n)
        if (layerHit) return layerHit
      }
      const layerFallback = layer.images.find(img => img.time_step === rawStep)
      if (layerFallback) return layerFallback
    }
    return undefined
  }

  function findLoadedImageByLayerAndTimeStep(layerId, rawStep, layers = []) {
    if (layerId == null || layerId === '') return findLoadedImageByTimeStep(rawStep, layers)
    const list = batchLoadedImages.value
    const sid = String(layerId)
    const n = Number(rawStep)
    if (list?.length) {
      const scoped = list.filter(
        (img) => String(img.layerId ?? img.layer_id ?? '') === sid,
      )
      if (scoped.length) {
        if (Number.isFinite(n)) {
          const hit = scoped.find((img) => Number(img.time_step) === n)
          if (hit) return hit
        }
        const fallback = scoped.find((img) => img.time_step === rawStep)
        if (fallback) return fallback
      }
    }
    const targetLayer = layers.find(l => String(l.id) === sid)
    if (targetLayer?.images?.length) {
      if (Number.isFinite(n)) {
        const hit = targetLayer.images.find((img) => Number(img.time_step) === n)
        if (hit) return hit
      }
      const fallback = targetLayer.images.find((img) => img.time_step === rawStep)
      if (fallback) return fallback
    }
    return undefined
  }

  /** 预览用 URL：优先 PNG，否则 SVG */
  function displayUrlForCachedFrame(img) {
    if (!img) return ''
    const u = img.png_url || img.url || img.svg_url
    return typeof u === 'string' ? u.replace(/[`\s]/g, '') : ''
  }

  /** 云图 contour 请求的变量 id 列表 */
  function listCloudContourVariableIds() {
    const cv = visualization.value.cloud_variables
    if (Array.isArray(cv) && cv.length > 0 && visualization2DType.value === 'cloud') {
      return [...new Set(cv.map(x => String(x)))]
    }
    const v = visualization.value.variable
    if (v != null && String(v).trim() !== '') return [String(v).trim()]
    return ['VelocityMagnitude']
  }

  /** 当前 batchLoadedImages 是否已覆盖给定仿真时间步列表 */
  function timelineStepsFullyCached(steps, layers = []) {
    if (!Array.isArray(steps) || steps.length <= 1) return true
    const cached = new Set(batchLoadedImages.value.map(img => Number(img.time_step)))
    for (const layer of Array.isArray(layers) ? layers : []) {
      if (!Array.isArray(layer?.images)) continue
      layer.images.forEach((img) => {
        const step = Number(img?.time_step)
        if (Number.isFinite(step)) cached.add(step)
      })
    }
    return steps.every(t => cached.has(Number(t)))
  }

  return {
    // 模式
    visualizationDimension,
    visualization2DType,
    visualization3DType,
    selectedPlane,
    planeCoordinate,

    // 核心配置
    visualization,

    // 预览
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

    // 批量加载
    isBatchLoading,
    batchLoadingText,
    batchLoadProgress,
    batchLoadCurrent,
    batchLoadTotal,
    batchLoadedImages,

    // 应用
    isApplyingSettings,
    selectedLayerId,
    hasAppliedSettings,
    isTimelineCollapsed,

    // 步数与时间轴
    timelineCurrentStep,
    timelineTimeSteps,
    timelinePhysicalTimes,
    timelineTotalSteps,
    postProcessingTimeStepsTaskId,
    isTimelinePlaying,


    // 工具函数
    findLoadedImageByTimeStep,
    findLoadedImageByLayerAndTimeStep,
    displayUrlForCachedFrame,
    listCloudContourVariableIds,
    timelineStepsFullyCached,

  }
}

/** provide/inject key */
export const VIZ_STATE_KEY = 'vizState'
