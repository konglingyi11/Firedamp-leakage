<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { DataAnalysis, Loading } from '@element-plus/icons-vue'

const props = defineProps({
  currentTask: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  loadingProgress: { type: Number, default: 0 },
})

const emit = defineEmits(['focus-target'])

const router = useRouter()
const selectedTargetId = ref('gltf-animation-target')

/** 生命体征（仅呼吸；手势见「手势识别」区块） */
const vitalBars = computed(() => {
  const target = selectedTarget.value
  return [
    {
      label: '呼吸',
      value: clampPercent((target?.breathRate ?? 18) * 4),
      text: `${target?.breathRate ?? 18} bpm`,
      tone: 'blue',
    },
  ]
})

/** 四档手势 + 置信度，用于识别面板（与微动波形同目标联动） */
const defaultGestures = () => [
  { id: 'g1', label: '挥手', percent: 93 },
  { id: 'g2', label: '摆手', percent: 4 },
  { id: 'g3', label: '握拳', percent: 2 },
  { id: 'g4', label: '静止/其他', percent: 1 },
]

const gestureBoard = computed(() => {
  const g = selectedTarget.value?.gestures
  const list = Array.isArray(g) && g.length ? g : defaultGestures()
  const sliced = list.slice(0, 4)
  const maxP = Math.max(...sliced.map((x) => Number(x.percent) || 0), 0)
  const maxIdx = sliced.findIndex((x) => (Number(x.percent) || 0) === maxP && maxP > 0)
  return sliced.map((x, i) => ({
    ...x,
    percent: Number(x.percent) || 0,
    active: maxIdx === i,
  }))
})

const dominantGesture = computed(() => {
  const board = gestureBoard.value
  const hit = board.find((c) => c.active)
  return hit || board[0] || { label: '—', percent: 0 }
})

const radarParams = [
  { label: '中心频率', value: '915', unit: 'MHz' },
  { label: '采样率', value: '200', unit: 'MHz' },
  { label: '发射功率', value: '20', unit: 'dBm' },
  { label: '调频带宽', value: '125', unit: 'kHz' },
]

/** 示意数据：微动识别与场景监测点解耦，不接 monitoringPoints */
const mockTargets = [
  {
    id: 'gltf-animation-target',
    name: '目标1',
    location: 'X: 1.24, Y: 0.68, Z: 0.32',
    heartRate: 72,
    breathRate: 18,
    amplitude: 3.2,
    confidence: 86,
    status: '危急',
    source: 'gltf-animation',
    waveform: [0.2, 0.48, -0.12, 0.62, -0.26, 0.42, -0.08, 0.28, 0.04, -0.2],
    gestures: [
      { id: 'g1', label: '挥手', percent: 93 },
      { id: 'g2', label: '摆手', percent: 4 },
      { id: 'g3', label: '握拳', percent: 2 },
      { id: 'g4', label: '静止', percent: 1 },
    ],
  },
]

const selectedTarget = computed(() => {
  return (
    mockTargets.find((target) => String(target.id) === String(selectedTargetId.value)) ||
    mockTargets[0] ||
    null
  )
})

const summary = computed(() => {
  const targets = mockTargets
  const critical = targets.filter((target) => target.status === '危急').length
  const avgConfidence = targets.length
    ? Math.round(targets.reduce((sum, target) => sum + target.confidence, 0) / targets.length)
    : 0
  return {
    total: targets.length,
    critical,
    avgConfidence,
  }
})

function clampPercent(value) {
  return Math.max(4, Math.min(100, Math.round(value)))
}

function statusClass(status) {
  if (status === '危急') return 'critical'
  if (status === '异常') return 'warning'
  return 'normal'
}

function toneClass(tone) {
  return `tone-${tone}`
}

function selectTarget(target) {
  selectedTargetId.value = target.id
  emit('focus-target', target)
}

function selectFirstTarget() {
  const target = mockTargets[0]
  if (target) {
    selectTarget(target)
  }
}

function openDatasetEvaluation() {
  router.push('/test-shibie')
}

defineExpose({ selectFirstTarget })

function waveformPoints(values) {
  const width = 260
  const height = 78
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width
      const y = height / 2 - value * 46
      return `${x.toFixed(1)},${Math.max(2, Math.min(height - 2, y)).toFixed(1)}`
    })
    .join(' ')
}
</script>

