<script setup>
import { computed, ref, watch, onUnmounted, nextTick } from 'vue'
import { Close, Download, VideoPlay, VideoPause, DArrowLeft, DArrowRight } from '@element-plus/icons-vue'
import { downloadSvgAsPng } from '@/utils/svgToPng'
import { formatTimelineRange } from '@/utils/timelineLabel'
import { ElMessage } from 'element-plus'
import { useTaskStore } from '@/stores/task.js'
import { postProcessingApi } from '@/api'
import {
  resolveColormapColors,
} from '@/utils/volumeColormap'

// 初始化 task store
const taskStore = useTaskStore()

const props = defineProps({
  url: {
    type: String,
    required: true,
  },
  visible: {
    type: Boolean,
    default: false,
  },
  rows: {
    type: Number,
    default: 1,
  },
  cols: {
    type: Number,
    default: 1,
  },
  currentStep: {
    type: Number,
    default: 0,
  },
  frameCount: {
    type: Number,
    default: 1,
  },
  physicalWidth: {
    type: Number,
    default: null,
  },
  physicalHeight: {
    type: Number,
    default: null,
  },
  physicalTimes: {
    type: Array,
    default: () => [],
  },
  vmin: {
    type: Number,
    default: 0,
  },
  vmax: {
    type: Number,
    default: 100,
  },
  cmap: {
    type: String,
    default: 'coolwarm',
  },
  variable: {
    type: String,
    default: '',
  },
  showColorbar: {
    type: Boolean,
    default: true,
  },
  /**
   * 多图层数据（每个图层含 images/physicalTimes/vmin/vmax/cmap/opacity/blendMode/visible）
   * 若传入非空数组，则启用多图层叠加模式
   */
  layers: {
    type: Array,
    default: () => [],
  },
  /**
   * 当前选中要单独查看的图层 id（为 null 表示叠加所有可见图层）
   */
  selectedLayerId: {
    type: String,
    default: null,
  },
  /** 变量→色带方案映射，与气体色带配置弹窗一致 */
  gasCmaps: {
    type: Object,
    default: () => ({}),
  },
  /** 接口色带目录 items（GET /api/v1/color-maps/） */
  colorMapCatalog: {
    type: Array,
    default: () => [],
  },
  /** 任务 ID（用于调用 plane-variable-bounds 接口） */
  taskId: {
    type: String,
    default: '',
  },
  /** 切片平面类型 (xy/xz/yz) */
  plane: {
    type: String,
    default: '',
  },
  /** 切片平面偏移 */
  planeOffset: {
    type: Number,
    default: null,
  },
})

const emit = defineEmits(['update:currentStep', 'update:selectedLayerId', 'close'])

// 与外部时间轴同步：用 currentStep 作为唯一数据源，预览内操作时向外 emit
const clampFrame = (value) =>
  Math.max(0, Math.min((props.frameCount || 1) - 1, value))

// 动画控制
const isPlaying = ref(false)
const currentFrame = ref(0)
const playbackSpeed = ref(1) // 播放速度 1x, 2x, 3x 等
const zoomScale = ref(1)
const MIN_ZOOM = 0.5
const MAX_ZOOM = 6
// 用 setTimeout 做帧调度，切速时只重算“下一次触发”，减少闪烁
const animationInterval = ref(null) // 实际存 timeoutId
const lastTickAt = ref(0)
const lastScheduledDelay = ref(1000)
const activeImageUrl = ref('')
const pendingImageUrl = ref('')
const sourceImageWidth = ref(0)
const sourceImageHeight = ref(0)

const spriteContainerRef = ref(null)
const fitW = ref(0)
const fitH = ref(0)
let spriteResizeObserver = null

/** 单帧宽高比 width / height（优先接口物理尺寸） */
function getFrameAspectRatio() {
  const pw = Number(props.physicalWidth)
  const ph = Number(props.physicalHeight)
  if (Number.isFinite(pw) && Number.isFinite(ph) && pw > 0 && ph > 0) {
    return pw / ph
  }
  const fullW = Number(sourceImageWidth.value)
  const fullH = Number(sourceImageHeight.value)
  const frameW =
    Number.isFinite(fullW) && fullW > 0 && props.cols > 0
      ? fullW / props.cols
      : 1
  const frameH =
    Number.isFinite(fullH) && fullH > 0 && props.rows > 0
      ? fullH / props.rows
      : 1
  return frameW > 0 && frameH > 0 ? frameW / frameH : 1
}

function updateSpriteFit() {
  const el = spriteContainerRef.value
  if (!el || !props.visible) return
  const cw = el.clientWidth
  const ch = el.clientHeight
  if (cw < 2 || ch < 2) return
  const ar = getFrameAspectRatio()
  if (!Number.isFinite(ar) || ar <= 0) return
  let w = cw
  let h = w / ar
  if (h > ch) {
    h = ch
    w = h * ar
  }
  fitW.value = w
  fitH.value = h
}

function detachSpriteResizeObserver() {
  if (spriteResizeObserver) {
    spriteResizeObserver.disconnect()
    spriteResizeObserver = null
  }
}

function attachSpriteResizeObserver() {
  detachSpriteResizeObserver()
  const el = spriteContainerRef.value
  if (!el) return
  spriteResizeObserver = new ResizeObserver(() => updateSpriteFit())
  spriteResizeObserver.observe(el)
}

// 计算播放间隔（毫秒）
const getPlaybackInterval = () => {
  // playbackSpeed 可能来自 UI 选项，理论上是 number，但这里做下保护
  const sp = Number(playbackSpeed.value)
  if (!Number.isFinite(sp) || sp <= 0) return 1000
  return 1000 / sp // 1秒/速度
}

const clearPlaybackTimer = () => {
  if (animationInterval.value != null) {
    clearTimeout(animationInterval.value)
    animationInterval.value = null
  }
}

const scheduleNextTick = (delayMs) => {
  if (!isPlaying.value || props.frameCount <= 1) return
  const d = Number.isFinite(delayMs) ? delayMs : getPlaybackInterval()
  const clamped = Math.max(0, d)
  lastScheduledDelay.value = clamped

  animationInterval.value = setTimeout(() => {
    const next = (currentFrame.value + 1) % props.frameCount
    currentFrame.value = next
    emit('update:currentStep', next)
    lastTickAt.value = Date.now()
    scheduleNextTick()
  }, clamped)
}

