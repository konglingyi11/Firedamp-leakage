import { ref, watch, nextTick } from 'vue'
import taskApi from '@/api/task.js'
import postProcessingApi from '@/api/postProcessing.js'
import { useTaskStore } from '@/stores/task.js'
import { ElMessage, ElLoading } from 'element-plus'
import {
  sanitizeVectorQualityPreset,
  sanitizeVectorTransparentBackground,
  sanitizeGlyphDensity,
  sanitizeVectorLineWidth,
} from '@/utils/sanitize'
import { buildRadarMockVolumeVariableId } from '@/utils/mockRadarVolume3d.js'

function extractTaskListItems(res) {
  if (Array.isArray(res?.items)) return res.items
  if (Array.isArray(res?.data?.items)) return res.data.items
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.data)) return res.data
  return []
}

function getTaskLatestTime(task) {
  const raw =
    task?.created_at ??
    task?.createdAt ??
    task?.updated_at ??
    task?.updatedAt ??
    task?.completed_at ??
    task?.completedAt ??
    task?.started_at ??
    task?.startedAt
  const time = Date.parse(raw)
  return Number.isFinite(time) ? time : 0
}

export function useHomeBatchLoader(options = {}) {
  const {
    getCurrentTask = () => null,
    getVisualization = () => ({}),
    getSelectedPlane = () => 'xy',
    getPlaneCoordinate = () => 0,
    getVisualization2DType = () => 'cloud',
    getTimelineTimeSteps = () => [],
    getTimelinePhysicalTimes = () => [],
    getGeneratedVizLayers = () => [],
    setTimelineTimeSteps = () => {},
    setTimelinePhysicalTimes = () => {},
    setTimelineTotalSteps = () => {},
    setPreviewFrameCount = () => {},
    setPreviewImageUrl = () => {},
    setPreviewPhysicalWidth = () => {},
    setPreviewPhysicalHeight = () => {},
    setPreviewGeometricCenter = () => {},
    setBatchLoading = () => {},
    setBatchLoadProgress = () => {},
    setBatchLoadCurrent = () => {},
    setBatchLoadTotal = () => {},
    setBatchLoadedImages = () => {},
    setPreviewLayout = () => {},
    listCloudContourVariableIds = () => [],
    buildGeneratedLayerId = () => '',
    registerGeneratedLayer = () => {},
    applyContourColormapToPayload = () => {},
    resolveContourColormapParams = () => null,
    displayUrlForCachedFrame = () => '',
    onFrameLoaded = null,
    onLayerRegistered = null,
    onBatchComplete = null,
  } = options

  const taskStore = useTaskStore()
  const metadataLoadingTaskIds = new Set()

  async function ensureTaskMetadataCached(taskId, context = 'metadata') {
    if (!taskId) return
    if (metadataLoadingTaskIds.has(taskId)) return
    metadataLoadingTaskIds.add(taskId)
    try {
      await taskStore.fetchTaskMetadata(taskId)
    } catch (error) {
      console.warn(`[${context}] metadata load failed:`, error)
    } finally {
      metadataLoadingTaskIds.delete(taskId)
    }
  }

  async function getLatestTaskFromList() {
    const res = await taskApi.getTasks({ page: 1, page_size: 10 })
    const tasks = extractTaskListItems(res)
    if (!tasks.length) return null

    return [...tasks].sort((a, b) => getTaskLatestTime(b) - getTaskLatestTime(a))[0]
  }

  async function batchLoadTimeSteps(timeSteps, batchSize = 10, physicalTimes = []) {
    const currentTask = getCurrentTask()
    if (!currentTask?.id) {
      ElMessage.error('请先选择任务')
      return
    }

    setBatchLoading(true)
    setBatchLoadProgress(0)
    setBatchLoadCurrent(0)

    const allValidTimeSteps = (Array.isArray(timeSteps) ? timeSteps : [])
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => Number.isFinite(Number(t)) && Number(t) !== 0)
      .map(({ i }) => timeSteps[i])

    if (allValidTimeSteps.length === 0) {
      setBatchLoading(false)
      ElMessage.warning('时间步为空或无效')
      return
    }

    const hasPhysical =
      Array.isArray(physicalTimes) && physicalTimes.length === timeSteps.length
    const allPhysicalTimes = hasPhysical
      ? allValidTimeSteps.map((_, i) => physicalTimes[i])
      : []
    const effectivePhysicalTimes =
      allPhysicalTimes.length > 0 ? allPhysicalTimes : allValidTimeSteps

    const visualization2DType = getVisualization2DType()

    const cloudContourVarIdsForBatch =
      visualization2DType === 'cloud' ? listCloudContourVariableIds() : []
    const primaryContourVarForBatch =
      cloudContourVarIdsForBatch.length > 0 ? cloudContourVarIdsForBatch[0] : null
    const total =
      visualization2DType === 'cloud' && cloudContourVarIdsForBatch.length > 1
        ? allValidTimeSteps.length * cloudContourVarIdsForBatch.length
        : allValidTimeSteps.length
    setBatchLoadTotal(total)

    const loadedImages = []
    setBatchLoadedImages(loadedImages)

    setTimelineTimeSteps(allValidTimeSteps)
    setTimelinePhysicalTimes(effectivePhysicalTimes)
    setTimelineTotalSteps(allValidTimeSteps.length - 1)
    setPreviewFrameCount(allValidTimeSteps.length)

    const errorState = createErrorState()
    const processedLayerIds = []

    if (visualization2DType === 'cloud') {
      await batchLoadCloudContours(
        allValidTimeSteps,
        cloudContourVarIdsForBatch,
        primaryContourVarForBatch,
        batchSize,
        effectivePhysicalTimes,
        loadedImages,
        errorState,
        processedLayerIds,
      )
    } else {
      await batchLoadVectors(
        allValidTimeSteps,
        batchSize,
        effectivePhysicalTimes,
        loadedImages,
        errorState,
        processedLayerIds,
      )
    }

    setBatchLoading(false)

    loadedImages.sort((a, b) => Number(a.time_step) - Number(b.time_step))

    if (typeof onBatchComplete === 'function') {
      onBatchComplete({
        loadedImages,
        hasError: errorState.hasError,
        errorCount: errorState.errorCount,
        effectivePhysicalTimes,
        layerIds: processedLayerIds,
        visualization2DType,
      })
    }

    if (loadedImages.length > 0) {
      const successRate = Math.round(
        (loadedImages.length / allValidTimeSteps.length) * 100,
      )

      if (errorState.hasError) {
        ElMessage.warning(
          `批量加载完成，成功 ${loadedImages.length}/${allValidTimeSteps.length} (${successRate}%)，部分失败`,
        )
      } else {
        ElMessage.success(
          `批量加载完成，成功加载 ${loadedImages.length}/${allValidTimeSteps.length} 张图片`,
        )
      }

      const firstImage = loadedImages[0]
      const newUrl = displayUrlForCachedFrame(firstImage)
      if (newUrl) {
        setPreviewImageUrl(newUrl)
        setPreviewLayout(1, 1)
        const physicalWidthNum = Number(
          firstImage?.data?.physical_width ?? firstImage?.data?.physicalWidth,
        )
        const physicalHeightNum = Number(
          firstImage?.data?.physical_height ?? firstImage?.data?.physicalHeight,
        )
        if (Number.isFinite(physicalWidthNum) && physicalWidthNum > 0) {
          setPreviewPhysicalWidth(physicalWidthNum)
        }
        if (Number.isFinite(physicalHeightNum) && physicalHeightNum > 0) {
          setPreviewPhysicalHeight(physicalHeightNum)
        }
        if (Array.isArray(firstImage?.data?.geometric_center)) {
          setPreviewGeometricCenter(firstImage.data.geometric_center)
        }
      }
    } else {
      ElMessage.error('批量加载失败，请稍后重试')
      console.error('批量加载完全失败')
    }
  }

  function createErrorState() {
    let hasError = false
    let errorCount = 0
    return {
      get hasError() { return hasError },
      get errorCount() { return errorCount },
      trackError() {
        errorCount++
        hasError = true
        if (errorCount >= 3) {
          ElMessage.warning(`已有 ${errorCount} 个批次加载失败，继续尝试...`)
        }
      },
    }
  }

  async function batchLoadCloudContours(
    allValidTimeSteps,
    cloudContourVarIds,
    primaryVid,
    batchSize,
    effectivePhysicalTimes,
    loadedImages,
    errorState,
    processedLayerIds,
  ) {
    const currentTask = getCurrentTask()
    const visualization = getVisualization()
    const selectedPlane = getSelectedPlane()
    const planeCoordinate = getPlaneCoordinate()

    const baseTemplate = {
      task_id: currentTask.id,
      plane_type: selectedPlane.toLowerCase(),
      plane_offset: planeCoordinate,
      quality: '2k',
      convertToPng: false,
      quality_preset: sanitizeVectorQualityPreset(
        visualization.quality_preset,
      ),
      transparent_background: sanitizeVectorTransparentBackground(
        visualization.transparent_background,
      ),
      use_pregen: visualization.usePregen,
    }
    const progressDen = Math.max(
      allValidTimeSteps.length * Math.max(cloudContourVarIds.length, 1),
      1,
    )
    let completedUnits = 0

    for (const cvid of cloudContourVarIds) {
      const layerId = buildGeneratedLayerId('contour', { variable: cvid })
      registerGeneratedLayer('contour', {
        variable: cvid,
        plane: getSelectedPlane(),
        coordinate: getPlaneCoordinate(),
      })
      processedLayerIds.push(layerId)

      if (typeof onLayerRegistered === 'function') {
        onLayerRegistered(layerId, 'contour', { variable: cvid })
      }

      for (let i = 0; i < allValidTimeSteps.length; i += batchSize) {
        const batch = allValidTimeSteps.slice(i, i + batchSize)
        const batchIndex = Math.floor(i / batchSize) + 1

        try {
          const batchParams = { ...baseTemplate, variable: cvid }
          applyContourColormapToPayload(
            batchParams,
            resolveContourColormapParams(cvid),
          )
          const results = await postProcessingApi.getContoursByTimeSteps({
            ...batchParams,
            time_steps: batch,
          })

          if (results) {
            results.forEach((result) => {
              if (!result.success) return
              const svgUrl =
                result.data.svg_url ||
                result.data.contour_frame_url ||
                result.data.vector_url ||
                result.data.url
              const pngUrl = result.data.png_url || svgUrl
              const isPrimary = primaryVid != null && cvid === primaryVid
              const frameEntry = {
                time_step: result.time_step,
                svg_url: svgUrl,
                png_url: pngUrl,
                url: pngUrl,
                data: result.data,
              }

              if (isPrimary) {
                loadedImages.push(frameEntry)
              }

              if (typeof onFrameLoaded === 'function') {
                onFrameLoaded(frameEntry, layerId, isPrimary)
              }
            })
          }
        } catch (error) {
          console.error(`云图 [${cvid}] 批次 ${batchIndex} 加载失败:`, error)
          errorState.trackError()
        }

        completedUnits += batch.length
        setBatchLoadCurrent(completedUnits)
        setBatchLoadProgress(Math.round((completedUnits / progressDen) * 100))

        if (i + batchSize < allValidTimeSteps.length) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    }
  }

  async function batchLoadVectors(
    allValidTimeSteps,
    batchSize,
    effectivePhysicalTimes,
    loadedImages,
    errorState,
    processedLayerIds,
  ) {
    const currentTask = getCurrentTask()
    const visualization = getVisualization()
    const selectedPlane = getSelectedPlane()
    const planeCoordinate = getPlaneCoordinate()

    const layerId = buildGeneratedLayerId('vector')
    registerGeneratedLayer('vector', {
      plane: getSelectedPlane(),
      coordinate: getPlaneCoordinate(),
    })
    processedLayerIds.push(layerId)

    if (typeof onLayerRegistered === 'function') {
      onLayerRegistered(layerId, 'vector', {})
    }

    const vectorDefaultColor = visualization.vectorColor || '#ffffff'
    const baseParams = {
      task_id: currentTask.id,
      plane_type: selectedPlane.toLowerCase(),
      plane_offset: planeCoordinate,
      quality: '2k',
      convertToPng: false,
      color: vectorDefaultColor,
      quality_preset: sanitizeVectorQualityPreset(
        visualization.quality_preset,
      ),
      transparent_background: sanitizeVectorTransparentBackground(
        visualization.transparent_background,
      ),
      glyph_density: sanitizeGlyphDensity(visualization.glyph_density),
      line_width: sanitizeVectorLineWidth(visualization.vectorLineWidth),
      vmin: Number.isFinite(Number(visualization.vmin))
        ? Number(visualization.vmin)
        : undefined,
      vmax: Number.isFinite(Number(visualization.vmax))
        ? Number(visualization.vmax)
        : undefined,
      use_pregen: visualization.usePregen,
    }

    for (let i = 0; i < allValidTimeSteps.length; i += batchSize) {
      const batch = allValidTimeSteps.slice(i, i + batchSize)
      const batchIndex = Math.floor(i / batchSize) + 1

      try {
        const results = await postProcessingApi.getVectorsByTimeSteps({
          ...baseParams,
          time_steps: batch,
        })

        if (results) {
          results.forEach((result) => {
            if (!result.success) return
            const svgUrl =
              result.data.svg_url ||
              result.data.contour_frame_url ||
              result.data.vector_url ||
              result.data.url
            const pngUrl = result.data.png_url || svgUrl
            const frameEntry = {
              time_step: result.time_step,
              svg_url: svgUrl,
              png_url: pngUrl,
              url: pngUrl,
              data: result.data,
            }
            loadedImages.push(frameEntry)

            if (typeof onFrameLoaded === 'function') {
              onFrameLoaded(frameEntry, layerId, true)
            }
          })
        }
      } catch (error) {
        console.error(`批次 ${batchIndex} 加载失败:`, error)
        errorState.trackError()
      }

      setBatchLoadCurrent(Math.min(i + batchSize, allValidTimeSteps.length))
      setBatchLoadProgress(
        Math.round((Math.min(i + batchSize, allValidTimeSteps.length) / allValidTimeSteps.length) * 100),
      )

      if (i + batchSize < allValidTimeSteps.length) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  return {
    ensureTaskMetadataCached,
    getLatestTaskFromList,
    batchLoadTimeSteps,
    extractTaskListItems,
    getTaskLatestTime,
  }
}