<template>
  <section class="micro-motion-results">
    <div v-if="loading" class="micro-loading-overlay">
      <div class="micro-loading-card">
        <el-icon class="micro-loading-icon"><Loading /></el-icon>
        <div class="micro-loading-bar">
          <span :style="{ width: `${loadingProgress}%` }" />
        </div>
      </div>
    </div>
    <div class="micro-section overview-section stats-guide-micro-overview">
      <div class="section-title-row">
        <span class="section-title">识别概览</span>
        <div class="section-actions">
          <span class="task-chip">{{ currentTask?.name || currentTask?.id || '实时监测' }}</span>
          <el-button class="evaluation-link" size="small" text @click="openDatasetEvaluation">
            <el-icon><DataAnalysis /></el-icon>
            <span>数据集评估</span>
          </el-button>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-card">
          <span>目标数</span>
          <strong>{{ summary.total }}</strong>
        </div>
        <div
          class="summary-card danger"
          title="当前判定为「危急」状态的生命目标个数（示意统计）">
          <span>危急目标数</span>
          <strong>{{ summary.critical }}</strong>
        </div>
        <div class="summary-card" title="全部目标的识别置信度平均值（示意）">
          <span>平均置信度</span>
          <strong>{{ summary.avgConfidence }}%</strong>
        </div>
      </div>
    </div>

    <div v-if="selectedTarget" class="micro-section">
      <div class="section-title-row">
        <span class="section-title">生命目标</span>
        <span class="status-pill" :class="statusClass(selectedTarget.status)">
          {{ selectedTarget.status }}
        </span>
      </div>
      <div class="target-title">
        <strong>{{ selectedTarget.name }}</strong>
        <span>{{ selectedTarget.location }}</span>
      </div>
      <div class="bar-list">
        <div v-for="item in vitalBars" :key="item.label" class="bar-row">
          <span class="bar-label" :class="toneClass(item.tone)">{{ item.label }}</span>
          <span class="bar-track">
            <span class="bar-fill" :style="{ width: `${item.value}%` }"></span>
          </span>
          <span class="bar-value">{{ item.text }}</span>
        </div>
      </div>
    </div>

    <div v-if="selectedTarget" class="micro-section gesture-section stats-guide-micro-gesture">
      <div class="section-title-row">
        <span class="section-title">手势识别</span>
        <span class="task-chip">
          当前：{{ dominantGesture.label }} · {{ dominantGesture.percent }}%
        </span>
      </div>
      <p class="gesture-hint">基于微动特征的典型手势分类（示意数据，随所选目标切换）</p>
      <div class="gesture-board">
        <div
          v-for="(cell, idx) in gestureBoard"
          :key="cell.id || idx"
          class="gesture-cell"
          :class="{ active: cell.active }">
          <span class="gesture-arc" :class="{ active: cell.active }"></span>
          <span class="gesture-hand">{{ idx + 1 }}</span>
          <span class="gesture-meta">{{ cell.label }}</span>
          <span class="gesture-pct">{{ cell.percent }}%</span>
        </div>
      </div>
    </div>

    <div class="micro-section">
      <div class="section-title-row">
        <span class="section-title">波形参数</span>
      </div>
      <dl class="param-grid">
        <div v-for="item in radarParams" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>
            {{ item.value }}
            <small>{{ item.unit }}</small>
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="selectedTarget" class="micro-section stats-guide-micro-waveform">
      <div class="section-title-row">
        <span class="section-title">微动信号波形</span>
        <span class="task-chip">{{ selectedTarget.amplitude.toFixed(1) }} mm</span>
      </div>
      <svg viewBox="0 0 260 78" preserveAspectRatio="none" class="wave-chart">
        <line x1="0" y1="39" x2="260" y2="39" class="axis" />
        <line v-for="y in [13, 26, 52, 65]" :key="y" x1="0" :y1="y" x2="260" :y2="y" class="grid" />
        <polyline
          :points="waveformPoints(selectedTarget.waveform)"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          vector-effect="non-scaling-stroke" />
      </svg>
      <div class="wave-footer">
        <span>功率谱密度</span>
        <strong>{{ selectedTarget.confidence }}%</strong>
      </div>
    </div>

    <div v-if="mockTargets.length" class="target-list">
      <button
        v-for="target in mockTargets"
        :key="target.id"
        type="button"
        class="target-row"
        :class="{ active: String(target.id) === String(selectedTarget?.id) }"
        @click="selectTarget(target)">
        <span class="target-dot" :class="statusClass(target.status)"></span>
        <span>{{ target.name }}</span>
        <strong>{{ target.confidence }}%</strong>
      </button>
    </div>

  </section>