// 开始播放
const startPlayback = () => {
  if (props.frameCount <= 1) return

  isPlaying.value = true
  clearPlaybackTimer() // 确保没有旧的定时器在运行
  lastTickAt.value = Date.now()
  scheduleNextTick()
}

// 播放过程中切换速度：重建定时器以立即生效
watch(playbackSpeed, () => {
  // 用定时器存在与否作为准入条件，更抗“isPlaying 状态不同步”的情况
  if (!animationInterval.value) return

  // 尽量平滑：用“已经过去的比例”去缩放下一次触发剩余时间
  const now = Date.now()
  const elapsed = now - lastTickAt.value
  const oldDelay = lastScheduledDelay.value || getPlaybackInterval()
  const fraction = oldDelay > 0 ? Math.min(1, Math.max(0, elapsed / oldDelay)) : 0

  const newDelay = getPlaybackInterval()
  const remaining = Math.max(0, (1 - fraction) * newDelay)

  clearPlaybackTimer()
  scheduleNextTick(remaining)
})

// 停止播放
const stopPlayback = () => {
  clearPlaybackTimer()
  isPlaying.value = false
}

// 切换播放/暂停
const togglePlayPause = () => {
  if (isPlaying.value) {
    stopPlayback()
  } else {
    startPlayback()
  }
}

const handleSpriteWheel = (evt) => {
  const delta = evt.deltaY
  const factor = delta < 0 ? 1.1 : 0.9
  const next = zoomScale.value * factor
  zoomScale.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
}

// 跳转到指定帧（并同步到外部时间轴）
const jumpToFrame = (index) => {
  const next = clampFrame(index)
  currentFrame.value = next
  emit('update:currentStep', next)
}

// 前一帧
const previousFrame = () => {
  const next =
    (currentFrame.value - 1 + props.frameCount) % props.frameCount
  currentFrame.value = next
  emit('update:currentStep', next)
}

// 后一帧
const nextFrame = () => {
  const next = (currentFrame.value + 1) % props.frameCount
  currentFrame.value = next
  emit('update:currentStep', next)
}

const frameInfoText = computed(() => {
  const count = Number(props.frameCount) || 0
  if (count <= 0) return '0 / 0'
  const idx = clampFrame(currentFrame.value)
  return formatTimelineRange(idx, Math.max(0, count - 1), props.physicalTimes)
})

const colorbarTitleText = computed(() => {
  const raw = typeof props.variable === 'string' ? props.variable.trim() : ''
  if (!raw) return '数值'
  const lower = raw.toLowerCase()
  const prefix = 'mass_fraction_of_'
  if (lower.startsWith(prefix)) {
    const gas = raw.slice(prefix.length)
    return gas || raw
  }
  return raw
})

// 外部时间轴或初始打开时，同步到预览内当前帧
watch(
  () => [props.visible, props.currentStep, props.frameCount],
  () => {
    // 播放时以本地 currentFrame 为准，避免被外部 timeline 同步覆盖
    if (props.visible && props.frameCount > 0 && !isPlaying.value) {
      currentFrame.value = clampFrame(props.currentStep)
    }
  },
  { immediate: true },
)

