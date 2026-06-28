<script setup>
import { computed, ref, watch } from 'vue'
import {
  View,
  Position,
  Share,
  Histogram,
  Check,
  Loading,
} from '@element-plus/icons-vue'
import {
  RADAR_FREQUENCY_OPTIONS,
  sanitizeRadarFrequencies,
} from '@/constants/radarFrequencies.js'

const props = defineProps({
  theme: {
    type: String,
    default: 'leida',
    validator: (v) => ['leida', 'default'].includes(v),
  },
  showTypes: { type: Boolean, default: true },
  showModes: { type: Boolean, default: true },
  showParams: { type: Boolean, default: true },
  /** 结果可视化：按当前模式展示发射点、流线/体渲染等参数 */
  showVizParams: { type: Boolean, default: false },
  taskId: { type: String, default: '' },
  visualization: { type: Object, required: true },
  dimension: { type: String, default: '3d' },
  type2d: { type: String, default: 'cloud' },
  type3d: { type: String, default: 'volume' },
  radarResultMode: { type: String, default: '' },
  radarFrequencies: { type: Array, default: () => [] },
  applying: { type: Boolean, default: false },
  batchLoading: { type: Boolean, default: false },
  showApply: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
  showSummary: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:radarFrequencies',
  'update:dimension',
  'update:type2d',
  'update:type3d',
  'update:radarResultMode',
  'apply',
])

function radarListSignature(ids) {
  return sanitizeRadarFrequencies(ids).join('|')
}

const selectedRadarIds = ref(sanitizeRadarFrequencies(props.radarFrequencies))

watch(
  () => props.radarFrequencies,
  (rf) => {
    const next = sanitizeRadarFrequencies(rf)
    if (radarListSignature(next) === radarListSignature(selectedRadarIds.value)) {
      return
    }
    selectedRadarIds.value = next
  },
  { deep: true },
)

watch(
  selectedRadarIds,
  () => {
    const next = sanitizeRadarFrequencies(selectedRadarIds.value)
    if (radarListSignature(next) === radarListSignature(props.radarFrequencies)) {
      return
    }
    emit('update:radarFrequencies', next)
  },
  { deep: true },
)

const radarModeConfigs = {
  wavefront: {
    label: '波前传播动画',
    description: '随时间推移动画渲染电磁波前',
    target: '类似等值面/膨胀球动画',
  },
  heatmap: {
    label: '场强热力图',
    description: '用色阶表示局部电场强度',
    target: '高反射区域高亮',
  },
  trails: {
    label: '能量轨迹线',
    description: '用粒子或路径线表示能量流向',
    target: '模拟辐射能量传播方向',
  },
  structure: {
    label: '介质结构叠加',
    description: '半透明墙体显示',
    target: '辅助定位波与结构交互区域',
  },
}

const legacyRadarModeMap = {
  cloud: 'wavefront',
  vector: 'heatmap',
  streamline: 'trails',
  volume: 'structure',
}

const radarModeToVisualizationType = {
  wavefront: { dimension: '2d', type: 'cloud' },
  heatmap: { dimension: '2d', type: 'vector' },
  trails: { dimension: '3d', type: 'streamline' },
  structure: { dimension: '3d', type: 'volume' },
}

function normalizeRadarResultMode(mode) {
  const key = String(mode || '').trim()
  return legacyRadarModeMap[key] || key || 'wavefront'
}

const activeVisualizationLayer = computed(() => {
  if (props.radarResultMode) return normalizeRadarResultMode(props.radarResultMode)
  if (props.dimension === '2d') return normalizeRadarResultMode(props.type2d || 'cloud')
  return normalizeRadarResultMode(props.type3d || 'volume')
})

const activeRadarModeConfig = computed(
  () => radarModeConfigs[activeVisualizationLayer.value] || radarModeConfigs.wavefront,
)

const modeCards = [
  { id: 'wavefront', icon: View, ...radarModeConfigs.wavefront },
  { id: 'heatmap', icon: Position, ...radarModeConfigs.heatmap },
  { id: 'trails', icon: Share, ...radarModeConfigs.trails },
  // { id: 'structure', icon: Histogram, ...radarModeConfigs.structure },
]

