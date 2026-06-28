<script setup>
import { ref, onMounted, watch, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Delete, DataAnalysis } from '@element-plus/icons-vue'
import { useDataStatistics } from '@/composables/useDataStatistics'
import { useStatisticsCharts } from '@/composables/useStatisticsCharts'
import { getVariableDisplayName, COLOR_PALETTE } from '@/utils/gas'

const props = defineProps({
  currentTask: { type: Object, default: null },
  monitoringPoints: { type: Array, default: () => [] },
})
const emit = defineEmits([
  'add-point',
  'update-point',
  'preview-point',
  'delete-point',
  'focus-point',
  'sync-points',
])

const windSpeedChartRef = ref(null)
const temperatureChartRef = ref(null)
const humidityChartRef = ref(null)
const pressureChartRef = ref(null)
const gasMassFractionChartRef = ref(null)
const dialogChartRef = ref(null)
const overviewGasTrendChartRef = ref(null)
const overviewWindSpeedChartRef = ref(null)
const overviewTemperatureChartRef = ref(null)
const overviewHumidityChartRef = ref(null)
const overviewPressureChartRef = ref(null)
const overviewGasSnapshotChartRef = ref(null)
const overviewPointGasTotalChartRef = ref(null)
const overviewGasHeatmapChartRef = ref(null)
const overviewPointSpatialChartRef = ref(null)
const overviewEnvRadarChartRef = ref(null)
const overviewWaveAttenuationChartRef = ref(null)
const overviewWaveIntensityChartRef = ref(null)

const state = useDataStatistics({ props, emit })
const {
  usePregenForProbe,
  loading,
  isGlobalLoading,
  monitoringPoints,
  selectedPointId,
  dialogSelectedPointIds,
  syncedPointIds,
  shouldFetchOnSelection,
  suppressNextFocusEmit,
  waveOverviewRevealAllowed,
  monitoringPoint,
  draftMonitoringPoint,
  geometryBounds,
  selectedGasesForChart,
  availableGases,
  gasListExpanded,
  visibleGasIds,
  maxVisibleGasCount,
  gasMassFractionData,
  envDataHistory,
  realTimeData,
  startTime,
  endTime,
  envSnapshotTime,
  timeOptions,
  physicalTimes,
  pointIdsForFetch,
  fetchVariables,
  fetchTimeSteps,
  fetchProbeAllData,
  fetchGeometryBounds,
  applyMainPanelProbeSnapshot,
  updateDraftMonitoringPointCoordinate,
  commitDraftMonitoringPoint,
  updateMonitoringPointFromExternal,
  syncMonitoringPointsFromParent,
} = state

const {
  charts,
  initCharts,
  initDialogChart: renderDialogChart,
  updateDialogChart: refreshDialogChart,
  initOverviewCharts,
  updateOverviewCharts,
  setOverviewChartsLoading,
  disposeOverviewCharts,
  updateEnvCharts,
  updateGasMassFractionChart,
} = useStatisticsCharts(
  {
    windSpeedChartRef,
    temperatureChartRef,
    humidityChartRef,
    pressureChartRef,
    gasMassFractionChartRef,
    dialogChartRef,
    overviewGasTrendChartRef,
    overviewWindSpeedChartRef,
    overviewTemperatureChartRef,
    overviewHumidityChartRef,
    overviewPressureChartRef,
    overviewGasSnapshotChartRef,
    overviewPointGasTotalChartRef,
    overviewGasHeatmapChartRef,
    overviewPointSpatialChartRef,
    overviewEnvRadarChartRef,
    overviewWaveAttenuationChartRef,
    overviewWaveIntensityChartRef,
  },
  state,
)

const dialogVisible = ref(false)
const overviewDialogVisible = ref(false)

const WAVE_OVERVIEW_REVEAL_MS = 1000
let waveOverviewRevealTimerId = null
const overviewSelectedPointIds = ref([])
const overviewSelectedGasIds = ref([])
const currentChartType = ref('')
const currentGasColor = ref('#409EFF')
const colorPalette = COLOR_PALETTE

