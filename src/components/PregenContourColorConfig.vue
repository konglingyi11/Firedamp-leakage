<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import postProcessingApi from '@/api/postProcessing'
import ribbonApi from '@/api/ribbon'
import { gasNameMap, isGasVariable } from '@/constants/gasVariables'
import {
  mergeVolumeColormapOptions,
  findColormapOptionByValue,
  colormapBarStyleFromOption,
} from '@/utils/volumeColormap'
import { assignDistinctGasColormaps } from '@/utils/gasColormapDefaults'

const props = defineProps({
  taskId: {
    type: [String, Number],
    default: '',
  },
  defaultCmap: {
    type: String,
    default: '',
  },
  variableCmaps: {
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['update:defaultCmap', 'update:variableCmaps'])

const FOLLOW_DEFAULT_VALUE = '__follow_default__'
const gasVariables = ref([])
const colorMapCatalog = ref([])
const loadingVariables = ref(false)
const loadingColorMaps = ref(false)

const colorMapOptions = computed(() =>
  mergeVolumeColormapOptions(colorMapCatalog.value),
)

const cmapBarStyleForValue = (value) =>
  colormapBarStyleFromOption(
    findColormapOptionByValue(colorMapOptions.value, value),
  )

const cmapBarStyleForOption = (opt) => colormapBarStyleFromOption(opt)

function getGasDisplayName(variableId) {
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

function getVariableCmapSelectValue(variableId) {
  const value = props.variableCmaps?.[variableId]
  return value == null || value === '' ? FOLLOW_DEFAULT_VALUE : value
}

function getVariablePreviewValue(variableId) {
  return props.variableCmaps?.[variableId] || props.defaultCmap
}

function getVariableLabelValue(value) {
  return value === FOLLOW_DEFAULT_VALUE ? props.defaultCmap : value
}

function getVariableLabelText(label, value) {
  if (value === FOLLOW_DEFAULT_VALUE) return '跟随默认'
  return label
}

function normalizeSelectionState() {
  const options = colorMapOptions.value
  if (!options.length) return

  const firstValue = options[0].value
  const hasOption = (value) =>
    value != null &&
    value !== '' &&
    findColormapOptionByValue(options, value) != null

  if (!hasOption(props.defaultCmap)) {
    emit('update:defaultCmap', firstValue)
  }

  emit(
    'update:variableCmaps',
    assignDistinctGasColormaps(gasVariables.value, options, props.variableCmaps),
  )
}

async function fetchColorMaps() {
  loadingColorMaps.value = true
  try {
    const response = await ribbonApi.getRibbons({ page: 1, page_size: 200 })
    const items = response?.data?.items || response?.items || []
    colorMapCatalog.value = Array.isArray(items) ? items : []
    normalizeSelectionState()
  } catch (error) {
    console.error('Failed to fetch pregen contour color maps', error)
    colorMapCatalog.value = []
    ElMessage.error('加载色带列表失败')
  } finally {
    loadingColorMaps.value = false
  }
}

async function fetchVariables(taskId) {
  if (!taskId) {
    gasVariables.value = []
    emit('update:variableCmaps', {})
    return
  }

  loadingVariables.value = true
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

    gasVariables.value = gasIds.map((id) => ({
      id,
      name: getGasDisplayName(id),
    }))
    normalizeSelectionState()
  } catch (error) {
    console.error('Failed to fetch pregen contour gas variables', error)
    gasVariables.value = []
    emit('update:variableCmaps', {})
    ElMessage.error('加载气体变量失败')
  } finally {
    loadingVariables.value = false
  }
}

function updateVariableCmap(id, value) {
  const next = { ...(props.variableCmaps || {}) }
  if (value == null || value === '' || value === FOLLOW_DEFAULT_VALUE) {
    delete next[id]
  } else {
    next[id] = value
  }
  emit('update:variableCmaps', next)
}

watch(
  () => props.taskId,
  (taskId) => {
    fetchVariables(taskId)
  },
  { immediate: true },
)

watch(
  colorMapOptions,
  () => {
    normalizeSelectionState()
  },
  { deep: true },
)

fetchColorMaps()

// 暴露方法给父组件
defineExpose({
  fetchColorMaps,
  getColorMapCatalog: () => colorMapCatalog.value,
})
</script>

<template>
  <div class="pregen-contour-color-config">
    <el-form-item v-if="gasVariables.length > 0" label="气体色带">
      <div class="contour-variable-cmaps">
        <div
          v-for="gas in gasVariables"
          :key="gas.id"
          class="contour-variable-cmap-row">
          <div class="contour-variable-cmap-info">
            <span class="contour-variable-cmap-name">{{ gas.name }}</span>
          </div>

          <el-select
            :model-value="getVariableCmapSelectValue(gas.id)"
            clearable
            filterable
            placeholder="跟随默认"
            class="contour-variable-cmap-select"
            @change="(value) => updateVariableCmap(gas.id, value)">
            <template #label="{ label, value }">
              <span class="cmap-select-label">
                <span
                  class="cmap-select-label-bar"
                  :style="cmapBarStyleForValue(getVariableLabelValue(value))" />
                <span class="cmap-select-label-text">{{
                  getVariableLabelText(label, value)
                }}</span>
              </span>
            </template>
            <el-option
              :key="`${gas.id}-${FOLLOW_DEFAULT_VALUE}`"
              label="跟随默认"
              :value="FOLLOW_DEFAULT_VALUE">
              <div class="gas-cmap-option-row">
                <span class="gas-cmap-option-label">跟随默认</span>
                <span
                  class="gas-cmap-option-gradient"
                  :style="cmapBarStyleForValue(defaultCmap)" />
              </div>
            </el-option>
            <el-option
              v-for="opt in colorMapOptions"
              :key="`${gas.id}-${opt.value}`"
              :label="opt.label"
              :value="opt.value">
              <div class="gas-cmap-option-row">
                <span class="gas-cmap-option-label">{{ opt.label }}</span>
                <span
                  class="gas-cmap-option-gradient"
                  :style="cmapBarStyleForOption(opt)" />
              </div>
            </el-option>
          </el-select>
        </div>
      </div>
    </el-form-item>

    <div
      v-else-if="loadingVariables"
      class="hint-text contour-variable-cmap-status">
      正在加载气体变量...
    </div>
  </div>
</template>

<style scoped>
.pregen-contour-color-config {
  width: 100%;
}

/* 选中标签样式 */
.cmap-select-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.cmap-select-label-bar {
  flex-shrink: 0;
  width: 4rem;
  height: 1rem;
  border-radius: 0.25rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
}

.cmap-select-label-text {
  flex: 1;
  font-size: 0.875rem;
  color: var(--text-primary, rgba(226, 247, 255, 0.95));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 下拉选项样式 - 使用 :deep 穿透 el-select-dropdown */
:deep(.el-select-dropdown__item) {
  padding: 0 12px;
}

:deep(.gas-cmap-option-row) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.35rem 0;
}

:deep(.gas-cmap-option-label) {
  flex-shrink: 0;
  font-size: 0.875rem;
  color: var(--el-text-color-regular, rgba(226, 247, 255, 0.95));
  min-width: 4rem;
}

:deep(.gas-cmap-option-gradient) {
  flex: 1;
  height: 1.25rem;
  border-radius: 0.25rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.15);
  min-width: 60px;
}

/* 气体色带列表 */
.contour-variable-cmaps {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}

.contour-variable-cmap-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.contour-variable-cmap-info {
  flex-shrink: 0;
  min-width: 6rem;
}

.contour-variable-cmap-name {
  font-size: 0.875rem;
  color: var(--text-secondary, rgba(226, 247, 255, 0.8));
}

.contour-variable-cmap-select {
  flex: 1;
}

.contour-variable-cmap-preview {
  flex-shrink: 0;
  width: 3rem;
  height: 1.25rem;
  border-radius: 0.25rem;
}

.hint-text {
  font-size: 0.75rem;
  color: var(--text-hint, rgba(226, 247, 255, 0.5));
}

.contour-variable-cmap-status {
  padding: 0.5rem;
  text-align: center;
}
</style>