</template>

<style scoped>
.micro-motion-results {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--text-primary, #e6f7ff);
  position: relative;
  padding-bottom: 10px;
}

.micro-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: rgba(3, 10, 24, 0.68);
  backdrop-filter: blur(4px);
}

.micro-loading-card {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 18px 20px;
  border: 1px solid rgba(0, 243, 255, 0.24);
  border-radius: 6px;
  background: rgba(8, 18, 34, 0.92);
  box-shadow: 0 0 24px rgba(0, 243, 255, 0.12);
}

.micro-loading-icon {
  color: var(--primary-color, #00f3ff);
  font-size: 28px;
  animation: micro-spin 1s linear infinite;
}

.micro-loading-bar {
  width: 160px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}

.micro-loading-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--primary-color, #00f3ff), transparent);
  transition: width 0.25s ease;
}

.micro-section {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(0, 243, 255, 0.24);
  border-radius: 6px;
  background:
    linear-gradient(135deg, rgba(0, 243, 255, 0.08), transparent 42%),
    rgba(8, 18, 34, 0.78);
  box-shadow: inset 0 0 20px rgba(0, 243, 255, 0.04);
}

.micro-section::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, var(--primary-color, #00f3ff), transparent);
  content: "";
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 36px;
  padding: 9px 12px 9px 15px;
  border-bottom: 1px solid rgba(0, 243, 255, 0.18);
  background: linear-gradient(90deg, rgba(0, 243, 255, 0.13), rgba(0, 243, 255, 0.02));
}

