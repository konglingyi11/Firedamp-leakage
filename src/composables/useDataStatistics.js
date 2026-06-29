import { ref, computed, watch, nextTick } from 'vue'
import postProcessingApi from '@/api/postProcessing'
import { ElMessage } from 'element-plus'
import {
  ENV_VAR_KEYS,
  getGasInfoById,
  isGasVariable,
  COLOR_PALETTE,
} from '@/utils/gas'
import { normalizeMonitoringPoints } from '@/utils/monitoringPointLayers'
import { clampMonitoringPointToBounds } from '@/utils/monitoringPointDrag'
import { simulatedRadarWaveSnapshot } from '@/utils/simulatedRadarProbe'
import { isGoafTask } from '@/utils/taskType'

/**
 * 为采空区任务生成模拟的监测点时序数据。
 * 不请求后端，直接返回结构合理的模拟值序列。
 * @param {number} pointId 监测点 id
 * @param {number} x 监测点 x 坐标
 * @param {number} y 监测点 y 坐标
 * @param {number} z 监测点 z 坐标
 * @param {string[]} gasIds 需要生成的气体变量 id 列表
 * @param {number} stepCount 时间步数量
 * @returns {{ env: Record<string, number[]>, gases: Record<string, number[]> }}
 */
function generateGoafMockProbeData(pointId, x, y, z, gasIds, stepCount = 10) {
  // 用坐标生成稳定种子，让同一监测点的数据可复现
  const seed = Math.abs(pointId * 9301 + Math.round(x * 100) + Math.round(y * 10) + Math.round(z)) % 233280
  let rngState = seed
  const rand = () => {
    rngState = (rngState * 9301 + 49297) % 233280
    return rngState / 233280
  }
  // 距离原点距离用作基础扰动幅度
  const distFactor = Math.min(1, Math.sqrt(x * x + y * y + z * z) / 50)

  const env = {}
  // 温度：295-320K，随时间缓慢上升
  env.temperature = Array.from({ length: stepCount }, (_, i) =>
    295 + rand() * 5 + i * (1 + distFactor) + Math.sin(i * 0.6) * 1.2,
  )
  // 压力：相对偏差 0.5-2 kPa
  env.pressure = Array.from({ length: stepCount }, (_, i) =>
    0.5 + rand() * 1.5 + Math.sin(i * 0.4 + pointId) * 0.3,
  )
  // 风速：0.2-1.5 m/s，带波动
  env.windSpeed = Array.from({ length: stepCount }, (_, i) =>
    0.2 + rand() * 0.8 + Math.sin(i * 0.5 + pointId * 0.3) * 0.25,
  )
  // 湿度：质量分数 0.005-0.02
  env.humidity = Array.from({ length: stepCount }, (_, i) =>
    0.005 + rand() * 0.012 + Math.sin(i * 0.3) * 0.002,
  )

  const gases = {}
  gasIds.forEach((gasId) => {
    // 不同气体给出不同量级，瓦斯(ch4) 给较高质量分数
    const base = /ch4|methane/i.test(gasId) ? 0.02 : 0.005
    gases[gasId] = Array.from({ length: stepCount }, (_, i) =>
      base + rand() * base * 0.8 + i * base * 0.05 + Math.sin(i * 0.4) * base * 0.2,
    )
  })
  return { env, gases }
}

