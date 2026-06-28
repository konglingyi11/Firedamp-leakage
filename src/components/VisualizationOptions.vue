<script setup>
import { ref, computed, watch, inject } from 'vue'
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
  Plus,
  Histogram,
  Loading,
  Share,
  QuestionFilled,
  VideoCamera,
} from '@element-plus/icons-vue'
import { useTaskStore } from '../stores/task.js'
import { useVisualizationOptions } from '@/composables/useVisualizationOptions'
import { getVariableDisplayName } from '@/utils/gas'
import { VIZ_STATE_KEY } from '@/composables/useVisualizationState'
import SpriteImageViewer from './SpriteImageViewer.vue'

const props = defineProps({
  taskId: { type: String, default: '' },
  visualization: { type: Object },
  dimension: { type: String },
  type2d: { type: String },
  type3d: { type: String },
  plane: { type: String },
  coordinate: { type: Number },
  previewImage: { type: String },
  vmin: { type: Number },
  vmax: { type: Number },
  rows: { type: Number },
  cols: { type: Number },
  frameCount: { type: Number, default: 1 },
  physicalWidth: { type: Number },
  physicalHeight: { type: Number },
  physicalTimes: { type: Array },
  currentStep: { type: Number },
  availableTimeSteps: { type: Array },
  applying: { type: Boolean },
  batchLoading: { type: Boolean },
  batchProgress: { type: Number },
  batchCurrent: { type: Number },
  batchTotal: { type: Number },
  loadingText: { type: String },
  minTimeStep: { type: Number },
  maxTimeStep: { type: Number },
  layers: { type: Array },
  pregenConfig: { type: Object, default: null },
  gasCmaps: { type: Object, default: () => ({}) },
  colorMapCatalog: { type: Array, default: () => [] },
  visualDomain: { type: String, default: 'gas' },
})

const vizState = inject(VIZ_STATE_KEY)

const emit = defineEmits([
  'update:dimension',
  'update:type2d',
  'update:type3d',
  'update:plane',
  'update:coordinate',
  'update:currentStep',
  'update:selectedLayerId',
  'update:visualDomain',
  'apply',
  'start-recognition',
  'reset',
  'load-preset',
])

const taskStore = useTaskStore()
const state = useVisualizationOptions({ props, emit, taskStore })

const {
  selectedLayerId,
  currentPhysicalTime,
  previewLayers,
  selectedPreviewLayer,
  selectedLayerPreviewUrl,
  resolvedPreviewImage,
  thumbnailUsesSpriteSheet,
  thumbnailPreviewStyle,
  previewCardPlane,
  previewCardCoordinate,
  previewCardVMin,
  previewCardVMax,
  reset2dRange,
  getVariableBoundsForPlane,
  isFetchingPlaneBounds,
} = state

const multiLayerCount = computed(() =>
  Math.max(0, previewLayers.value.length - 1),
)
const batchProgressDetail = computed(() => {
  const current = Number(props.batchCurrent || 0)
  const total = Number(props.batchTotal || 0)
  if (total > 0) return `${current} / ${total}`
  return `${Math.max(0, Number(props.batchProgress || 0))}%`
})

const activeVisualDomain = computed({
  get: () => props.visualDomain || 'gas',
  set: (v) => emit('update:visualDomain', v),
})
const previewVisible = ref(false)
const LAYER_KIND_DISPLAY = {
  contour: '云图',
  cloud: '云图',
  radar_cloud: '雷达云图',
  radar_wave: '雷达波',
  vector: '矢量图',
  volume: '体渲染',
  streamline: '流线图',
  video: '视频',
}

const volumeVariablesDisplay = computed(() =>
  (props.visualization?.volume_variables || [])
    .map(getVariableDisplayName)
    .join('、'),
)

function ensureRadarDefaults() {
  const viz = props.visualization
  if (!viz) return
  const allowedGhz = [0.4, 0.8, 2.4, 5.8, 7.9]
  const ghz = Number(viz.radar_frequency_ghz)
  if (!allowedGhz.includes(ghz)) viz.radar_frequency_ghz = 2.4
  if (viz.radar_bandwidth_mhz == null) viz.radar_bandwidth_mhz = 500
  if (viz.radar_transmit_power_dbm == null) viz.radar_transmit_power_dbm = 20
  if (
    viz.radar_transmit_mode == null ||
    !['单向', '扇形'].includes(viz.radar_transmit_mode)
  ) {
    viz.radar_transmit_mode = '单向'
  }
  if (viz.radar_receive_mode == null) viz.radar_receive_mode = '单站雷达回波'
}

const selectVisualizationLayer = (layer) => {
  if (['cloud', 'vector'].includes(layer)) {
    emit('update:dimension', '2d')
    emit('update:type2d', layer)
  } else {
    emit('update:dimension', '3d')
    emit('update:type3d', layer)
  }
}

const radarModeConfigs = {
  cloud: {
    label: '波前传播动画',
    description: '随时间推移动画渲染电磁波前',
    target: '类似等值面/膨胀球动画',
  },
  vector: {
    label: '场强热力图',
    description: '用色阶表示局部电场强度',
    target: '高反射区域高亮',
  },
  streamline: {
    label: '能量轨迹线',
    description: '用粒子或路径线表示能量流向',
    target: '模拟辐射能量传播方向',
  },
  volume: {
    label: '介质结构叠加',
    description: '半透明墙体显示',
    target: '辅助定位波与结构交互区域',
  },
}

const activeRadarModeConfig = computed(
  () => radarModeConfigs[activeVisualizationLayer.value] || radarModeConfigs.cloud,
)

const selectRadarVisualizationLayer = (layer) => {
  ensureRadarDefaults()
  selectVisualizationLayer(layer)
}

const handlePreview = () => {
  if (resolvedPreviewImage.value) previewVisible.value = true
}

const previewCardAxisName = computed(
  () => ({ xy: 'Z', xz: 'Y', yz: 'X' })[previewCardPlane.value] || 'Z',
)
const previewCardVisualizationType = computed(() => {
  if (selectedLayerId.value && selectedPreviewLayer.value)
    return LAYER_KIND_DISPLAY[selectedPreviewLayer.value.kind] || '云图'
  if (props.dimension === '2d')
    return props.type2d === 'vector' ? '矢量图' : '云图'
  return props.type3d === 'volume'
    ? '体渲染'
    : props.type3d === 'streamline'
      ? '流线图'
      : props.type3d === 'video'
        ? '视频'
        : '云图'
})

const getVariableZhName = (v) => getVariableDisplayName(v)

/**
 * 更新自动范围 - 当开启自动范围时，从后端获取平面变量范围
 */
const updateAutoRange = async () => {
  if (!props.visualization?.autoRange) return
  if (props.dimension !== '2d') return
  if (!props.taskId || !props.plane || !Number.isFinite(props.coordinate))
    return

  const variable =
    props.type2d === 'vector'
      ? 'VelocityMagnitude'
      : props.visualization?.variable

  if (!variable) return

  const bounds = await getVariableBoundsForPlane(
    props.taskId,
    props.plane,
    props.coordinate,
    variable,
    props.visualization?.usePregen,
  )

  if (bounds && Number.isFinite(bounds.vmin) && Number.isFinite(bounds.vmax)) {
    props.visualization.vmin = bounds.vmin
    props.visualization.vmax = bounds.vmax
  }
}