.section-title {
  color: var(--primary-light, #8ff4ff);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
}

.section-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.task-chip {
  overflow: hidden;
  max-width: 160px;
  padding: 2px 7px;
  border: 1px solid rgba(0, 243, 255, 0.18);
  border-radius: 4px;
  background: rgba(0, 243, 255, 0.06);
  color: var(--text-secondary, rgba(223, 247, 255, 0.78));
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.evaluation-link {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 7px;
  border: 1px solid rgba(0, 243, 255, 0.22);
  border-radius: 4px;
  background: rgba(0, 243, 255, 0.07);
  color: var(--primary-light, #8ff4ff);
  font-size: 12px;
  font-weight: 700;
}

.evaluation-link:hover,
.evaluation-link:focus {
  border-color: rgba(0, 243, 255, 0.48);
  background: rgba(0, 243, 255, 0.13);
  color: var(--primary-color, #00f3ff);
}

.evaluation-link .el-icon {
  margin-right: 4px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px;
}

.summary-card {
  min-width: 0;
  padding: 9px 6px;
  border: 1px solid rgba(0, 243, 255, 0.14);
  border-radius: 6px;
  background: rgba(3, 16, 31, 0.62);
  text-align: center;
}

.summary-grid span,
.target-title span,
.wave-footer span {
  color: var(--text-secondary, rgba(223, 247, 255, 0.68));
  font-size: 12px;
}

.summary-grid strong {
  display: block;
  margin-top: 5px;
  color: var(--primary-color, #00f3ff);
  font-size: 24px;
  line-height: 1;
  text-shadow: 0 0 10px rgba(0, 243, 255, 0.25);
}

.summary-card.danger strong {
  color: var(--danger-color, #ff3366);
  text-shadow: 0 0 10px rgba(255, 51, 102, 0.25);
}

.status-pill {
  flex: 0 0 auto;
  min-width: 48px;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
}

.critical {
  color: var(--danger-color, #ff3366);
  background: rgba(255, 51, 102, 0.1);
}

.warning {
  color: var(--warning-color, #f7b955);
  background: rgba(247, 185, 85, 0.1);
}

.normal {
  color: var(--success-color, #00ff88);
  background: rgba(0, 255, 136, 0.1);
}

.target-title {
  display: grid;
  gap: 4px;
  padding: 12px 12px 0 15px;
}

.target-title strong {
  color: #ffffff;
  font-size: 17px;
  line-height: 1.2;
}

.target-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-list {
  display: grid;
  gap: 10px;
  padding: 12px 12px 14px 15px;
}

.bar-row {
  display: grid;
  grid-template-columns: 56px minmax(80px, 1fr) 62px;
  align-items: center;
  gap: 8px;
}

.bar-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  box-shadow: inset 0 -10px 18px rgba(0, 0, 0, 0.12);
}

.tone-blue {
  background: linear-gradient(180deg, #4fb9ff, #1670c6);
}

.tone-green {
  background: linear-gradient(180deg, #32d995, #0f9663);
}

.tone-amber {
  background: linear-gradient(180deg, #f7c852, #c88313);
}

.tone-orange {
  background: linear-gradient(180deg, #ff8f4f, #d84b21);
}

.bar-track {
  position: relative;
  height: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(225, 236, 243, 0.88);
}

.bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--primary-color, #00f3ff), var(--primary-light, #7dfcff));
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.32);
}

.bar-value {
  color: var(--text-primary, #e6f7ff);
  font-size: 12px;
  font-weight: 700;
  text-align: right;
}

.gesture-hint {
  margin: 0 12px 10px 15px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary, rgba(223, 247, 255, 0.58));
}

.gesture-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 0 12px 14px 15px;
}

.gesture-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  min-height: 118px;
  padding: 10px 4px 8px;
  border: 1px solid rgba(0, 243, 255, 0.16);
  border-radius: 6px;
  background: rgba(3, 16, 31, 0.46);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.gesture-cell.active {
  border-color: rgba(0, 243, 255, 0.5);
  box-shadow: 0 0 16px rgba(0, 243, 255, 0.2);
}

.gesture-arc {
  width: 36px;
  height: 36px;
  border: 2px solid rgba(223, 250, 255, 0.55);
  border-right-color: transparent;
  border-radius: 50%;
  transform: rotate(-30deg);
  flex-shrink: 0;
}

.gesture-arc.active {
  border-color: rgba(0, 243, 255, 0.9);
  border-right-color: transparent;
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.35);
}

.gesture-hand {
  color: #dff9ff;
  font-size: 17px;
  font-weight: 800;
  line-height: 1;
}

.gesture-meta {
  max-width: 100%;
  padding: 0 2px;
  color: var(--text-secondary, rgba(223, 247, 255, 0.78));
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  line-height: 1.2;
}

.gesture-pct {
  margin-top: 2px;
  color: var(--primary-light, #8ff4ff);
  font-size: 12px;
  font-weight: 700;
}

.gesture-section .task-chip {
  max-width: 200px;
}

.param-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 12px 12px 14px 15px;
}

.param-grid div {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(0, 243, 255, 0.12);
  border-radius: 6px;
  background: rgba(3, 16, 31, 0.46);
}

.param-grid dt {
  color: var(--text-secondary, rgba(223, 247, 255, 0.68));
  font-size: 12px;
}

.param-grid dd {
  margin: 5px 0 0;
  color: var(--primary-light, #8ff4ff);
  font-size: 19px;
  font-weight: 700;
  line-height: 1;
}

.param-grid small {
  margin-left: 3px;
  color: var(--text-secondary, rgba(223, 247, 255, 0.62));
  font-size: 10px;
  font-weight: 500;
}

.wave-chart {
  display: block;
  width: calc(100% - 24px);
  height: 92px;
  margin: 12px 12px 8px 15px;
  color: var(--primary-color, #00f3ff);
}

.wave-chart .axis {
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 1;
}

.wave-chart .grid {
  stroke: rgba(0, 243, 255, 0.14);
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.wave-footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 0 12px 12px 15px;
}

.wave-footer strong {
  color: var(--primary-light, #8ff4ff);
  font-size: 12px;
}

.target-list {
  display: grid;
  gap: 8px;
}

.target-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 10px 12px 10px 15px;
  border: 1px solid rgba(0, 243, 255, 0.2);
  border-radius: 4px;
  background:
    linear-gradient(90deg, rgba(0, 243, 255, 0.12), transparent),
    rgba(8, 18, 34, 0.72);
  color: var(--text-primary, #e6f7ff);
  cursor: pointer;
  text-align: left;
}

.target-row.active {
  border-color: rgba(0, 243, 255, 0.42);
  background: rgba(0, 243, 255, 0.08);
}

.target-row span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-row strong {
  color: var(--primary-color, #00f3ff);
  font-size: 12px;
}

.target-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 10px currentColor;
}

@media (max-width: 520px) {
  .summary-grid,
  .param-grid {
    grid-template-columns: 1fr;
  }

  .gesture-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@keyframes micro-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

</style>
