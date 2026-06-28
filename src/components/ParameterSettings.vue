<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import {
  Setting,
  Check,
  RefreshLeft,
  Collection,
  Top,
  TopRight,
  Right,
  BottomRight,
  Bottom,
  BottomLeft,
  Back,
  TopLeft,
  VideoPlay,
  Delete,
  Plus,
  QuestionFilled,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useParameterForm } from '@/composables/useParameterForm'
import { useParameterPresets } from '@/composables/useParameterPresets'
import { useWorkerDialog } from '@/composables/useWorkerDialog'
import { normalizeWorkersList } from '@/utils/worker'
import postProcessingApi from '@/api/postProcessing'
import ribbonApi from '@/api/ribbon'
import taskApi from '@/api/task'
import { gasNameMap, isGasVariable } from '@/constants/gasVariables'
import {
  mergeVolumeColormapOptions,
  findColormapOptionByValue,
  colormapBarStyleFromOption,
} from '@/utils/volumeColormap'
import {
  readSavedGasColormaps,
  writeSavedGasColormaps,
} from '@/utils/gasColormapStorage'
import { assignDistinctGasColormaps } from '@/utils/gasColormapDefaults'
import { isUnsetBoundaryTemperature } from '@/utils/boundaryTemperature.js'
import PregenContourColorConfig from './PregenContourColorConfig.vue'
import GasVariableConfigDialog from './GasVariableConfigDialog.vue'
import WorkerSelectDialog from './WorkerSelectDialog.vue'

const props = defineProps({
  taskId: { type: [String, Number], default: '' },
  modelId: { type: [String, Number], default: '' },
  initialData: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['start-analysis', 'navigate', 'refresh', 'params-saved'])

const stateForm = useParameterForm({
  props,
  emit,
  getContourRibbonCatalog: () =>
    pregenContourColorConfigRef.value?.getColorMapCatalog?.() ?? [],
})
const { form, fetchModelInfo, submitForm, mapBackendParamsToForm } = stateForm

const statePresets = useParameterPresets({ form })
const {
  selectedPreset,
  allPresets,
  loadCustomPresets,
  loadPreset,
  handleSaveCurrentAsPreset,
  handleDeletePreset,
} = statePresets

// Worker 对话框：使用 useWorkerDialog 直接处理启动任务，不再经过 HomeView 转发
const runtimeConfig = ref({
  time_steps: 100,
  time_step_size: 0.01,
  iterations_per_time_step: 20,
  processes: 1,
  image_generation_granularity: 10,
})

// 气体变量配置对话框
const gasVariableConfigVisible = ref(false)
const pregenContourColorConfigRef = ref(null)
const workerDialogRef = ref(null)
const {
  workerDialogVisible,
  workers,
  selectedWorkerId,
  loadingWorkers,
  fetchWorkers,
  confirmRunTask: runTaskDirect,
} = useWorkerDialog({ activeModule: ref('param'), runtimeConfig })

const handleStartAnalysis = async () => {
  workerDialogVisible.value = true
  await fetchWorkers()
}

const savingParams = ref(false)

const handleSaveParameters = async () => {
  if (!props.taskId) {
    ElMessage.warning('请先创建或选择一个任务')
    return
  }
  savingParams.value = true
  try {
    const result = await submitForm(false)
    if (result?.ok && result.updateData) {
      emit('params-saved', result.updateData)
    }
  } finally {
    savingParams.value = false
  }
}

const confirmRunTask = async (payload) => {
  const result = await submitForm(true)
  if (!result?.ok) {
    ElMessage.error('任务参数保存失败，无法启动任务')
    return
  }
  if (result.updateData) {
    emit('params-saved', result.updateData)
  }
  await runTaskDirect({
    ...payload,
    taskId: props.taskId,
    onTaskStarted: async () => {
      emit('navigate', 'tasks')
    },
  })
}

const guideOpenWorkerDialog = async () => {
  workerDialogVisible.value = true
  await fetchWorkers()
  await nextTick()
}

const guideSelectFirstWorker = async () => {
  if (!workers.value.length) {
    await fetchWorkers()
  }
  const firstWorker = workers.value[0]
  if (firstWorker) {
    selectedWorkerId.value = firstWorker.id
    await nextTick()
  }
}

const guideGoToRuntimeConfig = async () => {
  await guideSelectFirstWorker()
  workerDialogRef.value?.setGuideStep?.(1)
  await nextTick()
}

const guideCloseWorkerDialog = async () => {
  workerDialogRef.value?.closeDialog?.()
  await nextTick()
}

defineExpose({
  guideOpenWorkerDialog,
  guideSelectFirstWorker,
  guideGoToRuntimeConfig,
  guideCloseWorkerDialog,
})
const rules = {
  temperature: [
    { required: true, message: '请输入温度' },
    { type: 'number', min: -20, max: 100, message: '范围 -20~100' },
  ],
  humidity: [
    { required: true, message: '请输入湿度' },
    { type: 'number', min: 0, max: 100, message: '范围 0~100' },
  ],
  pressure: [
    { required: true, message: '请输入压力' },
    { type: 'number', min: 0, max: 200, message: '范围 0~200 kPa' },
  ],
  windSpeed: [
    { required: true, message: '请输入风速' },
    { type: 'number', min: 0, message: '风速不能小于 0' },
  ],
  windDirectionX: [{ required: true, message: '请输入风向 X 分量' }],
  windDirectionY: [{ required: true, message: '请输入风向 Y 分量' }],
  windDirectionZ: [{ required: true, message: '请输入风向 Z 分量' }],
}

const addCustomColor = () => {
  form.pregenContourCustomColors.push('#888888')
}
const removeCustomColor = (idx) => {
  form.pregenContourCustomColors.splice(idx, 1)
}

const boundaryTypeOptions = [
  { label: '壁面', value: 'wall' },
  { label: '压力出口', value: 'pressure-outlet' },
  { label: '质量流量入口', value: 'mass-flow-inlet' },
  { label: '速度入口', value: 'velocity-inlet' },
]

const boundaryTypeFieldConfig = {
  wall: [{ key: 'temperature', label: '温度 (°C)', kind: 'temperature' }],
  'pressure-outlet': [
    { key: 'temperature', label: '温度 (°C)', kind: 'temperature' },
  ],
  'mass-flow-inlet': [
    { key: 'temperature', label: '温度 (°C)', kind: 'temperature' },
    { key: 'mass_flow_rate', label: '质量流量', kind: 'number' },
    { key: 'species_fractions', label: '组分分数', kind: 'species' },
  ],
  'velocity-inlet': [
    { key: 'temperature', label: '温度 (°C)', kind: 'temperature' },
    { key: 'velocity_x', label: 'X 方向速度', kind: 'number' },
    { key: 'velocity_y', label: 'Y 方向速度', kind: 'number' },
    { key: 'velocity_z', label: 'Z 方向速度', kind: 'number' },
  ],
}

const boundaryTypeDefaults = {
  wall: { temperature: null },
  'pressure-outlet': { temperature: null },
  'mass-flow-inlet': {
    temperature: null,
    mass_flow_rate: 0,
    species_fractions: {},
  },
  'velocity-inlet': {
    temperature: null,
    velocity_x: 0,
    velocity_y: 0,
    velocity_z: 0,
  },
}

const dynamicBoundaryFieldKeys = [
  'temperature',
  'mass_flow_rate',
  'species_fractions',
  'velocity_x',
  'velocity_y',
  'velocity_z',
]

const normalizeBoundaryType = (type) =>
  boundaryTypeOptions.some((option) => option.value === type) ? type : 'wall'

const applyBoundaryTypeDefaults = (bc) => {
  const type = normalizeBoundaryType(bc.type)
  const previousTemperature = bc.temperature
  bc.type = type
  dynamicBoundaryFieldKeys.forEach((key) => {
    delete bc[key]
  })
  Object.assign(bc, boundaryTypeDefaults[type])
  if (
    previousTemperature != null &&
    !isUnsetBoundaryTemperature(previousTemperature)
  ) {
    bc.temperature = Number(previousTemperature)
  }
}

const setBoundaryTemperatureValue = (bc, value) => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) {
    bc.temperature = null
    return
  }
  bc.temperature = Number(value)
}

