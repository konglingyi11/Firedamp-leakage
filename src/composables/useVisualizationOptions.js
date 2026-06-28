import { ref, computed, watch, inject } from 'vue'
import { getVariableDisplayName } from '@/utils/gas'
import { VIZ_STATE_KEY } from './useVisualizationState'
import { postProcessingApi } from '@/api'
import {
  cleanPreviewUrl,
  pickPreviewLayer,
  resolvePreviewFrameUrl,
} from '@/utils/previewFrame'

export function useVisualizationOptions(options = {}) {
  const { props: passedProps, emit, taskStore } = options
  
  // Inject the centralized visualization state
  const vizState = inject(VIZ_STATE_KEY)

  // Helper to get value from props or injected state
  const getVal = (propKey, statePath) => {
    if (passedProps && passedProps[propKey] !== undefined) return passedProps[propKey]
    if (vizState) {
      if (statePath) return vizState[statePath]?.value
      return vizState[propKey]?.value
    }
    return undefined
  }

  // Define local refs/computed that proxy either props or injected state
  const visualization = computed(() => getVal('visualization'))
  const dimension = computed(() => getVal('dimension', 'visualizationDimension'))
  const type2d = computed(() => getVal('type2d', 'visualization2DType'))
  const type3d = computed(() => getVal('type3d', 'visualization3DType'))
  const plane = computed(() => getVal('plane', 'selectedPlane'))
  const coordinate = computed(() => getVal('coordinate', 'planeCoordinate'))
  const currentStep = computed(() => getVal('currentStep', 'timelineCurrentStep'))
  const timelineTimeSteps = computed(() =>
    getVal('timelineTimeSteps', 'timelineTimeSteps'),
  )
  const currentSimulationTimeStep = computed(() => {
    const idx = Number(currentStep.value) || 0
    const steps = timelineTimeSteps.value
    if (!Array.isArray(steps) || steps.length === 0) return null
    const raw = steps[idx]
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  })
  const layers = computed(() => getVal('layers', 'generatedVizLayers'))
  const previewImage = computed(() => getVal('previewImage', 'previewImageUrl'))
  const rows = computed(() => getVal('rows', 'previewRows'))
  const cols = computed(() => getVal('cols', 'previewCols'))
  const frameCount = computed(() => getVal('frameCount', 'previewFrameCount'))
  const globalPhysicalWidth = computed(() =>
    getVal('physicalWidth', 'previewPhysicalWidth'),
  )
  const globalPhysicalHeight = computed(() =>
    getVal('physicalHeight', 'previewPhysicalHeight'),
  )
  const physicalTimes = computed(() => getVal('physicalTimes', 'timelinePhysicalTimes'))
  const vmin = computed(() => getVal('vmin', 'previewVMin'))
  const vmax = computed(() => getVal('vmax', 'previewVMax'))

  const selectedLayerId = ref(null)
  watch(layers, () => { selectedLayerId.value = null }, { deep: true })

  // 平面变量范围缓存（key: `${taskId}:${plane}:${coordinate}`, value: { vmin, vmax, variableBounds }
  const planeVariableBoundsCache = ref(new Map())
  const isFetchingPlaneBounds = ref(false)

  const PREVIEW_LAYER_KINDS = ['cloud', 'contour', 'radar_cloud', 'radar_wave', 'vector']

  const currentPhysicalTime = computed(() => {
    const pts = physicalTimes.value; if (!Array.isArray(pts) || !pts.length) return null
    const idx = Math.max(0, Math.min(Number(currentStep.value) || 0, pts.length - 1))
    const pt = Number(pts[idx]); return Number.isFinite(pt) ? pt : null
  })

  const previewLayers = computed(() =>
    Array.isArray(layers.value)
      ? layers.value.filter((layer) => PREVIEW_LAYER_KINDS.includes(layer?.kind))
      : [],
  )

  function parseGeneratedLayerId(id) {
    if (!id) return null
    const parts = String(id).split(':'); const head = parts[0]
    if (head === 'cloud' && parts.length >= 5) return { plane: parts[2], coordinate: Number(parts[3]), variable: parts.slice(4).join(':') }
    if (head === 'vector' && parts.length >= 4) return { plane: parts[2], coordinate: Number(parts[3]), variable: null }
    if (head === 'volume' && parts.length >= 3) return { plane: null, coordinate: null, variable: parts.slice(2).join(':') }
    return head === 'streamline' ? { plane: null, coordinate: null, variable: null } : null
  }

  const selectedPreviewLayer = computed(() => {
    return pickPreviewLayer(
      previewLayers.value,
      selectedLayerId.value,
      PREVIEW_LAYER_KINDS,
    )
  })

  const selectedLayerPreviewUrl = computed(() => {
    return resolvePreviewFrameUrl({
      layer: selectedPreviewLayer.value,
      currentStep: currentStep.value,
      currentPhysicalTime: currentPhysicalTime.value,
      simulationTimeStep: currentSimulationTimeStep.value,
    })
  })

  function resolveLayerPhysicalDimension(layer, axis) {
    if (!layer) return null

    const layerValue =
      axis === 'width' ? layer.physicalWidth : layer.physicalHeight
    const layerNum = Number(layerValue)
    if (Number.isFinite(layerNum) && layerNum > 0) return layerNum

    const firstFrame = Array.isArray(layer.images) ? layer.images[0] : null
    const frameValue =
      axis === 'width'
        ? firstFrame?.data?.physical_width ?? firstFrame?.data?.physicalWidth
        : firstFrame?.data?.physical_height ?? firstFrame?.data?.physicalHeight
    const frameNum = Number(frameValue)
    return Number.isFinite(frameNum) && frameNum > 0 ? frameNum : null
  }

  const physicalWidth = computed(() => {
    const layerWidth = resolveLayerPhysicalDimension(
      selectedPreviewLayer.value,
      'width',
    )
    return layerWidth ?? globalPhysicalWidth.value
  })

  const physicalHeight = computed(() => {
    const layerHeight = resolveLayerPhysicalDimension(
      selectedPreviewLayer.value,
      'height',
    )
    return layerHeight ?? globalPhysicalHeight.value
  })

  const resolvedPreviewImage = computed(() => selectedLayerPreviewUrl.value || cleanPreviewUrl(previewImage.value))

  watch(
    () => [
      dimension.value,
      type2d.value,
      selectedLayerId.value,
      selectedPreviewLayer.value?.id ?? null,
      currentStep.value,
      currentPhysicalTime.value,
      selectedLayerPreviewUrl.value,
      resolvedPreviewImage.value,
      cleanPreviewUrl(previewImage.value),
    ],
    ([
      dimensionValue,
      type2dValue,
      selectedId,
      previewLayerId,
      step,
      physicalTime,
      layerUrl,
      resolvedUrl,
      fallbackUrl,
    ]) => {
      if (dimensionValue !== '2d') return
      
    },
    { immediate: true },
  )

  const thumbnailUsesSpriteSheet = computed(() => {
    if (selectedLayerPreviewUrl.value || !previewImage.value) return false
    return (Math.max(1, rows.value || 1) * Math.max(1, cols.value || 1) > 1) || (frameCount.value || 0) > 1
  })

  const spriteSheetThumbnailStyle = computed(() => {
    if (!resolvedPreviewImage.value || !rows.value || !cols.value) return {}
    const idx = (Number(currentStep.value) || 0) % (frameCount.value || 1)
    const r = Math.floor(idx / cols.value), c = idx % cols.value
    const x = cols.value > 1 ? (c / (cols.value - 1)) * 100 : 0
    const y = rows.value > 1 ? (r / (rows.value - 1)) * 100 : 0
    const asp = (physicalWidth.value && physicalHeight.value) ? physicalWidth.value / physicalHeight.value : null
    return { backgroundImage: `url(${resolvedPreviewImage.value})`, backgroundSize: `${cols.value * 100}% ${rows.value * 100}%`, backgroundPosition: `${x}% ${y}%`, backgroundRepeat: 'no-repeat', ...(asp ? { aspectRatio: String(asp), width: '100%', height: 'auto', maxHeight: '100%' } : {}) }
  })

  const thumbnailPreviewStyle = computed(() => resolvedPreviewImage.value ? (thumbnailUsesSpriteSheet.value ? spriteSheetThumbnailStyle.value : { backgroundImage: `url(${resolvedPreviewImage.value})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }) : {})

  const variableRangeFromMetadata = computed(() => visualization.value?.variable ? taskStore.getVariableRange(visualization.value.variable) : null)

  const baseVMin = computed(() => {
    const u = Number(visualization.value?.vmin); if (Number.isFinite(u)) return u
    if (type2d.value === 'vector') { const m = taskStore.getVariableRange('VelocityMagnitude'); return m?.vmin != null ? Number(m.vmin) : 0 }
    const m = variableRangeFromMetadata.value; return m?.vmin != null ? Number(m.vmin) : (Number.isFinite(Number(vmin.value)) ? Number(vmin.value) : 0)
  })

  const baseVMax = computed(() => {
    const u = Number(visualization.value?.vmax); if (Number.isFinite(u)) return u
    if (type2d.value === 'vector') { const m = taskStore.getVariableRange('VelocityMagnitude'); return m?.vmax != null ? Number(m.vmax) : 1 }
    const m = variableRangeFromMetadata.value; return m?.vmax != null ? Number(m.vmax) : (Number.isFinite(Number(vmax.value)) ? Number(vmax.value) : 100)
  })

  const previewCardParsedId = computed(() => parseGeneratedLayerId(selectedPreviewLayer.value?.id))
  const previewCardPlane = computed(() => {
    if (selectedLayerId.value && selectedPreviewLayer.value) {
      const p = previewCardParsedId.value?.plane; const pl = typeof p === 'string' ? p.toLowerCase() : ''
      if (['xy', 'xz', 'yz'].includes(pl)) return pl
    }
    return plane.value
  })
  const previewCardCoordinate = computed(() => (selectedLayerId.value && Number.isFinite(previewCardParsedId.value?.coordinate)) ? previewCardParsedId.value.coordinate : coordinate.value)
  const previewCardVMin = computed(() => (selectedLayerId.value && Number.isFinite(Number(selectedPreviewLayer.value?.vmin))) ? Number(selectedPreviewLayer.value.vmin) : baseVMin.value)
  const previewCardVMax = computed(() => (selectedLayerId.value && Number.isFinite(Number(selectedPreviewLayer.value?.vmax))) ? Number(selectedPreviewLayer.value.vmax) : baseVMax.value)

  const reset2dRange = () => {
    if (dimension.value !== '2d') return
    const target = type2d.value === 'vector' ? 'VelocityMagnitude' : visualization.value?.variable
    if (!target) return
    const r = taskStore.getVariableRange(target)
    if (r && Number.isFinite(Number(r.vmin)) && Number.isFinite(Number(r.vmax))) {
      visualization.value.vmin = Number(r.vmin); visualization.value.vmax = Number(r.vmax)
    } else if (type2d.value === 'vector') {
      visualization.value.vmin = 0; visualization.value.vmax = 1
    }
  }

  /**
   * 获取指定平面的全时间变量范围
   * @param {string} taskId - 任务ID
   * @param {string} planeType - 平面类型 (xy, xz, yz)
   * @param {number} planeOffset - 平面偏移量 (cm)
   * @param {boolean} [usePregen] - 是否使用预生成数据
   * @returns {Promise<Object>} - { vmin, vmax, variableBounds, aligned_plane_offset }
   */
  const fetchPlaneVariableBounds = async (taskId, planeType, planeOffset, usePregen) => {
    if (!taskId || !planeType || !Number.isFinite(planeOffset)) {
      return null
    }

    const cacheKey = `${taskId}:${planeType}:${planeOffset}:${usePregen ?? 'default'}`

    // 检查缓存
    if (planeVariableBoundsCache.value.has(cacheKey)) {
      return planeVariableBoundsCache.value.get(cacheKey)
    }

    isFetchingPlaneBounds.value = true
    try {
      const response = await postProcessingApi.getPlaneVariableBounds({
        task_id: taskId,
        plane_type: planeType.toUpperCase(),
        plane_offset: planeOffset,
        use_pregen: usePregen,
      })

      // 解析响应数据
      const data = response?.data || response
      const variableBounds = data?.variable_bounds || []
      const alignedPlaneOffset = data?.aligned_plane_offset

      // 计算所有变量的全局 vmin/vmax
      let globalVMin = Infinity
      let globalVMax = -Infinity
      variableBounds.forEach((vb) => {
        if (Number.isFinite(vb.vmin)) globalVMin = Math.min(globalVMin, vb.vmin)
        if (Number.isFinite(vb.vmax)) globalVMax = Math.max(globalVMax, vb.vmax)
      })

      const result = {
        vmin: Number.isFinite(globalVMin) ? globalVMin : 0,
        vmax: Number.isFinite(globalVMax) ? globalVMax : 100,
        variableBounds,
        alignedPlaneOffset,
      }

      // 存入缓存
      planeVariableBoundsCache.value.set(cacheKey, result)
      return result
    } catch (error) {
      console.error('获取平面变量范围失败:', error)
      return null
    } finally {
      isFetchingPlaneBounds.value = false
    }
  }

  /**
   * 获取指定变量的范围
   * @param {string} taskId - 任务ID
   * @param {string} planeType - 平面类型
   * @param {number} planeOffset - 平面偏移量
   * @param {string} variable - 变量名
   * @param {boolean} [usePregen] - 是否使用预生成数据
   * @returns {Promise<{vmin: number, vmax: number}|null>}
   */
  const getVariableBoundsForPlane = async (taskId, planeType, planeOffset, variable, usePregen) => {
    const bounds = await fetchPlaneVariableBounds(taskId, planeType, planeOffset, usePregen)
    if (!bounds?.variableBounds) return null

    const vb = bounds.variableBounds.find((v) => v.variable === variable)
    if (vb && Number.isFinite(vb.vmin) && Number.isFinite(vb.vmax)) {
      return { vmin: vb.vmin, vmax: vb.vmax }
    }

    // 如果没有找到特定变量，返回全局范围
    return { vmin: bounds.vmin, vmax: bounds.vmax }
  }

  return {
    selectedLayerId, currentPhysicalTime, previewLayers, selectedPreviewLayer, selectedLayerPreviewUrl,
    resolvedPreviewImage, thumbnailUsesSpriteSheet, thumbnailPreviewStyle,
    previewCardPlane, previewCardCoordinate, previewCardVMin, previewCardVMax, reset2dRange,
    fetchPlaneVariableBounds, getVariableBoundsForPlane, isFetchingPlaneBounds, planeVariableBoundsCache,
  }
}
