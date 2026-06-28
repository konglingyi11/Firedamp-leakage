import { reactive } from 'vue'

export function useIsosurface({ currentTask, generatedVizLayers, playerRef, taskStore }) {
  const isosurfaceState = reactive({})
  const isosurfaceValueRanges = reactive({})

  function normalizeIsoRange(vmin, vmax) {
    const min = Number(vmin)
    const max = Number(vmax)
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
    return [min, max]
  }

  function getIsoValueRange(layerId) {
    return isosurfaceValueRanges[layerId] || [0, 1]
  }

  function getIsoState(layerId) {
    if (!isosurfaceState[layerId]) {
      isosurfaceState[layerId] = { enabled: false, value: 0.5 }
    }
    return isosurfaceState[layerId]
  }

  function getIsoSliderValue(layerId) {
    const state = getIsoState(layerId)
    const [vMin, vMax] = getIsoValueRange(layerId)
    return vMin + state.value * (vMax - vMin)
  }

  function getIsoDisplayValue(layerId) {
    return getIsoSliderValue(layerId).toFixed(2)
  }

  function applyIsosurfaceToCanvas() {
    const visibleVolumeLayers = (generatedVizLayers.value || []).filter(
      (l) => l?.kind === 'volume' && l?.visible !== false,
    )
    const activeLayer = visibleVolumeLayers.find((l) => getIsoState(l.id).enabled)
    if (activeLayer) {
      const state = getIsoState(activeLayer.id)
      playerRef.value?.setIsosurfaceEnabled?.(true)
      playerRef.value?.setIsosurfaceValue?.(state.value)
    } else {
      playerRef.value?.setIsosurfaceEnabled?.(false)
    }
  }

  function toggleIsosurfaceForLayer(layer) {
    const id = layer?.id
    if (!id) return
    const state = getIsoState(id)
    state.enabled = !state.enabled
    applyIsosurfaceToCanvas()
  }

  function updateIsosurfaceValueForLayer(layerId, val) {
    const state = getIsoState(layerId)
    const [vMin, vMax] = getIsoValueRange(layerId)
    const rawValue = Number(val)
    state.value =
      Number.isFinite(rawValue) && vMax > vMin
        ? Math.max(0, Math.min(1, (rawValue - vMin) / (vMax - vMin)))
        : Math.max(0, Math.min(1, Number(val) || 0.5))
    applyIsosurfaceToCanvas()
  }

  async function refreshIsosurfaceRangeForLayer(layer) {
    const id = layer?.id
    if (!id) return
    const layerRange = normalizeIsoRange(layer?.vmin, layer?.vmax)
    if (layerRange) {
      isosurfaceValueRanges[id] = layerRange
      return
    }

    const variable = layer?.variable || ''
    let metaRange = variable ? taskStore.getVariableRange(variable) : null
    if (!metaRange && variable && currentTask.value?.id) {
      try {
        await taskStore.fetchTaskMetadata(currentTask.value.id)
        metaRange = taskStore.getVariableRange(variable)
      } catch (e) {
        console.warn('[等值面] 获取 metadata 失败:', e)
      }
    }
    const resolvedMetaRange = normalizeIsoRange(metaRange?.vmin, metaRange?.vmax)
    if (resolvedMetaRange) {
      isosurfaceValueRanges[id] = resolvedMetaRange
    } else {
      isosurfaceValueRanges[id] = playerRef.value?.getVolumeValueRange?.() || [0, 1]
    }
  }

  return {
    getIsoValueRange,
    getIsoState,
    getIsoSliderValue,
    getIsoDisplayValue,
    toggleIsosurfaceForLayer,
    updateIsosurfaceValueForLayer,
    refreshIsosurfaceRangeForLayer,
  }
}