const RADAR_CENTER_FREQUENCY_GHZ_OPTIONS = [0.4, 0.8, 2.4, 5.8, 7.9]
const RADAR_WAVEFRONT_DIMENSION_OPTIONS = [
  { value: '2d', label: '二维', hint: '平面波前云图' },
  { value: '3d', label: '三维', hint: '空间波前动画' },
]

function normalizeRadarCenterFrequencyGhz(value) {
  const n = Number(value)
  if (RADAR_CENTER_FREQUENCY_GHZ_OPTIONS.includes(n)) return n
  return 2.4
}

function ensureRadarDefaults() {
  const viz = props.visualization
  if (!viz) return
  viz.radar_frequency_ghz = normalizeRadarCenterFrequencyGhz(viz.radar_frequency_ghz)
  if (viz.radar_bandwidth_mhz == null) viz.radar_bandwidth_mhz = 500
  if (viz.radar_transmit_power_dbm == null) viz.radar_transmit_power_dbm = 20
  if (
    viz.radar_transmit_mode == null ||
    !['单向', '扇形'].includes(viz.radar_transmit_mode)
  ) {
    viz.radar_transmit_mode = '单向'
  }
  if (viz.radar_receive_mode == null) viz.radar_receive_mode = '单站雷达回波'
  if (!viz.radar_emitter || typeof viz.radar_emitter !== 'object') {
    viz.radar_emitter = { x: 0, y: 0, z: 0 }
  }
}

function normalizeRadarWavefrontDimensions(value) {
  const source = Array.isArray(value) ? value : []
  const next = RADAR_WAVEFRONT_DIMENSION_OPTIONS
    .map((item) => item.value)
    .filter((value) => source.includes(value))
  return next.length ? next : ['3d']
}

function ensureRadarWavefrontDimensions() {
  const viz = props.visualization
  if (!viz) return
  const next = normalizeRadarWavefrontDimensions(viz.radar_wavefront_dimensions)
  if (
    !Array.isArray(viz.radar_wavefront_dimensions) ||
    next.join('|') !== viz.radar_wavefront_dimensions.join('|')
  ) {
    viz.radar_wavefront_dimensions = next
  }
}

const showStreamlineConfig = computed(
  () =>
    activeVisualizationLayer.value === 'trails' &&
    (props.showVizParams || props.showParams),
)

const showVolumeVizConfig = computed(
  () =>
    activeVisualizationLayer.value === 'structure' &&
    props.showVizParams,
)

const showPlaneVizConfig = computed(
  () =>
    ['wavefront', 'heatmap'].includes(activeVisualizationLayer.value) &&
    props.showVizParams,
)

const showWavefrontDimensionConfig = computed(
  () =>
    activeVisualizationLayer.value === 'wavefront' &&
    props.showVizParams,
)

function ensureRadarTrailsDefaults() {
  const viz = props.visualization
  if (!viz) return
  if (!viz.radar_trails || typeof viz.radar_trails !== 'object') {
    viz.radar_trails = {}
  }
  const rt = viz.radar_trails
  const legacy = viz.streamline && typeof viz.streamline === 'object' ? viz.streamline : {}
  if (rt.seed_count == null) rt.seed_count = legacy.seed_count ?? 28
  if (rt.points_per_streamline == null) rt.points_per_streamline = legacy.points_per_streamline ?? 36
  if (rt.line_width == null) rt.line_width = legacy.line_width ?? 0.38
  if (rt.display_time == null) rt.display_time = legacy.display_time ?? 5
  if (rt.color == null) rt.color = legacy.color ?? '#ff3b30'
}

watch(
  showStreamlineConfig,
  (visible) => {
    if (visible) ensureRadarTrailsDefaults()
  },
  { immediate: true },
)

watch(
  showWavefrontDimensionConfig,
  (visible) => {
    if (visible) ensureRadarWavefrontDimensions()
  },
  { immediate: true },
)