// 切换图片 URL 时先预加载，加载完成后再替换显示，减少闪烁
watch(
  () => props.url,
  (newUrl) => {
    const clean = typeof newUrl === 'string' ? newUrl.replace(/[`\s]/g, '') : ''
    if (!clean) {
      activeImageUrl.value = ''
      pendingImageUrl.value = ''
      return
    }
    if (clean === activeImageUrl.value) return

    pendingImageUrl.value = clean
    const img = new Image()
    img.onload = () => {
      if (pendingImageUrl.value === clean) {
        sourceImageWidth.value = img.naturalWidth || img.width || 0
        sourceImageHeight.value = img.naturalHeight || img.height || 0
        activeImageUrl.value = clean
        nextTick(() => updateSpriteFit())
      }
    }
    img.onerror = () => {
      // 兜底：至少保证有图可显示
      if (!activeImageUrl.value) activeImageUrl.value = clean
    }
    img.src = clean
  },
  { immediate: true },
)

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      zoomScale.value = 1
      await nextTick()
      await nextTick()
      attachSpriteResizeObserver()
      updateSpriteFit()
    } else {
      detachSpriteResizeObserver()
      fitW.value = 0
      fitH.value = 0
    }
  },
)

watch(
  () => [
    props.physicalWidth,
    props.physicalHeight,
    sourceImageWidth.value,
    sourceImageHeight.value,
    props.rows,
    props.cols,
    props.visible,
  ],
  () => {
    if (props.visible) nextTick(() => updateSpriteFit())
  },
)

// 组件卸载时清理定时器
onUnmounted(() => {
  stopPlayback()
  detachSpriteResizeObserver()
})

// ── 从 plane-variable-bounds 接口获取变量范围 ──
const variableBoundsMap = ref({}) // { variableName: { vmin, vmax } }

const normalizeLookupKey = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()

async function fetchVariableBounds() {
  if (!props.taskId || !props.plane || !Number.isFinite(props.planeOffset)) return
  try {
    const response = await postProcessingApi.getPlaneVariableBounds({
      task_id: props.taskId,
      plane_type: props.plane.toUpperCase(),
      plane_offset: props.planeOffset,
      use_pregen: true,
    })
    const data = response?.data || response
    const bounds = data?.variable_bounds || []
    const map = {}
    bounds.forEach((vb) => {
      const vmin = Number(vb?.vmin)
      const vmax = Number(vb?.vmax)
      if (vb?.variable && Number.isFinite(vmin) && Number.isFinite(vmax)) {
        map[vb.variable] = { vmin, vmax }
      }
    })
    variableBoundsMap.value = map
  } catch (e) {
    console.warn('[SpriteImageViewer] fetchVariableBounds failed:', e)
  }
}

watch(
  () => [props.visible, props.taskId, props.plane, props.planeOffset],
  () => {
    if (props.visible) fetchVariableBounds()
  },
  { immediate: true },
)

// 从 store 获取实际的变量范围
const actualRange = computed(() => {
  if (!props.variable) return null
  return taskStore.getVariableRange(props.variable)
})

/** 从接口获取的变量范围 */
const apiVariableRange = computed(() => {
  if (!props.variable) return null
  return lookupVariableBounds(props.variable)
})

function lookupVariableBounds(variableId) {
  if (!variableId) return null
  const direct = variableBoundsMap.value[variableId]
  if (direct) return direct
  const target = normalizeLookupKey(variableId)
  for (const [key, range] of Object.entries(variableBoundsMap.value)) {
    if (normalizeLookupKey(key) === target) return range
  }
  return null
}

const displayVMin = computed(() => {
  // 优先使用 API 返回的范围
  const apiRange = apiVariableRange.value
  if (apiRange && Number.isFinite(apiRange.vmin)) return apiRange.vmin
  return Number.isFinite(props.vmin) ? props.vmin : 0
})

const displayVMax = computed(() => {
  const apiRange = apiVariableRange.value
  if (apiRange && Number.isFinite(apiRange.vmax)) return apiRange.vmax
  return Number.isFinite(props.vmax) ? props.vmax : 0
})

// 显示范围来源信息
const rangeSource = computed(() => {
  if (!actualRange.value) return 'API返回'

  const eps = 1e-8
  const vminMeta = actualRange.value?.vmin ?? 0
  const vmaxMeta = actualRange.value?.vmax ?? 0
  const vminSame = Math.abs(vminMeta - props.vmin) <= eps
  const vmaxSame = Math.abs(vmaxMeta - props.vmax) <= eps

  return vminSame && vmaxSame ? '元数据' : '参数'
})

const handleClose = () => {
  stopPlayback()
  emit('close')
}

// 下载PNG功能
const downloading = ref(false)

const handleDownloadPng = async () => {
  if (!props.url) {
    ElMessage.warning('没有可下载的图片')
    return
  }

  downloading.value = true
  try {
    // 生成文件名（不要使用 URL 本身）
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)
    const safeVar =
      typeof props.variable === 'string' && props.variable.trim()
        ? props.variable.trim().replace(/[^\w.-]+/g, '_')
        : 'preview'
    const baseName = `${safeVar}_${timestamp}`

    // 判断是否为SVG
    const isSvg =
      props.url.toLowerCase().includes('.svg') ||
      props.url.toLowerCase().includes('svg')

    if (isSvg) {
      // SVG转PNG下载
      await downloadSvgAsPng(props.url, baseName, {
        scale: 2, // 2倍分辨率
        backgroundColor: 'white',
      })
      ElMessage.success('PNG下载成功')
    } else {
      // 非 SVG：拉取为 Blob 后下载，避免跳转打开新页面
      const resp = await fetch(props.url, { mode: 'cors' })
      if (!resp.ok) {
        throw new Error(`下载失败（HTTP ${resp.status}）`)
      }
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      const ext =
        blob.type && blob.type.includes('jpeg')
          ? 'jpg'
          : blob.type && blob.type.includes('webp')
            ? 'webp'
            : blob.type && blob.type.includes('gif')
              ? 'gif'
              : 'png'
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `${baseName}.${ext}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
      ElMessage.success('图片下载成功')
    }
  } catch (error) {
    console.error('下载失败:', error)
    ElMessage.error('下载失败: ' + (error?.message || '未知错误'))
  } finally {
    downloading.value = false
  }
}

// 计算精灵图样式
const spriteStyle = computed(() => {
  if (!activeImageUrl.value || !props.rows || !props.cols) return {}

  // 确定当前显示的帧索引
  let frameIndex = 0
  if (props.frameCount > 0) {
    if (isPlaying.value) {
      frameIndex = currentFrame.value % props.frameCount
    } else {
      // 如果没有播放，显示传入的 currentStep
      frameIndex = props.currentStep % props.frameCount
    }
  }

  const row = Math.floor(frameIndex / props.cols)
  const col = frameIndex % props.cols

  // 计算百分比位置
  const xPercent = props.cols > 1 ? (col / (props.cols - 1)) * 100 : 0
  const yPercent = props.rows > 1 ? (row / (props.rows - 1)) * 100 : 0

  // 预览按单帧原始比例显示，避免被容器拉伸导致和下载图比例不一致
  const fullW = Number(sourceImageWidth.value)
  const fullH = Number(sourceImageHeight.value)
  const frameW =
    Number.isFinite(fullW) && fullW > 0 && props.cols > 0
      ? fullW / props.cols
      : 1
  const frameH =
    Number.isFinite(fullH) && fullH > 0 && props.rows > 0
      ? fullH / props.rows
      : 1
  const pixelAspect = frameW > 0 && frameH > 0 ? frameW / frameH : 1
  const pw = Number(props.physicalWidth)
  const ph = Number(props.physicalHeight)
  const physicalAspect =
    Number.isFinite(pw) && Number.isFinite(ph) && pw > 0 && ph > 0
      ? pw / ph
      : null
  const frameAspect = physicalAspect ?? pixelAspect
  const aspectCss =
    physicalAspect != null
      ? `${pw} / ${ph}`
      : String(frameAspect)

  const base = {
    backgroundImage: `url(${activeImageUrl.value})`,
    backgroundSize: `${props.cols * 100}% ${props.rows * 100}%`,
    backgroundPosition: `${xPercent}% ${yPercent}%`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    transform: `scale(${zoomScale.value})`,
    transformOrigin: 'center center',
  }

  const w = fitW.value
  const h = fitH.value
  if (w >= 1 && h >= 1) {
    return {
      ...base,
      width: `${w}px`,
      height: `${h}px`,
    }
  }

  // 尚未完成容器测量：禁止 width:100% 撑满，仅用 aspect-ratio 在 flex 内占位
  return {
    ...base,
    width: 'auto',
    height: 'auto',
    maxWidth: '100%',
    maxHeight: '100%',
    aspectRatio: aspectCss,
  }
})

// 生成色带渐变
const colorbarGradient = computed(() => {
  // 尝试从 gasCmaps + colorMapCatalog 解析色带
  const resolvedColors = resolveVariableCmapColors(props.variable)
  if (resolvedColors) return colorsToVerticalGradient(resolvedColors)

  // 根据不同的 cmap 生成对应的渐变
  const cmapGradients = {
    coolwarm:
      'linear-gradient(to top, #3b4cc0, #7396f5, #b4d7f5, #f4d9d0, #dd7373, #b40426)',
    hot: 'linear-gradient(to top, #000000, #ff0000, #ffff00, #ffffff)',
    viridis: 'linear-gradient(to top, #440154, #31688e, #35b779, #fde724)',
    jet: 'linear-gradient(to top, #000080, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000, #800000)',
    gray: 'linear-gradient(to top, #000000, #ffffff)',
    plasma:
      'linear-gradient(to top, #0d0887, #7e03a8, #cc4778, #f89540, #f0f921)',
    inferno:
      'linear-gradient(to top, #000004, #420a68, #932667, #dd513a, #fca50a, #fcffa4)',
    magma:
      'linear-gradient(to top, #000004, #3b0f70, #8c2981, #de4968, #fe9f6d, #fcfdbf)',
  }

  return cmapGradients[props.cmap] || cmapGradients.coolwarm
})

/** 颜色数组 → 竖直色带渐变 (to top) */
function colorsToVerticalGradient(colors) {
  if (!Array.isArray(colors) || colors.length === 0) return ''
  if (colors.length === 1) {
    return `linear-gradient(to top, ${colors[0]}, ${colors[0]})`
  }
  const parts = colors.map((c, i) => {
    const pct = (i / (colors.length - 1)) * 100
    return `${c} ${pct}%`
  })
  return `linear-gradient(to top, ${parts.join(', ')})`
}

/** 从 gasCmaps + colorMapCatalog 解析指定变量的色带颜色数组 */
function resolveVariableCmapColors(variableId) {
  if (!variableId || !props.gasCmaps) return null
  // 大小写不敏感查找 gasCmaps
  const scheme = lookupGasScheme(props.gasCmaps, variableId)
  if (!scheme) return null
  const colors = resolveColormapColors(scheme, null, props.colorMapCatalog)
  return Array.isArray(colors) && colors.length > 0 ? colors : null
}

/** 大小写不敏感查找 gasCmaps */
function lookupGasScheme(gasCmaps, variableId) {
  if (!gasCmaps || !variableId) return undefined
  if (gasCmaps[variableId] != null && String(gasCmaps[variableId]).trim() !== '') {
    return gasCmaps[variableId]
  }
  const lowerId = String(variableId).toLowerCase()
  for (const [key, value] of Object.entries(gasCmaps)) {
    if (String(key).toLowerCase() === lowerId && value != null && String(value).trim() !== '') {
      return value
    }
  }
  return undefined
}

const formatNumericLabel = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const normalized = Math.abs(n) < 1e-14 ? 0 : n
  const abs = Math.abs(normalized)
  if (abs === 0) return '0'
  if (abs < 0.001) return normalized.toExponential(2)
  if (abs >= 1000) return normalized.toExponential(2)
  if (abs >= 1) return normalized.toFixed(2)
  if (abs >= 0.1) return normalized.toFixed(3)
  if (abs >= 0.01) return normalized.toFixed(4)
  return normalized.toFixed(5)
}

