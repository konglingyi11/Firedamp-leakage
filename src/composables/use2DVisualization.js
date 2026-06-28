import { ref } from 'vue'
import { resolveColormapColors } from '@/utils/volumeColormap.js'

const QUALITY_2D_FIXED = '2k'
const MAX_2D_TIME_STEPS_FOR_UE = 30

const CMAP_MAP = {
  default: 'coolwarm',
  thermal: 'hot',
  speed: 'viridis',
  multicolor: 'jet',
  grayscale: 'gray',
}

/**
 * 2D 云图/矢量图参数构造 + UE 发送
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.playerRef
 * @param {import('vue').Ref} deps.currentTask
 * @param {import('vue').Ref} deps.visualization
 * @param {import('vue').Ref} deps.visualization2DType
 * @param {import('vue').Ref} deps.selectedPlane
 * @param {import('vue').Ref} deps.planeCoordinate
 * @param {Object} deps.layers - useGeneratedLayers 返回值（buildGeneratedLayerId, buildGeneratedLayerLabel）
 * @param {import('vue').Ref<Array<{ id: string, name?: string, colors?: string[], color_map_url?: string }>>} [deps.colorMapCatalog]
 */
export function use2DVisualization({
  playerRef,
  currentTask,
  visualization,
  visualization2DType,
  selectedPlane,
  planeCoordinate,
  layers,
  colorMapCatalog,
}) {
  const latest2DVMin = ref(null)
  const latest2DVMax = ref(null)

  function resolveSelectedCmap() {
    if (visualization.value.colorScheme === 'custom') {
      return visualization.value.customColormap || 'coolwarm'
    }
    return CMAP_MAP[visualization.value.colorScheme] || 'coolwarm'
  }

  /**
   * 云图：使用当前变量在 gasCmaps 中的色带（与气体列表 UI 一致），与全局 colorScheme 对齐。
   * 能解析出颜色数组时只返回 custom_colors，由调用方传给后端且不再传 cmap；无法解析时再回落 cmap 名称。
   * @returns {{ custom_colors?: string[], cmap?: string } | { cmap: string, custom_colors: null }}
   */
  /**
   * @param {string} [overrideVarId] - 云图多变量时按该 id 查 gasCmaps，不传则用 visualization.variable
   */
  function resolveContourColormapParams(overrideVarId) {
    if (visualization2DType.value !== 'cloud') {
      return { cmap: resolveSelectedCmap(), custom_colors: null }
    }
    const varId =
      typeof overrideVarId === 'string' && overrideVarId.trim() !== ''
        ? overrideVarId.trim()
        : visualization.value.variable || 'VelocityMagnitude'
    const gasScheme = visualization.value.gasCmaps?.[varId]
    const scheme = gasScheme ?? visualization.value.colorScheme ?? 'default'
    const cat = colorMapCatalog?.value

    const colors = resolveColormapColors(
      scheme,
      visualization.value.manualColors,
      cat,
    )
    if (Array.isArray(colors) && colors.length > 0) {
      return { custom_colors: colors }
    }

    const fallbackCmap =
      gasScheme != null &&
      gasScheme !== '' &&
      CMAP_MAP[gasScheme] !== undefined
        ? CMAP_MAP[gasScheme]
        : resolveSelectedCmap()
    return { cmap: fallbackCmap, custom_colors: null }
  }

  /**
   * 云图请求体：有 custom_colors 时只带颜色数组，不传 cmap（与后端约定一致）。
   */
  function applyContourColormapToPayload(payload, cc) {
    if (!payload || !cc) return
    delete payload.cmap
    delete payload.custom_colors
    if (Array.isArray(cc.custom_colors) && cc.custom_colors.length > 0) {
      payload.custom_colors = cc.custom_colors
    } else if (cc.cmap != null && cc.cmap !== '') {
      payload.cmap = cc.cmap
    }
  }

  /**
   * @param {number[]|*} timeStepArray
   * @param {{ contourVariable?: string }} [opts]
   */
  function build2DParamsForUE(timeStepArray, opts = {}) {
    const taskId = currentTask.value?.id
    if (!taskId) return null

    const rawSteps = Array.isArray(timeStepArray)
      ? timeStepArray
      : timeStepArray != null
        ? [timeStepArray]
        : []
    let steps = rawSteps.map((t) => Number(t)).filter((t) => Number.isFinite(t))
    // UE 不接受 time_step=0，过滤掉
    steps = steps.filter((t) => t !== 0)
    if (steps.length === 0) return null

    const payload = {
      task_id: taskId,
      plane_type: selectedPlane.value.toLowerCase(),
      plane_offset: planeCoordinate.value,
      time_step: steps,
      quality: QUALITY_2D_FIXED,
      use_pregen: visualization.value.usePregen ?? true,
    }

    const userVMinNum = Number(visualization.value.vmin)
    const userVMaxNum = Number(visualization.value.vmax)
    const latestVMinNum = Number(latest2DVMin.value)
    const latestVMaxNum = Number(latest2DVMax.value)
    const resolvedVMin = Number.isFinite(userVMinNum)
      ? userVMinNum
      : Number.isFinite(latestVMinNum)
        ? latestVMinNum
        : null
    const resolvedVMax = Number.isFinite(userVMaxNum)
      ? userVMaxNum
      : Number.isFinite(latestVMaxNum)
        ? latestVMaxNum
        : null
    if (Number.isFinite(resolvedVMin)) payload.vmin = resolvedVMin
    if (Number.isFinite(resolvedVMax)) payload.vmax = resolvedVMax

    if (visualization2DType.value === 'cloud') {
      const contourVar =
        typeof opts.contourVariable === 'string' &&
        opts.contourVariable.trim() !== ''
          ? opts.contourVariable.trim()
          : visualization.value.variable || 'VelocityMagnitude'
      payload.variable = contourVar
      applyContourColormapToPayload(
        payload,
        resolveContourColormapParams(contourVar),
      )
      payload.id = layers.buildGeneratedLayerId('contour', {
        variable: contourVar,
      })
      payload.name = layers.buildGeneratedLayerLabel('contour', {
        variable: contourVar,
      })
      payload.kind = 'contour'
    } else {
      payload.color = visualization.value.vectorColor || '#ffffff'
      payload.id = layers.buildGeneratedLayerId('vector')
      payload.name = layers.buildGeneratedLayerLabel('vector')
      payload.kind = 'vector'
    }
    return payload
  }

  function send2DParamsToUE(timeStepArray) {
    const normalizedTimeSteps = Array.isArray(timeStepArray)
      ? timeStepArray
          .map((t) => Number(t))
          .filter((t) => Number.isFinite(t) && t !== 0)
      : []
    if (normalizedTimeSteps.length === 0) {
      console.warn(
        '[应用设置] 跳过发送 2D 参数：time_step 为空（未获取到接口时间步）',
      )
      return
    }
    const stepsForUE = normalizedTimeSteps.slice(0, MAX_2D_TIME_STEPS_FOR_UE)
    const payload = build2DParamsForUE(stepsForUE)
    if (!payload || !playerRef.value) return
    if (
      visualization2DType.value === 'cloud' ||
      visualization2DType.value === 'vector'
    ) {
      
      return
    }
  }

  return {
    QUALITY_2D_FIXED,
    MAX_2D_TIME_STEPS_FOR_UE,
    latest2DVMin,
    latest2DVMax,
    resolveSelectedCmap,
    resolveContourColormapParams,
    applyContourColormapToPayload,
    build2DParamsForUE,
    send2DParamsToUE,
  }
}
