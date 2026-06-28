<script setup>
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, Setting } from '@element-plus/icons-vue'
import postProcessingApi from '@/api/postProcessing.js'
import {
  gasNameMap,
  isGasVariable,
  formatCloudContourOtherVariableLabel,
} from '@/constants/gasVariables.js'
import {
  mergeVolumeColormapOptions,
  findColormapOptionByValue,
  colormapBarStyleFromOption,
} from '@/utils/volumeColormap.js'
import { writeSavedGasColormaps } from '@/utils/gasColormapStorage'
import {
  getCachedTaskVariables,
  setCachedTaskVariables,
} from '@/utils/taskVariablesCache'
import { assignDistinctGasColormaps } from '@/utils/gasColormapDefaults'
import ColorMapManagerDialog from './ColorMapManagerDialog.vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  taskId: {
    type: String,
    default: '',
  },
  /** '2d' | '3d' */
  dimension: {
    type: String,
    default: '3d',
  },
  /** 二维云图时为 'cloud' */
  visualizationType: {
    type: String,
    default: 'volume',
  },
  gasCmaps: {
    type: Object,
    default: () => ({}),
  },
  gasColors: {
    type: Object,
    default: () => ({}),
  },
  /** 与 HomeView 拉取的 GET /api/v1/color-maps/ items 一致 */
  colorMapCatalog: {
    type: Array,
    default: () => [],
  },
  /** 从图层行打开时，只配置该变量；为空则显示全部变量 */
  targetVariableId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits([
  'update:modelValue',
  'update-gas-cmap',
  'update-gas-color',
  'color-maps-updated',
  'refresh-color-maps',
])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const colorMapManagerVisible = ref(false)

const gases = ref([])
const loading = ref(false)

/** 体渲染与二维云图均使用色带下拉；流线图与非云图 2D 不用 */
const isVolumeCmapMode = computed(
  () =>
    props.visualizationType !== 'streamline' &&
    (props.dimension === '3d' ||
      (props.dimension === '2d' && props.visualizationType === 'cloud')),
)

const isCloud2d = computed(
  () => props.dimension === '2d' && props.visualizationType === 'cloud',
)

const isSingleVariableMode = computed(
  () => String(props.targetVariableId || '').trim() !== '',
)

const volumeColormapOptions = computed(() =>
  mergeVolumeColormapOptions(props.colorMapCatalog),
)

const cmapBarStyleForValue = (value) =>
  colormapBarStyleFromOption(
    findColormapOptionByValue(volumeColormapOptions.value, value),
  )

const cmapBarStyleForOption = (opt) => colormapBarStyleFromOption(opt)

const defaultCmapForIndex = (index) => {
  const opts = volumeColormapOptions.value
  return opts.length > 0 ? opts[index % opts.length].value : 'default'
}

function applyDefaultColormapsWhereNeeded() {
  const opts = volumeColormapOptions.value
  if (!opts.length) return

  const nextGasCmaps = assignDistinctGasColormaps(
    gases.value,
    opts,
    props.gasCmaps,
  )
  gases.value.forEach((gas) => {
    const cmap = nextGasCmaps[gas.id]
    if (!cmap) return
    if (gas.cmap !== cmap) {
      gas.cmap = cmap
    }
    if (props.gasCmaps?.[gas.id] !== cmap) {
      emit('update-gas-cmap', { id: gas.id, cmap })
    }
  })
  writeSavedGasColormaps(nextGasCmaps)
}

const getColorForIndex = (index) => {
  const colors = [
    '#a855f7',
    '#f59e0b',
    '#8b5cf6',
    '#6366f1',
    '#14b8a6',
    '#eab308',
    '#3b82f6',
    '#ec4899',
    '#f97316',
    '#f43f5e',
    '#84cc16',
    '#06b6d4',
    '#d946ef',
    '#10b981',
    '#ef4444',
  ]
  return colors[index % colors.length]
}