// 生成刻度标签
const colorbarTicks = computed(() => {
  const range = displayVMax.value - displayVMin.value
  const ticks = []
  const tickCount = 5 // 显示5个刻度

  for (let i = 0; i < tickCount; i++) {
    const value = displayVMin.value + (range * i) / (tickCount - 1)
    const position = (i / (tickCount - 1)) * 100
    ticks.push({
      value: formatNumericLabel(value),
      position: 100 - position, // 从下到上
    })
  }

  return ticks
})

// “最大值/最小值”也按量级动态显示，避免误解为“没值”
const formatDisplayV = (v) => {
  return formatNumericLabel(v)
}

/* ---------- 多图层合成逻辑 ---------- */

/** 当前是否多图层模式 */
const isMultiLayerMode = computed(() =>
  Array.isArray(props.layers) && props.layers.length > 0,
)

/** 当前选中的图层（null 表示叠加所有可见图层） */
const selectedLayer = computed(() => {
  if (!props.selectedLayerId) return null
  return props.layers.find((l) => String(l.id) === String(props.selectedLayerId)) ?? null
})

function createFrameLayer(layer, url, blendMode = 'normal') {
  if (!layer) return null
  return {
    id: layer.id,
    label: layer.label || layer.kind || '图层',
    kind: layer.kind,
    url,
    opacity: Number.isFinite(layer.opacity) ? layer.opacity : 1,
    blendMode,
    vmin: layer.vmin,
    vmax: layer.vmax,
    cmap: layer.cmap || 'coolwarm',
    variable: layer.variable,
    custom_colors: layer.custom_colors,
  }
}

/** 当前物理时间（按 currentStep 从 physicalTimes 查表） */
const currentPhysicalTime = computed(() => {
  const pts = props.physicalTimes
  if (Array.isArray(pts) && pts.length > 0) {
    const idx = clampFrame(props.currentStep)
    const pt = pts[idx]
    return pt != null ? Number(pt) : null
  }
  return null
})

/**
 * 在给定图层中按当前帧索引找帧 URL
 * 优先 time_step 匹配，再 fallback 到索引
 */
