import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { useMonitoringPointStore } from '@/stores/monitoringPoints'
import {
  applyMonitoringLayerVisibility,
  buildMonitoringPointLayers,
  normalizeMonitoringPoints,
  resolveMonitoringLayerPointId,
} from '@/utils/monitoringPointLayers'
import {
  clampMonitoringPointToBounds,
  normalizeMonitoringPointBounds,
} from '@/utils/monitoringPointDrag'
import postProcessingApi from '@/api/postProcessing'

/**
 * 监测点管理 composable，封装完整的监测点 CRUD、bounds 解析、图层同步、UE 通信等逻辑。
 * 所有外部依赖通过 options 回调注入，保持低耦合。
 */
export function useHomeMonitoringPoints(options = {}) {
  const {
    getCurrentTask = () => null,
    getPlayerRef = () => null,
    getDataStatisticsRef = () => null,
    getGeneratedVizLayers = () => [],
    setGeneratedVizLayers = () => {},
    getUeMsg = () => null,
    getActiveModule = () => 'home',
    setActiveModule = () => {},
    setShowMicroMotionPanel = () => {},
    setRightPanelCollapsed = () => {},
    onStartMicroMotionLoading = null,
    buildGeneratedLayerLabel = () => '',
    vizLayerIdForUE = (id) => id,
  } = options

  const monitoringPointStore = useMonitoringPointStore()

  const monitoringPoints = ref([])
  const radarMediumProbeFallback = computed(
    () => monitoringPoints.value?.[0] ?? null,
  )
  const monitoringPointBoundsCache = new Map()

  function getCachedMonitoringPointBounds() {
    const player = getPlayerRef()?.value
    const canvasBounds = player?.getCachedGeometryBounds?.()
    if (normalizeMonitoringPointBounds(canvasBounds)) return canvasBounds
    const taskId = getCurrentTask()?.id
    if (taskId != null && monitoringPointBoundsCache.has(String(taskId))) {
      return monitoringPointBoundsCache.get(String(taskId))
    }
    return null
  }

  async function resolveMonitoringPointBounds() {
    const cached = getCachedMonitoringPointBounds()
    if (cached) return cached

    const taskId = getCurrentTask()?.id
    if (taskId == null || String(taskId).trim() === '') return null
    try {
      const res = await postProcessingApi.getGeometryBounds(taskId)
      const bounds = res?.data ?? res
      if (!normalizeMonitoringPointBounds(bounds)) return null
      monitoringPointBoundsCache.set(String(taskId), bounds)
      return bounds
    } catch (error) {
      console.warn('[monitoring-point] geometry bounds load failed:', error)
      return null
    }
  }

  function normalizeMonitoringPointsForCurrentBounds(points) {
    const bounds = getCachedMonitoringPointBounds()
    return normalizeMonitoringPoints(points).map((point) =>
      bounds ? clampMonitoringPointToBounds(point, bounds) : point,
    )
  }

  async function normalizeMonitoringPointForCommit(data, { warn = true } = {}) {
    const normalized = normalizeMonitoringPoints([data])[0]
    if (!normalized) return null
    const bounds = await resolveMonitoringPointBounds()
    if (!bounds) {
      if (warn) ElMessage.warning('包围盒未就绪，暂不能添加或更新监测点')
      nextTick(syncMonitoringPointsToPanel)
      return null
    }
    return clampMonitoringPointToBounds(normalized, bounds)
  }

  function syncMonitoringPointsToStore() {
    monitoringPointStore.setPoints(getCurrentTask()?.id, monitoringPoints.value)
  }

  function syncMonitoringPointLayers() {
    const nonMonitorLayers = (getGeneratedVizLayers() || []).filter(
      (layer) => layer?.kind !== 'monitor',
    )
    setGeneratedVizLayers([
      ...nonMonitorLayers,
      ...buildMonitoringPointLayers(monitoringPoints.value, getCurrentTask()?.id),
    ])
  }

  function syncMonitoringPointsToPanel() {
    const dataStatisticsRef = getDataStatisticsRef()
    dataStatisticsRef?.value?.syncMonitoringPointsFromParent?.(
      monitoringPoints.value,
    )
  }

  function syncPointsToThree() {
    const player = getPlayerRef()?.value
    player?.syncMonitoringPoints?.(monitoringPoints.value)
  }

  function setMonitoringPoints(points, { syncStore = true } = {}) {
    monitoringPoints.value = normalizeMonitoringPointsForCurrentBounds(points)
    if (syncStore) syncMonitoringPointsToStore()
    syncMonitoringPointLayers()
    syncPointsToThree()
    nextTick(syncMonitoringPointsToPanel)
  }

  function clearMonitoringPointsState({ clearStore = false } = {}) {
    monitoringPoints.value = []
    if (clearStore) monitoringPointStore.clearPoints(getCurrentTask()?.id)
    syncMonitoringPointLayers()
    const player = getPlayerRef()?.value
    if (player) {
      player.syncMonitoringPoints?.([])
    }
    nextTick(syncMonitoringPointsToPanel)
  }

  // 切换任务时清空监测点，并从 Pinia 删除上一任务（及新任务侧旧缓存）的监测点条目
  watch(
    () => getCurrentTask()?.id,
    (nextId, prevId) => {
      if (String(prevId ?? '') === String(nextId ?? '')) return
      const prevTrim =
        prevId != null && String(prevId).trim() !== '' ? String(prevId) : ''
      const nextTrim =
        nextId != null && String(nextId).trim() !== '' ? String(nextId) : ''
      const switchedFromTask = prevTrim !== ''
      if (switchedFromTask) {
        monitoringPointStore.clearPoints(prevTrim)
        if (nextTrim) monitoringPointStore.clearPoints(nextTrim)
      }
      setMonitoringPoints([], { syncStore: false })
    },
    { immediate: true },
  )

  // 监听监测点新增，发送给 UE 并同步到 Three.js
  const handleAddPoint = async (data) => {
    const normalized = await normalizeMonitoringPointForCommit(data)
    if (!normalized) return
    const existingIndex = monitoringPoints.value.findIndex(
      (p) => p.id === normalized.id,
    )
    if (existingIndex === -1) {
      monitoringPoints.value.push(normalized)
    } else {
      monitoringPoints.value[existingIndex] = {
        ...monitoringPoints.value[existingIndex],
        ...normalized,
      }
    }
    syncMonitoringPointsToStore()
    syncMonitoringPointLayers()
    syncPointsToThree()
    const ueMsg = getUeMsg()
    if (getPlayerRef()?.value && ueMsg) {
      ueMsg.addPoint(normalized)
    }
  }

  // 监听监测点位置更新，发送给 UE 并同步到 Three.js
  const handleUpdatePoint = async (data) => {
    const normalized = await normalizeMonitoringPointForCommit(data)
    if (!normalized) return
    const existingIndex = monitoringPoints.value.findIndex(
      (p) => p.id === normalized.id,
    )
    if (existingIndex !== -1) {
      monitoringPoints.value[existingIndex] = {
        ...monitoringPoints.value[existingIndex],
        ...normalized,
      }
    } else {
      monitoringPoints.value.push(normalized)
    }
    syncMonitoringPointsToStore()
    syncMonitoringPointLayers()
    const dataStatisticsRef = getDataStatisticsRef()
    dataStatisticsRef?.value?.updateMonitoringPointFromExternal?.(normalized)
    nextTick(() => {
      dataStatisticsRef?.value?.updateMonitoringPointFromExternal?.(normalized)
    })
    syncPointsToThree()
    const ueMsg = getUeMsg()
    if (getPlayerRef()?.value && ueMsg) {
      ueMsg.updatePoint(normalized)
    }
  }

  // 预览监测点位置（仅用于空间可视预览，不持久化本地监测点列表）
  const handlePreviewPoint = async (data) => {
    if (!data?.id) return
    const normalized = await normalizeMonitoringPointForCommit(data, { warn: false })
    if (!normalized) return
    const player = getPlayerRef()?.value
    const ueMsg = getUeMsg()
    if (player && ueMsg) {
      ueMsg.updatePoint(normalized)
      const previewPoints = monitoringPoints.value.map((point) =>
        point.id === normalized.id ? { ...point, ...normalized } : point,
      )
      player.syncMonitoringPoints?.(previewPoints)
    }
  }

  // 监听监测点删除，发送给 UE 并同步到 Three.js
  const handleDeletePoint = (data) => {
    monitoringPoints.value = monitoringPoints.value.filter(
      (p) => p.id !== data.id,
    )
    syncMonitoringPointsToStore()
    syncMonitoringPointLayers()
    syncPointsToThree()
    const ueMsg = getUeMsg()
    if (getPlayerRef()?.value && ueMsg) {
      ueMsg.deletePoint(data)
    }
  }

  function isMonitoringGeneratedLayer(layer) {
    return layer?.kind === 'monitor'
  }

  function handleMonitoringLayerVisibilityChange(layer, visible) {
    monitoringPoints.value = applyMonitoringLayerVisibility(
      monitoringPoints.value,
      layer,
      visible,
    )
    syncMonitoringPointsToStore()
    syncMonitoringPointLayers()
    syncPointsToThree()
    nextTick(syncMonitoringPointsToPanel)
  }

  function handleMonitoringLayerFocus(layer) {
    const pointId = resolveMonitoringLayerPointId(layer)
    const point =
      monitoringPoints.value.find((item) => String(item.id) === String(pointId)) ||
      layer?.point
    if (!point) return
    const normalized = normalizeMonitoringPoints([point])[0]
    if (!normalized) return
    syncPointsToThree()
    const dataStatisticsRef = getDataStatisticsRef()
    dataStatisticsRef?.value?.selectMonitoringPointById?.(normalized.id)
    nextTick(() => {
      handleFocusPoint(normalized)
    })
  }

  // UE 通过像素流回传要聚焦的监测点 id，同步左侧「数据统计」下拉选中
  const handleUeFocusPoint = (payload) => {
    const id = payload?.id
    if (id == null || id === '') return
    if (getActiveModule() !== 'statistics') {
      setActiveModule('statistics')
    }
    nextTick(() => {
      const dataStatisticsRef = getDataStatisticsRef()
      dataStatisticsRef?.value?.selectMonitoringPointById(id)
    })
  }

  // 监听监测点聚焦，发送给 UE
  const handleFocusPoint = (data) => {
    const player = getPlayerRef()?.value
    if (!player) return
    player.focusMonitoringPoint?.(data)
    const payload = {
      type: 'focusPlane',
      data: JSON.stringify(data),
    }
    player.emitMessage(payload)
  }

  const handleMicroMotionTargetFocus = (target) => {
    const matchedPoint = monitoringPoints.value.find(
      (point) => String(point.id) === String(target?.id),
    )
    if (matchedPoint) {
      handleFocusPoint(matchedPoint)
    }
    const player = getPlayerRef()?.value
    const highlightMethod =
      target?.source === 'gltf-animation'
        ? player?.highlightAnimatedModelTarget
        : player?.highlightPersonModel
    highlightMethod?.({
      focus: !matchedPoint,
      personInfo: target,
    })
  }

  /** 可向 UE 发送 focusPlane 的已生成图层（id 与 vizLayerIdForUE 一致） */
  function isGeneratedLayerPlaneFocusable(layer) {
    const k = layer?.kind
    return (
      k === 'contour' ||
      k === 'cloud' ||
      k === 'radar_cloud' ||
      k === 'vector'
    )
  }

  function handleGeneratedLayerPlaneFocus(layer) {
    if (!isGeneratedLayerPlaneFocusable(layer)) return
    const player = getPlayerRef()?.value
    player?.focusCameraOnPlaneLayer?.(layer)
    if (!player) return
    handleFocusPoint({ id: vizLayerIdForUE(layer), kind: layer.kind })
  }

  return {
    monitoringPointStore,
    monitoringPoints,
    radarMediumProbeFallback,
    getCachedMonitoringPointBounds,
    resolveMonitoringPointBounds,
    normalizeMonitoringPointsForCurrentBounds,
    normalizeMonitoringPointForCommit,
    syncMonitoringPointsToStore,
    syncMonitoringPointLayers,
    syncMonitoringPointsToPanel,
    syncPointsToThree,
    setMonitoringPoints,
    clearMonitoringPointsState,
    handleAddPoint,
    handleUpdatePoint,
    handlePreviewPoint,
    handleDeletePoint,
    isMonitoringGeneratedLayer,
    handleMonitoringLayerVisibilityChange,
    handleMonitoringLayerFocus,
    handleUeFocusPoint,
    handleFocusPoint,
    handleMicroMotionTargetFocus,
    isGeneratedLayerPlaneFocusable,
    handleGeneratedLayerPlaneFocus,
  }
}