function selectRadarVisualizationLayer(layer) {
  const radarLayer = normalizeRadarResultMode(layer)
  ensureRadarDefaults()
  if (radarLayer === 'wavefront') {
    ensureRadarWavefrontDimensions()
  }
  if (radarLayer === 'trails') {
    ensureRadarTrailsDefaults()
  }
  emit('update:radarResultMode', radarLayer)
  if (props.radarResultMode) return
  const mapped = radarModeToVisualizationType[radarLayer]
  if (!mapped) return
  if (mapped.dimension === '2d') {
    emit('update:dimension', '2d')
    emit('update:type2d', mapped.type)
  } else {
    emit('update:dimension', '3d')
    emit('update:type3d', mapped.type)
  }
}

const isLeidaTheme = computed(() => props.theme === 'leida')

const selectedRadarLabels = computed(() => {
  const labels = RADAR_FREQUENCY_OPTIONS.filter((opt) =>
    selectedRadarIds.value.includes(opt.id),
  ).map((opt) => opt.label)
  return labels.length ? labels.join('、') : '未选择'
})

const summaryRows = computed(() => {
  const viz = props.visualization
  const radarDimension =
    activeVisualizationLayer.value === 'wavefront'
      ? normalizeRadarWavefrontDimensions(viz?.radar_wavefront_dimensions)
          .map((value) => (value === '2d' ? '二维' : '三维'))
          .join(' + ')
      : radarModeToVisualizationType[activeVisualizationLayer.value]?.dimension || props.dimension
  const rows = [
    { label: '雷达类型', value: selectedRadarLabels.value },
    { label: '可视化', value: activeRadarModeConfig.value.label },
    { label: '维度', value: radarDimension === '2d' ? '二维' : radarDimension === '3d' ? '三维' : radarDimension },
  ]
  if (viz?.radar_frequency_ghz != null) {
    rows.push({ label: '中心频率', value: `${viz.radar_frequency_ghz} GHz` })
  }
  if (viz?.radar_bandwidth_mhz != null) {
    rows.push({ label: '带宽', value: `${viz.radar_bandwidth_mhz} MHz` })
  }
  if (viz?.radar_transmit_power_dbm != null) {
    rows.push({ label: '发射功率', value: `${viz.radar_transmit_power_dbm} dBm` })
  }
  return rows
})
</script>