const getBoundaryFields = (bc) =>
  boundaryTypeFieldConfig[normalizeBoundaryType(bc.type)] ||
  boundaryTypeFieldConfig.wall

const resolveGasInfo = (id) => {
  let gasInfo = gasNameMap[id]
  if (!gasInfo) {
    const normalizedId = String(id || '').replace(
      /^mass_fraction_of_/,
      'Mass_fraction_of_',
    )
    gasInfo = gasNameMap[normalizedId]
  }
  return gasInfo
}

const getSpeciesOrder = () => {
  const source =
    props.initialData?.species_order ||
    props.initialData?.params?.species_order ||
    props.initialData?.model?.species_order ||
    []
  return Array.isArray(source) ? source.filter(Boolean) : []
}

const getInitialSpeciesFractionIds = (bc) => {
  const fractions = bc?.species_fractions
  const existingIds =
    fractions && typeof fractions === 'object' && !Array.isArray(fractions)
      ? Object.keys(fractions)
      : []
  if (existingIds.length > 0) return existingIds

  const speciesOrder = getSpeciesOrder()
  if (speciesOrder.length > 0) return speciesOrder

  return Object.keys(gasNameMap)
}

const ensureSpeciesFractionIds = (bc) => {
  if (!Array.isArray(bc.species_fraction_ids)) {
    bc.species_fraction_ids = getInitialSpeciesFractionIds(bc)
  }
  return bc.species_fraction_ids
}

const getSpeciesFractionGasOptions = (bc) =>
  ensureSpeciesFractionIds(bc).map((id) => {
    const gasInfo = resolveGasInfo(id)
    return {
      id,
      label: gasInfo ? `${gasInfo.zh} (${gasInfo.en})` : String(id),
    }
  })

const ensureSpeciesFractions = (bc) => {
  if (!bc.species_fractions || typeof bc.species_fractions !== 'object') {
    bc.species_fractions = {}
  }
  return bc.species_fractions
}

const getSpeciesFractionValue = (bc, gasId) => {
  const fractions = ensureSpeciesFractions(bc)
  if (fractions[gasId] == null || fractions[gasId] === '') {
    fractions[gasId] = 0
  }
  const value = fractions[gasId]
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const setSpeciesFractionValue = (bc, gasId, value) => {
  const fractions = ensureSpeciesFractions(bc)
  const number = Number(value)
  fractions[gasId] = Number.isFinite(number) ? number : 0
}

const removeSpeciesFraction = (bc, gasId) => {
  bc.species_fraction_ids = ensureSpeciesFractionIds(bc).filter(
    (id) => id !== gasId,
  )
  if (
    bc.species_fractions &&
    typeof bc.species_fractions === 'object' &&
    !Array.isArray(bc.species_fractions)
  ) {
    delete bc.species_fractions[gasId]
  }
}

const NAMED_COLOR_MAP = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  cyan: '#00ffff',
  magenta: '#ff00ff',
}