const overviewPointOptions = computed(() => {
  const fetchedPointIds = new Set(pointIdsForFetch.value)
  const fetchedPoints = monitoringPoints.value.filter((point) =>
    fetchedPointIds.has(point.id),
  )
  return fetchedPoints.length ? fetchedPoints : monitoringPoints.value
})

const getGasName = (id) =>
  availableGases.value.find((g) => g.id === id)?.name || id

const hasPendingMonitoringPointDraft = () => {
  const draft = draftMonitoringPoint.value
  if (!draft?.id) return false
  const current = monitoringPoints.value.find(
    (point) => String(point.id) === String(draft.id),
  )
  if (!current) return false
  if (!syncedPointIds.value.has(draft.id)) return true
  return ['x', 'y', 'z'].some(
    (axis) => Number(current[axis]) !== Number(draft[axis]),
  )
}

const commitCurrentMonitoringPointDraft = () => {
  if (!hasPendingMonitoringPointDraft()) return null
  const committedPoint = commitDraftMonitoringPoint()
  if (!committedPoint) return null
  emit('update-point', committedPoint)
  syncedPointIds.value.add(committedPoint.id)
  emit('sync-points')
  return committedPoint
}

const handleAddPoint = () => {
  commitCurrentMonitoringPointDraft()
  state.handleAddPoint()
  emit('add-point', state.monitoringPoint.value)
}

const handleDeletePoint = () => {
  state.handleDeletePoint()
  emit('sync-points')
}

const applyMonitoringPoint = async () => {
  const committed = commitCurrentMonitoringPointDraft()
  if (committed) {
    ElMessage.success({
      message: '监测点已应用。可点击「全屏图表」打开数据统计总览。',
      duration: 5000,
    })
  }
}

const handleGasColorChange = (gas, val) => {
  gas.color = val
}

const handleMainPointChange = (val) => {
  if (!val || suppressNextFocusEmit.value) return
  const p =
    (draftMonitoringPoint.value && draftMonitoringPoint.value.id === val
      ? draftMonitoringPoint.value
      : null) || monitoringPoints.value.find((point) => point.id === val)
  if (p) emit('focus-point', { ...p })
}

const handleCoordinateInput = (axis, value) => {
  const draft = updateDraftMonitoringPointCoordinate(axis, value)
  if (draft) {
    emit('preview-point', draft)
    emit('focus-point', draft)
  }
}

const initDialogChart = () => {
  // 弹窗打开后初始化放大图表
  nextTick(() => {
    if (dialogChartRef.value) {
      renderDialogChart(currentChartType.value, dialogSelectedPointIds.value)
    }
  })
}

const handleDialogPointChange = () => {
  // 弹窗中切换监测点后刷新图表
  nextTick(() => {
    if (dialogChartRef.value) {
      refreshDialogChart(currentChartType.value, dialogSelectedPointIds.value)
    }
  })
}

const handleDialogOpen = () => {
  if (!dialogSelectedPointIds.value.length) {
    if (selectedPointId.value)
      dialogSelectedPointIds.value = [selectedPointId.value]
    else if (syncedPointIds.value.size)
      dialogSelectedPointIds.value = [...syncedPointIds.value]
  }
  initDialogChart()
}
const handleDialogClose = () => {
  dialogVisible.value = false
}

const getDefaultOverviewPointIds = () => {
  const optionIds = overviewPointOptions.value.map((point) => point.id)
  if (optionIds.length) return optionIds
  return selectedPointId.value ? [selectedPointId.value] : []
}

const syncOverviewDefaults = () => {
  const availablePointIds = new Set(
    overviewPointOptions.value.map((point) => String(point.id)),
  )
  const availableGasIds = new Set(availableGases.value.map((gas) => gas.id))
  overviewSelectedPointIds.value = overviewSelectedPointIds.value.filter((id) =>
    availablePointIds.has(String(id)),
  )
  overviewSelectedGasIds.value = overviewSelectedGasIds.value.filter((id) =>
    availableGasIds.has(id),
  )
  if (!overviewSelectedPointIds.value.length) {
    overviewSelectedPointIds.value = getDefaultOverviewPointIds()
  }
  if (!overviewSelectedGasIds.value.length) {
    overviewSelectedGasIds.value = [...selectedGasesForChart.value]
  }
}