<template>
  <div
    class="radar-viz-controls"
    :class="{
      'is-leida': isLeidaTheme,
      'is-default': !isLeidaTheme,
      'is-compact': compact,
    }">
    <section v-if="showSummary" class="rvc-section rvc-summary">
      <h4 class="rvc-section-title">当前配置</h4>
      <dl class="rvc-summary-grid">
        <template v-for="row in summaryRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="showTypes && taskId" class="rvc-section">
      <h4 class="rvc-section-title">雷达类型</h4>
      <el-checkbox-group
        v-model="selectedRadarIds"
        class="rvc-type-group">
        <el-checkbox
          v-for="opt in RADAR_FREQUENCY_OPTIONS"
          :key="opt.id"
          :label="opt.id"
          class="rvc-type-item">
          <span class="rvc-type-label">{{ opt.label }}</span>
          <span v-if="opt.hint" class="rvc-type-hint">{{ opt.hint }}</span>
        </el-checkbox>
      </el-checkbox-group>
    </section>

    <section v-if="showModes" class="rvc-section">
      <h4 class="rvc-section-title">可视化模式</h4>
      <div class="rvc-mode-grid">
        <button
          v-for="card in modeCards"
          :key="card.id"
          type="button"
          class="rvc-mode-card"
          :class="[`mode-${card.id}`, { active: activeVisualizationLayer === card.id }]"
          @click="selectRadarVisualizationLayer(card.id)">
          <span class="rvc-mode-main">
            <span class="rvc-mode-icon"><component :is="card.icon" /></span>
            <span class="rvc-mode-text">
              <strong>{{ card.label }}</strong>
              <small>{{ card.target }}</small>
            </span>
          </span>
          <span class="rvc-mode-preview" aria-hidden="true">
            <span v-if="card.id === 'wavefront'" class="rvc-preview-wave">
              <i v-for="n in 4" :key="n" :style="{ '--i': n }"></i>
              <b></b>
            </span>
            <span v-else-if="card.id === 'heatmap'" class="rvc-preview-heat">
              <i></i>
              <b></b>
            </span>
            <span v-else-if="card.id === 'trails'" class="rvc-preview-trail">
              <svg viewBox="0 0 96 44" focusable="false">
                <path d="M5 28 C26 10 42 14 55 24 S78 42 91 18" />
                <path d="M10 36 C30 28 39 34 51 22 S72 4 88 12" />
                <circle cx="38" cy="18" r="3" />
                <circle cx="70" cy="32" r="2.5" />
              </svg>
            </span>
            <span v-else class="rvc-preview-medium">
              <i class="layer a"></i>
              <i class="layer b"></i>
              <i class="layer c"></i>
              <i class="bar one"></i>
              <i class="bar two"></i>
              <b></b>
            </span>
          </span>
        </button>
      </div>
      <div class="rvc-mode-desc">
        <span>描述</span>
        <strong>{{ activeRadarModeConfig.description }}</strong>
      </div>
    </section>

    <section v-if="showWavefrontDimensionConfig" class="rvc-section">
      <h4 class="rvc-section-title">波前显示维度</h4>
      <el-checkbox-group
        v-model="visualization.radar_wavefront_dimensions"
        class="rvc-dim-group"
        @change="ensureRadarWavefrontDimensions">
        <el-checkbox
          v-for="opt in RADAR_WAVEFRONT_DIMENSION_OPTIONS"
          :key="opt.value"
          :label="opt.value"
          class="rvc-dim-item">
          <span class="rvc-type-label">{{ opt.label }}</span>
          <span class="rvc-type-hint">{{ opt.hint }}</span>
        </el-checkbox>
      </el-checkbox-group>
    </section>

    <section v-if="showStreamlineConfig" class="rvc-section">
      <h4 class="rvc-section-title">能量轨迹线</h4>
      <div class="rvc-params-grid">
        <label class="rvc-field">
          <span>轨迹数量</span>
          <el-input-number
            v-model="visualization.radar_trails.seed_count"
            :min="4"
            :max="120"
            :step="1"
            controls-position="right"
            class="rvc-el-number"
            @focus="ensureRadarTrailsDefaults" />
        </label>
        <label class="rvc-field">
          <span>每线点数</span>
          <el-input-number
            v-model="visualization.radar_trails.points_per_streamline"
            :min="8"
            :max="96"
            :step="1"
            controls-position="right"
            class="rvc-el-number"
            @focus="ensureRadarTrailsDefaults" />
        </label>
        <label class="rvc-field">
          <span>线宽</span>
          <el-input-number
            v-model="visualization.radar_trails.line_width"
            :min="0.01"
            :max="2"
            :step="0.05"
            controls-position="right"
            class="rvc-el-number"
            @focus="ensureRadarTrailsDefaults" />
        </label>
        <label class="rvc-field">
          <span>轨迹颜色</span>
          <el-color-picker
            v-model="visualization.radar_trails.color"
            class="rvc-color-picker"
            @focus="ensureRadarTrailsDefaults" />
        </label>
        <label class="rvc-field">
          <span>发射方式</span>
          <el-select
            v-model="visualization.radar_transmit_mode"
            class="rvc-el-select"
            popper-class="visualization-select-popper"
            @focus="ensureRadarDefaults">
            <el-option label="单向" value="单向" />
            <el-option label="扇形" value="扇形" />
          </el-select>
        </label>
      </div>
    </section>

    <section v-if="showVolumeVizConfig" class="rvc-section">
      <h4 class="rvc-section-title">介质结构叠加</h4>
      <div class="rvc-params-grid">
        <label class="rvc-field">
          <span>体分辨率</span>
          <el-input-number
            v-model="visualization.volume_resolution"
            :min="24"
            :max="96"
            :step="4"
            controls-position="right"
            class="rvc-el-number" />
        </label>
        <label class="rvc-field">
          <span>结构透明度</span>
          <el-input-number
            v-model="visualization.model_opacity"
            :min="0.05"
            :max="1"
            :step="0.05"
            controls-position="right"
            class="rvc-el-number" />
        </label>
      </div>
    </section>

    <section v-if="showPlaneVizConfig" class="rvc-section">
      <h4 class="rvc-section-title">平面可视化</h4>
      <div class="rvc-params-grid">
        <label class="rvc-field">
          <span>透明度</span>
          <el-input-number
            v-model="visualization.transparency"
            :min="0"
            :max="100"
            :step="5"
            controls-position="right"
            class="rvc-el-number" />
        </label>
        <label class="rvc-field">
          <span>动画速度</span>
          <el-input-number
            v-model="visualization.animationSpeed"
            :min="1"
            :max="100"
            :step="1"
            controls-position="right"
            class="rvc-el-number" />
        </label>
      </div>
    </section>

    <section v-if="showParams" class="rvc-section">
      <h4 class="rvc-section-title">配置参数</h4>
      <div class="rvc-params-grid">
        <label class="rvc-field">
          <span>中心工作频率（GHz）</span>
          <el-select
            v-model="visualization.radar_frequency_ghz"
            class="rvc-el-select"
            popper-class="visualization-select-popper"
            @focus="ensureRadarDefaults"
            @change="ensureRadarDefaults">
            <el-option
              v-for="ghz in RADAR_CENTER_FREQUENCY_GHZ_OPTIONS"
              :key="ghz"
              :value="ghz"
              :label="String(ghz)" />
          </el-select>
        </label>
        <label class="rvc-field">
          <span>带宽（MHz）</span>
          <el-input-number
            v-model="visualization.radar_bandwidth_mhz"
            :min="1"
            :max="2000"
            :step="10"
            controls-position="right"
            class="rvc-el-number"
            @focus="ensureRadarDefaults" />
        </label>
        <label class="rvc-field">
          <span>发射功率（dBm）</span>
          <el-input-number
            v-model="visualization.radar_transmit_power_dbm"
            :min="-50"
            :max="60"
            :step="1"
            controls-position="right"
            class="rvc-el-number"
            @focus="ensureRadarDefaults" />
        </label>
        <label class="rvc-field">
          <span>发射方式</span>
          <el-select
            v-model="visualization.radar_transmit_mode"
            class="rvc-el-select"
            popper-class="visualization-select-popper">
            <el-option label="单向" value="单向" />
            <el-option label="扇形" value="扇形" />
          </el-select>
        </label>
        <label class="rvc-field rvc-field-full">
          <span>接收方式</span>
          <el-select
            v-model="visualization.radar_receive_mode"
            class="rvc-el-select"
            popper-class="visualization-select-popper">
            <el-option label="单站雷达回波" value="单站雷达回波" />
            <el-option label="双站雷达回波" value="双站雷达回波" />
          </el-select>
        </label>
      </div>
    </section>

    <button
      v-if="showApply"
      type="button"
      class="rvc-apply-btn"
      :disabled="applying || batchLoading"
      @click="emit('apply')">
      <el-icon v-if="applying || batchLoading" class="is-loading"><Loading /></el-icon>
      <el-icon v-else><Check /></el-icon>
      应用设置
    </button>
  </div>