const handleApply = async () => {
  await updateAutoRange()
  emit('apply')
}

// autoRange 改为仅在「应用设置」时触发，避免频繁请求 plane-variable-bounds 接口

watch(
  () => [props.visualization.startTimeStep, props.visualization.endTimeStep],
  ([s, e]) => {
    if (Number.isFinite(s) && Number.isFinite(e) && s > e) {
      props.visualization.startTimeStep = e
      props.visualization.endTimeStep = s
    }
  },
)

watch(
  () => props.visualization,
  () => ensureRadarDefaults(),
  { immediate: true },
)

watch(
  () => props.type2d,
  async (t, prev) => {
    if (t === 'vector') {
      if (!props.visualization.vectorColor)
        props.visualization.vectorColor = '#ffffff'
      if (!props.visualization.quality_preset)
        props.visualization.quality_preset = '1k'
      if (props.visualization.transparent_background == null)
        props.visualization.transparent_background = true
      if (props.visualization.vectorLineWidth == null)
        props.visualization.vectorLineWidth = 1
    }
    if (props.dimension === '2d' && prev && prev !== t) {
      if (props.taskId) {
        try {
          await taskStore.fetchTaskMetadata(props.taskId, true)
        } catch (e) {}
      }
      reset2dRange()
    }
  },
  { immediate: true },
)

watch(
  () => props.type3d,
  (t) => {
    if (t === 'streamline' && !props.visualization.streamline) {
      props.visualization.streamline = {
        time_step: 0,
        seed_count: 50,
        points_per_streamline: 40,
        line_width: 0.38,
        display_time: 5,
        color: '#ffffff',
      }
    }
  },
  { immediate: true },
)

const handleNavClick = (m) => {
  // handled in parent
}

// ── 预生成配置处理 ──

// 是否使用预生成数据
const isUsingPregen = computed(() => props.visualization?.usePregen === true)

// 从 pregenConfig 获取矢量图配置
const pregenVectorConfig = computed(() => props.pregenConfig?.vector)

// 从 pregenConfig 获取体渲染配置
const pregenVolumeConfig = computed(() => {
  const pregen = props.pregenConfig
  return pregen?.volume ?? pregen?.volume_texture
})

// 从 pregenConfig 获取流线配置
const pregenStreamlineConfig = computed(() => props.pregenConfig?.streamline)

// 判断特定配置项是否在 pregenConfig 中定义
const hasPregenVectorQualityPreset = computed(
  () => pregenVectorConfig.value?.quality_preset != null,
)
const hasPregenVectorTransparentBackground = computed(
  () => pregenVectorConfig.value?.transparent_background != null,
)
const hasPregenVectorGlyphDensity = computed(
  () => pregenVectorConfig.value?.glyph_density != null,
)
const hasPregenVectorLineWidth = computed(
  () => pregenVectorConfig.value?.line_width != null,
)
const hasPregenVectorColor = computed(
  () => pregenVectorConfig.value?.color != null,
)

const hasPregenVolumeResolution = computed(
  () => pregenVolumeConfig.value?.resolution != null,
)
const hasPregenVolumeSamplingRatio = computed(
  () => pregenVolumeConfig.value?.sampling_ratio != null,
)

const hasPregenStreamlineSeedCount = computed(
  () => pregenStreamlineConfig.value?.seed_count != null,
)
const hasPregenStreamlinePointsPerStreamline = computed(
  () => pregenStreamlineConfig.value?.points_per_streamline != null,
)
const hasPregenStreamlineLineWidth = computed(
  () => pregenStreamlineConfig.value?.line_width != null,
)

// 当开启预生成数据时，从 pregenConfig 同步数值
watch(
  () => [
    isUsingPregen.value,
    props.pregenConfig,
    props.dimension,
    props.type2d,
    props.type3d,
  ],
  () => {
    if (!isUsingPregen.value || !props.pregenConfig) return

    const viz = props.visualization
    if (!viz) return

    // 2D 矢量图：从 pregenConfig.vector 同步
    if (props.dimension === '2d' && props.type2d === 'vector') {
      const vectorCfg = pregenVectorConfig.value
      if (vectorCfg) {
        if (vectorCfg.quality_preset)
          viz.quality_preset = vectorCfg.quality_preset
        if (vectorCfg.transparent_background != null)
          viz.transparent_background = vectorCfg.transparent_background
        if (vectorCfg.glyph_density != null)
          viz.glyph_density = vectorCfg.glyph_density
        if (vectorCfg.line_width != null)
          viz.vectorLineWidth = vectorCfg.line_width
        if (vectorCfg.color) viz.vectorColor = vectorCfg.color
        if (vectorCfg.streamline_color)
          viz.vectorStreamlineColor = vectorCfg.streamline_color
        if (vectorCfg.arrow_color) viz.vectorArrowColor = vectorCfg.arrow_color
        if (vectorCfg.seed_color) viz.vectorSeedColor = vectorCfg.seed_color
      }
    }

    // 3D 体渲染：从 pregenConfig.volume 或 volume_texture 同步
    if (props.dimension === '3d' && props.type3d === 'volume') {
      const volCfg = pregenVolumeConfig.value
      if (volCfg) {
        if (volCfg.resolution) {
          viz.volume_resolution = volCfg.resolution
          viz.volume_res_mode = 'resolution'
        }
        if (volCfg.sampling_ratio) {
          viz.sampling_ratio = volCfg.sampling_ratio
          viz.volume_res_mode = 'sampling'
        }
      }
    }

    // 3D 流线图：从 pregenConfig.streamline 同步
    if (props.dimension === '3d' && props.type3d === 'streamline') {
      const slCfg = pregenStreamlineConfig.value
      if (slCfg) {
        if (!viz.streamline) viz.streamline = {}
        if (slCfg.seed_count != null)
          viz.streamline.seed_count = slCfg.seed_count
        if (slCfg.points_per_streamline != null)
          viz.streamline.points_per_streamline = slCfg.points_per_streamline
        if (slCfg.line_width != null)
          viz.streamline.line_width = slCfg.line_width
        if (slCfg.center != null) viz.streamline.center = slCfg.center
        if (slCfg.radius != null) viz.streamline.radius = slCfg.radius
        if (slCfg.maximum_streamline_length != null) {
          viz.streamline.maximum_streamline_length =
            slCfg.maximum_streamline_length
        }
      }
    }
  },
  { immediate: true, deep: true },
)

// ── 平面 & 坐标更新 ──

const updatePlane = (p) => emit('update:plane', p)
const updateCoordinate = (v) => emit('update:coordinate', v)

const coordinateAxisName = computed(
  () => ({ xy: 'Z', xz: 'Y', yz: 'X' })[props.plane] || 'Z',
)