const fetchGases = async () => {
  if (!props.taskId) {
    gases.value = []
    return
  }
  loading.value = true
  try {
    let allVarIds = getCachedTaskVariables(props.taskId)
    if (!allVarIds) {
      const gasResponse = await postProcessingApi.getTaskVariables(props.taskId)
      allVarIds = setCachedTaskVariables(props.taskId, gasResponse)
    }
    if (!Array.isArray(allVarIds)) {
      gases.value = []
      return
    }
    let i = 0
    const gasRows = allVarIds
      .filter((id) => isGasVariable(id))
      .map((id) => {
        let gasInfo = gasNameMap[id]
        if (!gasInfo) {
          const camelCaseId = id.replace(
            /^mass_fraction_of_/,
            'Mass_fraction_of_',
          )
          gasInfo = gasNameMap[camelCaseId]
        }
        const savedCmap = props.gasCmaps?.[id]
        const savedColor = props.gasColors?.[id]
        const rowIndex = i++
        const defColor = getColorForIndex(rowIndex)
        return {
          id,
          name: gasInfo ? `${gasInfo.zh} (${gasInfo.en})` : id,
          defaultCmapIndex: rowIndex,
          cmap:
            savedCmap != null && savedCmap !== ''
              ? savedCmap
              : defaultCmapForIndex(rowIndex),
          color:
            savedColor && typeof savedColor === 'string'
              ? savedColor
              : defColor,
        }
      })
    let rows = gasRows
    if (isCloud2d.value) {
      const otherRows = allVarIds
        .filter((id) => !isGasVariable(id))
        .map((id, idx) => {
          const savedCmap = props.gasCmaps?.[id]
          const savedColor = props.gasColors?.[id]
          const rowIndex = gasRows.length + idx
          const defColor = getColorForIndex(rowIndex)
          return {
            id,
            name: formatCloudContourOtherVariableLabel(id),
            defaultCmapIndex: rowIndex,
            cmap:
              savedCmap != null && savedCmap !== ''
                ? savedCmap
                : defaultCmapForIndex(rowIndex),
            color:
              savedColor && typeof savedColor === 'string'
                ? savedColor
                : defColor,
          }
        })
      rows = [...gasRows, ...otherRows]
    }
    const targetId = String(props.targetVariableId || '').trim()
    if (targetId) {
      const targetRow = rows.find((row) => String(row.id) === targetId)
      gases.value = targetRow ? [targetRow] : []
      applyDefaultColormapsWhereNeeded()
      return
    }
    gases.value = rows
    applyDefaultColormapsWhereNeeded()
  } catch (e) {
    console.error(e)
    ElMessage.error('获取气体变量列表失败')
    gases.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open && props.taskId) fetchGases()
  },
)

watch(
  () => props.taskId,
  (id) => {
    if (id && props.modelValue) fetchGases()
  },
)

watch(
  () => props.targetVariableId,
  () => {
    if (props.modelValue && props.taskId) fetchGases()
  },
)

watch(
  () => props.gasCmaps,
  (gc) => {
    if (!gc || typeof gc !== 'object') return
    for (const g of gases.value) {
      const c = gc[g.id]
      if (c != null && c !== '') g.cmap = c
    }
  },
  { deep: true },
)

watch(
  () => props.gasColors,
  (gc) => {
    if (!gc || typeof gc !== 'object') return
    for (const g of gases.value) {
      const c = gc[g.id]
      if (c && typeof c === 'string') g.color = c
    }
  },
  { deep: true },
)

watch(
  () => props.colorMapCatalog,
  () => {
    applyDefaultColormapsWhereNeeded()
  },
  { deep: true },
)

const onCmapChange = (gas, scheme) => {
  gas.cmap = scheme
  emit('update-gas-cmap', { id: gas.id, cmap: scheme })
  writeSavedGasColormaps({ [gas.id]: scheme })
}

const onColorInput = (gas, value) => {
  gas.color = value
  emit('update-gas-color', { id: gas.id, color: value })
}

const openColorMapManager = () => {
  colorMapManagerVisible.value = true
}

const handleColorMapsUpdated = () => {
  // 色带更新后，通知父组件刷新色带列表
  emit('color-maps-updated')
}