</template>

<style scoped>
.radar-viz-controls.is-compact {
  gap: 10px;
}

.radar-viz-controls.is-compact .rvc-section + .rvc-section {
  padding-top: 10px;
}

.rvc-summary-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid rgba(0, 243, 255, 0.12);
  background: rgba(0, 243, 255, 0.04);
}

.rvc-summary-grid dt {
  margin: 0;
  font-size: 11px;
  color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
  white-space: nowrap;
}

.rvc-summary-grid dd {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, rgba(255, 255, 255, 0.88));
  text-align: right;
  word-break: break-word;
}

.is-compact .rvc-type-item {
  padding: 6px 8px;
}

.is-compact .rvc-mode-card {
  padding: 8px;
  gap: 6px;
}

.is-compact .rvc-mode-preview {
  height: 34px;
}

.is-compact .rvc-params-grid {
  gap: 6px 10px;
}

.is-compact .rvc-apply-btn {
  height: 34px;
  margin-top: 0;
}

.radar-viz-controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rvc-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rvc-section + .rvc-section {
  padding-top: 12px;
  border-top: 1px solid rgba(0, 243, 255, 0.12);
}

.rvc-section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: rgba(0, 243, 255, 0.85);
  text-transform: uppercase;
}

.is-leida .rvc-section-title {
  font-family: var(--font-family-tech, inherit);
}

