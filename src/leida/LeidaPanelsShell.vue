<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  Aim,
  ArrowLeft,
  ArrowRight,
  Coin,
  DArrowLeft,
  DArrowRight,
  Monitor,
  Setting,
  VideoPause,
} from '@element-plus/icons-vue'
import LeidaViewportChrome from './components/LeidaViewportChrome.vue'
import RadarVisualizationControls from '@/components/RadarVisualizationControls.vue'
import TimelineControl from '@/components/TimelineControl.vue'
import './styles/leida-dashboard.css'

const props = defineProps({
  embedded: { type: Boolean, default: false },
  externalViewport: { type: Boolean, default: false },
  modelName: { type: String, default: '掩埋空间_01' },
  taskId: { type: String, default: 'EM2025072101' },
  visualization: { type: Object, default: null },
  dimension: { type: String, default: '3d' },
  type2d: { type: String, default: 'cloud' },
  type3d: { type: String, default: 'volume' },
  radarResultMode: { type: String, default: 'wavefront' },
  radarFrequencies: { type: Array, default: () => [] },
  applying: { type: Boolean, default: false },
  batchLoading: { type: Boolean, default: false },
  showTimeline: { type: Boolean, default: false },
  timelineCurrentStep: { type: Number, default: 0 },
  timelineTotalSteps: { type: Number, default: 0 },
  timelinePhysicalTimes: { type: Array, default: () => [] },
  isTimelinePlaying: { type: Boolean, default: false },
  isTimelineCollapsed: { type: Boolean, default: false },
  timelineDisabled: { type: Boolean, default: false },
  animationSpeed: { type: Number, default: 1 },
  generatedLayers: { type: Array, default: () => [] },
  selectedLayerId: { type: String, default: null },
  geometryBounds: { type: Object, default: null },
  geometrySelections: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'update:hasDataPanel',
  'update:radarFrequencies',
  'update:dimension',
  'update:type2d',
  'update:type3d',
  'update:radarResultMode',
  'apply-radar-settings',
  'update:timelineCurrentStep',
  'update:animationSpeed',
  'update:selectedLayerId',
  'timeline-play',
  'timeline-pause',
  'timeline-stop',
  'timeline-seek',
  'timeline-toggle-collapse',
  'select-geometry-part',
  'update:mediumBindings',
  'medium-nav-active',
])

const activeNav = ref('medium')
const navCollapsed = ref(false)
const configCollapsed = ref(false)
const bottomCollapsed = ref(false)
const outputTab = ref('files')
const simProgress = ref(68)
const currentTime = ref(3.42)
const playbackSpeed = ref('1.0')
const realtimeMode = ref(true)
const compareCaseA = ref('buried_space_01')
const compareCaseB = ref('buried_space_02')

// Step completion tracking
const completedSteps = reactive({
  medium: false,
  sim: false,
  radar: false,
})

// Check if a step is accessible (all previous steps completed)
function isStepAccessible(stepId) {
  const stepOrder = ['medium', 'sim', 'radar', 'viz']
  const index = stepOrder.indexOf(stepId)
  if (index <= 0) return true // medium is always accessible
  // Check if all previous steps are completed
  return stepOrder.slice(0, index).every((s) => completedSteps[s])
}

const simulationDraft = reactive({
  solver: props.visualization?.radar_simulation?.solver || '时域有限差分',
  domainSizeText:
    props.visualization?.radar_simulation?.domain_size_text || '[2.0, 2.0, 1.5]',
  timeSteps: Number(props.visualization?.radar_simulation?.time_steps) || 5000,
  boundary: props.visualization?.radar_simulation?.boundary || '完美匹配层',
  timeStepText:
    props.visualization?.radar_simulation?.time_step_text || '1.25×10⁻¹²',
  durationNs: Number(props.visualization?.radar_simulation?.duration_ns) || 10,
})

const totalTime = computed(() => Math.max(0, Number(simulationDraft.durationNs) || 0))

const navItems = [
  {
    id: 'medium',
    label: '介质参数',
    desc: '材料电磁属性与区域绑定',
    icon: Coin,
  },
  {
    id: 'sim',
    label: '仿真配置',
    desc: '时域有限差分求解与时间步进设置',
    icon: Setting,
  },
  { id: 'radar', label: '雷达参数', desc: '发射源、频段与天线位置', icon: Aim },
  {
    id: 'viz',
    label: '结果可视化',
    desc: '场分布、色图与时间窗控制',
    icon: Monitor,
  },
]

const materialPresets = [
  // { name: '空气', er: '1.0', sigma: '0' },
  { name: '木板', er: '2.2', sigma: '0.01' },
  { name: '砖墙', er: '4.5', sigma: '0.05' },
  { name: '混凝土', er: '7.0', sigma: '0.015' },
  { name: '金属物', er: '∞', sigma: '＞10⁶' },
]