function getLayerFrameUrlForStep(layer, stepIdx) {
  if (!layer?.images?.length) return ''
  const pts = layer.physicalTimes
  const curPt = currentPhysicalTime.value

  if (curPt != null && Array.isArray(pts) && pts.length > 0) {
    let closest = layer.images[0]
    let minDiff = Infinity
    pts.forEach((pt, i) => {
      const diff = Math.abs(Number(pt) - curPt)
      if (diff < minDiff && layer.images[i]) {
        minDiff = diff
        closest = layer.images[i]
      }
    })
    const url = closest?.png_url || closest?.svg_url || closest?.url || ''
    return typeof url === 'string' ? url.replace(/[`\s]/g, '') : ''
  }

  const idx = Math.max(0, Math.min(stepIdx, layer.images.length - 1))
  const frame = layer.images[idx]
  if (!frame) return ''
  const raw = frame.png_url || frame.svg_url || frame.url || ''
  return typeof raw === 'string' ? raw.replace(/[`\s]/g, '') : ''
}

function findRenderableLayer(layers, stepIdx) {
  const list = Array.isArray(layers) ? layers : []
  for (const layer of list) {
    const url = getLayerFrameUrlForStep(layer, stepIdx)
    if (url) return { layer, url }
  }
  return null
}

/** 叠加模式下每层的帧 URL（按图层顺序，从底到顶） */
const layerStackFrames = computed(() => {
  if (!isMultiLayerMode.value) return []

  // 单图层查看模式：只显示选中的图层
  if (props.selectedLayerId) {
    const layer = props.layers.find((l) => String(l.id) === String(props.selectedLayerId))
    if (layer) {
      const url = getLayerFrameUrlForStep(layer, props.currentStep)
      if (url) return [createFrameLayer(layer, url, 'normal')]

      const fallback =
        findRenderableLayer(
          props.layers.filter((l) => l.visible !== false),
          props.currentStep,
        ) || findRenderableLayer(props.layers, props.currentStep)
      return fallback ? [createFrameLayer(fallback.layer, fallback.url, 'normal')] : []
    }
    return []
  }

  // 全部叠加模式
  const visibleLayers = props.layers.filter((l) => l.visible)
  
  return visibleLayers.map((l) => {
    const url = getLayerFrameUrlForStep(l, props.currentStep)
    return createFrameLayer(l, url, l.blendMode || 'normal')
  }).filter((layer) => layer?.url)
})

/** 当前多图层是否有可渲染的帧 URL */
const hasRenderableLayerFrames = computed(() =>
  layerStackFrames.value.some((f) => typeof f.url === 'string' && f.url.length > 0),
)

/** 实际是否启用多图层渲染（无可用帧时自动回退到单图） */
const useMultiLayerRender = computed(
  () => isMultiLayerMode.value && hasRenderableLayerFrames.value,
)

/** 单图层查看模式下当前选中图层的色带数据 */
const displayedSingleLayer = computed(() => {
  if (!props.selectedLayerId) {
    const stackLayerId = layerStackFrames.value[0]?.id
    if (stackLayerId) {
      return props.layers.find((l) => String(l.id) === String(stackLayerId)) ?? null
    }
    return (
      findRenderableLayer(
        props.layers.filter((l) => l.visible !== false),
        props.currentStep,
      )?.layer ||
      findRenderableLayer(props.layers, props.currentStep)?.layer ||
      null
    )
  }
  const preferred = selectedLayer.value
  if (preferred && getLayerFrameUrlForStep(preferred, props.currentStep)) return preferred
  return (
    findRenderableLayer(
      props.layers.filter((l) => l.visible !== false),
      props.currentStep,
    )?.layer ||
    findRenderableLayer(props.layers, props.currentStep)?.layer ||
    preferred
  )
})

/** 单图层查看模式下当前选中图层的色带数据 */
const selectedLayerColorbar = computed(() => {
  if (!displayedSingleLayer.value) return null
  const l = displayedSingleLayer.value
  const fallbackVmin = Number.isFinite(Number(props.vmin)) ? Number(props.vmin) : 0
  const fallbackVmax = Number.isFinite(Number(props.vmax)) ? Number(props.vmax) : 0

  // 从 API bounds 获取变量范围
  const varId = l.variable || l.id
  const apiRange = lookupVariableBounds(varId)
  const vmin = apiRange && Number.isFinite(apiRange.vmin)
    ? apiRange.vmin
    : (Number.isFinite(Number(l.vmin)) ? Number(l.vmin) : fallbackVmin)
  const vmax = apiRange && Number.isFinite(apiRange.vmax)
    ? apiRange.vmax
    : (Number.isFinite(Number(l.vmax)) ? Number(l.vmax) : fallbackVmax)

  // 尝试从 gasCmaps + colorMapCatalog 解析色带颜色
  const gasColors = resolveVariableCmapColors(varId)

  return {
    vmin,
    vmax,
    cmap: l.cmap || props.cmap || 'coolwarm',
    custom_colors:
      Array.isArray(l.custom_colors) && l.custom_colors.length > 0
        ? l.custom_colors
        : gasColors,
    label: l.label || l.kind || '',
  }
})

/** 图层切换 */
const handleLayerSelect = (layerId) => {
  // layerId 为 null 表示"全部叠加"模式
  emit('update:selectedLayerId', layerId)
}

/** 根据 cmap 名称返回对应渐变字符串 */
const getColorbarGradientForCmap = (cmap) => {
  const gradients = {
    coolwarm: 'linear-gradient(to top, #3b4cc0, #7396f5, #b4d7f5, #f4d9d0, #dd7373, #b40426)',
    hot: 'linear-gradient(to top, #000000, #ff0000, #ffff00, #ffffff)',
    viridis: 'linear-gradient(to top, #440154, #31688e, #35b779, #fde724)',
    jet: 'linear-gradient(to top, #000080, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000, #800000)',
    gray: 'linear-gradient(to top, #000000, #ffffff)',
    plasma: 'linear-gradient(to top, #0d0887, #7e03a8, #cc4778, #f89540, #f0f921)',
    inferno: 'linear-gradient(to top, #000004, #420a68, #932667, #dd513a, #fca50a, #fcffa4)',
    magma: 'linear-gradient(to top, #000004, #3b0f70, #8c2981, #de4968, #fe9f6d, #fcfdbf)',
  }
  return gradients[cmap] || gradients.coolwarm
}

/** 与内置色带一致：竖直色条用 to top */
function colorbarBackgroundForLayer(cb) {
  if (!cb) return ''
  const colors = cb.custom_colors
  if (Array.isArray(colors) && colors.length > 0) {
    if (colors.length === 1) {
      const c = colors[0]
      return `linear-gradient(to top, ${c}, ${c})`
    }
    const parts = colors.map((c, i) => {
      const pct = (i / (colors.length - 1)) * 100
      return `${c} ${pct}%`
    })
    return `linear-gradient(to top, ${parts.join(', ')})`
  }
  return getColorbarGradientForCmap(cb.cmap)
}

/** 根据 vmin/vmax/cmap 生成色带刻度数组 */
const getColorbarTicksForRange = (vmin, vmax, cmap) => {
  const ticks = []
  const tickCount = 5
  const fallbackMin = Number.isFinite(Number(props.vmin)) ? Number(props.vmin) : 0
  const fallbackMax = Number.isFinite(Number(props.vmax)) ? Number(props.vmax) : 0
  const min = Number.isFinite(Number(vmin)) ? Number(vmin) : fallbackMin
  const max = Number.isFinite(Number(vmax)) ? Number(vmax) : fallbackMax
  const range = max - min
  for (let i = 0; i < tickCount; i++) {
    const value = min + (range * i) / (tickCount - 1)
    const position = (i / (tickCount - 1)) * 100
    ticks.push({
      value: formatDisplayV(value),
      position: 100 - position,
    })
  }
  return ticks
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="sprite-viewer-mask" @click.self="handleClose">
      <div class="sprite-viewer-toolbar">
        <el-button
          type="primary"
          :icon="Download"
          :loading="downloading"
          @click="handleDownloadPng"
          circle
          size="large" />
        <el-button :icon="Close" @click="handleClose" circle size="large" />
      </div>

      <!-- 多图层切换器 -->
      <div v-if="isMultiLayerMode && layers.length > 0" class="layer-switcher">
        <div class="layer-switcher-label">图层</div>
        <el-select
          :model-value="selectedLayerId || '__all__'"
          size="small"
          class="layer-select"
          placeholder="选择图层"
          teleported
          popper-class="sprite-layer-select-popper"
          @update:model-value="(v) => emit('update:selectedLayerId', v === '__all__' ? null : v)">
          <el-option label="全部叠加" value="__all__" />
          <el-option
            v-for="layer in layers"
            :key="layer.id"
            :label="layer.label || layer.kind"
            :value="layer.id" />
        </el-select>
      </div>

      <div class="sprite-viewer-canvas">
        <div
          ref="spriteContainerRef"
          class="sprite-container"
          @wheel.prevent="handleSpriteWheel">

          <!-- 多图层叠加模式（全部叠加 OR 单图层查看） -->
          <div
            v-if="useMultiLayerRender && layerStackFrames.length > 0"
            class="layer-stack">
            <div
              v-for="frameLayer in layerStackFrames"
              :key="frameLayer.id"
              class="layer-frame"
              :class="`layer-kind-${frameLayer.kind}`"
              :style="{
                backgroundImage: frameLayer.url ? `url('${frameLayer.url}')` : 'none',
                opacity: frameLayer.opacity,
                mixBlendMode: frameLayer.blendMode,
              }">
              <img
                v-if="frameLayer.url"
                :src="frameLayer.url"
                :alt="frameLayer.label"
                class="layer-image"
                @error="(e) => e.target.style.display = 'none'" />
            </div>
          </div>

          <!-- 单图层（legacy / 非多图层模式） -->
          <div
            v-else
            class="sprite-image"
            :style="spriteStyle"></div>
        </div>

        <!-- 色带：多图层模式下始终跟随当前展示的图层，避免“全部叠加”回退到默认色带。 -->
        <div v-if="showColorbar" class="colorbar-container">
          <!-- 多图层模式：动态色带 -->
          <template v-if="isMultiLayerMode && selectedLayerColorbar">
            <div class="colorbar-title">{{ selectedLayerColorbar.label }}</div>
            <div class="colorbar-wrapper">
              <div
                class="colorbar-gradient"
                :style="{ background: colorbarBackgroundForLayer(selectedLayerColorbar) }"></div>
              <div class="colorbar-ticks">
                <div
                  v-for="(tick, index) in getColorbarTicksForRange(selectedLayerColorbar.vmin, selectedLayerColorbar.vmax, selectedLayerColorbar.cmap)"
                  :key="index"
                  class="colorbar-tick"
                  :style="{ top: `${tick.position}%` }">
                  <div class="tick-line"></div>
                  <div class="tick-label">{{ tick.value }}</div>
                </div>
              </div>
            </div>
            <div class="colorbar-info">
              <div class="colorbar-range">
                <span class="range-label">最大值</span>
                <span class="range-value">{{ formatDisplayV(selectedLayerColorbar.vmax) }}</span>
              </div>
              <div class="colorbar-range">
                <span class="range-label">最小值</span>
                <span class="range-value">{{ formatDisplayV(selectedLayerColorbar.vmin) }}</span>
              </div>
            </div>
          </template>
          <!-- 非多图层模式：默认色带 -->
          <template v-else>
            <div class="colorbar-title">{{ colorbarTitleText }}</div>
            <div class="colorbar-wrapper">
              <div
                class="colorbar-gradient"
                :style="{ background: colorbarGradient }"></div>
              <div class="colorbar-ticks">
                <div
                  v-for="(tick, index) in colorbarTicks"
                  :key="index"
                  class="colorbar-tick"
                  :style="{ top: `${tick.position}%` }">
                  <div class="tick-line"></div>
                  <div class="tick-label">{{ tick.value }}</div>
                </div>
              </div>
            </div>
            <div class="colorbar-info">
              <div class="colorbar-range">
                <span class="range-label">最大值</span>
                <span class="range-value">{{ formatDisplayV(displayVMax) }}</span>
              </div>
              <div class="colorbar-range">
                <span class="range-label">最小值</span>
                <span class="range-value">{{ formatDisplayV(displayVMin) }}</span>
              </div>

              <div class="colorbar-source" v-if="actualRange">
                <span class="source-label">数据来源: {{ rangeSource }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 时间轴控制面板 -->
      <div class="timeline-container">
        <div class="timeline-controls">
          <!-- 播放/暂停 -->
          <div class="playback-controls">
            <el-button
              :icon="isPlaying ? VideoPause : VideoPlay"
              @click="togglePlayPause"
              :disabled="frameCount <= 1"
              size="large"
              :type="isPlaying ? 'warning' : 'primary'" />

            <el-button
              :icon="DArrowLeft"
              @click="previousFrame"
              :disabled="frameCount <= 1"
              size="large"
              type="default" />

            <el-button
              :icon="DArrowRight"
              @click="nextFrame"
              :disabled="frameCount <= 1"
              size="large"
              type="default" />
          </div>

          <!-- 进度条 -->
          <div class="progress-controls">
            <span class="frame-info">{{ frameInfoText }}</span>
            <el-slider
              v-if="frameCount > 1"
              v-model="currentFrame"
              :min="0"
              :max="frameCount - 1"
              :step="1"
              @change="jumpToFrame"
              class="frame-slider" />
          </div>

          <!-- 播放速度 -->
          <div class="speed-controls" v-if="frameCount > 1">
            <span class="speed-label">速度:</span>
            <el-select
              v-model="playbackSpeed"
              size="small"
              class="speed-select"
              teleported
              popper-class="sprite-speed-popper"
              filterable
              allow-create
              default-first-option>
              <el-option label="0.5x · 0.5 帧/秒" :value="0.5" />
              <el-option label="1x · 1.0 帧/秒" :value="1" />
              <el-option label="2x · 2.0 帧/秒" :value="2" />
              <el-option label="4x · 4.0 帧/秒" :value="4" />
              <el-option label="8x · 8.0 帧/秒" :value="8" />
            </el-select>
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sprite-viewer-mask {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background:
    radial-gradient(circle at 50% 44%, rgba(9, 26, 46, 0.58), rgba(2, 6, 13, 0.82) 64%),
    rgba(2, 6, 13, 0.74);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.sprite-viewer-toolbar {
  position: absolute;
  top: 40px;
  right: 40px;
  display: flex;
  gap: 1rem;
  z-index: 10000;
}

.sprite-viewer-toolbar :deep(.el-button) {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(0, 243, 255, 0.3);
  color: #fff;
  transition: all 0.3s;
}

.sprite-viewer-toolbar :deep(.el-button:hover) {
  background-color: rgba(0, 243, 255, 0.2);
  border-color: var(--primary-color);
  transform: translateY(-2px);
}

.sprite-viewer-toolbar :deep(.el-button.is-loading) {
  background-color: rgba(0, 243, 255, 0.15);
}

.sprite-viewer-canvas {
  width: min(92vw, 100%);
  height: min(78vh, 100%);
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2rem;
}

.sprite-container {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: zoom-in;
  padding: 1rem;
  border: 1px solid rgba(135, 226, 255, 0.18);
  border-radius: 14px;
  background:
    linear-gradient(45deg, rgba(214, 225, 235, 0.92) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(214, 225, 235, 0.92) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(214, 225, 235, 0.92) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(214, 225, 235, 0.92) 75%),
    #f7fbff;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0;
  background-size: 20px 20px;
  box-shadow:
    0 22px 60px rgba(0, 0, 0, 0.38),
    0 0 0 1px rgba(0, 243, 255, 0.06) inset;
}

/* 不固定 100% 填满，避免压扁/拉长；由内联 aspect-ratio + max 尺寸在可视区内等比容纳 */
.sprite-image {
  flex-shrink: 1;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  transition: transform 0.08s linear;
  will-change: transform;
  box-sizing: border-box;
}

/* 时间轴控制 */
.timeline-container {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 1000px;
  background: rgba(13, 20, 35, 0.95);
  border: 1px solid rgba(0, 243, 255, 0.2);
  border-radius: 20px;
  padding: 1.25rem 1.75rem;
  backdrop-filter: blur(20px);
  z-index: 10000;
  box-shadow: 0 10px 40px rgba(0, 243, 255, 0.15);
  transition: all 0.3s ease;
}

.timeline-container:hover {
  border-color: rgba(0, 243, 255, 0.4);
  box-shadow: 0 15px 50px rgba(0, 243, 255, 0.25);
}

.timeline-controls {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}

.playback-controls {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.playback-controls :deep(.el-button) {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 243, 255, 0.2);
  color: #fff;
  transition: all 0.3s;
}

.playback-controls :deep(.el-button:hover) {
  background: rgba(0, 243, 255, 0.15);
  border-color: rgba(0, 243, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 243, 255, 0.2);
}

.playback-controls :deep(.el-button:disabled) {
  opacity: 0.3;
  cursor: not-allowed;
}

.playback-controls :deep(.el-button.is-primary) {
  background: rgba(0, 243, 255, 0.2);
  border-color: rgba(0, 243, 255, 0.4);
}

.playback-controls :deep(.el-button.is-primary:hover) {
  background: rgba(0, 243, 255, 0.3);
  border-color: rgba(0, 243, 255, 0.6);
}

.playback-controls :deep(.el-button.is-warning) {
  background: rgba(255, 193, 7, 0.2);
  border-color: rgba(255, 193, 7, 0.4);
  color: #ffc107;
}

.playback-controls :deep(.el-button.is-warning:hover) {
  background: rgba(255, 193, 7, 0.3);
  border-color: rgba(255, 193, 7, 0.6);
  color: #ffc107;
}

.progress-controls {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
}

.frame-info {
  font-family: var(--font-family-mono);
  font-size: var(--text-body);
  color: var(--text-secondary);
  min-width: 100px;
  text-align: center;
  font-weight: 500;
}

.frame-slider {
  width: 100%;
  max-width: 850px;
}

.frame-slider :deep(.el-slider__runway) {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(0, 243, 255, 0.2);
  height: 6px;
  border-radius: 3px;
}

.frame-slider :deep(.el-slider__bar) {
  background: linear-gradient(90deg, var(--primary-color), #00d9ff);
  height: 6px;
  border-radius: 3px;
}

.frame-slider :deep(.el-slider__button) {
  width: 18px;
  height: 18px;
  border: 2px solid var(--primary-color);
  background: rgba(0, 243, 255, 0.2);
  box-shadow: 0 2px 8px rgba(0, 243, 255, 0.3);
}

.frame-slider :deep(.el-slider__button:hover) {
  transform: scale(1.2);
  background: rgba(0, 243, 255, 0.3);
}

.speed-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.speed-label {
  font-size: var(--text-body);
  color: var(--text-secondary);
  font-weight: 500;
}

.speed-select {
  width: 100px;
  --el-fill-color-blank: rgba(10, 18, 36, 0.92);
  --el-text-color-regular: rgba(220, 247, 255, 0.96);
  --el-text-color-placeholder: rgba(170, 210, 230, 0.75);
  --el-border-color: rgba(0, 243, 255, 0.22);
  --el-border-color-hover: rgba(0, 243, 255, 0.5);
  --el-color-primary: #00f3ff;
  --el-color-primary-light-3: #66f8ff;
  --el-box-shadow-light: 0 0 0 1px rgba(0, 243, 255, 0.35) inset;
}

.speed-select :deep(.el-input__wrapper) {
  background: linear-gradient(
    180deg,
    rgba(14, 25, 48, 0.96) 0%,
    rgba(8, 16, 32, 0.92) 100%
  );
  border: 1px solid rgba(0, 243, 255, 0.3);
  border-radius: 0.5rem;
  box-shadow:
    inset 0 0 0 1px rgba(0, 243, 255, 0.12),
    0 0 0.75rem rgba(0, 243, 255, 0.12);
  transition: all 0.2s ease;
}

.speed-select :deep(.el-input__inner) {
  color: rgba(220, 247, 255, 0.96);
  font-size: var(--text-body);
  font-family: var(--font-family-mono);
  font-weight: 600;
}

.speed-select :deep(.el-input__wrapper:hover) {
  border-color: rgba(0, 243, 255, 0.55);
  box-shadow:
    inset 0 0 0 1px rgba(0, 243, 255, 0.25),
    0 0 0.9rem rgba(0, 243, 255, 0.2);
}

.speed-select :deep(.el-input__wrapper.is-focus) {
  border-color: rgba(0, 243, 255, 0.75);
  box-shadow:
    inset 0 0 0 1px rgba(0, 243, 255, 0.4),
    0 0 1rem rgba(0, 243, 255, 0.35);
}

.speed-select :deep(.el-input__suffix-inner) {
  color: rgba(0, 243, 255, 0.8);
}

:deep(.sprite-speed-popper) {
  border: 1px solid rgba(0, 243, 255, 0.35) !important;
  background: linear-gradient(
    180deg,
    rgba(10, 18, 36, 0.98) 0%,
    rgba(8, 14, 28, 0.96) 100%
  ) !important;
  box-shadow:
    0 0 1.25rem rgba(0, 243, 255, 0.2),
    0 0.4rem 1rem rgba(0, 0, 0, 0.35) !important;
  backdrop-filter: blur(12px);
}

:deep(.sprite-speed-popper .el-select-dropdown__item) {
  color: rgba(220, 247, 255, 0.9);
  font-family: var(--font-family-mono);
}

:deep(.sprite-speed-popper .el-select-dropdown__item:hover) {
  background: rgba(0, 243, 255, 0.14);
  color: #d6fdff;
}

:deep(.sprite-speed-popper .el-select-dropdown__item.selected) {
  color: #00f3ff;
  background: rgba(0, 243, 255, 0.2);
  font-weight: 700;
}

/* 色带容器 */
.colorbar-container {
  width: 136px;
  height: 80%;
  display: flex;
  flex-direction: column;
  background: rgba(7, 15, 29, 0.96);
  border: 1px solid rgba(0, 243, 255, 0.46);
  border-radius: 10px;
  padding: 1rem;
  backdrop-filter: blur(10px);
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.34),
    0 0 22px rgba(0, 243, 255, 0.12);
}

.colorbar-title {
  font-family: var(--font-family-tech);
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--primary-color);
  text-align: center;
  margin-bottom: 1rem;
  letter-spacing: 0.5px;
}

.colorbar-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  gap: 0.5rem;
}

.colorbar-gradient {
  width: 30px;
  height: 100%;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.3);
}