export function useDataStatistics(options) {
  const { props, emit } = options

  const usePregenForProbe = ref(true)
  const loading = ref({
    gasMassFraction: false,
    windSpeed: false,
    temperature: false,
    humidity: false,
    pressure: false,
  })
  const isGlobalLoading = computed(() =>
    Object.values(loading.value).some((status) => status),
  )

  const monitoringPoints = ref([])
  const selectedPointId = ref(null)
  const dialogSelectedPointIds = ref([])
  const syncedPointIds = ref(new Set())
  const shouldFetchOnSelection = ref(true)
  const suppressNextFocusEmit = ref(false)
  /** 数据统计总览里电磁波两图：首屏先短 loading 再展示模拟曲线，不阻塞在接口上 */
  const waveOverviewRevealAllowed = ref(true)

  const monitoringPoint = computed(
    () =>
      monitoringPoints.value.find(
        (p) => String(p.id) === String(selectedPointId.value),
      ) ||
      monitoringPoints.value[0] ||
      null,
  )
  const draftMonitoringPoint = ref(null)

  const geometryBounds = ref({
    xmin: -100,
    xmax: 100,
    ymin: -100,
    ymax: 100,
    zmin: -100,
    zmax: 100,
  })
  const selectedGasesForChart = ref([])
  const availableGases = ref([])
  const gasListExpanded = ref(false)
  const maxVisibleGasCount = 3
  const visibleGasIds = computed(() =>
    gasListExpanded.value
      ? selectedGasesForChart.value
      : selectedGasesForChart.value.slice(0, maxVisibleGasCount),
  )

  const gasMassFractionData = ref({})
  const envDataHistory = ref({
    temperature: {},
    pressure: {},
    windSpeed: {},
    humidity: {},
  })
  const realTimeData = ref({
    temperature: 0,
    humidity: 0,
    pressure: 0,
    windSpeed: 0,
    waveAttenuationRate: '—',
    waveIntensity: '—',
    gasConcentrations: {},
  })

  const startTime = ref('')
  const endTime = ref('')
  const envSnapshotTime = ref(null)
  const timeOptions = ref([])
  const physicalTimes = ref([])

  const pointIdsForFetch = computed(() => {
    const synced = new Set([...syncedPointIds.value].map((id) => String(id)))
    return monitoringPoints.value
      .filter((p) => synced.has(String(p.id)))
      .map((p) => p.id)
  })

  const clonePoint = (point) => (point ? { ...point } : null)

  const syncDraftFromSelectedPoint = () => {
    draftMonitoringPoint.value = clonePoint(monitoringPoint.value)
  }

  const updateDraftMonitoringPointCoordinate = (axis, value) => {
    if (!draftMonitoringPoint.value) return null
    const next = Number(value)
    draftMonitoringPoint.value = clampMonitoringPointToBounds({
      ...draftMonitoringPoint.value,
      [axis]: Number.isFinite(next) ? next : draftMonitoringPoint.value[axis],
    }, geometryBounds.value)
    return clonePoint(draftMonitoringPoint.value)
  }

  const commitDraftMonitoringPoint = () => {
    const draft = draftMonitoringPoint.value
    if (!draft || !draft.id) return null
    const idx = monitoringPoints.value.findIndex((p) => p.id === draft.id)
    if (idx === -1) return null
    monitoringPoints.value[idx] = clampMonitoringPointToBounds({
      ...monitoringPoints.value[idx],
      ...draft,
    }, geometryBounds.value)
    draftMonitoringPoint.value = clonePoint(monitoringPoints.value[idx])
    return clonePoint(monitoringPoints.value[idx])
  }

  const updateMonitoringPointFromExternal = (point) => {
    if (!point?.id) return null
    const boundedPoint = clampMonitoringPointToBounds(point, geometryBounds.value)
    const idx = monitoringPoints.value.findIndex(
      (p) => String(p.id) === String(boundedPoint.id),
    )
    if (idx === -1) {
      monitoringPoints.value.push({ ...boundedPoint })
      if (selectedPointId.value == null) selectedPointId.value = boundedPoint.id
      if (String(selectedPointId.value) === String(boundedPoint.id)) {
        draftMonitoringPoint.value = clonePoint(boundedPoint)
      }
      return clonePoint(boundedPoint)
    }
    monitoringPoints.value[idx] = {
      ...monitoringPoints.value[idx],
      ...boundedPoint,
    }
    if (String(selectedPointId.value) === String(boundedPoint.id)) {
      draftMonitoringPoint.value = clonePoint(monitoringPoints.value[idx])
    }
    return clonePoint(monitoringPoints.value[idx])
  }

  const syncMonitoringPointsFromParent = (points) => {
    const normalized = normalizeMonitoringPoints(points).map((point) =>
      clampMonitoringPointToBounds(point, geometryBounds.value),
    )
    monitoringPoints.value = normalized
    const validIds = new Set(normalized.map((p) => String(p.id)))
    syncedPointIds.value = new Set(
      [...syncedPointIds.value].filter((id) => validIds.has(String(id))),
    )
    const selectedExists = normalized.some(
      (point) => String(point.id) === String(selectedPointId.value),
    )
    if (!selectedExists) {
      selectedPointId.value = normalized[0]?.id ?? null
    }
    dialogSelectedPointIds.value = dialogSelectedPointIds.value.filter((id) =>
      normalized.some((point) => String(point.id) === String(id)),
    )
    syncDraftFromSelectedPoint()
  }

  // Helpers
  const filterDataByTime = (data) => {
    if (!timeOptions.value.length) return { xAxisData: [], seriesData: [] }
    const startIdx = timeOptions.value.findIndex(
      (t) => t.value === startTime.value,
    )
    const endIdx = timeOptions.value.findIndex((t) => t.value === endTime.value)
    const start = startIdx >= 0 ? startIdx : 0
    const end = endIdx >= 0 ? endIdx : timeOptions.value.length - 1
    const sliceStart = Math.min(start, end)
    const sliceEnd = Math.max(start, end) + 1
    const xAxisData = timeOptions.value
      .slice(sliceStart, sliceEnd)
      .map((t) => t.value)
    let seriesData =
      data && data.length >= timeOptions.value.length
        ? data.slice(sliceStart, sliceEnd)
        : data || []
    return { xAxisData, seriesData }
  }

  const fetchVariables = async () => {
    if (!props.currentTask?.id) return
    try {
      const res = await postProcessingApi.getTaskVariables(props.currentTask.id)
      const list = res.data?.variables || res.data || res
      if (Array.isArray(list)) {
        availableGases.value = list
          .filter((v) => isGasVariable(v.id || v.name || v.variable || v))
          .map((v, i) => {
            const id = v.id || v.name || v.variable || v
            const info = getGasInfoById(id)
            return {
              id,
              name: info ? `${info.zh}(${info.en})` : id,
              color: info?.color || COLOR_PALETTE[i % COLOR_PALETTE.length],
            }
          })
        if (availableGases.value.length && !selectedGasesForChart.value.length)
          selectedGasesForChart.value = availableGases.value.map((g) => g.id)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchTimeSteps = async () => {
    if (!props.currentTask?.id) return
    try {
      const res = await postProcessingApi.getTaskTimeSteps(props.currentTask.id)
      const steps = res.data?.time_steps || res.time_steps || []
      const times = res.data?.physical_times || res.physical_times || []
      if (steps.length) {
        physicalTimes.value = times
        timeOptions.value = times.map((t, i) => ({
          label: `${t.toFixed(4)} s`,
          value: t,
          step: steps[i],
        }))
        startTime.value = timeOptions.value[0].value
        endTime.value = timeOptions.value[times.length - 1].value
        envSnapshotTime.value = endTime.value
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchGeometryBounds = async () => {
    if (!props.currentTask?.id) return
    try {
      const res = await postProcessingApi.getGeometryBounds(
        props.currentTask.id,
      )
      const bounds = res?.data ?? res
      const rawXMin = bounds?.xmin ?? bounds?.x_min ?? -100
      const rawXMax = bounds?.xmax ?? bounds?.x_max ?? 100
      const rawYMin = bounds?.ymin ?? bounds?.y_min ?? -100
      const rawYMax = bounds?.ymax ?? bounds?.y_max ?? 100
      const rawZMin = bounds?.zmin ?? bounds?.z_min ?? -100
      const rawZMax = bounds?.zmax ?? bounds?.z_max ?? 100
      geometryBounds.value = {
        xmin: Number(rawXMin),
        xmax: Number(rawXMax),
        ymin: Number(rawYMin),
        ymax: Number(rawYMax),
        zmin: Number(rawZMin),
        zmax: Number(rawZMax),
      }
      monitoringPoints.value = normalizeMonitoringPoints(
        monitoringPoints.value,
      ).map((point) => clampMonitoringPointToBounds(point, geometryBounds.value))
      if (draftMonitoringPoint.value) {
        draftMonitoringPoint.value = clampMonitoringPointToBounds(
          draftMonitoringPoint.value,
          geometryBounds.value,
        )
      }
    } catch (e) {
      console.error('获取几何边界失败:', e)
    }
  }

  const fetchProbeAllData = async (options = {}) => {
    const fetchPointIds =
      Array.isArray(options.pointIds) && options.pointIds.length
        ? options.pointIds
        : pointIdsForFetch.value
    const fetchGasIds =
      Array.isArray(options.gasIds) && options.gasIds.length
        ? options.gasIds
        : selectedGasesForChart.value
    if (!props.currentTask?.id || !fetchPointIds.length) return
    Object.keys(loading.value).forEach((k) => (loading.value[k] = true))
    try {
      const promises = fetchPointIds.map(async (pointId) => {
        const point = monitoringPoints.value.find(
          (p) => String(p.id) === String(pointId),
        )
        if (!point) return

        // 采空区任务：直接使用模拟数据，不请求后端
        if (isGoafTask(props.currentTask)) {
          const stepCount = timeOptions.value.length || 10
          const { env, gases } = generateGoafMockProbeData(
            Number(pointId) || 0,
            point.x,
            point.y,
            point.z,
            fetchGasIds,
            stepCount,
          )
          Object.entries(ENV_VAR_KEYS).forEach(([key]) => {
            const values = env[key]
            if (!values) return
            if (!envDataHistory.value[key]) envDataHistory.value[key] = {}
            if (key === 'humidity')
              envDataHistory.value[key][pointId] = values.map((v) => v * 100)
            else if (key === 'pressure') {
              const b =
                (props.currentTask?.params?.operating_pressure || 101325) / 1000
              envDataHistory.value[key][pointId] = values.map((v) => b + v)
            } else if (key === 'temperature')
              envDataHistory.value[key][pointId] = values.map((v) => v - 273.15)
            else envDataHistory.value[key][pointId] = values
          })
          fetchGasIds.forEach((gasId) => {
            if (!gasMassFractionData.value[gasId])
              gasMassFractionData.value[gasId] = {}
            gasMassFractionData.value[gasId][pointId] = gases[gasId] ?? []
          })
          return
        }

        const res = await postProcessingApi.getPointProbeData({
          task_id: props.currentTask.id,
          variables: [...Object.values(ENV_VAR_KEYS), ...fetchGasIds],
          x: point.x,
          y: point.y,
          z: point.z,
          use_pregen: usePregenForProbe.value,
        })
        const series = res.data?.series || res.series || res.results || []
        const stepMap = {}
        series.forEach((s) => (stepMap[s.variable] = s.values))

        Object.entries(ENV_VAR_KEYS).forEach(([key, variable]) => {
          const values = stepMap[variable]
          if (!values) return
          if (!envDataHistory.value[key]) envDataHistory.value[key] = {}
          if (key === 'humidity')
            envDataHistory.value[key][pointId] = values.map((v) => v * 100)
          else if (key === 'pressure') {
            const b =
              (props.currentTask?.params?.operating_pressure || 101325) / 1000
            envDataHistory.value[key][pointId] = values.map((v) => b + v)
          } else if (key === 'temperature')
            envDataHistory.value[key][pointId] = values.map((v) => v - 273.15)
          else envDataHistory.value[key][pointId] = values
        })
        fetchGasIds.forEach((gasId) => {
          if (!gasMassFractionData.value[gasId])
            gasMassFractionData.value[gasId] = {}
          gasMassFractionData.value[gasId][pointId] = stepMap[gasId] ?? []
        })
      })
      await Promise.all(promises)
    } finally {
      Object.keys(loading.value).forEach((k) => (loading.value[k] = false))
    }
  }

  const applyMainPanelProbeSnapshot = () => {
    if (!timeOptions.value.length) return
    const pointId = selectedPointId.value
    if (!pointId) return
    const target = Number(envSnapshotTime.value)
    let idx = timeOptions.value.findIndex(
      (o) => o.value === envSnapshotTime.value,
    )
    if (idx < 0) {
      let b = 0,
        d = Infinity
      timeOptions.value.forEach((o, i) => {
        const diff = Math.abs(Number(o.value) - target)
        if (diff < d) {
          d = diff
          b = i
        }
      })
      idx = b
    }

    ;['temperature', 'pressure', 'windSpeed', 'humidity'].forEach((k) => {
      const arr = envDataHistory.value[k]?.[pointId]
      if (arr && arr[idx] != null)
        realTimeData.value[k] = Number(arr[idx]).toFixed(
          k === 'pressure' ? 2 : 1,
        )
    })
    selectedGasesForChart.value.forEach((gid) => {
      const vals = gasMassFractionData.value[gid]?.[pointId]
      realTimeData.value.gasConcentrations[gid] =
        vals && vals[idx] != null ? vals[idx] : 0
    })

    const pointProbe = monitoringPoints.value.find(
      (p) => String(p.id) === String(pointId),
    )
    if (pointProbe) {
      const snap = simulatedRadarWaveSnapshot(
        pointProbe,
        idx,
        timeOptions.value.length,
      )
      realTimeData.value.waveAttenuationRate = snap.attenuation
      realTimeData.value.waveIntensity = snap.intensity
    } else {
      realTimeData.value.waveAttenuationRate = '—'
      realTimeData.value.waveIntensity = '—'
    }
  }

  const handleAddPoint = () => {
    const newId = `point_${Date.now()}`
    const centerX = (geometryBounds.value.xmin + geometryBounds.value.xmax) / 2
    const centerY = (geometryBounds.value.ymin + geometryBounds.value.ymax) / 2
    const centerZ = (geometryBounds.value.zmin + geometryBounds.value.zmax) / 2
    const newPoint = clampMonitoringPointToBounds({
      id: newId,
      name: `监测点 ${monitoringPoints.value.length + 1}`,
      x: Number.isFinite(centerX) ? centerX : 0,
      y: Number.isFinite(centerY) ? centerY : 0,
      z: Number.isFinite(centerZ) ? centerZ : 0,
    }, geometryBounds.value)
    monitoringPoints.value.push(newPoint)
    shouldFetchOnSelection.value = false
    selectedPointId.value = newId
    draftMonitoringPoint.value = clonePoint(newPoint)
    nextTick(() => {
      shouldFetchOnSelection.value = true
    })
  }

  const handleDeletePoint = () => {
    if (!selectedPointId.value) return
    const idx = monitoringPoints.value.findIndex(
      (p) => String(p.id) === String(selectedPointId.value),
    )
    if (idx === -1) return
    const p = monitoringPoints.value[idx]
    emit('delete-point', { ...p })
    ;[...syncedPointIds.value].forEach((id) => {
      if (String(id) === String(p.id)) syncedPointIds.value.delete(id)
    })
    monitoringPoints.value.splice(idx, 1)
    if (String(draftMonitoringPoint.value?.id) === String(p.id)) {
      draftMonitoringPoint.value = null
    }
    dialogSelectedPointIds.value = dialogSelectedPointIds.value.filter(
      (id) => String(id) !== String(p.id),
    )
    selectedPointId.value = monitoringPoints.value.length
      ? monitoringPoints.value[Math.min(idx, monitoringPoints.value.length - 1)]
          .id
      : null
    ElMessage.success('监测点已删除')
  }

  watch(
    selectedPointId,
    (nextId, prevId) => {
      if (prevId && nextId !== prevId) {
        // 切换监测点时丢弃未应用草稿，避免坐标被错误持久化
        draftMonitoringPoint.value = null
      }
      syncDraftFromSelectedPoint()
    },
    { immediate: true },
  )

  return {
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
    filterDataByTime,
    fetchVariables,
    fetchTimeSteps,
    fetchProbeAllData,
    fetchGeometryBounds,
    applyMainPanelProbeSnapshot,
    handleAddPoint,
    handleDeletePoint,
    updateDraftMonitoringPointCoordinate,
    commitDraftMonitoringPoint,
    updateMonitoringPointFromExternal,
    syncMonitoringPointsFromParent,
  }
}