// ── 数值范围 ──

const effectiveVMin = computed(() => {
  const u = Number(props.visualization?.vmin)
  return Number.isFinite(u) ? u : previewCardVMin.value
})

const effectiveVMax = computed(() => {
  const u = Number(props.visualization?.vmax)
  return Number.isFinite(u) ? u : previewCardVMax.value
})

const formatRangeValue = (v) =>
  Number.isFinite(Number(v)) ? Number(v).toPrecision(4) : '—'

// ── 时间范围 ──

const minPhysicalTime = computed(() => {
  const pts = props.physicalTimes
  if (!Array.isArray(pts) || !pts.length) return null
  const nums = pts.map(Number).filter(Number.isFinite)
  return nums.length ? Math.min(...nums) : null
})

const maxPhysicalTime = computed(() => {
  const pts = props.physicalTimes
  if (!Array.isArray(pts) || !pts.length) return null
  const nums = pts.map(Number).filter(Number.isFinite)
  return nums.length ? Math.max(...nums) : null
})

// ── 色图预选 & 色标管理 ──

const selectedPreviewCmap = computed({
  get: () => props.visualization?.cmap || 'coolwarm',
  set: (v) => {
    if (props.visualization) props.visualization.cmap = v
  },
})

const addColorStop = () => {
  if (!props.visualization) return
  if (!props.visualization.customColorStops)
    props.visualization.customColorStops = []
  props.visualization.customColorStops.push('#888888')
}

const removeColorStop = (index) => {
  if (!props.visualization?.customColorStops) return
  props.visualization.customColorStops.splice(index, 1)
}

// ── 应用进度 & 预览信息 ──

const applyProgress = computed(() => {
  if (props.batchLoading) return props.batchProgress || 0
  if (props.applying) return -1 // indeterminate
  return 100
})

const previewCardRangeSourceHint = computed(() => {
  if (selectedLayerId.value && selectedPreviewLayer.value) {
    return Number.isFinite(Number(selectedPreviewLayer.value?.vmin))
      ? '图层范围'
      : '全局范围'
  }
  const hasUser =
    Number.isFinite(Number(props.visualization?.vmin)) &&
    Number.isFinite(Number(props.visualization?.vmax))
  return hasUser ? '用户设定' : '元数据范围'
})

// ── 活跃图层 ──

const activeVisualizationLayer = computed(() => {
  if (props.dimension === '2d') return props.type2d || 'cloud'
  return props.type3d || 'volume'
})

// 切换图层可见性
const toggleLayerVisibility = (layer, visible) => {
  if (layer) {
    layer.visible = visible
  }
}

// 计算当前可见的图层数量
const visibleLayerCount = computed(() => {
  return previewLayers.value.filter((l) => l.visible !== false).length
})

// 计算图层选择器的显示文本
const layerSelectorLabel = computed(() => {
  if (selectedLayerId.value) {
    const layer = previewLayers.value.find(
      (l) => l.id === selectedLayerId.value,
    )
    return layer ? layer.label || layer.kind : '选择图层'
  }
  const count = visibleLayerCount.value
  return count > 0 ? `已选 ${count} 个图层` : '选择图层'
})
</script>