.colorbar-ticks {
  flex: 1;
  position: relative;
}

.colorbar-tick {
  position: absolute;
  left: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.tick-line {
  width: 8px;
  height: 1px;
  background: rgba(255, 255, 255, 0.5);
}

.tick-label {
  font-family: var(--font-family-mono);
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
}

.colorbar-info {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.colorbar-range {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.range-label {
  font-size: var(--text-caption);
  color: var(--text-secondary);
}

.range-value {
  font-family: var(--font-family-mono);
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--primary-color);
}

.colorbar-source {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.source-label {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
  font-style: italic;
}

/* 多图层叠加 */
.layer-stack {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.layer-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  transition: opacity 0.2s;
}

.layer-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* 多图层切换器 */
.layer-switcher {
  position: absolute;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10001;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  max-width: 80%;
  overflow: visible;
  padding: 0.45rem 0.6rem;
  border-radius: 999px;
  background: rgba(6, 14, 28, 0.94);
  border: 1px solid rgba(0, 243, 255, 0.45);
  box-shadow:
    0 14px 32px rgba(0, 0, 0, 0.34),
    0 0 22px rgba(0, 243, 255, 0.18),
    0 0 0 1px rgba(0, 243, 255, 0.14) inset;
  backdrop-filter: blur(12px);
}

.layer-switcher-label {
  flex: 0 0 auto;
  padding-left: 0.2rem;
  font-family: var(--font-family-tech);
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(170, 225, 240, 0.78);
}

.layer-select {
  width: min(80vw, 440px);
}

.layer-switcher :deep(.el-select__wrapper) {
  min-height: 42px;
  padding: 0 14px;
  background:
    linear-gradient(180deg, rgba(18, 38, 66, 0.98), rgba(9, 22, 42, 0.98));
  box-shadow:
    0 0 0 1px rgba(0, 243, 255, 0.36) inset,
    0 0 18px rgba(0, 243, 255, 0.16);
  border-radius: 999px;
  transition: box-shadow 0.2s ease, transform 0.2s ease, background 0.2s ease;
}

.layer-switcher :deep(.el-select__selected-item),
.layer-switcher :deep(.el-select__placeholder),
.layer-switcher :deep(.el-select__caret) {
  color: rgba(230, 250, 255, 0.92);
}

.layer-switcher :deep(.el-select__selected-item) {
  font-family: var(--font-family-tech);
  font-weight: 600;
}

.layer-switcher :deep(.el-select__placeholder) {
  color: rgba(160, 205, 220, 0.64);
}

.layer-switcher :deep(.el-select__wrapper.is-focused) {
  box-shadow:
    0 0 0 1px rgba(0, 243, 255, 0.42) inset,
    0 0 18px rgba(0, 243, 255, 0.2);
  transform: translateY(-1px);
}

.layer-switcher :deep(.el-select:hover .el-select__wrapper) {
  box-shadow:
    0 0 0 1px rgba(0, 243, 255, 0.3) inset,
    0 0 18px rgba(0, 243, 255, 0.14);
}

.sprite-layer-select-popper.el-popper {
  z-index: 20050 !important;
  border: 1px solid rgba(0, 243, 255, 0.18) !important;
  border-radius: 18px !important;
  background: rgba(7, 16, 30, 0.96) !important;
  backdrop-filter: blur(16px);
  box-shadow:
    0 18px 36px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(0, 243, 255, 0.06) inset !important;
}

.sprite-layer-select-popper .el-scrollbar__view {
  padding: 8px;
}

.sprite-layer-select-popper .el-select-dropdown__item {
  min-height: 36px;
  margin: 2px 0;
  border-radius: 10px;
  color: rgba(220, 247, 255, 0.84);
  font-family: var(--font-family-tech);
  font-size: var(--text-caption);
}

.sprite-layer-select-popper .el-select-dropdown__item.hover,
.sprite-layer-select-popper .el-select-dropdown__item:hover {
  background: rgba(0, 243, 255, 0.12) !important;
  color: #effcff;
}

.sprite-layer-select-popper .el-select-dropdown__item.is-selected {
  background: linear-gradient(90deg, rgba(0, 243, 255, 0.18), rgba(0, 243, 255, 0.08)) !important;
  color: var(--primary-color) !important;
  font-weight: 600;
}

</style>