const refreshOverviewIfOpen = () => {
  if (!overviewDialogVisible.value) return
  nextTick(() =>
    updateOverviewCharts(
      overviewSelectedPointIds.value,
      overviewSelectedGasIds.value,
    ),
  )
}

const ensureOverviewProbeData = async () => {
  syncOverviewDefaults()
  overviewSelectedPointIds.value.forEach((id) => {
    syncedPointIds.value.add(id)
  })
  await fetchProbeAllData({
    pointIds: overviewSelectedPointIds.value,
    gasIds: overviewSelectedGasIds.value,
  })
  updateEnvCharts()
}

const openOverviewDialog = () => {
  syncOverviewDefaults()
  overviewDialogVisible.value = true
}

const handleOverviewDialogOpen = async () => {
  waveOverviewRevealAllowed.value = false
  if (waveOverviewRevealTimerId != null) {
    clearTimeout(waveOverviewRevealTimerId)
    waveOverviewRevealTimerId = null
  }
  syncOverviewDefaults()
  initOverviewCharts(
    overviewSelectedPointIds.value,
    overviewSelectedGasIds.value,
  )
  setOverviewChartsLoading(true)
  waveOverviewRevealTimerId = window.setTimeout(() => {
    waveOverviewRevealTimerId = null
    waveOverviewRevealAllowed.value = true
    updateOverviewCharts(
      overviewSelectedPointIds.value,
      overviewSelectedGasIds.value,
    )
  }, WAVE_OVERVIEW_REVEAL_MS)

  try {
    await ensureOverviewProbeData()
  } catch (error) {
    console.error('获取监测点数据失败:', error)
    ElMessage.error('获取监测点数据失败')
  } finally {
    setOverviewChartsLoading(false)
    updateOverviewCharts(
      overviewSelectedPointIds.value,
      overviewSelectedGasIds.value,
    )
  }
}

const handleOverviewFilterChange = async () => {
  waveOverviewRevealAllowed.value = true
  setOverviewChartsLoading(true)
  try {
    await ensureOverviewProbeData()
  } catch (error) {
    console.error('刷新监测点数据失败:', error)
  } finally {
    setOverviewChartsLoading(false)
  }
  refreshOverviewIfOpen()
}

const handleOverviewDialogClose = () => {
  if (waveOverviewRevealTimerId != null) {
    clearTimeout(waveOverviewRevealTimerId)
    waveOverviewRevealTimerId = null
  }
  waveOverviewRevealAllowed.value = true
  disposeOverviewCharts()
  overviewDialogVisible.value = false
}

onMounted(async () => {
  initCharts({
    onChartClick: (e, type) => {
      currentChartType.value = type
      dialogVisible.value = true
    },
  })
})

watch(
  () => props.currentTask,
  async (newTask) => {
    if (!newTask) return
    if (
      String(newTask.status || '')
        .trim()
        .toLowerCase() !== 'completed'
    )
      return
    await fetchVariables()
    await fetchTimeSteps()
    await fetchGeometryBounds()
    updateEnvCharts()
    refreshOverviewIfOpen()
  },
  { immediate: true },
)

watch([startTime, endTime], () => {
  updateEnvCharts()
  refreshOverviewIfOpen()
})
watch([envSnapshotTime, selectedPointId], () => {
  applyMainPanelProbeSnapshot()
  refreshOverviewIfOpen()
})
watch(
  () => props.monitoringPoints,
  (points) => {
    syncMonitoringPointsFromParent(points)
  },
  { immediate: true, deep: true },
)

watch(
  selectedGasesForChart,
  () => {
    nextTick(() => {
      updateGasMassFractionChart()
      refreshOverviewIfOpen()
    })
  },
  { deep: true },
)

defineExpose({
  selectMonitoringPointById: (id) => {
    const p = monitoringPoints.value.find((p) => p.id === id)
    if (p) {
      suppressNextFocusEmit.value = true
      selectedPointId.value = p.id
      nextTick(() => (suppressNextFocusEmit.value = false))
    }
  },
  updateMonitoringPointFromExternal: async (point) => {
    updateMonitoringPointFromExternal(point)
  },
  syncMonitoringPointsFromParent: (points) => {
    syncMonitoringPointsFromParent(points)
  },
  getMonitoringPoints: () =>
    monitoringPoints.value.map((point) => ({ ...point })),
})
</script>