.rvc-type-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rvc-dim-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.rvc-type-item,
.rvc-dim-item {
  display: flex;
  align-items: flex-start;
  margin-right: 0;
  height: auto;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid rgba(0, 243, 255, 0.12);
  background: rgba(0, 243, 255, 0.03);
}

.rvc-type-item :deep(.el-checkbox__label),
.rvc-dim-item :deep(.el-checkbox__label) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.35;
  color: var(--text-secondary, rgba(235, 245, 255, 0.88));
  white-space: normal;
}

.rvc-type-label {
  font-size: 13px;
  font-weight: 500;
}

.rvc-type-hint {
  font-size: 11px;
  opacity: 0.72;
}

.rvc-mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.rvc-mode-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(0, 243, 255, 0.16);
  border-radius: 4px;
  background: rgba(0, 243, 255, 0.03);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.rvc-mode-card:hover {
  border-color: rgba(0, 243, 255, 0.35);
  background: rgba(0, 243, 255, 0.08);
}

.rvc-mode-card.active {
  border-color: rgba(0, 243, 255, 0.55);
  background: linear-gradient(
    90deg,
    rgba(0, 243, 255, 0.14),
    rgba(8, 12, 24, 0.4)
  );
  box-shadow: inset 3px 0 0 var(--primary-color, #00f3ff);
}

.rvc-mode-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.rvc-mode-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--primary-light, #6affff);
}

.rvc-mode-icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.rvc-mode-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rvc-mode-text strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.rvc-mode-text small {
  font-size: 10px;
  line-height: 1.35;
  color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
}

.rvc-mode-preview {
  position: relative;
  display: block;
  height: 42px;
  overflow: hidden;
  border-radius: 4px;
  border: 1px solid rgba(0, 243, 255, 0.1);
  background:
    linear-gradient(90deg, rgba(100, 225, 255, 0.04), rgba(255, 198, 82, 0.03)),
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0,
      rgba(255, 255, 255, 0.04) 1px,
      transparent 1px,
      transparent 12px
    ),
    #071521;
}

.rvc-mode-card.active .rvc-mode-preview {
  border-color: rgba(0, 243, 255, 0.22);
}

.rvc-preview-wave,
.rvc-preview-heat,
.rvc-preview-trail,
.rvc-preview-medium {
  position: absolute;
  inset: 0;
}

.rvc-preview-wave i {
  position: absolute;
  left: calc(8px + var(--i) * 15px);
  top: 50%;
  width: calc(20px + var(--i) * 9px);
  height: calc(22px + var(--i) * 8px);
  border: 1px solid rgba(126, 231, 255, 0.72);
  border-left-color: rgba(126, 231, 255, 0.2);
  border-radius: 50%;
  transform: translateY(-50%) rotateY(58deg);
  opacity: calc(0.88 - var(--i) * 0.12);
  animation: rvc-wave-phase 2.6s linear infinite;
  animation-delay: calc(var(--i) * -0.25s);
}

.rvc-preview-wave b {
  position: absolute;
  left: 6px;
  top: 15px;
  width: 7px;
  height: 12px;
  border-radius: 2px;
  background: #7ee7ff;
  box-shadow: 0 0 10px rgba(126, 231, 255, 0.7);
}

.rvc-preview-heat {
  background:
    radial-gradient(circle at 63% 43%, rgba(255, 48, 34, 0.95) 0 8%, rgba(255, 190, 54, 0.9) 9% 18%, transparent 28%),
    radial-gradient(circle at 41% 58%, rgba(255, 211, 80, 0.86) 0 8%, rgba(54, 219, 255, 0.46) 19%, transparent 34%),
    linear-gradient(90deg, rgba(28, 95, 168, 0.75), rgba(38, 210, 190, 0.42), rgba(255, 183, 60, 0.24));
}

.rvc-preview-heat i {
  position: absolute;
  inset: 7px 10px;
  border: 1px solid rgba(255, 235, 168, 0.45);
  border-radius: 50%;
  transform: rotate(-12deg);
}