const handleSaveToLocal = () => {
  const nextGasCmaps = gases.value.reduce((acc, gas) => {
    if (gas?.id && gas?.cmap) {
      acc[gas.id] = gas.cmap
    }
    return acc
  }, {})
  const ok = writeSavedGasColormaps(nextGasCmaps)
  if (ok) {
    ElMessage.success('气体色带已保存到本地')
  } else {
    ElMessage.error('本地保存失败')
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    width="min(30rem, 96vw)"
    append-to-body
    destroy-on-close
    align-center
    class="worker-dialog gas-variable-config-dialog">
    <template #header>
      <div class="gvc-dialog-title">
        <el-icon><Setting /></el-icon>
        <span>{{
          isSingleVariableMode
            ? '单个色带配置'
            : isCloud2d
              ? '云图变量色带配置'
              : '气体变量配置'
        }}</span>
        <el-button
          type="primary"
          size="small"
          @click="openColorMapManager"
          class="gvc-color-map-manager-btn">
          <span>色带管理</span>
        </el-button>
      </div>
    </template>

    <div v-if="!taskId" class="gvc-empty">请先选择一个任务</div>
    <div v-else-if="loading" class="gvc-loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>加载变量列表…</span>
    </div>
    <div v-else-if="gases.length === 0" class="gvc-empty">
      {{
        isSingleVariableMode
          ? '当前图层未匹配到可配置变量'
          : isCloud2d
            ? '暂无可用云图变量'
            : '暂无可用气体变量'
      }}
    </div>
    <div v-else class="gvc-list">
      <p class="gvc-hint">
        {{
          isSingleVariableMode
            ? '仅配置当前图层对应变量的色带。'
            : isVolumeCmapMode
            ? props.dimension === '3d'
              ? '为每种气体单独设置体渲染色带；是否在场景中显示请在左侧面板勾选。'
              : '为每个云图变量（含气体与其它场量）单独设置色带；勾选变量仍在左侧面板操作。'
            : '为每种气体单独设置显示颜色；当前变量选择仍在左侧面板操作。'
        }}
      </p>
      <div v-for="gas in gases" :key="gas.id" class="gvc-row">
        <span class="gvc-name">{{ gas.name }}</span>
        <el-select
          v-if="isVolumeCmapMode"
          :model-value="gas.cmap ?? 'default'"
          class="gvc-cmap-select"
          size="small"
          popper-class="gas-cmap-select-popper"
          @change="(v) => onCmapChange(gas, v)"
          @visible-change="
            (visible) => {
              if (visible) emit('refresh-color-maps')
            }
          ">
          <template #label="{ label, value }">
            <span class="cmap-select-label">
              <span
                class="cmap-select-label-bar"
                :style="cmapBarStyleForValue(value)" />
              <span class="cmap-select-label-text">{{ label }}</span>
            </span>
          </template>
          <el-option
            v-for="opt in volumeColormapOptions"
            :key="opt.value"
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
        <input
          v-else
          :value="gas.color"
          type="color"
          class="gvc-color-input"
          @input="(e) => onColorInput(gas, e.target.value)" />
      </div>
    </div>

    <template #footer>
      <div class="gvc-dialog-footer">
        <el-button @click="handleSaveToLocal">保存</el-button>
        <el-button type="primary" @click="visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 色带管理对话框 -->
  <ColorMapManagerDialog
    v-model="colorMapManagerVisible"
    @color-maps-updated="handleColorMapsUpdated" />
</template>

<style>
.gvc-dialog-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-card-title);
  font-weight: 600;
  color: var(--primary-light, #e8fcff);
}

.gvc-color-map-manager-btn {
  margin-left: auto;
  font-size: var(--text-caption);
  padding: 0.25rem 0.75rem;
}

.gvc-color-map-manager-btn .el-icon {
  margin-right: 0.25rem;
}

.gvc-dialog-title .el-icon {
  color: var(--primary-color, #49d1e0);
  font-size: var(--font-xl);
}

.gvc-hint {
  margin: 0 0 1rem;
  font-size: var(--text-body);
  line-height: var(--leading-normal);
  color: rgba(226, 247, 255, 0.72);
}

.gvc-list {
  max-height: min(72vh, 46rem);
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.35rem;
}

.gvc-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(0, 243, 255, 0.12);
}

.gvc-row:last-child {
  border-bottom: none;
}

.gvc-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 500;
  color: rgba(232, 248, 255, 0.92);
}

.gvc-cmap-select {
  width: 18rem;
  max-width: 100%;
  flex-shrink: 0;
  --gas-cmap-bg: rgba(6, 12, 24, 0.92);
  --gas-cmap-border: rgba(0, 243, 255, 0.22);
  --gas-cmap-text: rgba(226, 247, 255, 0.95);
}

/* 选中项：色带预览条 + 文案（#label 插槽） */
.cmap-select-label {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  min-width: 0;
}

.cmap-select-label-bar {
  flex-shrink: 0;
  width: 5.5rem;
  height: 0.7rem;
  border-radius: 0.1875rem;
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.cmap-select-label-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--gas-cmap-text);
}

.gvc-cmap-select .el-select__placeholder {
  z-index: 0;
}

.gvc-cmap-select .el-select__selection {
  flex: 1;
  min-width: 0;
}

.gvc-cmap-select .el-select__wrapper {
  padding: 0 0.4rem 0 0.55rem !important;
  min-height: 1.875rem !important;
  background: var(--gas-cmap-bg) !important;
  border-radius: 0.375rem !important;
  border: none !important;
  box-shadow:
    0 0 0 1px var(--gas-cmap-border) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 0.0625rem 0.25rem rgba(0, 0, 0, 0.2) !important;
}

.gvc-cmap-select .el-select__wrapper.is-hovering:not(.is-focused),
.gvc-cmap-select .el-select__wrapper:hover:not(.is-focused) {
  box-shadow:
    0 0 0 1px rgba(0, 243, 255, 0.4) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 0.0625rem 0.25rem rgba(0, 0, 0, 0.2) !important;
  background: rgba(10, 20, 38, 0.95) !important;
}

