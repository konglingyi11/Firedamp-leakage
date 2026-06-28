<script setup>
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Picture,
  Setting,
  Loading,
} from '@element-plus/icons-vue'
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
import {
  readSavedGasColormaps,
  writeSavedGasColormaps,
} from '@/utils/gasColormapStorage'
import { assignDistinctGasColormaps } from '@/utils/gasColormapDefaults'
import { RADAR_FREQUENCY_OPTIONS, sanitizeRadarFrequencies } from '@/constants/radarFrequencies.js'

const selectedGases = ref([])
const selectedCloudVariable = ref('')
const selectedRadarIds = ref([])

// 从 API 获取的气体列表
const gases = ref([])
/** 云图用：非气体变量行（与 gases 结构一致，含 cmap，便于合并多选） */
const otherVarRows = ref([])
const loadingVariables = ref(false)

const props = defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
  dimension: {
    type: String,
    default: '2d',
  },
  visualizationType: {
    type: String,
    default: 'cloud',
  },
  taskId: {
    type: String,
    default: '',
  },
  currentVariable: {
    type: String,
    default: '',
  },
  /** 2D 云图：多选气体 id 列表（与体渲染 volume_variables 对应） */
  cloudVariables: {
    type: Array,
    default: () => [],
  },
  /** 体渲染：多选气体 id 列表 */
  volumeVariables: {
    type: Array,
    default: () => [],
  },
  /** 体渲染：父级已保存的每变量色带方案，用于回填 */
  gasCmaps: {
    type: Object,
    default: () => ({}),
  },
  /** 接口 GET /api/v1/color-maps/ 返回的 items */
  colorMapCatalog: {
    type: Array,
    default: () => [],
  },
  /** 是否使用预生成数据 */
  usePregen: {
    type: Boolean,
    default: false,
  },
  /** 雷达信号类型 id 列表 */
  radarFrequencies: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits([
  'change',
  'update:radarFrequencies',
  'update-gas-cmap',
  'request-gas-config-dialog',
  'refresh-color-maps',
])

const radarFrequencyOptions = RADAR_FREQUENCY_OPTIONS
const radarListSignature = (ids) => sanitizeRadarFrequencies(ids).sort().join('|')

const volumeColormapOptions = computed(() =>
  mergeVolumeColormapOptions(props.colorMapCatalog),
)

const cmapBarStyleForValue = (value) =>
  colormapBarStyleFromOption(
    findColormapOptionByValue(volumeColormapOptions.value, value),
  )

const cmapBarStyleForOption = (opt) => colormapBarStyleFromOption(opt)

/** 按变量序号轮换接口色带；无列表时返回 null（不用内置名 default 冒充接口项） */
function catalogColormapValueAt(index) {
  const opts = volumeColormapOptions.value
  return opts.length > 0 ? opts[index % opts.length].value : null
}

function getConfigurableRows() {
  return [...gases.value, ...otherVarRows.value]
}

/**
 * 左侧变量列表初始化时自动补齐色带：
 * 1. 本地保存优先；
 * 2. 本地没有的变量按接口色带列表做不重复分配；
 * 3. 同步给父级 gasCmaps，避免必须先打开“气体变量配置”弹窗。
 */
function applySavedOrDefaultColormaps() {
  const rows = getConfigurableRows()
  if (!rows.length) return

  const localGasCmaps = readSavedGasColormaps()
  const opts = volumeColormapOptions.value
  const candidateCmaps = {
    ...(props.gasCmaps || {}),
    ...localGasCmaps,
  }
  const resolvedCmaps =
    opts.length > 0
      ? assignDistinctGasColormaps(rows, opts, candidateCmaps)
      : candidateCmaps

  const nextPersistedCmaps = {}
  rows.forEach((row, index) => {
    const hasResolved =
      resolvedCmaps[row.id] != null && resolvedCmaps[row.id] !== ''
    const resolved = hasResolved
      ? resolvedCmaps[row.id]
      : opts.length > 0
        ? opts[index % opts.length].value
        : null
    if (resolved == null || resolved === '') return

    nextPersistedCmaps[row.id] = resolved
    if (row.cmap !== resolved) {
      row.cmap = resolved
    }
    if (props.gasCmaps?.[row.id] !== resolved) {
      emit('update-gas-cmap', { id: row.id, cmap: resolved })
    }
  })

  if (Object.keys(nextPersistedCmaps).length > 0) {
    writeSavedGasColormaps(nextPersistedCmaps)
  }
}