const normalizePickerColor = (value) => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return ''
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
  }
  if (NAMED_COLOR_MAP[raw]) return NAMED_COLOR_MAP[raw]
  const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/)
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .split(',')
      .map((part) => Number.parseFloat(part.trim()))
    if (
      parts.length >= 3 &&
      parts.slice(0, 3).every((n) => Number.isFinite(n))
    ) {
      return `#${parts
        .slice(0, 3)
        .map((n) =>
          Math.max(0, Math.min(255, Math.round(n)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`
    }
  }
  return ''
}

const setUnifiedVectorColor = (value) => {
  if (!value) return
  // 检查是否是命名颜色
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  if (NAMED_COLOR_MAP[raw]) {
    form.pregenVectorColor = raw
  } else {
    form.pregenVectorColor =
      normalizePickerColor(value) || form.pregenVectorColor
  }
}

const pregenVolumeMode = computed({
  get() {
    const resolution = String(form.pregenVolumeResolution ?? '').trim()
    const samplingRatio = String(form.pregenVolumeSamplingRatio ?? '').trim()
    if (samplingRatio && !resolution) return 'sampling_ratio'
    return 'resolution'
  },
  set(mode) {
    if (mode === 'sampling_ratio') {
      form.pregenVolumeResolution = ''
      if (String(form.pregenVolumeSamplingRatio ?? '').trim() === '') {
        form.pregenVolumeSamplingRatio = 1
      }
      return
    }
    form.pregenVolumeSamplingRatio = ''
    if (String(form.pregenVolumeResolution ?? '').trim() === '') {
      form.pregenVolumeResolution = 64
    }
  },
})

const setPregenVolumeResolution = (value) => {
  form.pregenVolumeResolution = value
  if (String(value ?? '').trim() !== '') {
    form.pregenVolumeSamplingRatio = ''
  }
}

const setPregenVolumeSamplingRatio = (value) => {
  form.pregenVolumeSamplingRatio = value
  if (String(value ?? '').trim() !== '') {
    form.pregenVolumeResolution = ''
  }
}

const contourGasVariables = ref([])
const loadingContourVariables = ref(false)
const contourColorMapCatalog = ref([])
const loadingContourColorMaps = ref(false)

const contourColorMapOptions = computed(() =>
  mergeVolumeColormapOptions(contourColorMapCatalog.value),
)

const contourCmapBarStyleForValue = (value) =>
  colormapBarStyleFromOption(
    findColormapOptionByValue(contourColorMapOptions.value, value),
  )

const contourCmapBarStyleForOption = (opt) => colormapBarStyleFromOption(opt)

const firstContourColorMapValue = () =>
  contourColorMapOptions.value.length > 0
    ? contourColorMapOptions.value[0].value
    : ''

const normalizeContourCmapSelections = () => {
  const options = contourColorMapOptions.value
  if (!options.length) return

  const hasOption = (value) =>
    value != null && value !== '' && findColormapOptionByValue(options, value)

  const fallbackValue = options[0].value
  if (!hasOption(form.pregenContourCmap)) {
    form.pregenContourCmap = fallbackValue
  }

  form.pregenContourVariableCmaps = assignDistinctGasColormaps(
    contourGasVariables.value,
    options,
    form.pregenContourVariableCmaps,
  )
  writeSavedGasColormaps(form.pregenContourVariableCmaps)
}

// 打开气体变量配置对话框
const openGasVariableConfig = () => {
  gasVariableConfigVisible.value = true
}

// 色带更新后刷新列表
const handleColorMapsUpdated = () => {
  fetchContourColorMaps()
  // 刷新等值线色带配置组件的色带列表
  if (pregenContourColorConfigRef.value) {
    pregenContourColorConfigRef.value.fetchColorMaps?.()
  }
}

const handlePregenGasCmapUpdate = ({ id, cmap }) => {
  if (!id || !cmap) return
  const next = {
    ...(form.pregenContourVariableCmaps || {}),
    [id]: cmap,
  }
  form.pregenContourVariableCmaps = next
  writeSavedGasColormaps(next)
}

const fetchContourColorMaps = async () => {
  loadingContourColorMaps.value = true
  try {
    const response = await ribbonApi.getRibbons({ page: 1, page_size: 200 })
    const items = response?.data?.items || response?.items || []
    contourColorMapCatalog.value = Array.isArray(items) ? items : []
    normalizeContourCmapSelections()
  } catch (error) {
    console.error('Failed to fetch contour color maps', error)
    contourColorMapCatalog.value = []
  } finally {
    loadingContourColorMaps.value = false
  }
}

const getGasDisplayName = (variableId) => {
  let gasInfo = gasNameMap[variableId]
  if (!gasInfo) {
    const normalizedId = String(variableId || '').replace(
      /^mass_fraction_of_/,
      'Mass_fraction_of_',
    )
    gasInfo = gasNameMap[normalizedId]
  }
  return gasInfo ? `${gasInfo.zh} (${gasInfo.en})` : String(variableId || '')
}

const syncContourVariableCmaps = (variableIds = []) => {
  const next = {}
  const savedGasColormaps = readSavedGasColormaps()
  for (const id of variableIds) {
    const saved =
      form.pregenContourVariableCmaps?.[id] ?? savedGasColormaps?.[id] ?? ''
    if (saved != null && String(saved).trim() !== '') next[id] = saved
  }
  form.pregenContourVariableCmaps = next
  normalizeContourCmapSelections()
}

const fetchContourVariables = async (taskId) => {
  if (!taskId) {
    contourGasVariables.value = []
    syncContourVariableCmaps([])
    return
  }
  loadingContourVariables.value = true
  try {
    const response = await postProcessingApi.getTaskVariables(taskId)
    const variableList = response?.data?.variables || response?.data || response
    const gasIds = Array.isArray(variableList)
      ? variableList
          .map((variable) =>
            typeof variable === 'string'
              ? variable
              : variable.id || variable.name || variable.variable,
          )
          .filter((id) => isGasVariable(id))
      : []

    contourGasVariables.value = gasIds.map((id) => ({
      id,
      name: getGasDisplayName(id),
    }))
    syncContourVariableCmaps(gasIds)
  } catch (error) {
    console.error('Failed to fetch contour gas variables', error)
    contourGasVariables.value = []
    syncContourVariableCmaps([])
  } finally {
    loadingContourVariables.value = false
  }
}