const selectedGeometryName = ref('')
const selectedMaterialPreset = ref(materialPresets[0].name)
const mediumDraft = reactive({
  er: materialPresets[0].er,
  sigma: materialPresets[0].sigma,
})
const mediumBindings = ref([])

const geometryOptions = computed(() =>
  (props.geometrySelections || []).map((item) => ({
    ...item,
    label: formatGeometryPartLabel(item),
  })),
)

const hasGeometryOptions = computed(() => geometryOptions.value.length > 0)

function formatGeometryPartLabel(item) {
  const name = String(item?.name || '').trim() || '未命名部件'
  const details = []
  if (item?.node && item.node !== name) details.push(`节点 ${item.node}`)
  if (item?.mesh && item.mesh !== name && item.mesh !== item?.node) {
    details.push(`网格 ${item.mesh}`)
  }
  if (item?.material) details.push(`材质 ${item.material}`)
  return details.length > 0 ? `${name}（${details.join(' · ')}）` : name
}

function findMaterialPreset(name) {
  return materialPresets.find((item) => item.name === name) || null
}

function applyMaterialPreset(name) {
  const preset = findMaterialPreset(name)
  if (!preset) return
  selectedMaterialPreset.value = preset.name
  mediumDraft.er = preset.er
  mediumDraft.sigma = preset.sigma
}

function loadMediumDraftForPart(partName) {
  const existing = mediumBindings.value.find(
    (item) => item.partName === partName,
  )
  if (existing) {
    applyMaterialPreset(existing.materialName)
    mediumDraft.er = existing.er
    mediumDraft.sigma = existing.sigma
    return
  }

  const part = geometryOptions.value.find((item) => item.name === partName)
  const preset =
    findMaterialPreset(part?.material) ||
    findMaterialPreset(materialPresets[0].name)
  if (preset) applyMaterialPreset(preset.name)
}

function handleGeometryPartChange(partName) {
  selectedGeometryName.value = partName
  if (!partName) return
  loadMediumDraftForPart(partName)
  emit('select-geometry-part', partName)
}

function handleMaterialPresetChange(presetName) {
  applyMaterialPreset(presetName)
}

function bindMediumParams() {
  if (!selectedGeometryName.value) return
  const binding = {
    partName: selectedGeometryName.value,
    materialName: selectedMaterialPreset.value,
    er: mediumDraft.er,
    sigma: mediumDraft.sigma,
  }
  const index = mediumBindings.value.findIndex(
    (item) => item.partName === binding.partName,
  )
  if (index >= 0) mediumBindings.value[index] = binding
  else mediumBindings.value.push(binding)
  emit('update:mediumBindings', [...mediumBindings.value])
}

function removeMediumBinding(partName) {
  mediumBindings.value = mediumBindings.value.filter(
    (item) => item.partName !== partName,
  )
  emit('update:mediumBindings', [...mediumBindings.value])
}

watch(
  geometryOptions,
  (options) => {
    if (!options.length) {
      selectedGeometryName.value = ''
      return
    }
    if (!options.some((item) => item.name === selectedGeometryName.value)) {
      handleGeometryPartChange(options[0].name)
    }
  },
  { immediate: true },
)

// Reset completed steps when geometry changes significantly
watch(
  () => props.geometrySelections,
  (newSelections, oldSelections) => {
    // If geometry selections change completely, reset completion status
    if (newSelections?.length !== oldSelections?.length) {
      completedSteps.medium = false
      completedSteps.sim = false
      completedSteps.radar = false
      // Go back to medium step
      activeNav.value = 'medium'
    }
  },
)

const resultFiles = [
  { name: '场分布_00342.vti', fmt: '体素', size: '24.6 MB', status: '已生成' },
  { name: '回波信号.csv', fmt: '表格', size: '1.2 MB', status: '已生成' },
  {
    name: '场强最大值_xy.png',
    fmt: '图像',
    size: '856 KB',
    status: '已生成',
  },
  { name: '配置快照.json', fmt: '配置', size: '4.2 KB', status: '已生成' },
]

const logs = [
  '[信息] 时域有限差分求解器已初始化，计算域 2.0×2.0×1.5 米',
  '[信息] 时间步长 Δt = 1.25×10⁻¹² 秒，总步数 8000',
  '[信息] 第 5472/8000 步 — t = 3.42 纳秒，最大场强 = 8.73×10³ 伏/米',
  '[信息] 正在写入场切片 场分布_00342.vti …',
]

const compareCases = [
  { value: 'buried_space_01', label: '掩埋空间_01' },
  { value: 'buried_space_00', label: '掩埋空间_00' },
  { value: 'buried_space_02', label: '掩埋空间_02' },
]

function parseDomainSizeText(text) {
  const values = String(text || '')
    .replace(/[，；;]/g, ',')
    .match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  const parsed = (values || []).slice(0, 3).map((value) => Number(value))
  return parsed.length === 3 && parsed.every(Number.isFinite)
    ? parsed
    : [2.0, 2.0, 1.5]
}