// 预定义颜色
const predefineColors = [
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
]

// 体渲染 / 云图：色带变更
const handleVolumeCmapChange = (gas, scheme) => {
  gas.cmap = scheme
  emit('update-gas-cmap', { id: gas.id, cmap: scheme })
  writeSavedGasColormaps({ [gas.id]: scheme })
}

// 判断是否为多选模式（三维体渲染 或 二维云图气体）
const isMultiSelect = computed(() => props.dimension === '3d')
const isVolumeRenderMode = computed(
  () => props.dimension === '3d' && props.visualizationType === 'volume',
)
const isCloudGasMulti = computed(
  () => props.dimension === '2d' && props.visualizationType === 'cloud',
)

// 判断是否为矢量图模式
const isVectorMode = computed(
  () => props.dimension === '2d' && props.visualizationType === 'vector',
)
/** 气体卡片右上角：打开「全部气体色带/颜色」弹窗 */
const showGasConfigDialogBtn = computed(
  () => !!props.taskId && !isVectorMode.value,
)
/** 变量选择始终可用；预生成只影响生成参数，不限制手动选择变量 */
const isSelectionDisabled = computed(() => false)

/** 左侧面板标题：二维云图为气体与其它场量分区展示时的总标题 */
const variablePanelTitle = computed(() =>
  isCloudGasMulti.value ? '云图变量' : isMultiSelect.value ? '气体变量' : '气体',
)

/** 勾选列表：三维仅气体；二维云图 = 气体 + 其它云图变量 */
const checkboxVariableItems = computed(() => {
  if (isMultiSelect.value) return gases.value
  if (isCloudGasMulti.value) return [...gases.value, ...otherVarRows.value]
  return []
})

// 获取物理变量列表
const fetchVariables = async () => {
  if (!props.taskId) {
    console.warn('No taskId provided, cannot fetch variables')
    otherVarRows.value = []
    return
  }

  emit('refresh-color-maps')

  loadingVariables.value = true
  try {
    const response = await postProcessingApi.getTaskVariables(props.taskId)

    // 假设 API 返回格式为 { variables: [...] } 或直接是数组
    const variableList = response.data?.variables || response.data || response

    // 转换为组件需要的格式，只保留气体变量
    if (!Array.isArray(variableList)) {
      gases.value = []
      otherVarRows.value = []
    } else {
      const allVarIds = variableList.map((variable) =>
        typeof variable === 'string'
          ? variable
          : variable.id || variable.name || variable.variable,
      )

      let gasIndex = 0
      gases.value = allVarIds
        .filter((variable) => {
          return isGasVariable(variable)
        })
        .map((variable) => {
          // 尝试不同的键格式来查找气体信息
          let gasInfo = gasNameMap[variable]
          if (!gasInfo) {
            // 尝试转换为驼峰命名法
            const camelCaseVariable = variable.replace(
              /^mass_fraction_of_/,
              'Mass_fraction_of_',
            )
            gasInfo = gasNameMap[camelCaseVariable]
          }
          const savedCmap = props.gasCmaps?.[variable]
          const apiDefault = catalogColormapValueAt(gasIndex)
          const defaultCmap =
            savedCmap != null && savedCmap !== ''
              ? savedCmap
              : apiDefault != null
                ? apiDefault
                : 'default'
          return {
            id: variable,
            name: gasInfo ? `${gasInfo.zh} (${gasInfo.en})` : variable,
            zhName: gasInfo?.zh || variable,
            enName: gasInfo?.en || variable,
            color: getColorForIndex(gasIndex++),
            cmap: defaultCmap,
          }
        })

      otherVarRows.value = allVarIds
        .filter(
          (id) =>
            !isGasVariable(id) &&
            String(id).toLowerCase() !== 'mass_fraction_of_air',
        )
        .map((id, idx) => {
          const savedCmap = props.gasCmaps?.[id]
          const apiDefault = catalogColormapValueAt(gases.value.length + idx)
          const defaultCmap =
            savedCmap != null && savedCmap !== ''
              ? savedCmap
              : apiDefault != null
                ? apiDefault
                : 'default'
          return {
            id,
            name: formatCloudContourOtherVariableLabel(id),
            zhName: formatCloudContourOtherVariableLabel(id),
            enName: id,
            color: getColorForIndex(gases.value.length + idx),
            cmap: defaultCmap,
          }
        })
      applySavedOrDefaultColormaps()
    }
  } catch (error) {
    console.error('获取变量列表失败:', error)
    ElMessage.error('获取变量列表失败')
  } finally {
    loadingVariables.value = false
  }
}