// 高级参数编辑

const isEditingAdvanced = ref(false)
const advancedConfigDraft = ref({})

const startEditingAdvanced = () => {
  const original = props.initialData?.params || props.initialData || {}
  advancedConfigDraft.value = JSON.parse(JSON.stringify(original))
  isEditingAdvanced.value = true
}

const saveAdvancedConfig = async () => {
  try {
    if (props.taskId) {
      await taskApi.updateTask(props.taskId, {
        params: advancedConfigDraft.value,
      })
      ElMessage.success('高级参数保存成功')
    }
    isEditingAdvanced.value = false
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || ''))
  }
}

const cancelEditingAdvanced = () => {
  isEditingAdvanced.value = false
  advancedConfigDraft.value = {}
}

const addAdvancedParam = () => {
  const key = `param_${Date.now()}`
  advancedConfigDraft.value[key] = ''
}

const deleteAdvancedParam = (key) => {
  delete advancedConfigDraft.value[key]
}

// 边界条件管理

const addBoundaryCondition = () => {
  if (!advancedConfigDraft.value.boundary_conditions) {
    advancedConfigDraft.value.boundary_conditions = []
  }
  advancedConfigDraft.value.boundary_conditions.push({
    name: `boundary_${advancedConfigDraft.value.boundary_conditions.length + 1}`,
    type: 'wall',
  })
}

const deleteBoundaryCondition = (bcIndex) => {
  if (advancedConfigDraft.value.boundary_conditions) {
    advancedConfigDraft.value.boundary_conditions.splice(bcIndex, 1)
  }
}

const deleteBCProperty = (bcIndex, key) => {
  if (advancedConfigDraft.value.boundary_conditions?.[bcIndex]) {
    delete advancedConfigDraft.value.boundary_conditions[bcIndex][key]
  }
}

// 表单工具

const resetForm = () => {
  mapBackendParamsToForm(props.initialData?.params || props.initialData || {})
  ElMessage.info('参数已重置')
}

const getJsonString = (key, value) => {
  try {
    return typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value)
  } catch {
    return String(value)
  }
}

