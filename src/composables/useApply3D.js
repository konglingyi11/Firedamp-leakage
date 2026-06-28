import postProcessingApi from '@/api/postProcessing'
import {
  buildFullVolumeDatasetCachePayload,
  getFullVolumeDatasetCacheKeys,
} from '@/utils/volumeDatasetCache.js'
import { ElMessage } from 'element-plus'
import { useTaskStore } from '@/stores/task'
import {
  buildRadarVolumeMockApiChunk,
  extractRadarMockVolumeBandId,
  isRadarMockVolumeVariableId,
} from '@/utils/mockRadarVolume3d.js'

function shouldAutoShowVolumeLayerAfterApply(varId, { apiVolumeVars, radarOnly }) {
  if (isRadarMockVolumeVariableId(varId)) {
    return radarOnly
  }
  if (apiVolumeVars.length > 0) {
    return apiVolumeVars.some(
      (id) => String(id).toLowerCase() === String(varId).toLowerCase(),
    )
  }
  return true
}

function resolvePreferredVolumeLayerAfterApply(
  apiVolumeVars,
  hasRadarMockVolume,
  layers,
) {
  if (!Array.isArray(layers)) return null

  if (apiVolumeVars.length > 0) {
    const primaryVar = apiVolumeVars[0]
    const gasLayer =
      layers.find(
        (layer) =>
          layer?.kind === 'volume' &&
          !isRadarMockVolumeVariableId(layer.variable) &&
          layer.visible !== false &&
          String(layer.variable).toLowerCase() ===
            String(primaryVar).toLowerCase(),
      ) ??
      layers.find(
        (layer) =>
          layer?.kind === 'volume' &&
          !isRadarMockVolumeVariableId(layer.variable) &&
          layer.visible !== false,
      )
    if (gasLayer) return gasLayer
  }

  if (hasRadarMockVolume) {
    return (
      layers.find(
        (layer) =>
          layer?.kind === 'volume' &&
          isRadarMockVolumeVariableId(layer.variable) &&
          layer.visible !== false,
      ) ?? null
    )
  }

  return null
}

/**
 * 3D 可视化应用逻辑（体渲染 / 流线）
 */