// 为变量分配颜色
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

// 监听 taskId 变化
watch(
  () => props.taskId,
  (newTaskId) => {
    if (newTaskId) {
      fetchVariables()
    }
  },
  { immediate: true },
)

// 父级 gasCmaps 更新时同步到列表（不重新拉变量）
watch(
  () => props.gasCmaps,
  (gc) => {
    if (!gc || typeof gc !== 'object') return
    for (const g of gases.value) {
      const c = gc[g.id]
      if (c != null && c !== '') g.cmap = c
    }
    for (const row of otherVarRows.value) {
      const c = gc[row.id]
      if (c != null && c !== '') row.cmap = c
    }
  },
  { deep: true },
)

// 接口色带目录异步到达后：自动读取本地色带；本地没有则按接口色带分配
watch(
  () => props.colorMapCatalog,
  () => {
    applySavedOrDefaultColormaps()
  },
  { deep: true },
)

watch(
  () => props.radarFrequencies,
  (next) => {
    if (radarListSignature(next) === radarListSignature(selectedRadarIds.value)) {
      return
    }
    selectedRadarIds.value = sanitizeRadarFrequencies(next)
  },
  { immediate: true },
)

watch(
  selectedRadarIds,
  (next) => {
    const normalized = sanitizeRadarFrequencies(next)
    if (radarListSignature(normalized) === radarListSignature(props.radarFrequencies)) {
      return
    }
    emit('update:radarFrequencies', normalized)
  },
  { deep: true },
)

// 非云图多选、非三维时的单选回退（保留与父级 variable 同步）
watch(selectedCloudVariable, (newValue) => {
  if (!newValue || isMultiSelect.value || isCloudGasMulti.value) return
  const gas = gases.value.find((g) => g.id === newValue)
  emit('change', { id: newValue, color: gas?.color || '#ffffff' })
})

// 体渲染 / 云图气体多选
watch(
  selectedGases,
  (newValue) => {
    if (!isMultiSelect.value && !isCloudGasMulti.value) return
    const ids = Array.isArray(newValue) ? [...newValue] : []

    if (ids.length === 0) {
      emit('change', { ids: [], id: '', colors: [] })
      return
    }
    if (isCloudGasMulti.value) {
      selectedCloudVariable.value = ''
    }
    const colors = ids.map((gid) => {
      const gas = gases.value.find((g) => g.id === gid)
      const other = otherVarRows.value.find((r) => r.id === gid)
      const row = gas || other
      return {
        id: gid,
        color: row?.color || '#ffffff',
        cmap: row?.cmap ?? 'default',
      }
    })
    emit('change', { ids, id: ids[0], colors })
  },
  { deep: true },
)

// 监听维度变化，清空选择；离开 3D 时通知父组件清空 volume_variables
watch(
  () => props.dimension,
  (dim, prevDim) => {
    selectedCloudVariable.value = ''
    selectedGases.value = []
    if (prevDim === '3d' && dim !== '3d') {
      emit('change', { ids: [], id: '', colors: [] })
    }
  },
)

function syncSelectionFromParent() {
  const id =
    typeof props.currentVariable === 'string' ? props.currentVariable : ''
  const cv = Array.isArray(props.cloudVariables)
    ? props.cloudVariables.map(String)
    : []
  const vv = Array.isArray(props.volumeVariables)
    ? props.volumeVariables.map(String)
    : []

  if (isMultiSelect.value) {
    // 3D 体渲染模式：与父级 volume_variables 一致；为空时不保留旧的勾选状态。
    if (vv.length > 0) {
      selectedGases.value.splice(0, selectedGases.value.length, ...vv)
    } else {
      selectedGases.value.splice(0, selectedGases.value.length)
    }
    return
  }

  if (isCloudGasMulti.value) {
    const validIds = new Set([
      ...gases.value.map((g) => g.id),
      ...otherVarRows.value.map((r) => r.id),
    ])
    const fromParent = cv.filter((x) => validIds.has(String(x)))
    if (fromParent.length > 0) {
      selectedGases.value.splice(0, selectedGases.value.length, ...fromParent)
      selectedCloudVariable.value = ''
      return
    }
    selectedCloudVariable.value = ''
    selectedGases.value.splice(0, selectedGases.value.length)
    return
  }

  if (!id) return
  selectedCloudVariable.value = id
  selectedGases.value = []
}