const formatParamKey = (key) => {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const formatParamValue = (value) => {
  if (value == null) return '--'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

onMounted(() => {
  loadCustomPresets()
  fetchContourColorMaps()
  if (props.modelId) fetchModelInfo(props.modelId)
  if (props.taskId) fetchContourVariables(props.taskId)
})

watch(
  () => props.modelId,
  (id) => {
    if (id) fetchModelInfo(id)
  },
)
watch(
  () => props.taskId,
  (id) => {
    fetchContourVariables(id)
  },
  { immediate: true },
)
watch(
  () => props.initialData,
  (val) => {
    if (val) mapBackendParamsToForm(val.params || val)
  },
  { immediate: true, deep: true },
)
watch(
  () => contourColorMapCatalog.value,
  () => {
    normalizeContourCmapSelections()
  },
  { deep: true },
)
</script>

<template>
  <div class="parameter-settings">
    <div class="settings-header">
      <el-icon style="margin-right: 0.5rem"><Setting /></el-icon>
      <h3>环境参数设置</h3>
    </div>

    <div v-if="taskId" class="task-id-info">
      <span class="label">当前任务 ID:</span>
      <span class="value">{{ taskId }}</span>
    </div>

    <!-- 提示信息 -->
    <div v-if="!taskId" class="no-task-alert">
      <el-alert
        title="请先创建或选择一个任务"
        type="warning"
        :closable="false"
        show-icon />
    </div>

    <el-divider style="margin: 1rem 0" />

    <el-form
      :model="form"
      :rules="rules"
      label-width="110px"
      class="params-form"
      label-position="left">
      <el-form-item label="温度 (°C)" prop="temperature">
        <el-input
          v-model.number="form.temperature"
          placeholder="请输入温度"
          clearable />
      </el-form-item>

      <el-form-item label="湿度 (%)" prop="humidity">
        <el-input
          v-model.number="form.humidity"
          placeholder="请输入湿度"
          clearable />
      </el-form-item>

      <el-form-item label="压力 (kPa)" prop="pressure">
        <el-input
          v-model.number="form.pressure"
          placeholder="请输入压力"
          clearable />
      </el-form-item>

      <el-form-item label="风速" prop="windSpeed">
        <el-input
          v-model.number="form.windSpeed"
          placeholder="请输入风速"
          clearable />
      </el-form-item>

      <el-form-item label="风向" required>
        <div style="display: flex; gap: 0.5rem; width: 100%">
          <el-form-item prop="windDirectionX" style="margin-bottom: 0; flex: 1">
            <el-input v-model.number="form.windDirectionX" clearable>
              <template #prefix>X:</template>
            </el-input>
          </el-form-item>
          <el-form-item prop="windDirectionY" style="margin-bottom: 0; flex: 1">
            <el-input v-model.number="form.windDirectionY" clearable>
              <template #prefix>Y:</template>
            </el-input>
          </el-form-item>
          <el-form-item prop="windDirectionZ" style="margin-bottom: 0; flex: 1">
            <el-input v-model.number="form.windDirectionZ" clearable>
              <template #prefix>Z:</template>
            </el-input>
          </el-form-item>
        </div>
      </el-form-item>

      <el-divider style="margin: 1rem 0">
        <el-icon><Setting /></el-icon>
        边界条件设置
      </el-divider>

      <div class="boundary-form-section">
        <div class="section-header-with-action">
          <span class="section-title">边界条件列表</span>
        </div>
        <div
          v-for="(bc, bcIndex) in form.boundaryConditions"
          :key="bcIndex"
          class="boundary-condition-card boundary-condition-form-card">
          <div class="bc-header">
            <div class="bc-basic-fields">
              <div class="bc-field">
                <span class="field-label">边界名称</span>
                <el-input
                  :model-value="bc.name"
                  size="small"
                  readonly
                  class="bc-name-readonly"
                  placeholder="—" />
              </div>
              <div class="bc-field">
                <span class="field-label">边界类型</span>
                <el-select
                  v-model="bc.type"
                  size="small"
                  placeholder="请选择边界类型"
                  style="width: 170px"
                  @change="applyBoundaryTypeDefaults(bc)">
                  <el-option
                    v-for="option in boundaryTypeOptions"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value" />
                </el-select>
              </div>
              <div
                v-for="field in getBoundaryFields(bc)"
                :key="field.key"
                class="bc-field"
                :class="{ 'bc-field--species': field.kind === 'species' }">
                <span class="field-label">{{ field.label }}</span>
                <el-input-number
                  v-if="field.kind === 'temperature'"
                  :model-value="bc[field.key]"
                  size="small"
                  :step="0.1"
                  placeholder="未设置"
                  controls-position="right"
                  style="width: 150px"
                  @update:model-value="
                    (value) => setBoundaryTemperatureValue(bc, value)
                  " />
                <el-input-number
                  v-else-if="field.kind === 'number'"
                  v-model="bc[field.key]"
                  size="small"
                  :step="1"
                  controls-position="right"
                  style="width: 150px" />
                <el-input
                  v-else-if="field.kind === 'text'"
                  v-model="bc[field.key]"
                  size="small" />
                <div
                  v-else-if="field.kind === 'species'"
                  class="species-fractions-editor">
                  <div
                    v-for="gas in getSpeciesFractionGasOptions(bc)"
                    :key="gas.id"
                    class="species-fraction-row">
                    <span class="species-fraction-label">{{ gas.label }}</span>
                    <el-input-number
                      :model-value="getSpeciesFractionValue(bc, gas.id)"
                      size="small"
                      :step="0.01"
                      :min="0"
                      :max="1"
                      controls-position="right"
                      class="species-fraction-input"
                      @update:model-value="
                        (value) => setSpeciesFractionValue(bc, gas.id, value)
                      " />
                    <el-button
                      class="species-fraction-remove"
                      size="small"
                      circle
                      type="danger"
                      :icon="Delete"
                      @click="removeSpeciesFraction(bc, gas.id)"
                      title="删除气体" />
                  </div>
                  <div
                    v-if="getSpeciesFractionGasOptions(bc).length === 0"
                    class="empty-hint">
                    暂无气体组分，保存时 species_fractions 为空对象。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="!form.boundaryConditions || form.boundaryConditions.length === 0"
          class="empty-hint">
          暂无边界条件。保存时会提交为 params.boundary_conditions。
        </div>
      </div>

      <!-- <el-form-item label="风向" prop="windDirection">
        <el-select
          v-model="form.windDirection"
          placeholder="请选择风向"
          style="width: 100%">
          <el-option label="北 (North)" value="north">
            <el-icon style="margin-right: 0.5rem"><Top /></el-icon>
            北 (North)
          </el-option>
          <el-option label="东北 (Northeast)" value="northeast">
            <el-icon style="margin-right: 0.5rem"><TopRight /></el-icon>
            东北 (Northeast)
          </el-option>
          <el-option label="东 (East)" value="east">
            <el-icon style="margin-right: 0.5rem"><Right /></el-icon>
            东 (East)
          </el-option>
          <el-option label="东南 (Southeast)" value="southeast">
            <el-icon style="margin-right: 0.5rem"><BottomRight /></el-icon>
            东南 (Southeast)
          </el-option>
          <el-option label="南 (South)" value="south">
            <el-icon style="margin-right: 0.5rem"><Bottom /></el-icon>
            南 (South)
          </el-option>
          <el-option label="西南 (Southwest)" value="southwest">
            <el-icon style="margin-right: 0.5rem"><BottomLeft /></el-icon>
            西南 (Southwest)
          </el-option>
          <el-option label="西 (West)" value="west">
            <el-icon style="margin-right: 0.5rem"><Back /></el-icon>
            西 (West)
          </el-option>
          <el-option label="西北 (Northwest)" value="northwest">
            <el-icon style="margin-right: 0.5rem"><TopLeft /></el-icon>
            西北 (Northwest)
          </el-option>
        </el-select>
      </el-form-item> -->
    </el-form>

    <el-divider style="margin: 1rem 0">
      <el-icon><Setting /></el-icon>
      预生成配置
    </el-divider>

    <el-form
      :model="form"
      label-width="110px"
      class="params-form"
      label-position="left">
      <el-form-item>
        <template #label>
          <span class="label-with-tooltip">
            启用预生成
            <el-tooltip
              content="开启后在任务运行时自动生成可视化数据缓存，加快后续可视化查看速度"
              placement="top"
              effect="dark">
              <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <div class="switch-with-hint">
          <el-switch
            v-model="form.enablePregen"
            active-text="开启"
            inactive-text="关闭"
            :active-value="true"
            :inactive-value="false" />
          <span class="hint-text">
            开启后在任务运行时自动生成可视化数据缓存
          </span>
        </div>
      </el-form-item>

      <template v-if="form.enablePregen">
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              平面间距
              <el-tooltip
                content="设置平面采样的间距值，控制切片平面的密度。值越小，生成的切片越多，细节越丰富"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.pregenPlaneSpacing"
            controls-position="right"
            style="width: 100%" />
          <span class="hint-text" style="margin-top: 0.35rem; display: block"
            >平面采样间距</span
          >
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              点间距
              <el-tooltip
                content="设置点采样的间距值，控制数据点的密度。值越小，采样点越多，精度越高但数据量越大"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.pregenPointSpacing"
            controls-position="right"
            style="width: 100%" />
          <span class="hint-text" style="margin-top: 0.35rem; display: block"
            >点采样间距</span
          >
        </el-form-item>

        <div class="pregen-subtitle">
          <span>等值线 (contour)</span>
          <el-button type="primary" size="small" @click="openGasVariableConfig">
            气体变量配置
          </el-button>
        </div>
        <PregenContourColorConfig
          ref="pregenContourColorConfigRef"
          :task-id="taskId"
          :default-cmap="form.pregenContourCmap"
          :variable-cmaps="form.pregenContourVariableCmaps"
          @update:default-cmap="(value) => (form.pregenContourCmap = value)"
          @update:variable-cmaps="
            (value) => (form.pregenContourVariableCmaps = value)
          " />
        <div class="pregen-subtitle">矢量图 (vector)</div>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              颜色
              <el-tooltip
                content="设置矢量图的统一颜色"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="pregen-color-inline">
            <el-color-picker
              :model-value="
                NAMED_COLOR_MAP[form.pregenVectorColor?.toLowerCase()] ||
                normalizePickerColor(form.pregenVectorColor) ||
                '#000000'
              "
              :show-alpha="false"
              @change="setUnifiedVectorColor" />
          </div>
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              画质预设
              <el-tooltip
                content="设置矢量图的渲染画质。1k=低画质(快)，2k=中画质，4k=高画质(慢)。画质越高，细节越清晰但生成时间越长"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select v-model="form.pregenVectorQualityPreset" class="w-full">
            <el-option label="1k" value="1k" />
            <el-option label="2k" value="2k" />
            <el-option label="4k" value="4k" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              透明背景
              <el-tooltip
                content="开启后矢量图背景将变为透明，方便叠加到其他图像上"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-switch
            v-model="form.pregenVectorTransparentBackground"
            active-text="开启"
            inactive-text="关闭"
            :active-value="true"
            :inactive-value="false" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              箭矢密度
              <el-tooltip
                content="控制矢量图中箭头的密度。值越大，箭头越多越密集，但可能显得杂乱；值越小，箭头越稀疏"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input-number
            v-model="form.pregenVectorGlyphDensity"
            :min="4"
            :max="256"
            :step="1"
            controls-position="right"
            style="width: 100%"
            placeholder="4" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              线宽
              <el-tooltip
                content="设置矢量图中流线和箭头的线条宽度。值越大线条越粗，可视化效果更明显"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input-number
            v-model="form.pregenVectorLineWidth"
            :min="0.1"
            :max="20"
            :step="0.1"
            controls-position="right"
            style="width: 100%"
            placeholder="1" />
        </el-form-item>
        <div class="pregen-subtitle">流线图 (streamline)</div>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              种子数
              <el-tooltip
                content="设置流线的种子点数量。种子点越多，生成的流线越多，能更好地展示流场结构，但计算量也越大"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.pregenStreamlineSeedCount"
            controls-position="right"
            style="width: 100%" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              每条流线点数
              <el-tooltip
                content="设置每条流线上的点数。点数越多，流线越平滑连续，但数据量也越大"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.pregenStreamlinePointsPerStreamline"
            controls-position="right"
            style="width: 100%" />
        </el-form-item>

        <div class="pregen-subtitle">体渲染 (volume)</div>
        <el-form-item>
          <template #label>
            <span class="label-with-tooltip">
              填写方式
              <el-tooltip
                content="选择体渲染的参数填写方式：分辨率直接设置体数据的尺寸；采样比设置相对于原始数据的比例"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-radio-group
            v-model="pregenVolumeMode"
            class="pregen-inline-radio">
            <el-radio value="resolution">分辨率</el-radio>
            <el-radio value="sampling_ratio">采样比</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="pregenVolumeMode === 'resolution'">
          <template #label>
            <span class="label-with-tooltip">
              分辨率
              <el-tooltip
                content="直接设置体渲染的分辨率，格式如'256x256x128'。分辨率越高，体渲染越精细但数据量越大"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            :model-value="form.pregenVolumeResolution"
            @update:model-value="setPregenVolumeResolution"
            controls-position="right"
            style="width: 100%" />
        </el-form-item>
        <el-form-item v-else>
          <template #label>
            <span class="label-with-tooltip">
              采样比
              <el-tooltip
                content="设置体渲染相对于原始数据的采样比例，范围0-1。值越大，采样越密集，细节越丰富"
                placement="top"
                effect="dark">
                <el-icon class="label-tooltip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            :model-value="form.pregenVolumeSamplingRatio"
            @update:model-value="setPregenVolumeSamplingRatio"
            controls-position="right"
            style="width: 100%" />
        </el-form-item>

        <!-- <div class="pregen-subtitle">体纹理 (volume_texture)</div>
        <el-form-item label="分辨率">
          <el-input
            v-model="form.pregenVolumeTextureResolution"
            controls-position="right"
            style="width: 100%" />
        </el-form-item>
        <el-form-item label="采样比">
          <el-input
            v-model="form.pregenVolumeTextureSamplingRatio"
            controls-position="right"
            style="width: 100%" />
        </el-form-item> -->
      </template>
    </el-form>

    <template v-if="showAdvancedConfig">
      <el-divider style="margin: 1rem 0" />

      <!-- 高级配置 -->
      <el-collapse v-model="advancedConfigExpanded" class="advanced-config">
        <el-collapse-item name="advanced">
          <template #title>
            <div class="collapse-title">
              <el-icon><Setting /></el-icon>
              <span>高级配置</span>
            </div>
          </template>

          <!-- 只读模式 -->
          <div v-if="!isEditingAdvanced" class="advanced-params-content">
            <div class="advanced-actions">
              <el-button
                size="small"
                type="primary"
                @click="startEditingAdvanced"
                :disabled="!taskId">
                编辑配置
              </el-button>
            </div>

            <div
              v-for="(value, key) in advancedParams"
              :key="key"
              class="param-card">
              <div class="param-card-header">
                <span class="param-name">{{ formatParamKey(key) }}</span>
              </div>
              <div class="param-card-body">
                <!-- 简单值 -->
                <template v-if="!isObject(value) && !isArray(value)">
                  <div class="param-simple-value">
                    {{ formatParamValue(value) }}
                  </div>
                </template>
                <!-- 数组 -->
                <template v-else-if="isArray(value)">
                  <div class="param-array-value">
                    <div v-if="value.length === 0" class="empty-array">
                      空数组
                    </div>
                    <div v-else-if="isSimpleArray(value)" class="inline-array">
                      <span
                        v-for="(item, idx) in value"
                        :key="idx"
                        class="array-item">
                        {{ typeof item === 'number' ? item.toFixed(2) : item }}
                      </span>
                    </div>
                    <div v-else class="array-list">
                      <div
                        v-for="(item, idx) in value.slice(0, 5)"
                        :key="idx"
                        class="array-list-item">
                        <span class="array-index">[{{ idx }}]</span>
                        <span class="array-item-value">{{
                          typeof item === 'object' ? JSON.stringify(item) : item
                        }}</span>
                      </div>
                      <div v-if="value.length > 5" class="array-more">
                        ...还有 {{ value.length - 5 }} 项
                      </div>
                    </div>
                  </div>
                </template>
                <!-- 对象 -->
                <template v-else>
                  <div class="param-object-value">
                    <div
                      v-for="(objVal, objKey) in value"
                      :key="objKey"
                      class="object-prop">
                      <span class="object-key">{{ objKey }}:</span>
                      <span class="object-value">{{
                        typeof objVal === 'object'
                          ? JSON.stringify(objVal)
                          : objVal
                      }}</span>
                    </div>
                  </div>
                </template>
              </div>
            </div>
            <div
              v-if="Object.keys(advancedParams).length === 0"
              class="empty-hint">
              暂无其他配置参数
            </div>
          </div>

          <!-- 编辑模式 -->
          <div v-else class="advanced-params-content editing">
            <div class="advanced-actions">
              <el-button
                size="small"
                type="success"
                :icon="Check"
                @click="saveAdvancedConfig">
                保存
              </el-button>
              <el-button size="small" @click="cancelEditingAdvanced">
                取消
              </el-button>
              <el-button
                size="small"
                type="primary"
                :icon="Plus"
                @click="addAdvancedParam">
                添加参数
              </el-button>
            </div>

            <!-- 边界条件编辑 -->
            <div class="boundary-conditions-section">
              <div class="section-header-with-action">
                <span class="section-title">边界条件</span>
                <el-button
                  size="small"
                  type="primary"
                  :icon="Plus"
                  @click="addBoundaryCondition">
                  添加边界条件
                </el-button>
              </div>
              <div
                v-for="(bc, bcIndex) in editingBoundaryConditions"
                :key="bcIndex"
                class="boundary-condition-card">
                <div class="bc-header">
                  <div class="bc-basic-fields">
                    <div class="bc-field">
                      <span class="field-label">名称</span>
                      <el-input
                        :model-value="editingBoundaryConditions[bcIndex].name"
                        size="small"
                        readonly
                        class="bc-name-readonly"
                        placeholder="—" />
                    </div>
                    <div class="bc-field">
                      <span class="field-label">类型</span>
                      <el-select
                        v-model="editingBoundaryConditions[bcIndex].type"
                        size="small"
                        placeholder="边界类型"
                        style="width: 150px">
                        <el-option
                          v-for="option in boundaryTypeOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value" />
                      </el-select>
                    </div>
                  </div>
                  <el-button
                    size="small"
                    circle
                    type="danger"
                    :icon="Delete"
                    @click="deleteBoundaryCondition(bcIndex)"
                    title="删除边界条件" />
                </div>
                <div class="bc-custom-fields">
                  <div
                    v-for="(val, key) in getBCCustomFields(bc)"
                    :key="key"
                    class="custom-field-row">
                    <el-input
                      :model-value="key"
                      size="small"
                      readonly
                      style="width: 150px; margin-right: 8px" />
                    <div class="custom-field-value">
                      <!-- 布尔值 -->
                      <template v-if="typeof val === 'boolean'">
                        <el-switch
                          v-model="editingBoundaryConditions[bcIndex][key]"
                          active-text="是"
                          inactive-text="否" />
                      </template>
                      <!-- 数字 -->
                      <template v-else-if="typeof val === 'number'">
                        <el-input-number
                          v-model="editingBoundaryConditions[bcIndex][key]"
                          size="small"
                          style="width: 100%"
                          :step="0.1"
                          controls-position="right" />
                      </template>
                      <!-- 字符串 -->
                      <template v-else-if="typeof val === 'string'">
                        <el-input
                          v-model="editingBoundaryConditions[bcIndex][key]"
                          size="small"
                          placeholder="值" />
                      </template>
                      <!-- 数组/对象 -->
                      <template v-else>
                        <el-input
                          type="textarea"
                          :rows="2"
                          :model-value="JSON.stringify(val, null, 2)"
                          @input="
                            (newVal) => {
                              try {
                                editingBoundaryConditions[bcIndex][key] =
                                  JSON.parse(newVal)
                              } catch (e) {
                                // 解析失败时不更新
                              }
                            }
                          "
                          size="small"
                          placeholder="JSON"
                          spellcheck="false"
                          style="font-family: monospace" />
                      </template>
                    </div>
                    <el-button
                      size="small"
                      circle
                      type="danger"
                      :icon="Delete"
                      @click="deleteBCProperty(bcIndex, key)"
                      title="删除属性" />
                  </div>
                  <el-button
                    size="small"
                    type="primary"
                    text
                    @click="
                      async () => {
                        try {
                          const { value: key } = await ElMessageBox.prompt(
                            '请输入属性名称',
                            '添加属性',
                            {
                              confirmButtonText: '确定',
                              cancelButtonText: '取消',
                              inputPlaceholder: '属性名',
                            },
                          )
                          if (key && !editingBoundaryConditions[bcIndex][key]) {
                            editingBoundaryConditions[bcIndex][key] = ''
                          }
                        } catch (e) {
                          // 用户取消
                        }
                      }
                    ">
                    + 添加属性
                  </el-button>
                </div>
              </div>
              <div
                v-if="editingBoundaryConditions.length === 0"
                class="empty-hint">
                暂无边界条件，点击“添加边界条件”开始配置
              </div>
            </div>

            <div
              v-for="(value, key) in editingAdvancedParams"
              :key="key"
              class="param-card editable">
              <div class="param-card-header">
                <span class="param-name">{{ formatParamKey(key) }}</span>
                <div class="param-actions">
                  <el-button
                    size="small"
                    circle
                    type="danger"
                    :icon="Delete"
                    @click="deleteAdvancedParam(key)"
                    title="删除" />
                </div>
              </div>
              <div class="param-card-body" style="padding-top: 0.5rem">
                <!-- 布尔值 -->
                <template v-if="typeof value === 'boolean'">
                  <el-switch
                    v-model="editingAdvancedParams[key]"
                    active-text="是"
                    inactive-text="否" />
                </template>
                <!-- 数字 -->
                <template v-else-if="typeof value === 'number'">
                  <el-input-number
                    v-model="editingAdvancedParams[key]"
                    style="width: 100%"
                    :step="0.1"
                    controls-position="right" />
                </template>
                <!-- 字符串 -->
                <template v-else-if="typeof value === 'string'">
                  <el-input
                    v-model="editingAdvancedParams[key]"
                    placeholder="请输入值" />
                </template>
                <!-- 复杂对象/数组（JSON 编辑） -->
                <template v-else>
                  <el-input
                    type="textarea"
                    :rows="3"
                    :model-value="getJsonString(key, value)"
                    @input="(val) => updateJsonString(key, val)"
                    placeholder="请输入 JSON"
                    spellcheck="false"
                    style="font-family: monospace" />
                </template>
              </div>
            </div>
            <div
              v-if="Object.keys(editingAdvancedParams).length === 0"
              class="empty-hint">
              暂无配置参数，点击“添加参数”开始配置
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </template>

    <!-- <el-divider style="margin: 1rem 0">
      <el-icon><Collection /></el-icon>
      预设方案
    </el-divider>

    <div class="preset-select-wrap">
      <el-select
        v-model="selectedPreset"
        class="preset-select"
        placeholder="请选择预设方案"
        style="width: 100%"
        @change="loadPreset">
        <el-option
          v-for="item in allPresets"
          :key="item.value"
          :label="item.label"
          :value="item.value">
          <div class="preset-option-row">
            <span>{{ item.label }}</span>
            <el-icon
              class="preset-option-delete"
              @click.stop.prevent="handleDeletePreset(item.value)">
              <Delete />
            </el-icon>
          </div>
        </el-option>
      </el-select>
    </div> -->

    <el-divider style="margin: 1rem 0" />

    <div class="form-buttons">
      <el-button
        type="primary"
        :icon="Check"
        :loading="savingParams"
        :disabled="!taskId"
        class="task-guide-save-params form-btn-primary"
        @click="handleSaveParameters">
        保存参数
      </el-button>
      <el-button
        :icon="VideoPlay"
        :disabled="!taskId"
        class="task-guide-start-analysis form-btn-secondary"
        @click="handleStartAnalysis">
        开始分析
      </el-button>
      <!-- <el-button
        :icon="Check"
        @click="handleSaveCurrentAsPreset"
        class="form-btn-secondary">
        保存预设
      </el-button> -->
      <el-button
        :icon="RefreshLeft"
        class="form-btn-secondary"
        @click="resetForm">
        重置
      </el-button>
    </div>

    <WorkerSelectDialog
      ref="workerDialogRef"
      v-model="workerDialogVisible"
      :workers="workers"
      :loading="loadingWorkers"
      :selected-worker-id="selectedWorkerId"
      :runtime-config="runtimeConfig"
      :show-runtime-config="true"
      confirm-text="启动任务"
      @update:selected-worker-id="(id) => (selectedWorkerId = id)"
      @refresh="fetchWorkers"
      @confirm="confirmRunTask" />

    <!-- 气体变量配置对话框 -->
    <GasVariableConfigDialog
      v-model="gasVariableConfigVisible"
      :task-id="taskId ? String(taskId) : ''"
      dimension="3d"
      visualization-type="volume"
      :gas-cmaps="form.pregenContourVariableCmaps"
      :color-map-catalog="contourColorMapCatalog"
      @update-gas-cmap="handlePregenGasCmapUpdate"
      @color-maps-updated="handleColorMapsUpdated"
      @refresh-color-maps="fetchContourColorMaps" />
  </div>
</template>

<style scoped src="@/assets/styles/components/ParameterSettings.css"></style>