.rvc-preview-heat b {
  position: absolute;
  left: 19px;
  right: 14px;
  top: 22px;
  border-top: 1px dashed rgba(255, 255, 255, 0.42);
}

.rvc-preview-trail svg {
  width: 100%;
  height: 100%;
}

.rvc-preview-trail path {
  fill: none;
  stroke: rgba(126, 231, 255, 0.72);
  stroke-width: 2.2;
  stroke-linecap: round;
}

.rvc-preview-trail path + path {
  stroke: rgba(255, 207, 83, 0.74);
  stroke-width: 1.6;
}

.rvc-preview-trail circle {
  fill: #6affff;
  filter: drop-shadow(0 0 4px rgba(106, 255, 255, 0.8));
  animation: rvc-pulse-dot 1.6s ease-in-out infinite;
}

.rvc-preview-medium .layer {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 18px;
  border: 1px solid rgba(235, 245, 255, 0.22);
  background: rgba(175, 188, 182, 0.18);
}

.rvc-preview-medium .layer.a {
  left: 22px;
}

.rvc-preview-medium .layer.b {
  left: 42px;
  background: rgba(77, 161, 178, 0.24);
}

.rvc-preview-medium .layer.c {
  left: 62px;
  background: rgba(209, 178, 109, 0.22);
}

.rvc-preview-medium .bar {
  position: absolute;
  left: 30px;
  right: 16px;
  height: 2px;
  border-radius: 99px;
  background: rgba(37, 46, 50, 0.95);
}

.rvc-preview-medium .bar.one {
  top: 16px;
}

.rvc-preview-medium .bar.two {
  top: 27px;
}

.rvc-preview-medium b {
  position: absolute;
  right: 21px;
  top: 13px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1px solid rgba(255, 225, 138, 0.9);
  background: rgba(4, 11, 18, 0.72);
  box-shadow: 0 0 8px rgba(255, 225, 138, 0.32);
}

@keyframes rvc-wave-phase {
  0% {
    transform: translateY(-50%) rotateY(58deg) scale(0.96);
  }
  50% {
    transform: translateY(-50%) rotateY(58deg) scale(1.05);
  }
  100% {
    transform: translateY(-50%) rotateY(58deg) scale(0.96);
  }
}

@keyframes rvc-pulse-dot {
  0%,
  100% {
    opacity: 0.62;
  }
  50% {
    opacity: 1;
  }
}

.rvc-mode-desc {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr);
  gap: 8px;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid rgba(0, 243, 255, 0.12);
  background: rgba(0, 243, 255, 0.04);
  font-size: 11px;
}

.rvc-mode-desc span {
  color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
}

.rvc-mode-desc strong {
  color: var(--text-secondary, rgba(255, 255, 255, 0.88));
  font-weight: 500;
  line-height: 1.45;
}

.rvc-params-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.rvc-emitter-hint {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-tertiary, rgba(255, 255, 255, 0.55));
}

.rvc-emitter-grid {
  display: grid;
  gap: 8px;
}

.rvc-color-picker {
  width: 100%;
}

.rvc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.rvc-field-full {
  grid-column: 1 / -1;
}

.rvc-field > span {
  font-size: 11px;
  color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
}

.rvc-el-select,
.rvc-el-number {
  width: 100%;
}

.rvc-field :deep(.el-input__wrapper),
.rvc-field :deep(.el-select__wrapper) {
  min-height: 30px;
  background: rgba(5, 10, 20, 0.85);
  border-color: rgba(0, 243, 255, 0.2);
  box-shadow: none;
}

.rvc-field :deep(.el-input-number) {
  width: 100%;
}

.rvc-apply-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 36px;
  margin-top: 4px;
  border: 1px solid rgba(0, 243, 255, 0.45);
  border-radius: 4px;
  background: rgba(0, 243, 255, 0.12);
  color: var(--primary-light, #6affff);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.rvc-apply-btn:hover:not(:disabled) {
  background: rgba(0, 243, 255, 0.2);
  box-shadow: var(--shadow-glow, 0 0 15px rgba(0, 243, 255, 0.35));
}

.rvc-apply-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