<template>
  <div class="visualization-options">
    <div class="visual-domain-tabs" role="tablist" aria-label="可视化类型">
      <button
        type="button"
        class="visual-domain-tab"
        :class="{ active: activeVisualDomain === 'gas' }"
        role="tab"
        :aria-selected="activeVisualDomain === 'gas'"
        @click="activeVisualDomain = 'gas'">
        气体
      </button>
      <button
        type="button"
        class="visual-domain-tab"
        :class="{ active: activeVisualDomain === 'radar' }"
        role="tab"
        :aria-selected="activeVisualDomain === 'radar'"
        @click="activeVisualDomain = 'radar'">
        雷达
      </button>
    </div>

    <!-- 可视化图层（云图 / 矢量 / 体渲染 / 流线） -->
    <div v-if="activeVisualDomain === 'gas'" class="panel-section">
      <div class="section-header">
        <el-icon><Picture /></el-icon>
        <span>可视化图层</span>
      </div>
      <div class="section-content">
        <div class="layer-cards viz-guide-type-cards">
          <div
            class="type-card"
            :class="{ active: activeVisualizationLayer === 'cloud' }"
            @click="selectVisualizationLayer('cloud')">
            <div class="card-icon-small">
              <el-icon :size="24"><View /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title-small">云图</div>
              <div class="card-desc-small">二维颜色渐变</div>
            </div>
          </div>
          <div
            class="type-card"
            :class="{ active: activeVisualizationLayer === 'vector' }"
            @click="selectVisualizationLayer('vector')">
            <div class="card-icon-small">
              <el-icon :size="24"><Position /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title-small">矢量图</div>
              <div class="card-desc-small">二维箭头流场</div>
            </div>
          </div>
          <div
            class="type-card"
            :class="{ active: activeVisualizationLayer === 'volume' }"
            @click="selectVisualizationLayer('volume')">
            <div class="card-icon-small">
              <el-icon :size="24"><Histogram /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title-small">体渲染</div>
              <div class="card-desc-small">三维体积显示</div>
            </div>
          </div>
          <div
            class="type-card"
            :class="{ active: activeVisualizationLayer === 'streamline' }"
            @click="selectVisualizationLayer('streamline')">
            <div class="card-icon-small">
              <el-icon :size="24"><Share /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title-small">流线图</div>
              <div class="card-desc-small">三维流动轨迹</div>
            </div>
          </div>
          <div
            class="type-card"
            :class="{ active: activeVisualizationLayer === 'video' }"
            @click="selectVisualizationLayer('video')">
            <div class="card-icon-small">
              <el-icon :size="24"><VideoCamera /></el-icon>
            </div>
            <div class="card-content">
                <div class="card-title-small">视频</div>
                <div class="card-desc-small">模型演示视频</div>
            </div>
          </div>
        </div>

        <!-- 二维平面选择 -->
        <div v-if="dimension === '2d'" style="margin-top: 1.25rem">
          <!-- <div class="sub-section-title">选择平面</div> -->
          <div class="plane-cards viz-guide-plane-cards">
            <div
              class="plane-card"
              :class="{ active: plane === 'xy' }"
              @click="updatePlane('xy')">
              <div class="plane-label">XY</div>
              <div class="plane-desc">水平平面</div>
            </div>
            <div
              class="plane-card"
              :class="{ active: plane === 'xz' }"
              @click="updatePlane('xz')">
              <div class="plane-label">XZ</div>
              <div class="plane-desc">正面平面</div>
            </div>
            <div
              class="plane-card"
              :class="{ active: plane === 'yz' }"
              @click="updatePlane('yz')">
              <div class="plane-label">YZ</div>
              <div class="plane-desc">侧面平面</div>
            </div>
          </div>
        </div>

        <!-- 坐标输入 -->
        <div v-if="dimension === '2d'" style="margin-top: 1.25rem">
          <div class="coordinate-card viz-guide-coordinate">
            <div class="coordinate-label">
              <span class="axis-name">{{ coordinateAxisName }} 轴</span>
              <span class="coordinate-value">{{ coordinate }} cm</span>
            </div>
            <el-input-number
              :model-value="coordinate"
              @update:model-value="updateCoordinate"
              :step="0.1"
              controls-position="right"
              style="width: 100%" />
          </div>
        </div>
      </div>
    </div>

    <!-- 流线图配置：仅 3D 流线图时显示 -->
    <div
      v-if="
        activeVisualDomain === 'gas' &&
        dimension === '3d' &&
        type3d === 'streamline'
      "
      class="panel-section">
      <div class="section-header">
        <el-icon><Position /></el-icon>
        <span>流线图配置</span>
      </div>
      <div class="section-content">
        <el-form class="visualization-form">
          <el-form-item label="种子数">
            <el-input-number
              v-model="visualization.streamline.seed_count"
              :disabled="isUsingPregen && hasPregenStreamlineSeedCount"
              :min="1"
              :max="500"
              controls-position="right"
              style="width: 100%"
              placeholder="50" />
          </el-form-item>
          <el-form-item label="每条流线点数">
            <el-input-number
              v-model="visualization.streamline.points_per_streamline"
              :disabled="
                isUsingPregen && hasPregenStreamlinePointsPerStreamline
              "
              :min="0"
              :max="1000"
              controls-position="right"
              style="width: 100%"
              placeholder="40" />
          </el-form-item>
        </el-form>
      </div>
    </div>

    <!-- 显示设置
         - 2D 云图：显示完整设置
         - 2D 矢量图：只显示「箭头颜色」和「对齐预生成缓存」
         - 3D 流线图：只显示「对齐预生成缓存」
    -->
    <div
      v-if="activeVisualDomain === 'gas'"
      class="panel-section viz-guide-display-settings">
      <div class="section-header">
        <el-icon><Setting /></el-icon>
        <span>显示设置</span>
      </div>
      <div class="section-content">
        <el-form class="visualization-form">
          <!-- 2D 云图：色图、透明度等 -->
          <template v-if="dimension === '2d' && type2d !== 'vector'">
            <el-form-item label="气体变量">
              <div class="volume-variables-tags">
                <el-tag
                  v-for="(variable, index) in visualization?.cloud_variables ||
                  []"
                  :key="'cloud-' + index"
                  class="variable-tag"
                  size="small"
                  effect="dark">
                  {{ getVariableDisplayName(variable) }}
                </el-tag>
                <div
                  v-if="!(visualization?.cloud_variables?.length > 0)"
                  class="no-variables">
                  请在左侧面板勾选云图中的气体与其它场量
                </div>
              </div>
            </el-form-item>

            <!-- <el-form-item label="颜色方案">
              <el-select v-model="visualization.colorScheme" class="w-full">
                <el-option
                  v-for="item in colormaps"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value">
                  <div class="colormap-option-row">
                    <span class="colormap-option-label">{{ item.label }}</span>
                    <span
                      class="colormap-option-gradient"
                      :style="{
                        background: getColormapGradient(item.value),
                      }"></span>
                  </div>
                </el-option>
              </el-select>
            </el-form-item> -->

            <el-form-item
              label="选择色图"
              v-if="visualization.colorScheme === 'custom'">
              <el-select
                v-model="visualization.customColormap"
                placeholder="请选择色图"
                class="viz-form-select w-full"
                popper-class="visualization-select-popper">
                <el-option
                  v-for="item in customColormaps"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value">
                  {{ item.label }}
                </el-option>
              </el-select>
            </el-form-item>

            <div
              v-if="
                visualization.colorScheme === 'custom' &&
                visualization.customColormap === 'manual'
              "
              class="manual-color-editor">
              <!-- 渐变预览条 -->
              <div class="gradient-preview-section">
                <div class="section-title">渐变预览</div>
                <div
                  class="gradient-preview"
                  :style="{ background: manualGradientStyle }"></div>
              </div>

              <!-- 色标编辑区 -->
              <div class="color-stops-section">
                <div class="section-header">
                  <span class="section-title">色标编辑</span>
                  <div class="stop-count">
                    <span class="count-label">色标数量</span>
                    <span class="count-value"
                      >{{ visualization.manualColors.length }}/5</span
                    >
                  </div>
                </div>

                <div class="color-stops-container">
                  <div
                    v-for="(color, index) in visualization.manualColors"
                    :key="index"
                    class="color-stop-item">
                    <!-- 色标指示器 -->
                    <div
                      class="stop-indicator"
                      :style="{ backgroundColor: color }">
                      <div
                        class="stop-marker"
                        :style="{ backgroundColor: color }"></div>
                    </div>

                    <!-- 颜色选择器 -->
                    <div class="color-picker-wrapper">
                      <el-color-picker
                        v-model="visualization.manualColors[index]"
                        show-alpha
                        popper-class="dark-theme-picker"
                        size="large" />
                      <span class="stop-label">{{ index + 1 }}</span>
                    </div>

                    <!-- 删除按钮 -->
                    <button
                      v-if="visualization.manualColors.length > 2"
                      class="delete-stop-btn"
                      @click.stop="removeColorStop(index)">
                      <el-icon><Delete /></el-icon>
                    </button>
                  </div>
                </div>

                <!-- 添加色标按钮 -->
                <button
                  v-if="visualization.manualColors.length < 5"
                  class="add-stop-btn"
                  @click="addColorStop">
                  <el-icon><Plus /></el-icon>
                  <span>添加色标</span>
                </button>
              </div>
            </div>

            <el-form-item label="画质预设">
              <el-select
                v-model="visualization.quality_preset"
                class="viz-form-select w-full"
                popper-class="visualization-select-popper">
                <el-option label="1k" value="1k" />
                <el-option label="2k" value="2k" />
                <el-option label="4k" value="4k" />
              </el-select>
            </el-form-item>

            <el-form-item label="透明背景">
              <div class="switch-with-hint">
                <el-switch
                  v-model="visualization.transparent_background"
                  active-text="开启"
                  inactive-text="关闭"
                  :active-value="true"
                  :inactive-value="false" />
              </div>
            </el-form-item>

            <!-- <el-form-item label="透明度">
              <div class="slider-with-value" style="width: 100%">
                <el-slider
                  v-model="visualization.transparency"
                  :min="0"
                  :max="100"
                  style="flex: 1" />
                <span class="slider-value"
                  >{{ visualization.transparency }}%</span
                >
              </div>
            </el-form-item> -->

            <el-form-item label="自动范围">
              <div class="switch-with-hint">
                <el-switch
                  v-model="visualization.autoRange"
                  active-text="开启"
                  inactive-text="关闭"
                  :active-value="true"
                  :inactive-value="false" />
                <span class="hint-text">开启后自动计算数值范围</span>
              </div>
            </el-form-item>

            <el-form-item v-if="!visualization.autoRange" label="范围">
              <div class="range-param-row">
                <el-input
                  v-model="visualization.vmin"
                  type="number"
                  placeholder="最小值"
                  class="range-param-input" />
                <span class="range-param-sep">~</span>
                <el-input
                  v-model="visualization.vmax"
                  type="number"
                  placeholder="最大值"
                  class="range-param-input" />
              </div>
            </el-form-item>
          </template>

          <!-- 3D 体渲染：分辨率 / 采样比二选一 -->
          <template v-else-if="dimension === '3d' && type3d === 'volume'">
            <el-form-item label="气体变量">
              <div class="volume-variables-tags">
                <el-tag
                  v-for="(variable, index) in visualization?.volume_variables ||
                  []"
                  :key="index"
                  class="variable-tag"
                  size="small"
                  effect="dark">
                  {{ getVariableDisplayName(variable) }}
                </el-tag>
                <div
                  v-if="!visualization?.volume_variables?.length"
                  class="no-variables">
                  请在左侧面板选择变量
                </div>
              </div>
            </el-form-item>
            <el-form-item label="展示">
              <el-radio-group
                v-model="visualization.volume_render_mode"
                size="small"
                class="res-mode-group">
                <el-radio-button value="raymarch">体渲染</el-radio-button>
                <!-- <el-radio-button value="particle">粒子</el-radio-button> -->
              </el-radio-group>
            </el-form-item>
            <el-form-item label="模式">
              <el-radio-group
                v-model="visualization.volume_res_mode"
                :disabled="
                  isUsingPregen &&
                  (hasPregenVolumeResolution || hasPregenVolumeSamplingRatio)
                "
                size="small"
                class="res-mode-group">
                <el-radio-button value="resolution">分辨率</el-radio-button>
                <el-radio-button value="sampling">采样比</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="visualization.volume_res_mode === 'resolution'">
              <template #label>
                <span class="label-with-tip">
                  分辨率
                  <el-tooltip placement="top" effect="dark">
                    <template #content>
                      <div class="setting-tip-content">
                        <div>
                          <strong>volume_resolution：体数据结构化分辨率</strong>
                        </div>
                        <div>
                          与任务创建时的预生成体渲染分辨率（pregen_config）独立；此处仅控制当前「应用设置」时请求
                          /volume 与发给 UE 的网格分辨率。
                        </div>
                        <div>作用：控制体渲染重建网格的精细程度。</div>
                        <div>
                          越大：细节更丰富、边界更平滑；但显存与计算开销更高。
                        </div>
                        <div>
                          越小：速度更快，但细节损失更明显，可能出现块状感。
                        </div>
                      </div>
                    </template>
                    <el-icon class="label-tip-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </span>
              </template>
              <el-input-number
                v-model="visualization.volume_resolution"
                :disabled="isUsingPregen && hasPregenVolumeResolution"
                :min="8"
                :max="512"
                :step="1"
                controls-position="right"
                style="width: 100%"
                placeholder="64" />
            </el-form-item>
            <el-form-item v-else>
              <template #label>
                <span class="label-with-tip">
                  采样比
                  <el-tooltip placement="top" effect="dark">
                    <template #content>
                      <div class="setting-tip-content">
                        <div><strong>sampling_ratio：随机采样比例</strong></div>
                        <div>作用：控制参与体渲染计算的数据采样密度。</div>
                        <div>越大：采样更充分、结果更稳定；但计算更慢。</div>
                        <div>
                          越小：性能更好，但可能出现噪点、细节不连续或漏采样。
                        </div>
                      </div>
                    </template>
                    <el-icon class="label-tip-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </span>
              </template>
              <el-input-number
                v-model="visualization.sampling_ratio"
                :disabled="isUsingPregen && hasPregenVolumeSamplingRatio"
                :min="0.1"
                :max="5"
                :step="0.1"
                controls-position="right"
                style="width: 100%"
                placeholder="1" />
            </el-form-item>
            <!-- TODO:ue启用这两个选项 -->
            <!-- <el-form-item>
              <template #label>
                <span class="label-with-tip">
                  密度系数
                  <el-tooltip placement="top" effect="dark">
                    <template #content>
                      <div class="setting-tip-content">
                        <div><strong>density_scale：密度放大系数</strong></div>
                        <div>作用：控制体数据“有多浓/多不透明”。</div>
                        <div>
                          越大：更容易变实、发白、遮挡更强；细节可能糊成一团。
                        </div>
                        <div>
                          越小：更通透，内部层次更容易看见，但可能太淡。
                        </div>
                      </div>
                    </template>
                    <el-icon class="label-tip-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </span>
              </template>
              <el-input-number
                v-model="visualization.density_scale"
                :min="0.001"
                :max="10000"
                :step="1"
                controls-position="right"
                style="width: 100%"
                placeholder="100" />
            </el-form-item>
            <el-form-item>
              <template #label>
                <span class="label-with-tip">
                  步数
                  <el-tooltip placement="top" effect="dark">
                    <template #content>
                      <div class="setting-tip-content">
                        <div><strong>step_count：沿射线采样步数</strong></div>
                        <div>作用：控制每条视线在体内采样多少次。</div>
                        <div>
                          越大：质量更高、层次更平滑、条带感更少；但性能更贵。
                        </div>
                        <div>越小：性能好，但容易出现分层/断续/漏采样。</div>
                      </div>
                    </template>
                    <el-icon class="label-tip-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </span>
              </template>
              <el-input-number
                v-model="visualization.step_count"
                :min="1"
                :max="4096"
                :step="1"
                controls-position="right"
                style="width: 100%"
                placeholder="128" />
            </el-form-item> -->

            <!-- <div class="volume-csv-perf-subtitle">CSV 性能</div>
            <el-form-item label="启用帧内存缓存">
              <el-switch
                v-model="visualization.volume_csv.enable_frame_memory_cache"
                active-text="开启"
                inactive-text="关闭"
                :active-value="true"
                :inactive-value="false" />
            </el-form-item>
            <el-form-item
              v-if="visualization.volume_csv.enable_frame_memory_cache"
              label="帧缓存最大帧数">
              <el-input-number
                v-model="visualization.volume_csv.frame_memory_cache_max_frames"
                :min="0"
                :max="9999"
                :step="1"
                controls-position="right"
                style="width: 100%" />
            </el-form-item>
            <el-form-item label="启用预加载">
              <el-switch
                v-model="visualization.volume_csv.enable_prefetch"
                active-text="开启"
                inactive-text="关闭"
                :active-value="true"
                :inactive-value="false" />
            </el-form-item>
            <el-form-item
              v-if="visualization.volume_csv.enable_prefetch"
              label="预加载提前帧数">
              <el-input-number
                v-model="visualization.volume_csv.prefetch_ahead_frames"
                :min="0"
                :max="9999"
                :step="1"
                controls-position="right"
                style="width: 100%" />
            </el-form-item>
            <el-form-item
              v-if="visualization.volume_csv.enable_prefetch"
              label="预加载最大并发数">
              <el-input-number
                v-model="
                  visualization.volume_csv.prefetch_max_concurrent_requests
                "
                :min="1"
                :max="64"
                :step="1"
                controls-position="right"
                style="width: 100%" />
            </el-form-item>
            <el-form-item
              v-if="visualization.volume_csv.enable_prefetch"
              label="初始化预取全部帧">
              <el-switch
                v-model="visualization.volume_csv.prefetch_all_frames_at_init"
                active-text="开启"
                inactive-text="关闭"
                :active-value="true"
                :inactive-value="false" />
            </el-form-item>
            <el-form-item label="重初始化时保留 CSV 缓存">
              <el-switch
                v-model="visualization.volume_csv.preserve_csv_cache_on_reinit"
                active-text="开启"
                inactive-text="关闭"
                :active-value="true"
                :inactive-value="false" />
            </el-form-item>
            <el-form-item
              v-if="
                visualization.volume_csv.enable_prefetch &&
                !visualization.volume_csv.prefetch_all_frames_at_init
              "
              label="初始化预热预取帧数">
              <el-input-number
                v-model="
                  visualization.volume_csv.warmup_prefetch_frames_at_init
                "
                :min="0"
                :max="9999"
                :step="1"
                controls-position="right"
                style="width: 100%" />
            </el-form-item> -->
          </template>

          <!-- 2D 矢量图专用：矢量渲染参数 -->
          <el-form-item
            v-if="dimension === '2d' && type2d === 'vector'"
            label="画质预设">
            <el-select
              v-model="visualization.quality_preset"
              :disabled="isUsingPregen && hasPregenVectorQualityPreset"
              class="viz-form-select w-full"
              popper-class="visualization-select-popper">
              <el-option label="1k" value="1k" />
              <el-option label="2k" value="2k" />
              <el-option label="4k" value="4k" />
            </el-select>
          </el-form-item>

          <el-form-item
            v-if="dimension === '2d' && type2d === 'vector'"
            label="透明背景">
            <div class="switch-with-hint">
              <el-switch
                v-model="visualization.transparent_background"
                :disabled="
                  isUsingPregen && hasPregenVectorTransparentBackground
                "
                active-text="开启"
                inactive-text="关闭"
                :active-value="true"
                :inactive-value="false" />
            </div>
          </el-form-item>

          <el-form-item
            v-if="dimension === '2d' && type2d === 'vector'"
            label="箭矢密度">
            <el-input-number
              v-model="visualization.glyph_density"
              :disabled="isUsingPregen && hasPregenVectorGlyphDensity"
              :min="4"
              :max="256"
              :step="1"
              :precision="0"
              controls-position="right"
              style="width: 100%"
              placeholder="4" />
          </el-form-item>

          <el-form-item
            v-if="dimension === '2d' && type2d === 'vector'"
            label="流线线宽">
            <el-input-number
              v-model="visualization.vectorLineWidth"
              :disabled="isUsingPregen && hasPregenVectorLineWidth"
              :min="0.01"
              :max="20"
              :step="0.1"
              controls-position="right"
              style="width: 100%"
              placeholder="1" />
          </el-form-item>

          <el-form-item
            v-if="dimension === '2d' && type2d === 'vector'"
            label="颜色"
            class="vector-color-form-item">
            <div class="vector-color-row">
              <div class="vector-color-trigger-wrap">
                <div
                  class="vector-color-swatch"
                  :style="{
                    backgroundColor: visualization.vectorColor || '#ffffff',
                  }" />
                <el-color-picker
                  v-model="visualization.vectorColor"
                  color-format="hex"
                  :show-alpha="false"
                  popper-class="dark-theme-picker"
                  class="vector-color-picker-overlay" />
              </div>
            </div>
          </el-form-item>

          <el-form-item
            v-if="dimension === '2d' && type2d === 'vector'"
            label="自动范围">
            <div class="switch-with-hint">
              <el-switch
                v-model="visualization.autoRange"
                active-text="开启"
                inactive-text="关闭"
                :active-value="true"
                :inactive-value="false" />
              <span class="hint-text">开启后自动计算数值范围</span>
            </div>
          </el-form-item>

          <el-form-item
            v-if="
              dimension === '2d' &&
              type2d === 'vector' &&
              !visualization.autoRange
            "
            label="范围">
            <div class="range-param-row">
              <el-input
                v-model="visualization.vmin"
                type="number"
                placeholder="最小值"
                class="range-param-input" />
              <span class="range-param-sep">~</span>
              <el-input
                v-model="visualization.vmax"
                type="number"
                placeholder="最大值"
                class="range-param-input" />
            </div>
          </el-form-item>

          <!-- 流线图专用 -->
          <template v-if="dimension === '3d' && type3d === 'streamline'">
            <el-form-item label="线条粗细">
              <el-input-number
                v-model="visualization.streamline.line_width"
                :disabled="isUsingPregen && hasPregenStreamlineLineWidth"
                :min="0.1"
                :max="20"
                :step="0.1"
                controls-position="right"
                style="width: 100%"
                placeholder="0.2" />
            </el-form-item>
            <!-- <el-form-item label="显示时间(秒)">
              <el-input-number
                v-model="visualization.streamline.display_time"
                :min="0.1"
                :max="600"
                :step="0.1"
                controls-position="right"
                style="width: 100%"
                placeholder="5" />
            </el-form-item> -->
            <!-- 流线颜色：色块即 color-picker，16 进制传给 UE -->
            <!-- <el-form-item label="流线颜色" class="vector-color-form-item">
              <div class="vector-color-row">
                <div class="vector-color-trigger-wrap">
                  <div
                    class="vector-color-swatch"
                    :style="{
                      backgroundColor:
                        visualization.streamline.color || '#ffffff',
                    }" />
                  <el-color-picker
                    v-model="visualization.streamline.color"
                    color-format="hex"
                    :show-alpha="false"
                    popper-class="dark-theme-picker"
                    class="vector-color-picker-overlay" />
                </div>
                <span class="vector-color-hex">{{
                  (visualization.streamline.color || '#ffffff').toUpperCase()
                }}</span>
              </div>
            </el-form-item> -->
          </template>
          <el-form-item label="使用预生成数据">
            <div class="switch-with-hint">
              <el-switch
                v-model="visualization.usePregen"
                active-text="开启"
                inactive-text="关闭"
                :active-value="true"
                :inactive-value="false" />
            </div>
          </el-form-item>

          <!-- <el-form-item v-if="is2DCloudOrVector" label="开始物理时间">
            <el-input-number
              v-model="visualization.startTimeStep"
              :min="minPhysicalTime ?? undefined"
              :max="maxPhysicalTime ?? undefined"
              :step="0.01"
              :precision="4"
              controls-position="right"
              style="width: 100%"
              placeholder="例如 0" />
          </el-form-item>

          <el-form-item v-if="is2DCloudOrVector" label="结束物理时间">
            <el-input-number
              v-model="visualization.endTimeStep"
              :min="minPhysicalTime ?? undefined"
              :max="maxPhysicalTime ?? undefined"
              :step="0.01"
              :precision="4"
              controls-position="right"
              style="width: 100%"
              placeholder="例如 100" />
          </el-form-item> -->

          <!-- <el-form-item v-if="is2DCloudOrVector" label="物理时间范围">
            <div class="time-range-row">
              <el-input-number
                v-model="visualization.startTimeStep"
                :min="minPhysicalTime ?? undefined"
                :max="maxPhysicalTime ?? undefined"
                :step="0.01"
                :precision="4"
                controls-position="right"
                class="time-step-input" />
              <span class="time-range-sep">~</span>
              <el-input-number
                v-model="visualization.endTimeStep"
                :min="minPhysicalTime ?? undefined"
                :max="maxPhysicalTime ?? undefined"
                :step="0.01"
                :precision="4"
                controls-position="right"
                class="time-step-input" />
              <span class="time-range-hint">
                当前任务: {{ minPhysicalTime?.toFixed(4) ?? '-' }} / {{ maxPhysicalTime?.toFixed(4) ?? '-' }} s
              </span>
            </div>
          </el-form-item> -->

          <!-- <el-form-item label="动画速度">
            <div class="slider-with-value" style="width: 100%">
              <el-slider
                v-model="visualization.animationSpeed"
                :min="0"
                :max="100"
                style="flex: 1" />
              <span class="slider-value"
                >{{ visualization.animationSpeed }}%</span
              >
            </div>
          </el-form-item> -->

          <!-- <el-form-item label="动画速度">
            <div class="slider-with-value" style="width: 100%">
              <el-slider
                v-model="visualization.animationSpeed"
                :min="1"
                :max="200"
                style="flex: 1" />
              <span class="slider-value"
                >{{ visualization.animationSpeed }}%</span
              >
            </div>
          </el-form-item> -->
        </el-form>
      </div>
    </div>

    <!-- 图层控制 -->
    <!-- <div class="panel-section">
      <div class="section-header">
        <el-icon><View /></el-icon>
        <span>图层控制</span>
      </div>
      <div class="section-content">
        <el-checkbox-group v-model="visualization.layers">
          <el-checkbox label="temperature">
            <el-icon style="margin-right: 0.5rem"><View /></el-icon>
            温度层
          </el-checkbox>
          <el-checkbox label="humidity">
            <el-icon style="margin-right: 0.5rem"><View /></el-icon>
            湿度层
          </el-checkbox>
          <el-checkbox label="pressure">
            <el-icon style="margin-right: 0.5rem"><View /></el-icon>
            压力层
          </el-checkbox>
          <el-checkbox label="windFlow">
            <el-icon style="margin-right: 0.5rem"><View /></el-icon>
            风场层
          </el-checkbox>
        </el-checkbox-group>
      </div>
    </div> -->

    <!-- 预设方案 -->
    <!-- <div class="panel-section">
      <div class="section-header">
        <el-icon><Star /></el-icon>
        <span>预设方案</span>
      </div>
      <div class="section-content">
        <div class="preset-buttons">
          <el-button-group style="width: 100%">
            <el-button style="flex: 1" @click="emit('load-preset', 'standard')"
              >标准</el-button
            >
            <el-button style="flex: 1" @click="emit('load-preset', 'thermal')"
              >热力图</el-button
            >
            <el-button style="flex: 1" @click="emit('load-preset', 'wind')"
              >风场</el-button
            >
          </el-button-group>
          <el-button
            style="width: 100%; margin-top: 0.5rem"
            @click="emit('load-preset', 'comprehensive')"
            >综合视图</el-button
          >
        </div>
      </div>
    </div> -->

    <!-- 图片预览区域 -->
    <div
      v-if="activeVisualDomain === 'gas' && dimension === '2d'"
      class="panel-section viz-guide-preview-info">
      <div class="section-header">
        <el-icon><Monitor /></el-icon>
        <span>预览信息</span>
      </div>
      <div class="section-content">
        <div class="preview-container">
          <div class="preview-header">
            <div
              class="preview-icon"
              :class="{ 'is-clickable': resolvedPreviewImage }"
              @click="handlePreview">
              <div
                v-if="resolvedPreviewImage"
                class="sprite-preview"
                :style="thumbnailPreviewStyle"></div>
              <el-icon v-else :size="48"><Picture /></el-icon>
            </div>
            <div class="preview-status">
              <div
                class="status-badge"
                :class="{ 'is-active': resolvedPreviewImage }">
                {{ resolvedPreviewImage ? '预览已生成' : '准备就绪' }}
              </div>
              <div class="status-text">
                {{
                  resolvedPreviewImage
                    ? '点击图片可放大查看详情'
                    : '等待应用设置生成预览'
                }}
              </div>
            </div>
          </div>

          <!-- 多图层切换：显示在下拉中 -->
          <div v-if="multiLayerCount > 0" class="preview-layer-switcher">
            <span class="layer-switcher-label">图层：</span>
            <el-select
              v-model="selectedLayerId"
              size="small"
              :placeholder="layerSelectorLabel"
              clearable
              teleported
              @change="(v) => emit('update:selectedLayerId', v)"
              class="preview-layer-select">
              <el-option
                v-for="layer in previewLayers"
                :key="layer.id"
                :label="layer.label || layer.kind"
                :value="layer.id">
                <div
                  style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                  ">
                  <el-checkbox
                    :model-value="layer.visible !== false"
                    @change="(val) => toggleLayerVisibility(layer, val)"
                    @click.stop
                    style="margin-right: 4px" />
                  <span>{{ layer.label || layer.kind }}</span>
                </div>
              </el-option>
            </el-select>
          </div>

          <!-- 全屏预览组件 -->
          <SpriteImageViewer
            v-if="previewVisible"
            :visible="previewVisible"
            :url="resolvedPreviewImage"
            :rows="rows"
            :cols="cols"
            :currentStep="currentStep"
            :frameCount="Math.max(1, frameCount || 1)"
            :physical-width="physicalWidth"
            :physical-height="physicalHeight"
            :physicalTimes="physicalTimes"
            :vmin="effectiveVMin"
            :vmax="effectiveVMax"
            :cmap="selectedPreviewCmap"
            :variable="visualization.variable"
            :show-colorbar="!(dimension === '2d' && type2d === 'vector')"
            :layers="previewLayers"
            :selected-layer-id="selectedLayerId"
            :gas-cmaps="gasCmaps"
            :color-map-catalog="colorMapCatalog"
            :task-id="taskId"
            :plane="previewCardPlane"
            :plane-offset="previewCardCoordinate"
            @update:currentStep="emit('update:currentStep', $event)"
            @update:selectedLayerId="selectedLayerId = $event"
            @close="previewVisible = false" />

          <div class="preview-info-cards">
            <div class="info-card">
              <div class="info-icon">
                <el-icon :size="20"><Monitor /></el-icon>
              </div>
              <div class="info-content">
                <div class="info-label">可视化类型</div>
                <div class="info-value">
                  {{ previewCardVisualizationType }}
                </div>
              </div>
            </div>

            <div class="info-card">
              <div class="info-icon">
                <el-icon :size="20"><Grid /></el-icon>
              </div>
              <div class="info-content">
                <div class="info-label">切片平面</div>
                <div class="info-value">
                  {{ previewCardPlane.toUpperCase() }} 平面
                </div>
              </div>
            </div>

            <div class="info-card">
              <div class="info-icon">
                <el-icon :size="20"><Position /></el-icon>
              </div>
              <div class="info-content">
                <div class="info-label">坐标位置</div>
                <div class="info-value">
                  {{ previewCardAxisName }} = {{ previewCardCoordinate }}cm
                </div>
              </div>
            </div>

            <!-- <div class="info-card" v-if="resolvedPreviewImage">
              <div class="info-icon">
                <el-icon :size="20"><Histogram /></el-icon>
              </div>
              <div class="info-content">
                <div class="info-label">数值范围 (min - max)</div>
                <div class="info-value">
                  <div class="range-display-row">
                    <span
                      >{{ formatRangeValue(previewCardVMin) }} -
                      {{ formatRangeValue(previewCardVMax) }}</span
                    >
                    <span class="range-source-hint">{{
                      previewCardRangeSourceHint
                    }}</span>
                  </div>
                </div>
              </div>
            </div> -->
          </div>
        </div>
      </div>
    </div>

    <template v-if="activeVisualDomain === 'radar'">
      <div class="panel-section">
        <div class="section-header">
          <el-icon><Picture /></el-icon>
          <span>雷达渲染模式</span>
        </div>
        <div class="section-content">
          <div class="layer-cards viz-guide-type-cards">
            <div
              class="type-card"
              :class="{ active: activeVisualizationLayer === 'cloud' }"
              @click="selectRadarVisualizationLayer('cloud')">
              <div class="card-icon-small">
                <el-icon :size="24"><View /></el-icon>
              </div>
              <div class="card-content">
                <div class="card-title-small">波前传播动画</div>
                <div class="card-desc-small">类似等值面/膨胀球动画</div>
              </div>
            </div>
            <div
              class="type-card"
              :class="{ active: activeVisualizationLayer === 'vector' }"
              @click="selectRadarVisualizationLayer('vector')">
              <div class="card-icon-small">
                <el-icon :size="24"><Position /></el-icon>
              </div>
              <div class="card-content">
                <div class="card-title-small">场强热力图</div>
                <div class="card-desc-small">高反射区域高亮</div>
              </div>
            </div>
            <div
              class="type-card"
              :class="{ active: activeVisualizationLayer === 'streamline' }"
              @click="selectRadarVisualizationLayer('streamline')">
              <div class="card-icon-small">
                <el-icon :size="24"><Share /></el-icon>
              </div>
              <div class="card-content">
                <div class="card-title-small">能量轨迹线</div>
                <div class="card-desc-small">模拟辐射能量传播方向</div>
              </div>
            </div>
            <div
              class="type-card"
              :class="{ active: activeVisualizationLayer === 'volume' }"
              @click="selectRadarVisualizationLayer('volume')">
              <div class="card-icon-small">
                <el-icon :size="24"><Histogram /></el-icon>
              </div>
              <div class="card-content">
                <div class="card-title-small">介质结构叠加</div>
                <div class="card-desc-small">辅助定位波与结构交互区域</div>
              </div>
            </div>
          </div>

          <div class="radar-config-card">
            <div class="radar-config-row">
              <span>模式名称</span>
              <strong>{{ activeRadarModeConfig.label }}</strong>
            </div>
            <div class="radar-config-row">
              <span>描述</span>
              <strong>{{ activeRadarModeConfig.description }}</strong>
            </div>
            <div class="radar-config-row">
              <span>渲染目标</span>
              <strong>{{ activeRadarModeConfig.target }}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-header">
          <el-icon><Setting /></el-icon>
          <span>雷达参数设置</span>
        </div>
        <div class="section-content">
          <el-form class="visualization-form">
            <el-form-item label="发射频率(GHz)">
              <el-select
                v-model="visualization.radar_frequency_ghz"
                class="w-full">
                <el-option :value="0.4" label="0.4" />
                <el-option :value="0.8" label="0.8" />
                <el-option :value="2.4" label="2.4" />
                <el-option :value="5.8" label="5.8" />
                <el-option :value="7.9" label="7.9" />
              </el-select>
            </el-form-item>
            <el-form-item label="带宽(MHz)">
              <el-input-number
                v-model="visualization.radar_bandwidth_mhz"
                :min="1"
                :max="2000"
                :step="10"
                controls-position="right"
                style="width: 100%" />
            </el-form-item>
            <el-form-item label="发射功率(dBm)">
              <el-input-number
                v-model="visualization.radar_transmit_power_dbm"
                :min="-50"
                :max="60"
                :step="1"
                controls-position="right"
                style="width: 100%" />
            </el-form-item>
            <el-form-item label="发射方式">
              <el-select
                v-model="visualization.radar_transmit_mode"
                class="w-full">
                <el-option label="单向" value="单向" />
                <el-option label="扇形" value="扇形" />
              </el-select>
            </el-form-item>
            <el-form-item label="接收方式">
              <el-select
                v-model="visualization.radar_receive_mode"
                class="w-full">
                <el-option label="单站雷达回波" value="单站雷达回波" />
                <el-option label="双站雷达回波" value="双站雷达回波" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
      </div>
    </template>

    <!-- 操作按钮 -->
    <div class="settings-actions">
      <!-- 批量加载进度条 -->
      <div v-if="batchLoading" class="batch-loading-progress">
        <div class="progress-header">
          <span class="progress-title">
            <el-icon class="loading-icon"><Loading /></el-icon>
            {{ loadingText }}
          </span>
          <span class="progress-text">
            {{ batchProgress }}% · {{ batchProgressDetail }}
          </span>
        </div>
        <el-progress
          :percentage="batchProgress"
          :stroke-width="8"
          :show-text="false"
          color="#00d4ff"
          class="progress-bar" />
      </div>

      <!-- 应用设置进度条 -->
      <!-- <div v-if="applying || applyProgress > 0" class="apply-progress-wrap">
        <div class="progress-label">正在应用可视化设置...</div>
        <el-progress
          :percentage="applyProgress"
          :stroke-width="8"
          :show-text="true"
          :format="(p) => `${p}%`" />
      </div> -->

      <!-- 自动更新开关 -->
      <el-button
        type="primary"
        class="viz-guide-apply-btn"
        :icon="Check"
        :loading="false"
        :disabled="false"
        @click="handleApply"
        style="width: 100%">
        应用设置
      </el-button>
      <el-button
        type="success"
        class="viz-guide-recognize-btn"
        :icon="Loading"
        :disabled="applying || batchLoading"
        @click="emit('start-recognition')"
        style="width: 100%; margin-top: 0.5rem">
        开始识别
      </el-button>
      <el-button
        :icon="Delete"
        :disabled="applying || batchLoading"
        @click="emit('reset')"
        style="width: 100%; margin-top: 0.5rem">
        重置设置
      </el-button>
    </div>
  </div>
</template>

<style scoped src="@/assets/styles/components/VisualizationOptions.css"></style>