export function useApply3D(options) {
  const {
    visualization3DType,
    visualization,
    isBatchLoading,
    batchLoadingText,
    batchLoadProgress,
    batchLoadCurrent,
    batchLoadTotal,
    hasAppliedSettings,
    timelineCurrentStep,
    timelineTimeSteps,
    timelinePhysicalTimes,
    timelineTotalSteps,
    previewFrameCount,
    postProcessingTimeStepsTaskId,
    currentTask,
    playerRef,
    ueMsg,
    generatedVizLayers,
  } = options.refs

  const {
    listVolumeVariableIdsForUE,
    buildVolumeTextureParamsForUE,
    buildStreamlineApiParams,
    buildStreamlineUeParams,
    upsertGeneratedVizLayer,
    extractVolumeUrlsFromChunk,
    buildVolumeTextureChunkUePayload,
    resolveSimulationTimeStepAtSlideIndex,
    sendVizLayerVisibilityToUE,
    syncSelectedGeneratedLayerAfterBatch,
  } = options.methods

  const taskStore = useTaskStore()

  function parseValidTimeSteps(rawSteps) {
    return (Array.isArray(rawSteps) ? rawSteps : [])
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => Number.isFinite(Number(step)))
  }

  async function ensureVolumeTimeStepsFromApi() {
    const taskId = currentTask.value?.id
    if (!taskId) return []

    const res = await postProcessingApi.getTaskTimeSteps(taskId)
    const rawSteps = res.data?.time_steps || res.time_steps || []
    const physicalTimes = res.data?.physical_times || res.physical_times || []
    const validStepEntries = parseValidTimeSteps(rawSteps)

    if (validStepEntries.length === 0) {
      throw new Error('时间步接口没有返回有效时间步')
    }

    const steps = validStepEntries.map(({ step }) => step)
    const hasPhysicalTimes =
      Array.isArray(physicalTimes) && physicalTimes.length === rawSteps.length
    const validPhysicalTimes = hasPhysicalTimes
      ? validStepEntries.map(({ index }) => physicalTimes[index])
      : steps

    timelineTimeSteps.value = steps
    timelinePhysicalTimes.value = validPhysicalTimes
    timelineTotalSteps.value = steps.length - 1
    previewFrameCount.value = steps.length
    postProcessingTimeStepsTaskId.value = taskId
    return steps
  }

  function resolveApiVminVmax(payload) {
    const range =
      Array.isArray(payload?.original_value_range)
        ? payload.original_value_range
        : Array.isArray(payload?.value_range)
          ? payload.value_range
          : Array.isArray(payload?.valueRange)
            ? payload.valueRange
            : []
    const vmin = Number(
      payload?.val_min ??
        payload?.vmin ??
        payload?.minValue ??
        payload?.min_value ??
        payload?.min ??
        range[0],
    )
    const vmax = Number(
      payload?.val_max ??
        payload?.vmax ??
        payload?.maxValue ??
        payload?.max_value ??
        payload?.max ??
        range[1],
    )
    return {
      vmin: Number.isFinite(vmin) ? vmin : null,
      vmax: Number.isFinite(vmax) ? vmax : null,
    }
  }

  function buildOriginalValueRange(globalRange, apiRange, payload) {
    const candidates = [
      [globalRange?.vmin, globalRange?.vmax],
      [apiRange?.vmin, apiRange?.vmax],
      Array.isArray(payload?.original_value_range)
        ? payload.original_value_range
        : null,
      Array.isArray(payload?.value_range) ? payload.value_range : null,
      Array.isArray(payload?.valueRange) ? payload.valueRange : null,
    ]
    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || candidate.length < 2) continue
      const vmin = Number(candidate[0])
      const vmax = Number(candidate[1])
      if (Number.isFinite(vmin) && Number.isFinite(vmax) && vmax > vmin) {
        return [vmin, vmax]
      }
    }
    return null
  }

  /** 从 metadata 获取变量的全局值域，优先于 API 返回的局部值域 */
  function resolveGlobalVminVmax(variable, fallbackVmin, fallbackVmax) {
    if (!variable) return { vmin: fallbackVmin, vmax: fallbackVmax }
    const metaRange = taskStore.getVariableRange(variable)
    if (metaRange && metaRange.vmin != null && metaRange.vmax != null) {
      return { vmin: Number(metaRange.vmin), vmax: Number(metaRange.vmax) }
    }
    return { vmin: fallbackVmin, vmax: fallbackVmax }
  }

  async function apply3D() {
    isBatchLoading.value = true
    batchLoadingText.value = '正在应用 3D 可视化设置...'
    batchLoadProgress.value = 0

    try {
      if (visualization3DType.value === 'volume') {
        await applyVolume()
      } else if (visualization3DType.value === 'streamline') {
        await applyStreamline()
      }
      hasAppliedSettings.value = true
    } catch (error) {
      console.error('3D visualization application failed:', error)
      ElMessage.error('应用 3D 设置失败: ' + (error.message || '未知错误'))
    } finally {
      isBatchLoading.value = false
      batchLoadProgress.value = 100
    }
  }

  async function applyVolume() {
    const volumeVars = listVolumeVariableIdsForUE()
    if (!volumeVars.length) return

    const apiVolumeVars = volumeVars.filter((id) => !isRadarMockVolumeVariableId(id))
    const hasRadarMockVolume = volumeVars.some((id) =>
      isRadarMockVolumeVariableId(id),
    )
    const radarOnly =
      hasRadarMockVolume && apiVolumeVars.length === 0
    const autoShowContext = { apiVolumeVars, radarOnly }

    if (apiVolumeVars.length > 0 && !currentTask.value?.id) {
      ElMessage.warning('已勾选气体体变量，需要当前任务才能请求体数据接口；请先选择任务。')
      return
    }
    if (radarOnly && !currentTask.value?.id) {
      ElMessage.warning('已选雷达体变量，需要当前任务以加载真实仿真时间步；请先选择任务。')
      return
    }

    await ensureVolumeTimeStepsFromApi()

    /** 存在气体体时，锚点必须用气体变量，避免 task_id / 分辨率等与 getVolumeDataset 不一致 */
    const paramsAnchorVar =
      apiVolumeVars.length > 0 ? apiVolumeVars[0] : volumeVars[0]
    const firstParams = buildVolumeTextureParamsForUE(null, paramsAnchorVar)
    if (!firstParams) return
    const allTimeSteps = firstParams.time_step
    if (!allTimeSteps.length) return

    const radarVolChunks = new Map()
    volumeVars
      .filter((id) => isRadarMockVolumeVariableId(id))
      .forEach((varId) => {
        radarVolChunks.set(
          varId,
          buildRadarVolumeMockApiChunk({
            visualization: visualization?.value ?? visualization,
            taskId: currentTask.value?.id,
            timeSteps: allTimeSteps,
            radarBandId: extractRadarMockVolumeBandId(varId),
          }),
        )
      })

    volumeVars.forEach((varId) => {
      const params = buildVolumeTextureParamsForUE(null, varId)
      if (!params) return
      const radarVol = isRadarMockVolumeVariableId(varId)
      const shouldShow = shouldAutoShowVolumeLayerAfterApply(varId, autoShowContext)
      upsertGeneratedVizLayer({
        id: params.id,
        kind: 'volume',
        label: params.name + ' (加载中...)',
        variable: varId,
        visible: shouldShow,
        ready: true,
        loaded: false,
        isMock: radarVol,
        usePregen: firstParams.use_pregen,
        loadSource: 'manual',
      })
    })

    batchLoadCurrent.value = 0
    batchLoadTotal.value = 1
    batchLoadingText.value =
      apiVolumeVars.length > 0 && hasRadarMockVolume
        ? '正在加载气体体渲染并生成雷达体…'
        : apiVolumeVars.length > 0
          ? '正在加载体渲染…'
          : '正在生成雷达体…'
    batchLoadProgress.value = 30

    let mergedApiData = null
    if (apiVolumeVars.length > 0) {
      const requestPayload = {
        task_id: firstParams.task_id,
        time_step: allTimeSteps,
        variables: apiVolumeVars,
        use_pregen: firstParams.use_pregen,
      }
      if (firstParams.resolution !== undefined) {
        requestPayload.resolution = firstParams.resolution
      }
      if (firstParams.sampling_ratio !== undefined) {
        requestPayload.sampling_ratio = firstParams.sampling_ratio
      }

      const res = await postProcessingApi.getVolumeDataset(requestPayload)
      mergedApiData = res.data || res
    }

    if (mergedApiData && apiVolumeVars.length > 0) {
      const currentSimStep = resolveSimulationTimeStepAtSlideIndex(
        timelineCurrentStep.value,
      )
      playerRef.value?.cacheVolumePayload?.(
        buildFullVolumeDatasetCachePayload(mergedApiData, {
          taskId: firstParams.task_id,
          timeSteps: allTimeSteps,
          variables: apiVolumeVars,
          usePregen: firstParams.use_pregen,
          loadSource: 'manual',
        }),
        getFullVolumeDatasetCacheKeys(firstParams.task_id),
        currentSimStep,
      )
    }

    batchLoadProgress.value = 80

    for (let i = 0; i < volumeVars.length; i++) {
      const varId = volumeVars[i]

      if (!playerRef.value) continue
      const chunkData =
        isRadarMockVolumeVariableId(varId)
          ? radarVolChunks.get(varId) ?? null
          : mergedApiData
      if (!chunkData) continue

      const payload = buildVolumeTextureChunkUePayload(
        varId,
        allTimeSteps,
        [],
        [],
        [],
        chunkData,
      )
      if (!payload) continue
      payload.use_pregen = firstParams.use_pregen
      payload.loadSource = 'manual'
      payload.local_id = payload.id
      payload.layer_id = payload.id
      if (
        Array.isArray(mergedApiData?.datasets) &&
        mergedApiData.datasets.length > 0
      ) {
        payload.datasets = mergedApiData.datasets
      }

      const resolvedVar = payload.variable ?? varId
      const currentSimStep = resolveSimulationTimeStepAtSlideIndex(
        timelineCurrentStep.value,
      )
      playerRef.value?.cacheVolumePayload?.(
        payload,
        [payload.id, resolvedVar, `volume:${firstParams.task_id}:${resolvedVar}`],
        currentSimStep,
      )

      const apiRange = resolveApiVminVmax(payload)
      const globalRange = resolveGlobalVminVmax(
        resolvedVar,
        apiRange.vmin,
        apiRange.vmax,
      )
      const radarVol = isRadarMockVolumeVariableId(varId)
      const shouldShow = shouldAutoShowVolumeLayerAfterApply(varId, autoShowContext)
      upsertGeneratedVizLayer({
        id: payload.id,
        kind: 'volume',
        label: payload.name,
        vmin: globalRange.vmin,
        vmax: globalRange.vmax,
        original_value_range: buildOriginalValueRange(
          globalRange,
          apiRange,
          payload,
        ),
        variable: resolvedVar,
        cmap: payload.cmap,
        custom_colors: payload.custom_colors,
        visible: shouldShow,
        ready: true,
        loaded: true,
        isMock: radarVol,
        usePregen: firstParams.use_pregen,
        loadSource: 'manual',
      })

      ueMsg.updateCloudTexture(payload)
      sendVizLayerVisibilityToUE?.({
        id: payload.id,
        kind: 'volume',
        label: payload.name,
        visible: shouldShow,
      })
    }
    batchLoadProgress.value = 100

    const visibleVolumeLayers = (generatedVizLayers?.value || []).filter(
      (layer) => layer?.kind === 'volume' && layer?.visible !== false,
    )
    if (visibleVolumeLayers.length > 0) {
      batchLoadingText.value = '正在缓存体渲染所有时间步...'
      batchLoadProgress.value = 95
      for (const layer of visibleVolumeLayers) {
        try {
          await playerRef.value?.preloadVolumeLayer?.(layer)
        } catch (error) {
          console.warn('[ApplyVolume] 体渲染时间步预加载失败:', error)
        }
      }
    }

    const preferredLayer = resolvePreferredVolumeLayerAfterApply(
      apiVolumeVars,
      hasRadarMockVolume,
      generatedVizLayers?.value,
    )
    if (preferredLayer) {
      syncSelectedGeneratedLayerAfterBatch?.(preferredLayer)
    }
  }

  async function loadVolumeLayer(varId, options = {}) {
    if (isRadarMockVolumeVariableId(varId)) {
      if (
        !Array.isArray(timelineTimeSteps.value) ||
        timelineTimeSteps.value.length === 0
      ) {
        if (!currentTask.value?.id) return false
        await ensureVolumeTimeStepsFromApi()
      }
    } else {
      await ensureVolumeTimeStepsFromApi()
    }
    const params = buildVolumeTextureParamsForUE(null, varId)
    if (!params) return false

    const totalSteps = params.time_step.length
    const progressBase = Number(options.progressBase) || 0
    const progressSpan = Number(options.progressSpan) || 1

    batchLoadingText.value = `正在加载变量 [${varId}]...`
    batchLoadProgress.value = Math.round((progressBase + 0.5 * progressSpan) * 100)

    let data = null
    if (isRadarMockVolumeVariableId(varId)) {
      data = buildRadarVolumeMockApiChunk({
        visualization: visualization?.value ?? visualization,
        taskId: currentTask.value?.id,
        timeSteps: params.time_step,
        radarBandId: extractRadarMockVolumeBandId(varId),
      })
    } else {
      const requestPayload = {
        task_id: params.task_id,
        time_step: params.time_step,
        variables: [varId],
        use_pregen: params.use_pregen,
      }
      if (params.resolution !== undefined) {
        requestPayload.resolution = params.resolution
      }
      if (params.sampling_ratio !== undefined) {
        requestPayload.sampling_ratio = params.sampling_ratio
      }

      const res = await postProcessingApi.getVolumeDataset(requestPayload)
      data = res.data || res
    }

    batchLoadProgress.value = Math.round((progressBase + progressSpan) * 100)

    if (playerRef.value) {
      const payload = buildVolumeTextureChunkUePayload(
        varId,
        params.time_step,
        [],
        [],
        [],
        data,
      )
      if (payload) {
        payload.use_pregen = params.use_pregen
        payload.loadSource = 'manual'
        playerRef.value?.cacheVolumePayload?.(payload)

        const resolvedVar = payload.variable ?? varId
        const apiRange = resolveApiVminVmax(payload)
        const globalRange = resolveGlobalVminVmax(
          resolvedVar,
          apiRange.vmin,
          apiRange.vmax,
        )
        const shouldShow =
          options.visible !== undefined
            ? Boolean(options.visible)
            : !isRadarMockVolumeVariableId(varId)
        upsertGeneratedVizLayer({
          id: payload.id,
          kind: 'volume',
          label: payload.name,
          vmin: globalRange.vmin,
          vmax: globalRange.vmax,
          original_value_range: buildOriginalValueRange(
            globalRange,
            apiRange,
            payload,
          ),
          variable: resolvedVar,
          cmap: payload.cmap,
          custom_colors: payload.custom_colors,
          visible: shouldShow,
          ready: true,
          loaded: true,
          isMock: isRadarMockVolumeVariableId(varId),
          usePregen: params.use_pregen,
          loadSource: 'manual',
        })
        ueMsg.updateCloudTexture(payload)
        sendVizLayerVisibilityToUE?.({
          id: payload.id,
          kind: 'volume',
          label: payload.name,
          visible: shouldShow,
        })
      }
    }

    return true
  }

  async function applyStreamline() {
    const CHUNK_SIZE = 30

    // 获取所有时间步
    const steps = timelineTimeSteps.value || []
    if (steps.length === 0) {
      ElMessage.warning('没有可用的时间步用于生成流线图')
      return
    }

    const totalSteps = steps.length
    const totalChunks = Math.ceil(totalSteps / CHUNK_SIZE)

    batchLoadingText.value = '正在请求流线数据...'
    batchLoadCurrent.value = 0
    batchLoadTotal.value = totalChunks
    batchLoadProgress.value = 0

    // 先清空之前的流线（直接操作 Three.js，不走 UE）
    if (playerRef.value?.clearStreamlinePayload) {
      playerRef.value.clearStreamlinePayload()
    }

    const chunkResults = []

    // 分批请求
    for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
      const start = cIdx * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, totalSteps)
      const chunkSteps = steps.slice(start, end)

      batchLoadingText.value = `正在加载流线数据 (${cIdx + 1}/${totalChunks})...`

      const apiParams = buildStreamlineApiParams(chunkSteps)
      

      try {
        const res = await postProcessingApi.generateStreamline(apiParams)
        const data = res.data || res

        let csvUrls = []
        if (Array.isArray(data?.csv_urls)) {
          csvUrls = data.csv_urls
        } else if (typeof data?.csv_url === 'string') {
          csvUrls = [data.csv_url]
        }

        chunkResults.push({
          cIdx,
          chunkSteps,
          csvUrls: csvUrls.map((u) => (typeof u === 'string' ? u.replace(/[`\s]/g, '') : u)).filter(Boolean),
        })

        batchLoadCurrent.value = cIdx + 1
        batchLoadProgress.value = Math.round(((cIdx + 1) / totalChunks) * 100)
      } catch (error) {
        console.error(`[流线图] 批次 ${cIdx + 1}/${totalChunks} 请求失败:`, error)
        ElMessage.warning(`部分流线数据加载失败 (${cIdx + 1}/${totalChunks})`)
      }
    }

    // 获取当前显示的时间步
    const displaySimStep = resolveSimulationTimeStepAtSlideIndex(timelineCurrentStep.value)

    // 直接设置流线数据到 Three.js（不走 UE）
    if (playerRef.value?.setStreamlinePayload && chunkResults.length > 0) {
      // 合并所有批次的 CSV URLs
      const allCsvUrls = chunkResults.flatMap((r) => r.csvUrls).filter(Boolean)
      const allChunkSteps = chunkResults.flatMap((r) => r.chunkSteps)

      if (allCsvUrls.length > 0) {
        const payload = buildStreamlineUeParams(displaySimStep, {
          csv_urls: allCsvUrls,
          csv_time_steps: allChunkSteps,
        })

        if (payload) {
          playerRef.value.setStreamlinePayload(payload)
          
        }
      }

      // 注册流线图层
      upsertGeneratedVizLayer({
        id: `streamline:${currentTask.value?.id}`,
        kind: 'streamline',
        label: '流线图',
        visible: true,
        ready: true,
        loaded: true,
      })
    }

    batchLoadProgress.value = 100
  }

  return { apply3D, loadVolumeLayer }
}