.gvc-cmap-select .el-select__wrapper.is-focused {
  box-shadow:
    0 0 0 1px rgba(0, 243, 255, 0.55) inset,
    0 0 0 1px rgba(0, 243, 255, 0.25),
    0 0 0.75rem rgba(0, 243, 255, 0.12) !important;
  background: rgba(10, 20, 38, 0.98) !important;
}

.gvc-cmap-select .el-select__selected-item,
.gvc-cmap-select .el-select__selected-item span,
.gvc-cmap-select .el-select__placeholder,
.gvc-cmap-select .el-select__placeholder span,
.gvc-cmap-select .el-select__tags-text,
.gvc-cmap-select .el-select__input {
  color: var(--gas-cmap-text) !important;
  font-size: var(--text-caption) !important;
  font-weight: 500 !important;
}

.gvc-cmap-select .el-select__caret {
  color: rgba(0, 243, 255, 0.75) !important;
}

.gas-cmap-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
}

.gas-cmap-option-label {
  flex-shrink: 0;
  font-size: var(--text-caption);
}

.gas-cmap-option-gradient {
  flex: 1;
  min-width: 3.5rem;
  height: 0.875rem;
  border-radius: 0.1875rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.gas-cmap-select-popper.el-popper,
.gas-cmap-select-popper {
  background: rgba(10, 18, 34, 0.98) !important;
  border: 1px solid rgba(0, 243, 255, 0.28) !important;
  backdrop-filter: blur(0.75rem);
  box-shadow:
    0 0.25rem 1rem rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(0, 243, 255, 0.06) inset !important;
}

.gas-cmap-select-popper .el-select-dropdown__list {
  padding: 0.35rem 0;
}

.gas-cmap-select-popper .el-select-dropdown__item {
  color: rgba(230, 245, 255, 0.92) !important;
  background: transparent !important;
  padding: 0.5rem 0.75rem !important;
  min-height: 2.25rem;
}

.gas-cmap-select-popper .el-select-dropdown__item.hover,
.gas-cmap-select-popper .el-select-dropdown__item:hover {
  background: rgba(0, 243, 255, 0.14) !important;
  color: #e8fcff !important;
}

.gas-cmap-select-popper .el-select-dropdown__item.is-selected,
.gas-cmap-select-popper .el-select-dropdown__item.selected,
.gas-cmap-select-popper .el-select-dropdown__item.is-selected.hover,
.gas-cmap-select-popper .el-select-dropdown__item.is-selected:hover {
  color: #7ef3ff !important;
  font-weight: 600 !important;
  background: rgba(0, 243, 255, 0.12) !important;
}

.gas-cmap-select-popper .el-popper__arrow::before {
  background: rgba(10, 18, 34, 0.98) !important;
  border: 1px solid rgba(0, 243, 255, 0.28) !important;
}

.gvc-color-input {
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid rgba(0, 243, 255, 0.35);
  border-radius: 0.375rem;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.gvc-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.gvc-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}

.gvc-loading,
.gvc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem 1rem;
  color: rgba(226, 247, 255, 0.65);
  font-size: var(--text-body);
}

.gas-variable-config-dialog :deep(.el-dialog__footer) {
  padding: 1.5rem;
  border-top: 1px solid rgba(0, 243, 255, 0.12);
  background: rgba(10, 18, 34, 0.78);
}

.gvc-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.875rem;
}

.gas-variable-config-dialog :deep(.gvc-dialog-footer .el-button) {
  min-width: 5rem;
  padding: 0.5rem 1.4rem;
  border-radius: 0.375rem;
  font-weight: 600;
  transition: all 0.3s ease;
}

.gas-variable-config-dialog :deep(.gvc-dialog-footer .el-button:not(.el-button--primary)) {
  background: rgba(10, 18, 34, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: rgba(232, 248, 255, 0.88);
  box-shadow: none;
}

.gas-variable-config-dialog
  :deep(.gvc-dialog-footer .el-button:not(.el-button--primary):hover) {
  background: rgba(14, 24, 44, 0.92);
  border-color: rgba(255, 255, 255, 0.28);
  color: #f4fbff;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.gas-variable-config-dialog :deep(.gvc-dialog-footer .el-button--primary) {
  background: linear-gradient(
    135deg,
    rgba(0, 243, 255, 0.92),
    rgba(112, 92, 255, 0.82)
  );
  border: 1px solid rgba(126, 243, 255, 0.36);
  color: #f7fdff;
  box-shadow: 0 0 14px rgba(0, 243, 255, 0.18);
}

.gas-variable-config-dialog :deep(.gvc-dialog-footer .el-button--primary:hover) {
  background: linear-gradient(
    135deg,
    rgba(36, 246, 255, 1),
    rgba(131, 108, 255, 0.9)
  );
  border-color: rgba(126, 243, 255, 0.5);
  box-shadow: 0 0 18px rgba(0, 243, 255, 0.28);
  transform: translateY(-1px);
}
</style>