watch(
  () => [
    props.currentVariable,
    props.cloudVariables,
    props.volumeVariables,
    gases.value.length,
    otherVarRows.value.length,
  ],
  () => {
    syncSelectionFromParent()
  },
  { immediate: true, deep: true },
)

const selectAll = () => {
  if (isMultiSelect.value) {
    selectedGases.value = gases.value.map((g) => g.id)
    ElMessage.success('已选择所有气体')
  } else if (isCloudGasMulti.value) {
    selectedGases.value = checkboxVariableItems.value.map((item) => item.id)
    ElMessage.success('已选择全部云图变量')
  }
}

const clearSelection = () => {
  selectedCloudVariable.value = ''
  selectedGases.value = []
  ElMessage.info('已清除选择')
}
</script>

<template>
  <div class="visualization-settings">
    <!-- 气体 / 云图变量 -->
    <div class="settings-card">
      <div class="settings-header">
        <div class="header-title">
          <el-icon style="margin-right: 0.5rem"><Setting /></el-icon>
          <h3>气体</h3>
        </div>
        <div class="header-actions">
          <!-- <el-button
            v-if="isMultiSelect"
            size="small"
            :icon="Select"
            @click="selectAll"
            >全选</el-button
          >
          <el-button size="small" :icon="Delete" @click="clearSelection"
            >清空</el-button
          > -->
          <el-button
            v-if="showGasConfigDialogBtn"
            class="gas-config-dialog-btn"
            size="small"
            :icon="Setting"
            circle
            :title="
              isCloudGasMulti
                ? '全部云图变量色带/颜色配置'
                : '全部气体色带/颜色配置'
            "
            @click="emit('request-gas-config-dialog')" />
        </div>
      </div>

      <el-divider />

      <div v-if="loadingVariables" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载变量列表中...</span>
      </div>

      <div v-else-if="isVectorMode" class="empty-container">
        <el-icon style="font-size: var(--font-xl); margin-bottom: 0.5rem"
          ><Picture
        /></el-icon>
        <span>矢量图模式默认显示速度场</span>
        <span style="font-size: var(--text-caption); opacity: 0.7"
          >无需选择气体变量</span
        >
      </div>

      <div v-else-if="!taskId" class="empty-container">
        <span>请先选择一个任务</span>
      </div>

      <div
        v-else-if="
          (isMultiSelect || isCloudGasMulti) &&
          checkboxVariableItems.length === 0
        "
        class="empty-container">
        <span>{{
          isCloudGasMulti ? '暂无可用云图变量' : '暂无可用气体变量'
        }}</span>
      </div>

      <div v-else class="gas-list">
        <!-- 二维云图：气体与其它场量分栏 -->
        <template v-if="isCloudGasMulti">
          <div v-if="gases.length > 0" class="variable-subsection">
            <el-checkbox-group
              v-model="selectedGases"
              :disabled="isSelectionDisabled"
              class="gas-checkbox-group gas-checkbox-group--volume">
              <el-checkbox
                v-for="item in gases"
                :key="item.id"
                :label="item.id"
                :disabled="isSelectionDisabled"
                class="gas-checkbox gas-checkbox--volume">
                <div class="gas-label gas-label--volume">
                  <div class="gas-cmap-wrap" @mousedown.stop @click.stop>
                    <el-select
                      :model-value="item.cmap ?? 'default'"
                      :disabled="isSelectionDisabled"
                      class="gas-cmap-select"
                      size="small"
                      popper-class="gas-cmap-select-popper"
                      @change="(v) => handleVolumeCmapChange(item, v)"
                      @click.stop
                      @mousedown.stop
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
                          <span class="cmap-select-label-text">{{
                            label
                          }}</span>
                        </span>
                      </template>
                      <el-option
                        v-for="opt in volumeColormapOptions"
                        :key="opt.value"
                        :label="opt.label"
                        :value="opt.value">
                        <div class="gas-cmap-option-row">
                          <span class="gas-cmap-option-label">{{
                            opt.label
                          }}</span>
                          <span
                            class="gas-cmap-option-gradient"
                            :style="cmapBarStyleForOption(opt)" />
                        </div>
                      </el-option>
                    </el-select>
                  </div>
                  <span class="gas-name">{{ item.name }}</span>
                </div>
              </el-checkbox>
            </el-checkbox-group>
          </div>

          <div
            v-if="otherVarRows.length > 0"
            class="variable-subsection variable-subsection--spaced">
            <h4 class="variable-subsection-title">其它场量</h4>
            <el-checkbox-group
              v-model="selectedGases"
              :disabled="isSelectionDisabled"
              class="gas-checkbox-group gas-checkbox-group--volume">
              <el-checkbox
                v-for="item in otherVarRows"
                :key="item.id"
                :label="item.id"
                :disabled="isSelectionDisabled"
                class="gas-checkbox gas-checkbox--volume">
                <div class="gas-label gas-label--volume">
                  <div class="gas-cmap-wrap" @mousedown.stop @click.stop>
                    <el-select
                      :model-value="item.cmap ?? 'default'"
                      :disabled="isSelectionDisabled"
                      class="gas-cmap-select"
                      size="small"
                      popper-class="gas-cmap-select-popper"
                      @change="(v) => handleVolumeCmapChange(item, v)"
                      @click.stop
                      @mousedown.stop
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
                          <span class="cmap-select-label-text">{{
                            label
                          }}</span>
                        </span>
                      </template>
                      <el-option
                        v-for="opt in volumeColormapOptions"
                        :key="opt.value"
                        :label="opt.label"
                        :value="opt.value">
                        <div class="gas-cmap-option-row">
                          <span class="gas-cmap-option-label">{{
                            opt.label
                          }}</span>
                          <span
                            class="gas-cmap-option-gradient"
                            :style="cmapBarStyleForOption(opt)" />
                        </div>
                      </el-option>
                    </el-select>
                  </div>
                  <span class="gas-name">{{ item.name }}</span>
                </div>
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </template>

        <!-- 三维体渲染等：仅气体列表 -->
        <el-checkbox-group
          v-else-if="isMultiSelect"
          v-model="selectedGases"
          :disabled="isSelectionDisabled"
          class="gas-checkbox-group gas-checkbox-group--volume">
          <el-checkbox
            v-for="item in checkboxVariableItems"
            :key="item.id"
            :label="item.id"
            :disabled="isSelectionDisabled"
            class="gas-checkbox gas-checkbox--volume">
            <div class="gas-label gas-label--volume">
              <div class="gas-cmap-wrap" @mousedown.stop @click.stop>
                <el-select
                  :model-value="item.cmap ?? 'default'"
                  :disabled="isSelectionDisabled"
                  class="gas-cmap-select"
                  size="small"
                  popper-class="gas-cmap-select-popper"
                  @change="(v) => handleVolumeCmapChange(item, v)"
                  @click.stop
                  @mousedown.stop
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
              </div>
              <span class="gas-name">{{ item.name }}</span>
            </div>
          </el-checkbox>
        </el-checkbox-group>
      </div>
    </div>

    <div v-if="taskId" class="settings-card">
      <div class="settings-header">
        <div class="header-title">
          <el-icon style="margin-right: 0.5rem"><Picture /></el-icon>
          <h3>雷达类型</h3>
        </div>
      </div>

      <el-divider />

      <div class="variable-subsection variable-subsection--radar">
        <el-checkbox-group
          v-model="selectedRadarIds"
          class="radar-frequency-list">
          <el-checkbox
            v-for="opt in radarFrequencyOptions"
            :key="opt.id"
            :label="opt.id"
            class="radar-checkbox-item">
            <span class="radar-name">{{ opt.label }}</span>
          </el-checkbox>
        </el-checkbox-group>
      </div>
    </div>
  </div>
</template>

<style
  scoped
  src="@/assets/styles/components/VisualizationSettings.css"></style>
