import { ElLoading, ElMessage } from 'element-plus'
import postProcessingApi from '@/api/postProcessing.js'

export function useLayerPreloader(options = {}) {
  const {
    currentTask,
    playerRef,
    selectedPlane,
    planeCoordinate,
    visualization,
    timelineCurrentStep,
    timelineTimeSteps,
    timelinePhysicalTimes,
    isBatchLoading,
    batchLoadingText,
    batchLoadCurrent,
    batchLoadTotal,
    batchLoadProgress,
    batchLoadedImages,
    handleTimelinePause,
    sanitizeVectorQualityPreset,
    sanitizeVectorTransparentBackground,
    sanitizeGlyphDensity,
    sanitizeVectorLineWidth,
    applyContourColormapToPayload,
    resolveContourColormapParams,
    resolve2DFrameImageUrl,
    isUrlPreloaded,
    preload2DFrameImageUrls,
  } = options

  async function preloadVisibleVolumeLayer(layer) {
    if (!layer || layer.kind !== 'volume' || layer.visible === false) return
    const lockedTimelineStep = timelineCurrentStep.value
    const loading = ElLoading.service({
      lock: true,
      text: '正在缓存当前图层所有时间步数据...',
      background: 'rgba(5, 10, 20, 0.68)',
    })
    isBatchLoading.value = true
    batchLoadingText.value = `正在缓存 ${layer.label || '体渲染图层'} 的所有时间步...`
    batchLoadCurrent.value = 0
    batchLoadTotal.value = 1
    batchLoadProgress.value = 10
    handleTimelinePause()
    timelineCurrentStep.value = lockedTimelineStep
    try {
      await playerRef.value?.preloadVolumeLayer?.(layer)
      timelineCurrentStep.value = lockedTimelineStep
      batchLoadCurrent.value = 1
      batchLoadProgress.value = 100
    } catch (error) {
      console.warn('[VolumeLayerPreload] 图层预加载失败:', error)
      ElMessage.warning('图层数据缓存失败，切换时间步时可能仍会请求数据')
    } finally {
      timelineCurrentStep.value = lockedTimelineStep
      loading.close()
      isBatchLoading.value = false
    }
  }

  function parse2DLayerRequestMeta(layer) {
    const parts = String(layer?.id || '').split(':')
    if (parts.length < 4) return null
    const plane = String(layer.plane ?? parts[2] ?? selectedPlane.value).toLowerCase()
    const coordinate = Number(layer.coordinate ?? parts[3] ?? planeCoordinate.value)
    const variable =
      layer.variable != null && String(layer.variable).trim() !== ''
        ? String(layer.variable).trim()
        : parts.slice(4).join(':') || visualization.value.variable || 'VelocityMagnitude'
    return {
      plane,
      coordinate: Number.isFinite(coordinate) ? coordinate : planeCoordinate.value,
      variable,
    }
  }

  function resolve2DLayerMissingTimeSteps(layer) {
    const allSteps = (timelineTimeSteps.value || []).filter((step) =>
      Number.isFinite(Number(step)) && Number(step) !== 0,
    )
    if (!allSteps.length) return []

    const cachedSteps = new Set(
      (Array.isArray(layer?.images) ? layer.images : [])
        .map((image) => Number(image?.time_step))
        .filter((step) => Number.isFinite(step)),
    )
    return allSteps.filter((step) => !cachedSteps.has(Number(step)))
  }

  async function preloadVisible2DLayer(layer) {
    if (
      !layer ||
      !currentTask.value?.id ||
      layer.visible === false ||
      ![
        'contour',
        'cloud',
        'radar_cloud',
        'radar_wavefront_cloud',
        'radar_wavefront',
        'radar_heatmap',
        'vector',
      ].includes(layer.kind)
    ) {
      return
    }
    if (
      (layer.kind === 'radar_cloud' ||
        layer.kind === 'radar_wavefront_cloud' ||
        layer.kind === 'radar_wavefront' ||
        layer.kind === 'radar_heatmap') &&
      layer.isMock
    ) return

    const missingTimeSteps = resolve2DLayerMissingTimeSteps(layer)
    const existingFrameUrls = (Array.isArray(layer.images) ? layer.images : [])
      .map((frame) => resolve2DFrameImageUrl(frame))
      .filter((url) => url && !isUrlPreloaded(url))
    if (!missingTimeSteps.length && !existingFrameUrls.length) return

    const meta = missingTimeSteps.length ? parse2DLayerRequestMeta(layer) : null
    if (missingTimeSteps.length && !meta) return

    const lockedTimelineStep = timelineCurrentStep.value
    const loading = ElLoading.service({
      lock: true,
      text: '正在缓存当前图层所有时间步图片...',
      background: 'rgba(5, 10, 20, 0.68)',
    })
    isBatchLoading.value = true
    batchLoadingText.value = `正在缓存 ${layer.label || '图层'} 的所有时间步...`
    batchLoadCurrent.value = 0
    batchLoadTotal.value = Math.max(
      missingTimeSteps.length + existingFrameUrls.length,
      1,
    )
    batchLoadProgress.value = 5
    handleTimelinePause()
    timelineCurrentStep.value = lockedTimelineStep

    try {
      let results = []
      if (missingTimeSteps.length) {
        const requestBase = {
          task_id: currentTask.value.id,
          plane_type: meta.plane,
          plane_offset: meta.coordinate,
          quality: '2k',
          convertToPng: false,
          quality_preset: sanitizeVectorQualityPreset(
            visualization.value.quality_preset,
          ),
          transparent_background: sanitizeVectorTransparentBackground(
            visualization.value.transparent_background,
          ),
          use_pregen: visualization.value.usePregen,
        }

        if (layer.kind === 'vector') {
          results = await postProcessingApi.getVectorsByTimeSteps({
            ...requestBase,
            time_steps: missingTimeSteps,
            color: visualization.value.vectorColor || '#ffffff',
            glyph_density: sanitizeGlyphDensity(visualization.value.glyph_density),
            line_width: sanitizeVectorLineWidth(visualization.value.vectorLineWidth),
            vmin: Number.isFinite(Number(visualization.value.vmin))
              ? Number(visualization.value.vmin)
              : undefined,
            vmax: Number.isFinite(Number(visualization.value.vmax))
              ? Number(visualization.value.vmax)
              : undefined,
          })
        } else {
          const contourParams = {
            ...requestBase,
            time_steps: missingTimeSteps,
            variable: meta.variable,
          }
          applyContourColormapToPayload(
            contourParams,
            resolveContourColormapParams(meta.variable),
          )
          results = await postProcessingApi.getContoursByTimeSteps(contourParams)
        }
      }

      const existingImages = Array.isArray(layer.images) ? layer.images : []
      const existingStepKeys = new Set(
        existingImages.map((image) => String(image?.time_step)),
      )
      ;(Array.isArray(results) ? results : []).forEach((result) => {
        if (!result?.success) return
        const data = result.data || {}
        const sourceUrl =
          data.png_url ||
          data.contour_frame_url ||
          data.vector_url ||
          data.svg_url ||
          data.url
        if (!sourceUrl) return
        const frameEntry = {
          time_step: result.time_step,
          layerId: layer.id,
          svg_url: data.svg_url || sourceUrl,
          png_url: data.png_url || sourceUrl,
          url: (data.png_url || sourceUrl).replace(/[`\s]/g, ''),
          data,
        }
        if (!existingStepKeys.has(String(frameEntry.time_step))) {
          existingImages.push(frameEntry)
          existingStepKeys.add(String(frameEntry.time_step))
        }
        const globalStepExists = batchLoadedImages.value.some(
          (image) =>
            String(image?.layerId ?? image?.layer_id ?? '') === String(layer.id) &&
            Number(image?.time_step) === Number(frameEntry.time_step),
        )
        if (!globalStepExists) {
          batchLoadedImages.value.push(frameEntry)
        }
      })

      existingImages.sort((a, b) => Number(a.time_step) - Number(b.time_step))
      layer.images = existingImages
      existingImages.forEach((frame) => {
        const globalStepExists = batchLoadedImages.value.some(
          (image) =>
            String(image?.layerId ?? image?.layer_id ?? '') === String(layer.id) &&
            Number(image?.time_step) === Number(frame?.time_step),
        )
        if (!globalStepExists) {
          batchLoadedImages.value.push({
            ...frame,
            layerId: layer.id,
            url: resolve2DFrameImageUrl(frame),
          })
        }
      })
      layer.ready = existingImages.length > 0
      layer.loaded = true
      if (!layer.physicalTimes?.length) {
        layer.physicalTimes = [...timelinePhysicalTimes.value]
      }
      const firstData = existingImages[0]?.data
      if (firstData) {
        const physicalWidth = Number(
          firstData.physical_width ?? firstData.physicalWidth,
        )
        const physicalHeight = Number(
          firstData.physical_height ?? firstData.physicalHeight,
        )
        const vmin = Number(firstData.vmin ?? firstData.v_min)
        const vmax = Number(firstData.vmax ?? firstData.v_max)
        if (Number.isFinite(physicalWidth) && physicalWidth > 0) {
          layer.physicalWidth = physicalWidth
        }
        if (Number.isFinite(physicalHeight) && physicalHeight > 0) {
          layer.physicalHeight = physicalHeight
        }
        if (Number.isFinite(vmin)) layer.vmin = vmin
        if (Number.isFinite(vmax)) layer.vmax = vmax
      }

      const imageUrlsToPreload = existingImages
        .map((frame) => resolve2DFrameImageUrl(frame))
        .filter(Boolean)
      batchLoadTotal.value = Math.max(
        missingTimeSteps.length + imageUrlsToPreload.length,
        1,
      )
      await preload2DFrameImageUrls(imageUrlsToPreload, (completed) => {
        batchLoadCurrent.value = Math.min(
          missingTimeSteps.length + completed,
          batchLoadTotal.value,
        )
        batchLoadProgress.value = Math.round(
          (batchLoadCurrent.value / batchLoadTotal.value) * 100,
        )
      })
      batchLoadCurrent.value = batchLoadTotal.value
      batchLoadProgress.value = 100
    } catch (error) {
      console.warn('[2DLayerPreload] 图层图片缓存失败:', error)
      ElMessage.warning('图层图片缓存失败，切换时间步时可能仍会请求数据')
    } finally {
      timelineCurrentStep.value = lockedTimelineStep
      loading.close()
      isBatchLoading.value = false
    }
  }

  return {
    preloadVisibleVolumeLayer,
    preloadVisible2DLayer,
  }
}