const fdtdJson = computed(() =>
  JSON.stringify(
    {
      求解器: simulationDraft.solver,
      计算域尺寸: parseDomainSizeText(simulationDraft.domainSizeText),
      时间步数: Number(simulationDraft.timeSteps) || 0,
      边界条件: simulationDraft.boundary,
      时间步长: `${simulationDraft.timeStepText} 秒`,
      总时长: `${Number(simulationDraft.durationNs) || 0} 秒`,
      激励源: {
        类型: '高斯脉冲',
        中心频率: '1.2 吉赫兹',
      },
    },
    null,
    2,
  ),
)

const chartUid = `echo-${Math.random().toString(36).slice(2, 9)}`
const heatmapUid = `field-${Math.random().toString(36).slice(2, 9)}`

const activeNavMeta = computed(
  () => navItems.find((item) => item.id === activeNav.value) ?? navItems[0],
)

const showDataPanel = computed(
  () => activeNav.value === 'viz' || activeNav.value === 'compare',
)

const isCompactPanel = computed(() => props.embedded && props.externalViewport)

const useLiveRadarControls = computed(
  () => props.embedded && props.visualization != null,
)

const echoPoints = computed(() => {
  const vals = [
    -18, -12, -8, -22, -15, -6, -28, -10, -4, -16, -20, -9, -14, -7, -25, -11,
  ]
  const min = -35
  const max = 0
  const span = max - min
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * 280
      const y = 80 - ((v - min) / span) * 70
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

function modelSeed(text) {
  return String(text || 'model')
    .split('')
    .reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 2166136261)
}

function seededUnit(seed, index) {
  const x = Math.sin(seed * 0.0001 + index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function normalizeBounds(bounds) {
  const b = bounds || {}
  const xmin = Number(b.xmin ?? b.min_x ?? b.min?.x ?? b[0])
  const xmax = Number(b.xmax ?? b.max_x ?? b.max?.x ?? b[1])
  const ymin = Number(b.ymin ?? b.min_y ?? b.min?.y ?? b[2])
  const ymax = Number(b.ymax ?? b.max_y ?? b.max?.y ?? b[3])
  const zmin = Number(b.zmin ?? b.min_z ?? b.min?.z ?? b[4])
  const zmax = Number(b.zmax ?? b.max_z ?? b.max?.z ?? b[5])
  if (![xmin, xmax, ymin, ymax, zmin, zmax].every(Number.isFinite)) {
    return { xmin: -2, xmax: 2, ymin: -1.5, ymax: 1.5, zmin: 0, zmax: 1.5 }
  }
  return {
    xmin: Math.min(xmin, xmax),
    xmax: Math.max(xmin, xmax),
    ymin: Math.min(ymin, ymax),
    ymax: Math.max(ymin, ymax),
    zmin: Math.min(zmin, zmax),
    zmax: Math.max(zmin, zmax),
  }
}

function normalizeNumericText(value, fallback = 0) {
  const text = String(value ?? '').trim()
  if (!text) return fallback
  if (/∞|>|＞/.test(text)) return 1e6
  const n = Number(text.replace(/[^\d.eE+-]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

function projectPointToMap(point, bounds) {
  const width = Math.max(bounds.xmax - bounds.xmin, 1e-6)
  const height = Math.max(bounds.ymax - bounds.ymin, 1e-6)
  const x = Number(point?.x)
  const y = Number(point?.y)
  return {
    x: Math.min(
      92,
      Math.max(
        8,
        (((Number.isFinite(x) ? x : bounds.xmin) - bounds.xmin) / width) * 84 +
          8,
      ),
    ),
    y: Math.min(
      88,
      Math.max(
        12,
        88 -
          (((Number.isFinite(y) ? y : bounds.ymin) - bounds.ymin) / height) *
            76,
      ),
    ),
  }
}

function geometryCenterForMap(part, bounds, seed, index) {
  if (part?.center) return projectPointToMap(part.center, bounds)
  const partBounds = normalizeBounds(part?.bounds)
  if (part?.bounds) {
    return projectPointToMap(
      {
        x: (partBounds.xmin + partBounds.xmax) * 0.5,
        y: (partBounds.ymin + partBounds.ymax) * 0.5,
      },
      bounds,
    )
  }
  return {
    x: 18 + seededUnit(seed, index + 60) * 70,
    y: 18 + seededUnit(seed, index + 70) * 64,
  }
}

function bindingForPart(part) {
  const tokens = [part?.name, part?.node, part?.mesh, part?.material]
    .map((value) =>
      String(value || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
  return mediumBindings.value.find((item) =>
    tokens.includes(
      String(item?.partName || '')
        .trim()
        .toLowerCase(),
    ),
  )
}

function materialReflectivity(part) {
  const binding = bindingForPart(part)
  const materialText = String(
    binding?.materialName || part?.material || '',
  ).toLowerCase()
  const er = normalizeNumericText(
    binding?.er,
    /metal|金属|steel|iron|rebar|钢|铁/.test(materialText) ? 80 : 4,
  )
  const sigma = normalizeNumericText(
    binding?.sigma,
    /metal|金属|steel|iron|rebar|钢|铁/.test(materialText) ? 1e6 : 0.02,
  )
  const conductor = Math.min(1, Math.log10(Math.max(sigma, 0) + 1) / 6)
  const dielectricJump = Math.min(1, Math.abs(er - 1) / 16)
  return Math.min(1, Math.max(0.18, conductor * 0.72 + dielectricJump * 0.38))
}

function geometryObstacleRect(part, bounds, center, seed, index) {
  const partBounds = part?.bounds ? normalizeBounds(part.bounds) : null
  const width = Math.max(bounds.xmax - bounds.xmin, 1e-6)
  const height = Math.max(bounds.ymax - bounds.ymin, 1e-6)
  const w = partBounds
    ? Math.min(
        26,
        Math.max(5, ((partBounds.xmax - partBounds.xmin) / width) * 84),
      )
    : 7 + seededUnit(seed, index + 90) * 13
  const h = partBounds
    ? Math.min(
        30,
        Math.max(6, ((partBounds.ymax - partBounds.ymin) / height) * 76),
      )
    : 9 + seededUnit(seed, index + 100) * 20
  return {
    x: Math.min(94 - w, Math.max(6, center.x - w * 0.5)),
    y: Math.min(92 - h, Math.max(6, center.y - h * 0.5)),
    w,
    h,
    opacity: 0.12 + materialReflectivity(part) * 0.28,
  }
}

const fieldMap = computed(() => {
  const bounds = normalizeBounds(props.geometryBounds)
  const width = Math.max(bounds.xmax - bounds.xmin, 1e-6)
  const height = Math.max(bounds.ymax - bounds.ymin, 1e-6)
  const depth = Math.max(bounds.zmax - bounds.zmin, 1e-6)
  const seed = modelSeed(
    `${props.modelName}-${width.toFixed(3)}-${height.toFixed(3)}-${mediumBindings.value.length}`,
  )
  const emitter = props.visualization?.radar_emitter
  const source =
    emitter && typeof emitter === 'object'
      ? projectPointToMap(emitter, bounds)
      : {
          x: 18 + seededUnit(seed, 1) * 12,
          y: 28 + seededUnit(seed, 2) * 42,
        }
  const geometryParts = (props.geometrySelections || []).slice(0, 8)
  const candidates =
    geometryParts.length > 0
      ? geometryParts
      : Array.from({ length: 5 }, (_, index) => ({ name: `mock-${index}` }))
  const hotSpots = candidates
    .map((part, index) => {
      const center = geometryCenterForMap(part, bounds, seed, index)
      const distance =
        Math.hypot(center.x - source.x, center.y - source.y) / 100
      const reflectivity = materialReflectivity(part)
      const strength = Math.min(
        1,
        reflectivity * Math.exp(-distance * 1.35) + 0.12,
      )
      const radius = 10 + strength * 17 + seededUnit(seed, index + 30) * 5
      const paletteIndex = Math.min(4, Math.floor(strength * 5))
      return {
        x: center.x,
        y: center.y,
        r: radius,
        opacity: 0.4 + strength * 0.52,
        strength,
        color: ['#2f54ff', '#18bfff', '#41e37d', '#ffd43b', '#ff3b1f'][
          paletteIndex
        ],
      }
    })
    .sort((a, b) => a.strength - b.strength)
  const obstacles = candidates
    .slice(0, 6)
    .map((part, index) =>
      geometryObstacleRect(
        part,
        bounds,
        geometryCenterForMap(part, bounds, seed, index),
        seed,
        index,
      ),
    )
  const target = hotSpots[hotSpots.length - 1] || { x: 88, y: 56 }
  return {
    bounds,
    source,
    hotSpots,
    obstacles,
    target,
    label: `${width.toFixed(2)} × ${height.toFixed(2)} × ${depth.toFixed(2)} 米`,
  }
})

function selectNav(id) {
  // Check if the step is accessible
  if (!isStepAccessible(id)) {
    return // Don't allow navigation to locked steps
  }
  activeNav.value = id
  if (id === 'viz' || id === 'compare') {
    outputTab.value = 'files'
    bottomCollapsed.value = false
  }
}

function selectNextNav(id = activeNav.value) {
  const nextMap = {
    medium: 'sim',
    sim: 'radar',
    radar: 'viz',
  }
  const nextId = nextMap[id]
  if (nextId) selectNav(nextId)
}

function applyMediumStep() {
  if (selectedGeometryName.value) {
    bindMediumParams()
    // Mark medium step as completed
    completedSteps.medium = true
    // Auto-jump to next step (sim)
    selectNextNav('medium')
  }
}

function applySimulationStep() {
  if (props.visualization && typeof props.visualization === 'object') {
    props.visualization.radar_simulation = {
      solver: simulationDraft.solver,
      domain_size: parseDomainSizeText(simulationDraft.domainSizeText),
      domain_size_text: simulationDraft.domainSizeText,
      time_steps: Number(simulationDraft.timeSteps) || 0,
      boundary: simulationDraft.boundary,
      time_step_text: simulationDraft.timeStepText,
      duration_ns: Number(simulationDraft.durationNs) || 0,
    }
  }
  // Mark sim step as completed
  completedSteps.sim = true
  selectNextNav('sim')
}

function applyRadarStep() {
  emit('apply-radar-settings')
  // Mark radar step as completed
  completedSteps.radar = true
  selectNextNav('radar')
}

function applyVisualizationStep() {
  emit('apply-radar-settings')
}

watch(
  activeNav,
  (id) => {
    if (id === 'medium') emit('medium-nav-active')
  },
  { immediate: true },
)

watch(totalTime, (nextTotal) => {
  if (currentTime.value > nextTotal) currentTime.value = nextTotal
})

watch(
  [showDataPanel, bottomCollapsed],
  ([show, bottomHidden]) => {
    emit('update:hasDataPanel', show && !bottomHidden)
  },
  { immediate: true },
)
</script>

<template>
  <div
    class="leida-panels-shell"
    :class="{ embedded, 'external-viewport': externalViewport }">
    <div
      class="leida-body"
      :class="{
        'has-data-panel': showDataPanel && !bottomCollapsed,
        embedded,
        'external-viewport': externalViewport,
        'nav-collapsed': navCollapsed,
        'config-collapsed': configCollapsed,
        'bottom-collapsed': bottomCollapsed,
      }">
      <nav class="leida-nav" :class="{ 'is-collapsed': navCollapsed }">
        <div class="leida-panel-head">
          <span class="leida-panel-head-title">功能导航</span>
          <button
            type="button"
            class="leida-panel-collapse-btn"
            title="折叠导航"
            @click="navCollapsed = true">
            <ArrowLeft />
          </button>
        </div>
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="leida-nav-item"
          :class="{
            active: activeNav === item.id,
            disabled: !isStepAccessible(item.id),
            completed: completedSteps[item.id],
          }"
          :disabled="!isStepAccessible(item.id)"
          :title="!isStepAccessible(item.id) ? '请先完成前面的步骤' : ''"
          @click="selectNav(item.id)">
          <span class="nav-icon"><component :is="item.icon" /></span>
          <span>{{ item.label }}</span>
          <span v-if="completedSteps[item.id]" class="nav-check">✓</span>
          <span v-else-if="!isStepAccessible(item.id)" class="nav-lock">🔒</span>
        </button>

        <div class="leida-overview">
          <h3>项目概览</h3>
          <dl>
            <dt>模型名称</dt>
            <dd>{{ modelName }}</dd>
            <dt>任务编号</dt>
            <dd>{{ taskId }}</dd>
            <dt>网格单元</dt>
            <dd>12,345,678</dd>
            <!-- 暂时隐藏：当前时间、进度 -->
          </dl>
        </div>
      </nav>

      <button
        v-if="navCollapsed"
        type="button"
        class="leida-panel-fab leida-panel-fab--nav"
        title="展开导航"
        @click="navCollapsed = false">
        <DArrowRight />
        <span>导航</span>
      </button>

      <LeidaViewportChrome
        v-if="!externalViewport">
        <template #default="slotProps">
          <slot v-bind="slotProps" />
        </template>
      </LeidaViewportChrome>

      <aside
        class="leida-config"
        :class="{
          'is-collapsed': configCollapsed,
          'leida-config--embedded-float': embedded && externalViewport,
          'leida-config--compact': isCompactPanel,
        }">
        <header class="leida-module-head">
          <span class="leida-module-icon"
            ><component :is="activeNavMeta.icon"
          /></span>
          <div class="leida-module-head-text">
            <h2>{{ activeNavMeta.label }}</h2>
            <p v-if="!isCompactPanel">{{ activeNavMeta.desc }}</p>
          </div>
          <button
            type="button"
            class="leida-panel-collapse-btn"
            title="折叠配置"
            @click="configCollapsed = true">
            <ArrowRight />
          </button>
        </header>

        <!-- Step Progress Indicator -->
        <div class="leida-step-progress">
          <div
            v-for="(step, index) in navItems"
            :key="step.id"
            class="leida-step-dot"
            :class="{
              active: activeNav === step.id,
              completed: completedSteps[step.id],
              accessible: isStepAccessible(step.id),
            }"
            :title="step.label">
            <span class="step-number">{{ index + 1 }}</span>
          </div>
        </div>

        <div
          class="leida-module-body"
          :class="{ 'is-compact': isCompactPanel }">
          <template v-if="activeNav === 'medium'">
            <div class="leida-field leida-field-full">
              <label>几何部件</label>
              <select
                v-model="selectedGeometryName"
                :disabled="!hasGeometryOptions"
                @change="handleGeometryPartChange(selectedGeometryName)">
                <option v-if="!hasGeometryOptions" value="">
                  暂无可选几何部件
                </option>
                <option
                  v-for="item in geometryOptions"
                  :key="item.name"
                  :value="item.name">
                  {{ item.label }}
                </option>
              </select>
            </div>
            <div class="leida-hint">
              {{
                hasGeometryOptions
                  ? `已读取 ${geometryOptions.length} 个几何命名，选择后在视口中高亮对应区域。`
                  : '请先加载包含几何面的模型，系统将自动读取部件命名。'
              }}
            </div>

            <div class="leida-field leida-field-full">
              <label>材料预设</label>
              <select
                v-model="selectedMaterialPreset"
                :disabled="!hasGeometryOptions"
                @change="handleMaterialPresetChange(selectedMaterialPreset)">
                <option
                  v-for="preset in materialPresets"
                  :key="preset.name"
                  :value="preset.name">
                  {{ preset.name }}
                </option>
              </select>
            </div>

            <div class="leida-form-grid">
              <div class="leida-field">
                <label>相对介电常数 ε<sub>r</sub></label>
                <input
                  v-model="mediumDraft.er"
                  :disabled="!hasGeometryOptions" />
              </div>
              <div class="leida-field">
                <label>电导率 σ（西门子/米）</label>
                <input
                  v-model="mediumDraft.sigma"
                  :disabled="!hasGeometryOptions" />
              </div>
            </div>

            <button
              class="leida-btn primary leida-btn-block"
              :disabled="!selectedGeometryName"
              @click="applyMediumStep">
              绑定材料参数
            </button>

            <div v-if="!completedSteps.medium" class="leida-hint leida-hint--info">
              💡 绑定材料参数后将自动进入下一步（仿真配置）
            </div>

            <div v-if="mediumBindings.length" class="leida-medium-bindings">
              <div class="leida-medium-bindings-title">已绑定部件</div>
              <table class="leida-table">
                <thead>
                  <tr>
                    <th>部件</th>
                    <th>材料</th>
                    <th>ε<sub>r</sub></th>
                    <th>σ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="binding in mediumBindings" :key="binding.partName">
                    <td>{{ binding.partName }}</td>
                    <td>{{ binding.materialName }}</td>
                    <td class="mono">{{ binding.er }}</td>
                    <td class="mono">{{ binding.sigma }}</td>
                    <td>
                      <button
                        type="button"
                        class="leida-link-btn"
                        @click="removeMediumBinding(binding.partName)">
                        移除
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <details class="leida-medium-presets">
              <summary>材料预设参考</summary>
              <table class="leida-table">
                <thead>
                  <tr>
                    <th>材料</th>
                    <th>ε<sub>r</sub></th>
                    <th>σ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="preset in materialPresets" :key="preset.name">
                    <td>{{ preset.name }}</td>
                    <td class="mono">{{ preset.er }}</td>
                    <td class="mono">{{ preset.sigma }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </template>

          <template v-else-if="activeNav === 'sim'">
            <div class="leida-form-grid">
              <div class="leida-field">
                <label>求解器</label>
                <select v-model="simulationDraft.solver">
                  <option value="时域有限差分">时域有限差分</option>
                  <option value="有限元时域法">有限元时域法</option>
                  <option value="矩量法">矩量法</option>
                </select>
              </div>
              <div class="leida-field">
                <label>计算域尺寸</label>
                <input v-model="simulationDraft.domainSizeText" />
              </div>
              <div class="leida-field">
                <label>时间步数</label>
                <input v-model.number="simulationDraft.timeSteps" type="number" min="1" />
              </div>
              <div class="leida-field">
                <label>边界条件</label>
                <select v-model="simulationDraft.boundary">
                  <option value="完美匹配层">完美匹配层</option>
                  <option value="吸收边界">吸收边界</option>
                  <option value="周期边界">周期边界</option>
                  <option value="理想导体边界">理想导体边界</option>
                </select>
              </div>
              <div class="leida-field">
                <label>时间步长（秒）</label>
                <input v-model="simulationDraft.timeStepText" />
              </div>
              <div class="leida-field">
                <label>总时长（纳秒）</label>
                <input v-model.number="simulationDraft.durationNs" type="number" min="0" step="0.1" />
              </div>
            </div>
            <label class="leida-field leida-field-full">
              <span>配置预览</span>
              <pre class="leida-json">{{ fdtdJson }}</pre>
            </label>
            <div class="leida-btn-group">
              <button
                class="leida-btn leida-btn-secondary"
                @click="selectNav('medium')">
                ← 上一步
              </button>
              <button
                class="leida-btn primary"
                @click="applySimulationStep">
                应用设置 →
              </button>
            </div>
          </template>

          <template v-else-if="activeNav === 'radar'">
            <RadarVisualizationControls
              v-if="useLiveRadarControls"
              theme="leida"
              compact
              :task-id="taskId"
              :visualization="visualization"
              :dimension="dimension"
              :type2d="type2d"
              :type3d="type3d"
              :radar-result-mode="radarResultMode"
              :radar-frequencies="radarFrequencies"
              :applying="applying"
              :batch-loading="batchLoading"
              :show-modes="false"
              :show-params="isCompactPanel"
              :show-apply="true"
              @update:radar-frequencies="
                emit('update:radarFrequencies', $event)
              "
              @update:dimension="emit('update:dimension', $event)"
              @update:type2d="emit('update:type2d', $event)"
              @update:type3d="emit('update:type3d', $event)"
              @update:radar-result-mode="emit('update:radarResultMode', $event)"
              @apply="applyRadarStep" />
            <template v-else>
              <div class="leida-form-grid">
                <div class="leida-field">
                  <label>雷达模式</label>
                  <select>
                    <option>单基地</option>
                    <option>双基地</option>
                  </select>
                </div>
                <div class="leida-field">
                  <label>发射功率</label>
                  <input value="15 分贝毫瓦" />
                </div>
                <div class="leida-field">
                  <label>中心频率</label>
                  <input value="2.4 吉赫兹" />
                </div>
                <div class="leida-field">
                  <label>带宽</label>
                  <input value="400 兆赫兹" />
                </div>
                <div class="leida-field leida-field-full">
                  <label>发射位置</label>
                  <input value="[0.2, 1.0, 0.75]" />
                </div>
                <div class="leida-field leida-field-full">
                  <label>接收位置</label>
                  <input value="[0.2, 1.0, 0.75]" />
                </div>
              </div>
              <div class="leida-hint">
                雷达源位置可在中间视口中拖拽调整，参数将同步更新。
              </div>
              <div class="leida-btn-group">
                <button
                  class="leida-btn leida-btn-secondary"
                  @click="selectNav('sim')">
                  ← 上一步
                </button>
                <button
                  class="leida-btn primary"
                  @click="applyRadarStep">
                  应用设置 →
                </button>
              </div>
            </template>
          </template>

          <template v-else-if="activeNav === 'viz'">
            <RadarVisualizationControls
              v-if="useLiveRadarControls"
              theme="leida"
              compact
              :task-id="taskId"
              :visualization="visualization"
              :dimension="dimension"
              :type2d="type2d"
              :type3d="type3d"
              :radar-result-mode="radarResultMode"
              :radar-frequencies="radarFrequencies"
              :applying="applying"
              :batch-loading="batchLoading"
              :show-types="false"
              :show-params="false"
              :show-viz-params="true"
              :show-summary="isCompactPanel"
              @update:radar-frequencies="
                emit('update:radarFrequencies', $event)
              "
              @update:dimension="emit('update:dimension', $event)"
              @update:type2d="emit('update:type2d', $event)"
              @update:type3d="emit('update:type3d', $event)"
              @update:radar-result-mode="emit('update:radarResultMode', $event)"
              @apply="applyVisualizationStep" />
            <template v-else>
              <div class="leida-form-grid">
                <div class="leida-field">
                  <label>可视化模式</label>
                  <select>
                    <option>场波前</option>
                    <option>电场幅值</option>
                    <option>瞬时相位</option>
                  </select>
                </div>
                <div class="leida-field">
                  <label>色图</label>
                  <select>
                    <option>彩虹</option>
                    <option>青绿</option>
                    <option>热力</option>
                  </select>
                </div>
                <div class="leida-field">
                  <label>场强范围（伏/米）</label>
                  <input value="1.0×10⁰ ~ 1.0×10⁴" />
                </div>
                <div class="leida-field">
                  <label>切片平面</label>
                  <select>
                    <option>Z=0.75 水平截面</option>
                    <option>Y=1.0 纵向截面</option>
                  </select>
                </div>
              </div>
              <div class="leida-toggle-row">
                <span>显示几何体</span>
                <label class="leida-switch"
                  ><input type="checkbox" checked /><span
                /></label>
              </div>
              <div class="leida-window-row">
                <span>0 纳秒</span>
                <input
                  v-model.number="currentTime"
                  type="range"
                  min="0"
                  :max="totalTime"
                  step="0.01" />
                <span>10 纳秒</span>
              </div>
              <div class="leida-hint">
                下方图表区展示回波截面、场强映射与输出文件。
              </div>
              <div class="leida-btn-group">
                <button
                  class="leida-btn leida-btn-secondary"
                  @click="selectNav('radar')">
                  ← 上一步
                </button>
                <button
                  class="leida-btn primary"
                  @click="applyVisualizationStep">
                  应用设置
                </button>
              </div>
            </template>
          </template>

          <template v-else-if="activeNav === 'compare'">
            <div class="leida-form-grid">
              <div class="leida-field">
                <label>工况 A</label>
                <select v-model="compareCaseA">
                  <option
                    v-for="c in compareCases"
                    :key="c.value"
                    :value="c.value">
                    {{ c.label }}
                  </option>
                </select>
              </div>
              <div class="leida-field">
                <label>工况 B</label>
                <select v-model="compareCaseB">
                  <option
                    v-for="c in compareCases"
                    :key="`b-${c.value}`"
                    :value="c.value">
                    {{ c.label }}
                  </option>
                </select>
              </div>
              <div class="leida-field">
                <label>对比量</label>
                <select>
                  <option>场强最大值差分</option>
                  <option>回波幅度</option>
                  <option>传播路径</option>
                </select>
              </div>
              <div class="leida-field">
                <label>叠加透明度</label>
                <input type="range" min="0" max="100" value="50" />
              </div>
            </div>
            <div class="leida-compare-summary">
              <div><span>场强最大值差</span><strong>+1.24 分贝</strong></div>
              <div><span>回波峰值差</span><strong>-3.8 分贝</strong></div>
              <div><span>主径时延差</span><strong>0.12 纳秒</strong></div>
            </div>
            <button class="leida-btn primary leida-btn-block">
              生成对比报告
            </button>
          </template>
        </div>

        <!-- <footer v-if="isCompactPanel" class="leida-module-footer">
          <div class="leida-footer-grid">
            <div class="leida-footer-item">
              <span>模型</span>
              <strong>{{ modelName }}</strong>
            </div>
            <div class="leida-footer-item">
              <span>任务</span>
              <strong>{{ taskId }}</strong>
            </div>
            <div class="leida-footer-item">
              <span>仿真进度</span>
              <strong>{{ simProgress }}%</strong>
            </div>
          </div>
          <div class="leida-footer-progress">
            <div class="leida-progress-bar">
              <div
                class="leida-progress-fill"
                :style="{ width: `${simProgress}%` }" />
            </div>
          </div>
        </footer> -->
      </aside>

      <button
        v-if="configCollapsed"
        type="button"
        class="leida-panel-fab leida-panel-fab--config"
        title="展开配置"
        @click="configCollapsed = false">
        <DArrowLeft />
        <span>{{ activeNavMeta.label }}</span>
      </button>


      <TimelineControl
        v-if="embedded && showTimeline && !externalViewport"
        class="leida-playback leida-timeline-slot"
        layout="inline"
        :current-step="timelineCurrentStep"
        :total-steps="timelineTotalSteps"
        :physical-times="timelinePhysicalTimes"
        :is-playing="isTimelinePlaying"
        :is-collapsed="isTimelineCollapsed"
        :disabled="timelineDisabled"
        :speed="animationSpeed"
        :layers="generatedLayers"
        :selected-layer-id="selectedLayerId"
        @update:current-step="emit('update:timelineCurrentStep', $event)"
        @update:speed="emit('update:animationSpeed', $event)"
        @update:selected-layer-id="emit('update:selectedLayerId', $event)"
        @play="emit('timeline-play')"
        @pause="emit('timeline-pause')"
        @stop="emit('timeline-stop')"
        @seek="emit('timeline-seek', $event)"
        @toggle-collapse="emit('timeline-toggle-collapse')" />

      <footer v-else-if="!embedded" class="leida-playback">
        <div class="leida-playback-controls">
          <button class="active" title="暂停"><VideoPause /></button>
          <button title="停止">■</button>
          <button title="上一帧">⏮</button>
          <button title="后退">◀◀</button>
          <button title="前进">▶▶</button>
          <button title="下一帧">⏭</button>
          <button title="循环">🔁</button>
        </div>
        <div class="leida-playback-slider">
          <input
            v-model.number="currentTime"
            type="range"
            min="0"
            :max="totalTime"
            step="0.01" />
          <div class="leida-playback-time">
            时间：{{ currentTime.toFixed(2) }} 纳秒 /
            {{ totalTime.toFixed(2) }} 纳秒
          </div>
        </div>
        <div class="leida-playback-extra">
          <label>
            速度：
            <select v-model="playbackSpeed">
              <option value="0.5">0.5×</option>
              <option value="1.0">1.0×</option>
              <option value="2.0">2.0×</option>
            </select>
          </label>
          <label>
            <input v-model="realtimeMode" type="checkbox" />
            实时模式
          </label>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.leida-panels-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.leida-panels-shell.embedded {
  width: 100%;
  height: 100%;
}

.leida-panels-shell.embedded.external-viewport {
  display: contents;
}

.leida-panels-shell.embedded .leida-body:not(.external-viewport) {
  flex: 1;
  min-height: 0;
}

.leida-panels-shell.embedded .leida-body.external-viewport {
  display: contents;
}
</style>