<template>
  <div class="data-statistics">
    <!-- 监测点坐标 -->
    <div class="monitoring-point ds-stat-panel stats-guide-monitoring-point">
      <div class="selector-header">
        <span class="selector-label">数据源</span>
        <div class="point-actions">
          <el-button
            circle
            size="small"
            :icon="Plus"
            class="action-btn add-btn"
            @click="handleAddPoint"
            :disabled="isGlobalLoading"></el-button>
          <el-button
            circle
            size="small"
            :icon="Delete"
            class="action-btn delete-btn"
            @click="handleDeletePoint"
            :disabled="
              monitoringPoints.length === 0 ||
              !selectedPointId ||
              isGlobalLoading
            "></el-button>
        </div>
      </div>

      <div class="selector-content">
        <div class="point-selector-row">
          <span class="row-label">监测点:</span>
          <el-select
            v-model="selectedPointId"
            placeholder="选择监测点"
            size="default"
            class="monitoring-select"
            popper-class="monitoring-select-dropdown"
            :disabled="monitoringPoints.length === 0 || isGlobalLoading"
            @change="handleMainPointChange">
            <el-option
              v-for="point in monitoringPoints"
              :key="point.id"
              :label="point.name"
              :value="point.id" />
          </el-select>
        </div>

        <!-- 只在有选中点时显示坐标输入框 -->
        <div v-if="selectedPointId" class="point-coordinates">
          <div class="coordinate-item">
            <span class="coordinate-label">X</span>
            <el-input-number
              :model-value="draftMonitoringPoint?.x"
              @update:model-value="(v) => handleCoordinateInput('x', v)"
              :min="geometryBounds.xmin"
              :max="geometryBounds.xmax"
              :precision="1"
              :step="0.1"
              size="default"
              class="coordinate-input"
              :controls="false"
              :disabled="isGlobalLoading" />
          </div>
          <div class="coordinate-item">
            <span class="coordinate-label">Y</span>
            <el-input-number
              :model-value="draftMonitoringPoint?.y"
              @update:model-value="(v) => handleCoordinateInput('y', v)"
              :min="geometryBounds.ymin"
              :max="geometryBounds.ymax"
              :precision="1"
              :step="0.1"
              size="default"
              class="coordinate-input"
              :controls="false"
              :disabled="isGlobalLoading" />
          </div>
          <div class="coordinate-item">
            <span class="coordinate-label">Z</span>
            <el-input-number
              :model-value="draftMonitoringPoint?.z"
              @update:model-value="(v) => handleCoordinateInput('z', v)"
              :min="geometryBounds.zmin"
              :max="geometryBounds.zmax"
              :precision="1"
              :step="0.1"
              size="default"
              class="coordinate-input"
              :controls="false"
              :disabled="isGlobalLoading" />
          </div>
          <div class="point-pregen-toggle">
            <span class="selector-label">使用预生成数据</span>
            <el-switch
              v-model="usePregenForProbe"
              size="small"
              active-text="是"
              inactive-text="否" />
          </div>
          <el-button
            type="primary"
            size="default"
            class="apply-btn"
            @click="applyMonitoringPoint"
            :disabled="isGlobalLoading">
            应用
          </el-button>
        </div>

        <div
          v-else
          class="no-points-tip"
          style="
            text-align: center;
            color: var(--text-tertiary);
            padding: 1.25rem 0;
            font-size: var(--text-caption);
          ">
          暂无监测点，请点击上方 + 号添加
        </div>
      </div>
    </div>

    <!-- 气体选择器 -->
    <div class="gas-selector ds-stat-panel stats-guide-gas-selector">
      <div class="selector-header">
        <span class="selector-label">选择气体</span>
      </div>
      <div class="selector-content">
        <div class="gas-select-row">
          <el-select
            v-model="selectedGasesForChart"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="请选择气体"
            size="default"
            :max-collapse-tags="3"
            class="gas-select"
            popper-class="gas-select-dropdown"
            :disabled="isGlobalLoading">
            <el-option
              v-for="gas in availableGases"
              :key="gas.id"
              :label="gas.name"
              :value="gas.id">
              <div class="gas-option">
                <el-color-picker
                  v-model="gas.color"
                  size="small"
                  :predefine="colorPalette"
                  @change="(val) => handleGasColorChange(gas, val)"
                  @click.stop />
                <span>{{ gas.name }}</span>
              </div>
            </el-option>
          </el-select>
          <el-color-picker
            v-model="currentGasColor"
            size="default"
            :predefine="colorPalette" />
        </div>
      </div>
    </div>

    <!-- 实时环境数据 -->
    <div class="realtime-data stats-guide-realtime-data">
      <div class="data-section ds-stat-panel">
        <div class="section-header">
          <span class="selector-label">环境参数</span>
        </div>
        <div class="section-content">
          <div
            v-if="timeOptions.length > 0 && currentTask?.id"
            class="env-params-time-block">
            <div class="env-params-time-row">
              <span class="row-label">查看时刻</span>
              <el-select
                v-model="envSnapshotTime"
                placeholder="选择物理时间"
                size="default"
                class="monitoring-select env-params-time-select"
                popper-class="time-select-dropdown"
                :disabled="isGlobalLoading">
                <el-option
                  v-for="item in timeOptions"
                  :key="String(item.value) + '-env-snap'"
                  :label="item.label"
                  :value="item.value" />
              </el-select>
            </div>
          </div>
          <div class="data-grid">
            <div class="data-item">
              <span class="data-label">温度</span>
              <span class="data-value">{{ realTimeData.temperature }}°C</span>
            </div>
            <div class="data-item">
              <span class="data-label">湿度</span>
              <span class="data-value">{{ realTimeData.humidity }}%</span>
            </div>
            <div class="data-item">
              <span class="data-label">气压</span>
              <span class="data-value">{{ realTimeData.pressure }}kPa</span>
            </div>
            <div class="data-item">
              <span class="data-label">风速</span>
              <span class="data-value">{{ realTimeData.windSpeed }}m/s</span>
            </div>
            <div class="data-item data-item--row-full">
              <span class="data-label">电磁波衰减率</span>
              <span class="data-value">{{ realTimeData.waveAttenuationRate }}</span>
            </div>
            <div class="data-item data-item--row-full">
              <span class="data-label">电磁波强度</span>
              <span class="data-value">{{ realTimeData.waveIntensity }}</span>
            </div>
            <div
              v-for="gasId in visibleGasIds"
              :key="gasId"
              class="data-item"
              style="grid-column: span 2">
              <span class="data-label">{{ getGasName(gasId) }}</span>
              <span class="data-value">{{
                typeof realTimeData.gasConcentrations[gasId] === 'number'
                  ? realTimeData.gasConcentrations[gasId].toExponential(4)
                  : realTimeData.gasConcentrations[gasId]
              }}</span>
            </div>
            <div
              v-if="selectedGasesForChart.length > maxVisibleGasCount"
              class="gas-expand-row">
              <el-button
                type="primary"
                text
                size="small"
                @click="gasListExpanded = !gasListExpanded">
                {{ gasListExpanded ? '收起气体数据' : '展开更多气体' }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 图表上方：时间区间（横轴范围） -->
    <!-- <div
      v-if="timeOptions.length > 0 && currentTask?.id"
      class="stats-time-toolbar chart-range-toolbar ds-stat-panel stats-guide-time-range">
      <div class="selector-header">
        <span class="selector-label">曲线时间区间</span>
      </div>
      <div class="selector-content stats-chart-range-row">
        <el-select
          v-model="startTime"
          placeholder="开始时间"
          size="default"
          class="monitoring-select"
          popper-class="time-select-dropdown"
          :disabled="isGlobalLoading">
          <el-option
            v-for="item in timeOptions"
            :key="String(item.value) + '-chart-start'"
            :label="item.label"
            :value="item.value" />
        </el-select>
        <span class="stats-time-sep">—</span>
        <el-select
          v-model="endTime"
          placeholder="结束时间"
          size="default"
          class="monitoring-select"
          popper-class="time-select-dropdown"
          :disabled="isGlobalLoading">
          <el-option
            v-for="item in timeOptions"
            :key="String(item.value) + '-chart-end'"
            :label="item.label"
            :value="item.value" />
        </el-select>
      </div>
    </div> -->

    <div class="stats-overview-toolbar ds-stat-panel">
      <div class="selector-header stats-overview-toolbar-header">
        <span class="selector-label">统计图表</span>
        <el-button
          type="primary"
          size="small"
          :icon="DataAnalysis"
          class="overview-chart-btn stats-guide-overview-charts"
          :disabled="!currentTask?.id || isGlobalLoading"
          @click="openOverviewDialog">
          全屏图表
        </el-button>
      </div>
    </div>

    <!-- 图表详情弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="
        currentChartType === 'gasMassFraction'
          ? '气体质量分数变化详情'
          : currentChartType === 'windSpeed'
            ? '风速变化详情'
            : currentChartType === 'temperature'
              ? '温度变化详情'
              : currentChartType === 'humidity'
                ? '湿度变化详情'
                : currentChartType === 'pressure'
                  ? '气压变化详情'
                  : ''
      "
      width="80%"
      top="5vh"
      append-to-body
      :lock-scroll="true"
      :z-index="9999"
      @opened="handleDialogOpen"
      @close="handleDialogClose"
      class="chart-dialog">
      <!-- 气体选择器（仅在气体质量分数图表时显示） -->
      <div
        v-if="currentChartType === 'gasMassFraction'"
        class="dialog-gas-selector">
        <span class="selector-label">选择气体:</span>
        <el-select
          v-model="selectedGasesForChart"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :teleported="false"
          placeholder="选择气体（可多选）"
          size="small"
          class="gas-select-dialog"
          popper-class="gas-select-dropdown"
          @change="initDialogChart">
          <el-option
            v-for="gas in availableGases"
            :key="gas.id"
            :label="gas.name"
            :value="gas.id">
            <div class="gas-option">
              <el-color-picker
                v-model="gas.color"
                size="small"
                :predefine="colorPalette"
                @change="(val) => handleGasColorChange(gas, val)"
                @click.stop />
              <span>{{ gas.name }}</span>
            </div>
          </el-option>
        </el-select>
      </div>

      <!-- 时间选择器 -->
      <div class="dialog-gas-selector dialog-point-selector">
        <span class="selector-label">选择监测点:</span>
        <el-select
          v-model="dialogSelectedPointIds"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :teleported="false"
          placeholder="选择监测点（可多选）"
          size="small"
          class="gas-select-dialog"
          popper-class="monitoring-select-dropdown"
          :disabled="monitoringPoints.length === 0 || isGlobalLoading"
          @change="handleDialogPointChange">
          <el-option
            v-for="point in monitoringPoints"
            :key="point.id"
            :label="point.name"
            :value="point.id" />
        </el-select>
      </div>

      <div class="time-selector">
        <div class="time-item">
          <span class="selector-label">开始时间:</span>
          <el-select
            v-model="startTime"
            :teleported="false"
            placeholder="选择开始时间"
            size="small"
            class="gas-select-dialog"
            popper-class="time-select-dropdown">
            <el-option
              v-for="item in timeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value" />
          </el-select>
        </div>
        <div class="time-item">
          <span class="selector-label">结束时间:</span>
          <el-select
            v-model="endTime"
            :teleported="false"
            placeholder="选择结束时间"
            size="small"
            class="gas-select-dialog"
            popper-class="time-select-dropdown">
            <el-option
              v-for="item in timeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value" />
          </el-select>
        </div>
      </div>

      <div ref="dialogChartRef" class="dialog-chart"></div>
    </el-dialog>

    <el-dialog
      v-model="overviewDialogVisible"
      title="数据统计总览"
      fullscreen
      append-to-body
      :lock-scroll="true"
      :z-index="10000"
      class="chart-dialog stats-overview-dialog"
      @opened="handleOverviewDialogOpen"
      @close="handleOverviewDialogClose">
      <div class="stats-overview-summary">
        <div class="stats-overview-kpi">
          <span>监测点</span>
          <strong>{{ overviewSelectedPointIds.length }}</strong>
        </div>
        <div class="stats-overview-kpi">
          <span>气体变量</span>
          <strong>{{ overviewSelectedGasIds.length }}</strong>
        </div>
        <div class="stats-overview-kpi">
          <span>时间步</span>
          <strong>{{ timeOptions.length }}</strong>
        </div>
      </div>

      <div class="stats-overview-controls">
        <div class="stats-overview-filter">
          <span class="selector-label">监测点</span>
          <el-select
            v-model="overviewSelectedPointIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            :teleported="false"
            placeholder="选择监测点"
            size="small"
            class="gas-select-dialog stats-overview-select"
            popper-class="monitoring-select-dropdown"
            :disabled="overviewPointOptions.length === 0 || isGlobalLoading"
            @change="handleOverviewFilterChange">
            <el-option
              v-for="point in overviewPointOptions"
              :key="point.id"
              :label="point.name"
              :value="point.id" />
          </el-select>
        </div>

        <div class="stats-overview-filter">
          <span class="selector-label">气体</span>
          <el-select
            v-model="overviewSelectedGasIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            :teleported="false"
            placeholder="选择气体"
            size="small"
            class="gas-select-dialog stats-overview-select"
            popper-class="gas-select-dropdown"
            :disabled="availableGases.length === 0 || isGlobalLoading"
            @change="handleOverviewFilterChange">
            <el-option
              v-for="gas in availableGases"
              :key="gas.id"
              :label="gas.name"
              :value="gas.id">
              <div class="gas-option">
                <el-color-picker
                  v-model="gas.color"
                  size="small"
                  :predefine="colorPalette"
                  @change="handleOverviewFilterChange"
                  @click.stop />
                <span>{{ gas.name }}</span>
              </div>
            </el-option>
          </el-select>
        </div>

        <div class="stats-overview-filter stats-overview-filter--range">
          <span class="selector-label">曲线时间区间</span>
          <div class="stats-overview-range-row">
            <el-select
              v-model="startTime"
              :teleported="false"
              placeholder="开始时间"
              size="small"
              class="gas-select-dialog stats-overview-time-select"
              popper-class="time-select-dropdown"
              :disabled="timeOptions.length === 0 || isGlobalLoading"
              @change="handleOverviewFilterChange">
              <el-option
                v-for="item in timeOptions"
                :key="String(item.value) + '-overview-chart-start'"
                :label="item.label"
                :value="item.value" />
            </el-select>
            <span class="stats-time-sep">—</span>
            <el-select
              v-model="endTime"
              :teleported="false"
              placeholder="结束时间"
              size="small"
              class="gas-select-dialog stats-overview-time-select"
              popper-class="time-select-dropdown"
              :disabled="timeOptions.length === 0 || isGlobalLoading"
              @change="handleOverviewFilterChange">
              <el-option
                v-for="item in timeOptions"
                :key="String(item.value) + '-overview-chart-end'"
                :label="item.label"
                :value="item.value" />
            </el-select>
          </div>
        </div>
      </div>

      <div class="stats-overview-grid">
        <div class="stats-overview-card stats-overview-card--wide">
          <div
            ref="overviewGasTrendChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card stats-overview-card--wide">
          <div
            ref="overviewWaveAttenuationChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card stats-overview-card--wide">
          <div
            ref="overviewWaveIntensityChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewGasSnapshotChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewPointGasTotalChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card stats-overview-card--wide">
          <div
            ref="overviewGasHeatmapChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewPointSpatialChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewEnvRadarChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewWindSpeedChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewTemperatureChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewHumidityChartRef"
            class="stats-overview-chart"></div>
        </div>
        <div class="stats-overview-card">
          <div
            ref="overviewPressureChartRef"
            class="stats-overview-chart"></div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped src="@/assets/styles/components/DataStatistics.css"></style>
<style src="@/assets/styles/components/DataStatisticsDialogs.css"></style>
