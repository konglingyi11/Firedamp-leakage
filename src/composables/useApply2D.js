import postProcessingApi from '@/api/postProcessing'
import { ElMessage } from 'element-plus'
import {
  sanitizeVectorQualityPreset,
  sanitizeVectorTransparentBackground,
  sanitizeGlyphDensity,
} from '@/utils/sanitize'
import { normalizeRadarFrequencies, radarFrequencyLabel } from '@/constants/radarFrequencies.js'
import {
  RADAR_MOCK_LU_MAX,
  RADAR_MOCK_LU_MIN,
} from '@/utils/mockRadarPpi.js'

/** 仅使用 sim 下按切割面分子目录的帧：如 sim/xy/frame_000.png */
const SIM_RADAR_PLANE_FRAME_MODULES = import.meta.glob(
  '../../sim/*/frame_*.png',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
)

function simPlaneKeyFromPath(importPath) {
  const norm = String(importPath || '').replace(/\\/g, '/')
  const m = norm.match(/\/sim\/(xy|yz|xz)\/frame_(\d+)\.png$/i)
  if (!m) return null
  return { plane: m[1].toLowerCase(), frame: Number(m[2]) }
}

const SIM_RADAR_FRAME_URLS_BY_PLANE = (() => {
  const buckets = { xy: [], yz: [], xz: [] }
  for (const [path, urlVal] of Object.entries(SIM_RADAR_PLANE_FRAME_MODULES)) {
    const parsed = simPlaneKeyFromPath(path)
    if (!parsed) continue
    const { plane, frame } = parsed
    if (!buckets[plane]) continue
    buckets[plane].push({ frame, url: String(urlVal) })
  }
  const out = { xy: [], yz: [], xz: [] }
  for (const k of Object.keys(out)) {
    buckets[k]
      .sort((a, b) => a.frame - b.frame || String(a.url).localeCompare(String(b.url)))
    out[k] = buckets[k].map((x) => x.url)
  }
  return out
})()

/**
 * 2D 可视化应用逻辑（云图/矢量图）
 */
export function useApply2D(options) {
  const {
    currentTask,
    visualization,
    visualization2DType,
    isBatchLoading,
    batchLoadingText,
    batchLoadProgress,
    batchLoadCurrent,
    batchLoadTotal,
    batchLoadedImages,
    previewImageUrl,
    previewFrameCount,
    previewVMin,
    previewVMax,
    previewPhysicalWidth,
    previewPhysicalHeight,
    previewGeometricCenter,
    previewRows,
    previewCols,
    timelineCurrentStep,
    timelineTimeSteps,
    timelinePhysicalTimes,
    timelineTotalSteps,
    selectedPlane,
    planeCoordinate,
    generatedVizLayers,
    latest2DVMin,
    latest2DVMax,
    playerRef,
    ueMsg,
    selectedLayerId,
    applyFromRadarMediumCloud,
  } = options.refs

  const {
    build2DContourParamsForUE,
    build2DVectorParamsForUE,
    upsertGeneratedVizLayer,
    buildGeneratedLayerId,
    buildGeneratedLayerLabel,
    resolveSelectedCmap,
    resolveContourColormapParams,
    applyContourColormapToPayload,
    send2DParamsToUE,
    listCloudContourVariableIds,
    findLoadedImageByTimeStep,
    displayUrlForCachedFrame,
  } = options.methods

  const QUALITY_2D_FIXED = '2k'

  /** 与 /test-leida 雷达 PPI 模拟云图对应的占位变量 id */
  const MOCK_RADAR_CLOUD_VARIABLE = 'RadarMockPPI'

  function normalizeSimRadarPlaneFolder(planeRaw) {
    const p = String(planeRaw ?? 'xy').toLowerCase()
    if (p === 'xz' || p === 'yz' || p === 'xy') return p
    return 'xy'
  }

  function buildSimRadarFrameUrls(count, planeRaw) {
    const n = Math.max(0, Number(count) || 0)
    if (n <= 0) return []
    const plane = normalizeSimRadarPlaneFolder(planeRaw)
    const list = SIM_RADAR_FRAME_URLS_BY_PLANE[plane] || []
    if (list.length > 0) {
      return Array.from(
        { length: n },
        (_, idx) => list[idx % list.length],
      )
    }
    return Array.from(
      { length: n },
      (_, idx) =>
        `./sim/${plane}/frame_${String(idx % 72).padStart(3, '0')}.png`,
    )
  }

  /** 与当前切割面一致的轴标注，避免模拟雷达图贴到 XY 等切片上轴向错位 */
  function mockRadarSliceAxesFromPlane(planeRaw) {
    const p = String(planeRaw ?? 'xy').toLowerCase()
    if (p === 'xz') return { horizontal_axis: 'x', vertical_axis: 'z' }
    if (p === 'yz') return { horizontal_axis: 'y', vertical_axis: 'z' }
    return { horizontal_axis: 'x', vertical_axis: 'y' }
  }

  function normalizeGeomBoundsPayload(boundsPayload) {
    const raw = boundsPayload?.data ?? boundsPayload
    if (!raw || typeof raw !== 'object') return null
    const minX = Number(raw.xmin ?? raw.x_min)
    const maxX = Number(raw.xmax ?? raw.x_max)
    const minY = Number(raw.ymin ?? raw.y_min)
    const maxY = Number(raw.ymax ?? raw.y_max)
    const minZ = Number(raw.zmin ?? raw.z_min)
    const maxZ = Number(raw.zmax ?? raw.z_max)
    if (![minX, maxX, minY, maxY, minZ, maxZ].every(Number.isFinite)) return null
    return { minX, maxX, minY, maxY, minZ, maxZ }
  }

  /**
   * 模拟雷达层与真实切割面一致的物理宽高（cm）与几何中心，便于 Three.js 平面按包围盒比例贴合。
   */
  function buildMockRadarSliceMetrics(planeRaw, planeOffsetCm, boundsPayload) {
    const axes = mockRadarSliceAxesFromPlane(planeRaw)
    const plane = String(planeRaw ?? 'xy').toLowerCase()
    const off = Number(planeOffsetCm)
    const offset = Number.isFinite(off) ? off : 0
    const G = normalizeGeomBoundsPayload(boundsPayload)
    if (!G) {
      return {
        ...axes,
        physical_width: 180,
        physical_height: 180,
        geometric_center: [90, 90, 0],
      }
    }
    const cx = (G.minX + G.maxX) / 2
    const cy = (G.minY + G.maxY) / 2
    const cz = (G.minZ + G.maxZ) / 2
    if (plane === 'xz') {
      return {
        ...axes,
        physical_width: G.maxX - G.minX,
        physical_height: G.maxZ - G.minZ,
        geometric_center: [cx, offset, cz],
      }
    }
    if (plane === 'yz') {
      return {
        ...axes,
        physical_width: G.maxY - G.minY,
        physical_height: G.maxZ - G.minZ,
        geometric_center: [offset, cy, cz],
      }
    }
    return {
      ...axes,
      physical_width: G.maxX - G.minX,
      physical_height: G.maxY - G.minY,
      geometric_center: [cx, cy, offset],
    }
  }

  /**
   * 应用 2D 设置
   */
  async function apply2D() {
    try {
    // 若之前已生成过云图/矢量图数据，再次点应用设置时先清空预览图和时间轴状态
    if (
      batchLoadedImages.value.length > 0 ||
      (previewImageUrl.value && previewImageUrl.value.length > 0)
    ) {
      previewImageUrl.value = ''
      previewVMin.value = 0
      previewVMax.value = 0
      latest2DVMin.value = null
      latest2DVMax.value = null
      previewRows.value = 1
      previewCols.value = 1
      previewFrameCount.value = 0
      previewPhysicalWidth.value = null
      previewPhysicalHeight.value = null
      previewGeometricCenter.value = [0, 0, 0]
      timelineCurrentStep.value = 0
      // 保留本任务已加载的时间步列表，避免再次「应用设置」时重复请求 time-steps 接口
      if (timelineTimeSteps.value.length > 0) {
        timelineTotalSteps.value = Math.max(0, timelineTimeSteps.value.length - 1)
      } else {
        timelineTotalSteps.value = 0
      }
      batchLoadedImages.value = []
    }

    // 从时间轴获取时间步数据（时间步在任务选择时已加载）
    let startStep, endStep
    const allTimeSteps = Array.isArray(timelineTimeSteps.value) ? [...timelineTimeSteps.value] : []
    const allPhysicalTimes = Array.isArray(timelinePhysicalTimes.value) ? [...timelinePhysicalTimes.value] : []
    let availableTimeSteps = allTimeSteps

    if (allTimeSteps.length > 0) {
      const physicalTimeToTimeStep = (physicalTime) => {
        let closestIndex = 0
        let minDifference = Infinity
        if (allPhysicalTimes.length > 0) {
          allPhysicalTimes.forEach((time, index) => {
            const difference = Math.abs(time - physicalTime)
            if (difference < minDifference) {
              minDifference = difference
              closestIndex = index
            }
          })
        }
        return allTimeSteps[closestIndex]
      }

      if (allPhysicalTimes.length > 0) {
        if (visualization.value.startTimeStep == null) {
          visualization.value.startTimeStep = allPhysicalTimes[0]
        }
        if (visualization.value.endTimeStep == null) {
          visualization.value.endTimeStep = allPhysicalTimes[allPhysicalTimes.length - 1]
        }
      }

      if (visualization.value.startTimeStep != null) {
        startStep = physicalTimeToTimeStep(visualization.value.startTimeStep)
      }
      if (visualization.value.endTimeStep != null) {
        endStep = physicalTimeToTimeStep(visualization.value.endTimeStep)
      }
    }

    // 云图/矢量必须先从 time-steps 接口拿到非空列表
    if (visualization2DType.value === 'cloud' || visualization2DType.value === 'vector') {
      if (!Array.isArray(availableTimeSteps) || availableTimeSteps.length === 0) {
        ElMessage.error('未获取到任务可用时间步，无法生成可视化，请检查任务数据')
        return
      }
    }

    const commonParams = {
      task_id: currentTask.value.id,
      plane_type: selectedPlane.value.toLowerCase(),
      plane_offset: planeCoordinate.value,
      quality: QUALITY_2D_FIXED,
    }
    // 只有在非自动范围模式下才传递 vmin/vmax
    if (visualization.value.autoRange === false) {
      const vminNum = Number(visualization.value.vmin)
      const vmaxNum = Number(visualization.value.vmax)
      if (Number.isFinite(vminNum)) commonParams.vmin = vminNum
      if (Number.isFinite(vmaxNum)) commonParams.vmax = vmaxNum
    }

    const timeStep =
      timelineTimeSteps.value.length > timelineCurrentStep.value
        ? timelineTimeSteps.value[timelineCurrentStep.value]
        : timelineTimeSteps.value.length > 0
          ? timelineTimeSteps.value[0]
          : 1

    let targetTimeSteps = availableTimeSteps.length > 0 ? availableTimeSteps : [timeStep]
    if (startStep !== undefined && endStep !== undefined && availableTimeSteps.length > 0) {
      targetTimeSteps = availableTimeSteps.filter((t) => t >= startStep && t <= endStep)
    }

    const timeStepsForUE =
      availableTimeSteps.length > 0 ? [...availableTimeSteps] : [...targetTimeSteps]
    send2DParamsToUE(timeStepsForUE)

    // --- 批量加载逻辑 ---
    await performBatchLoad(timeStepsForUE, commonParams, timeStep)
    } finally {
      if (applyFromRadarMediumCloud) applyFromRadarMediumCloud.value = false
    }
  }

  /**
   * 批量加载 logic
   */
  async function performBatchLoad(stepsToFetchAndCache, commonParams, timeStep) {
    const CHUNK_SIZE = 30
    const totalChunks = Math.ceil(stepsToFetchAndCache.length / CHUNK_SIZE)
    let allContourUrls = []
    let allVectorUrls = []
    let mergedMetadata = {}
    let firstChunkData = null

    const hasCloudVars =
      Array.isArray(visualization.value.cloud_variables) &&
      visualization.value.cloud_variables.length > 0
    const radarFreqRaw =
      visualization.value.radar_frequencies ??
      visualization.value.radar_frequency
    /** 用户是否在左侧勾选过至少一个雷达类型（空数组则仅仿真云图、不叠模拟雷达） */
    const userPickedRadarBands =
      Array.isArray(radarFreqRaw) && radarFreqRaw.length > 0
    /** 介质与调制 → 二维云图「应用」：走仿真雷达切片，不拉左侧勾选的气体云图变量 */
    const radarMediumCloudOnly =
      applyFromRadarMediumCloud?.value === true
    const mockRadarOnly =
      visualization2DType.value === 'cloud' &&
      (!hasCloudVars || radarMediumCloudOnly)
    const appendMockRadarWithContour =
      visualization2DType.value === 'cloud' &&
      hasCloudVars &&
      userPickedRadarBands &&
      !radarMediumCloudOnly

    /** 平面模拟雷达：与几何包围盒一致的物理尺度与中心；获取失败时退回占位 180² */
    let mockRadarSliceMetrics = null
    if (mockRadarOnly || appendMockRadarWithContour) {
      try {
        const boundsRes = await postProcessingApi.getGeometryBounds(currentTask.value.id)
        mockRadarSliceMetrics = buildMockRadarSliceMetrics(
          selectedPlane.value,
          planeCoordinate.value,
          boundsRes,
        )
      } catch {
        mockRadarSliceMetrics = buildMockRadarSliceMetrics(
          selectedPlane.value,
          planeCoordinate.value,
          null,
        )
      }
    }

    isBatchLoading.value = true
    batchLoadingText.value = '正在初始化可视化请求...'
    batchLoadCurrent.value = 0
    const cloudContourVarIdsApply =
      visualization2DType.value === 'cloud'
        ? mockRadarOnly
          ? [MOCK_RADAR_CLOUD_VARIABLE]
          : listCloudContourVariableIds()
        : []
    const contourVarCountForProgress = Math.max(
      cloudContourVarIdsApply.length,
      1,
    )
    const radarProgressSteps =
      appendMockRadarWithContour && stepsToFetchAndCache.length > 0
        ? stepsToFetchAndCache.length
        : 0
    batchLoadTotal.value =
      visualization2DType.value === 'cloud'
        ? stepsToFetchAndCache.length * contourVarCountForProgress +
          radarProgressSteps
        : stepsToFetchAndCache.length
    batchLoadProgress.value = 0
    batchLoadedImages.value = []

    try {
      const chunkJobs = Array.from({ length: totalChunks }, (_, i) => {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, stepsToFetchAndCache.length)
        return { i, start, end, chunkTimeSteps: stepsToFetchAndCache.slice(start, end) }
      })

      const progressTotalApply = Math.max(
        mockRadarOnly
          ? stepsToFetchAndCache.length
          : totalChunks * contourVarCountForProgress + radarProgressSteps,
        1,
      )
      let completedChunks = 0
      batchLoadingText.value = '正在拉取时间步数据...'

      const chunkResults = []

      if (mockRadarOnly) {
        const simPlane = normalizeSimRadarPlaneFolder(selectedPlane.value)
        batchLoadingText.value = `正在加载雷达云图（${simPlane.toUpperCase()} 切面）…`
        const urls = buildSimRadarFrameUrls(
          stepsToFetchAndCache.length,
          selectedPlane.value,
        )
        if (urls.length === 0) {
          ElMessage.error(
            `未找到当前切面的雷达云图帧，请确认数据已就绪`,
          )
          return
        }
        for (let idx = 0; idx < urls.length; idx++) {
          batchLoadCurrent.value = idx + 1
          batchLoadProgress.value = Math.round(
            ((idx + 1) / progressTotalApply) * 100,
          )
        }

        chunkResults.push({
          i: 0,
          start: 0,
          end: stepsToFetchAndCache.length,
          chunkTimeSteps: stepsToFetchAndCache.slice(),
          chunkData: {
            contour_frame_urls: urls,
            time_steps: stepsToFetchAndCache.slice(),
            vmin: RADAR_MOCK_LU_MIN,
            vmax: RADAR_MOCK_LU_MAX,
            physical_width: mockRadarSliceMetrics.physical_width,
            physical_height: mockRadarSliceMetrics.physical_height,
            geometric_center: mockRadarSliceMetrics.geometric_center,
            horizontal_axis: mockRadarSliceMetrics.horizontal_axis,
            vertical_axis: mockRadarSliceMetrics.vertical_axis,
          },
          contourVariable: MOCK_RADAR_CLOUD_VARIABLE,
          varIdx: 0,
        })
      } else if (visualization2DType.value === 'vector') {
        for (const job of chunkJobs) {
          const vectorParams = {
            ...commonParams,
            quality_preset: sanitizeVectorQualityPreset(visualization.value.quality_preset),
            transparent_background: sanitizeVectorTransparentBackground(
              visualization.value.transparent_background,
            ),
            glyph_density: sanitizeGlyphDensity(visualization.value.glyph_density),
            time_step: job.chunkTimeSteps.filter((t) => t !== 0),
            use_pregen: visualization.value.usePregen,
            color: visualization.value.vectorColor || '#ffffff',
          }

          const chunkRes = await postProcessingApi.generateVector(vectorParams)
          completedChunks++
          batchLoadProgress.value = Math.round((completedChunks / progressTotalApply) * 100)
          chunkResults.push({ ...job, chunkData: chunkRes?.data || chunkRes })
        }
      } else {
        for (let varIdx = 0; varIdx < cloudContourVarIdsApply.length; varIdx++) {
          const contourVid = cloudContourVarIdsApply[varIdx]
          for (const job of chunkJobs) {
            const contourParams = {
              ...commonParams,
              variable: contourVid,
              time_step: job.chunkTimeSteps.filter((t) => t !== 0),
              use_pregen: visualization.value.usePregen,
            }
            applyContourColormapToPayload(contourParams, resolveContourColormapParams(contourVid))
            const chunkRes = await postProcessingApi.generateContour(contourParams)
            completedChunks++
            batchLoadProgress.value = Math.round(
              (completedChunks / progressTotalApply) * 100,
            )
            chunkResults.push({
              ...job,
              chunkData: chunkRes?.data || chunkRes,
              contourVariable: contourVid,
              varIdx,
            })
          }
        }

        if (appendMockRadarWithContour) {
          const simPlane = normalizeSimRadarPlaneFolder(selectedPlane.value)
          batchLoadingText.value = `正在加载雷达云图叠加层（${simPlane.toUpperCase()} 切面）…`
          const urls = buildSimRadarFrameUrls(
            stepsToFetchAndCache.length,
            selectedPlane.value,
          )
          if (urls.length === 0) {
            ElMessage.error(
              `未找到当前切面的雷达云图帧，请确认数据已就绪`,
            )
            return
          }
          const radarVarIdx = cloudContourVarIdsApply.length
          for (let idx = 0; idx < urls.length; idx++) {
            batchLoadCurrent.value = completedChunks + 1
            completedChunks++
            batchLoadProgress.value = Math.round(
              (completedChunks / progressTotalApply) * 100,
            )
          }
          chunkResults.push({
            i: totalChunks,
            start: 0,
            end: stepsToFetchAndCache.length,
            chunkTimeSteps: stepsToFetchAndCache.slice(),
            chunkData: {
              contour_frame_urls: urls,
              time_steps: stepsToFetchAndCache.slice(),
              vmin: RADAR_MOCK_LU_MIN,
              vmax: RADAR_MOCK_LU_MAX,
              physical_width: mockRadarSliceMetrics.physical_width,
              physical_height: mockRadarSliceMetrics.physical_height,
              geometric_center: mockRadarSliceMetrics.geometric_center,
              horizontal_axis: mockRadarSliceMetrics.horizontal_axis,
              vertical_axis: mockRadarSliceMetrics.vertical_axis,
            },
            contourVariable: MOCK_RADAR_CLOUD_VARIABLE,
            varIdx: radarVarIdx,
          })

        }
      }

      // 处理结果
      chunkResults.sort((a, b) => (a.i !== b.i ? a.i - b.i : (a.varIdx ?? 0) - (b.varIdx ?? 0)))
      const primaryContourVidApply = cloudContourVarIdsApply[0] || null

      for (const r of chunkResults) {
        const { chunkTimeSteps, chunkData, contourVariable } = r
        if (!chunkData) continue

        const cvResolved = contourVariable || visualization.value.variable
        let radarSortedKeyCloud = ''
        let radarBandsArrCloud = []
        if (
          visualization2DType.value === 'cloud' &&
          String(cvResolved || '').trim() === MOCK_RADAR_CLOUD_VARIABLE
        ) {
          radarBandsArrCloud = normalizeRadarFrequencies(
            visualization.value.radar_frequencies ??
              visualization.value.radar_frequency,
          )
          radarSortedKeyCloud = [...radarBandsArrCloud].sort().join('+')
        }

        if (!firstChunkData) {
          firstChunkData = chunkData
          mergedMetadata = {
            vmin: chunkData.vmin,
            vmax: chunkData.vmax,
            physical_width: chunkData.physical_width,
            physical_height: chunkData.physical_height,
            geometric_center: chunkData.geometric_center,
            horizontal_axis: chunkData.horizontal_axis,
            vertical_axis: chunkData.vertical_axis,
          }
        }

        const urls = chunkData.contour_frame_urls || chunkData.vector_frame_urls || []
        if (
          chunkData.contour_frame_urls &&
          (visualization2DType.value !== 'cloud' ||
            contourVariable == null ||
            contourVariable === primaryContourVidApply)
        ) {
          allContourUrls.push(...chunkData.contour_frame_urls)
        }
        if (chunkData.vector_frame_urls) {
          allVectorUrls.push(...chunkData.vector_frame_urls)
        }

        // 通知 UE
        if (playerRef.value) {
          if (visualization2DType.value === 'cloud' && chunkData.contour_frame_urls?.length > 0) {
            const timeSteps = chunkData.time_steps || chunkTimeSteps
            const baseContourPayload = build2DContourParamsForUE(timeSteps, {
              contourVariable: cvResolved,
            })
            const radarLabelsStr =
              radarSortedKeyCloud !== ''
                ? radarBandsArrCloud.map(radarFrequencyLabel).join('·')
                : ''
            const contourPayload =
              radarSortedKeyCloud !== ''
                ? {
                    ...baseContourPayload,
                    id: buildGeneratedLayerId('radar_cloud', {
                      variable: radarSortedKeyCloud,
                    }),
                    name: buildGeneratedLayerLabel('radar_cloud', {
                      variable: radarSortedKeyCloud,
                      radarBandLabels: radarLabelsStr,
                    }),
                    urls: chunkData.contour_frame_urls,
                    vmin: chunkData.vmin,
                    vmax: chunkData.vmax,
                    physical_width: chunkData.physical_width,
                    physical_height: chunkData.physical_height,
                    geometric_center: chunkData.geometric_center,
                    horizontal_axis: chunkData.horizontal_axis,
                    vertical_axis: chunkData.vertical_axis,
                  }
                : {
                    ...baseContourPayload,
                    urls: chunkData.contour_frame_urls,
                    ...mergedMetadata,
                  }
            ueMsg.update2DContourParams1(contourPayload)
            const vizLayerKindContour =
              radarSortedKeyCloud !== '' ? 'radar_cloud' : 'contour'
            const vizVariableContour =
              radarSortedKeyCloud !== '' ? radarSortedKeyCloud : cvResolved

            const images = chunkData.contour_frame_urls.map((url, index) => ({
              time_step: timeSteps[index],
              layerId: contourPayload.id,
              url: url.replace(/[`\s]/g, ''),
              png_url: url.replace(/[`\s]/g, ''),
              data: {
                physical_width: chunkData.physical_width,
                physical_height: chunkData.physical_height,
                geometric_center: chunkData.geometric_center,
                horizontal_axis: chunkData.horizontal_axis,
                vertical_axis: chunkData.vertical_axis,
                vmin: chunkData.vmin,
                vmax: chunkData.vmax,
              },
            }))
            upsertGeneratedVizLayer({
              id: contourPayload.id,
              kind: vizLayerKindContour,
              label: contourPayload.name || undefined,
              vmin: contourPayload.vmin,
              vmax: contourPayload.vmax,
              cmap: contourPayload.cmap || resolveSelectedCmap(),
              images,
              physicalTimes: timeSteps,
              variable: vizVariableContour,
              isMock: vizLayerKindContour === 'radar_cloud',
            })
            if (
              selectedLayerId &&
              contourPayload?.id &&
              ((vizLayerKindContour === 'radar_cloud' && mockRadarOnly) ||
                (vizLayerKindContour === 'contour' &&
                  contourVariable === primaryContourVidApply))
            ) {
              selectedLayerId.value = contourPayload.id
            }
          } else if (
            visualization2DType.value === 'vector' &&
            chunkData.vector_frame_urls?.length > 0
          ) {
            const timeSteps = chunkData.time_steps || chunkTimeSteps
            const payload = {
              ...build2DVectorParamsForUE(timeSteps),
              urls: chunkData.vector_frame_urls,
              ...mergedMetadata,
            }
            ueMsg.update2DVectorParams(payload)
            // 构建 images 数组，包含 time_step 信息
            const images = chunkData.vector_frame_urls.map((url, index) => ({
              time_step: timeSteps[index],
              layerId: payload.id,
              url: url.replace(/[`\s]/g, ''),
              png_url: url.replace(/[`\s]/g, ''),
              data: {
                physical_width: chunkData.physical_width,
                physical_height: chunkData.physical_height,
                geometric_center: chunkData.geometric_center,
                horizontal_axis: chunkData.horizontal_axis,
                vertical_axis: chunkData.vertical_axis,
                vmin: chunkData.vmin,
                vmax: chunkData.vmax,
              },
            }))
            upsertGeneratedVizLayer({
              id: payload.id,
              kind: 'vector',
              vmin: payload.vmin,
              vmax: payload.vmax,
              cmap: payload.cmap || resolveSelectedCmap(),
              images,
              physicalTimes: timeSteps,
            })
          }
        }

        // 缓存图片
        if (Array.isArray(urls)) {
          urls.forEach((url, index) => {
            if (index < chunkTimeSteps.length) {
              const frameEntry = {
                time_step: chunkTimeSteps[index],
                layerId:
                  visualization2DType.value === 'vector'
                    ? build2DVectorParamsForUE(chunkTimeSteps).id
                    : radarSortedKeyCloud !== ''
                      ? buildGeneratedLayerId('radar_cloud', {
                          variable: radarSortedKeyCloud,
                        })
                      : build2DContourParamsForUE(chunkTimeSteps, {
                          contourVariable: cvResolved,
                        }).id,
                url: url.replace(/[`\s]/g, ''),
                data: {
                  physical_width: chunkData.physical_width,
                  physical_height: chunkData.physical_height,
                  geometric_center: chunkData.geometric_center,
                  horizontal_axis: chunkData.horizontal_axis,
                  vertical_axis: chunkData.vertical_axis,
                  vmin: chunkData.vmin,
                  vmax: chunkData.vmax,
                },
              }
              if (
                visualization2DType.value !== 'cloud' ||
                contourVariable == null ||
                contourVariable === primaryContourVidApply ||
                String(contourVariable) === MOCK_RADAR_CLOUD_VARIABLE
              ) {
                batchLoadedImages.value.push(frameEntry)
              }
            }
          })
        }
      }

      // 应用开始时曾将 previewFrameCount 置 0；恢复为与时间轴一致，保证缩略图与播放状态正常
      if (
        Array.isArray(timelineTimeSteps.value) &&
        timelineTimeSteps.value.length > 0
      ) {
        previewFrameCount.value = timelineTimeSteps.value.length
        timelineTotalSteps.value = Math.max(
          0,
          timelineTimeSteps.value.length - 1,
        )
      }

      // 获取预览 - 始终显示第一张图片（时间步最小的），然后根据时间轴切换
      const firstTimeStep = stepsToFetchAndCache[0]
      const cachedImage = findLoadedImageByTimeStep(firstTimeStep) || batchLoadedImages.value[0]
      if (cachedImage) {
        previewImageUrl.value = displayUrlForCachedFrame(cachedImage)
      } else {
        // Fallback to API if not cached (simplified for brevity)
        previewImageUrl.value = allContourUrls[0] || allVectorUrls[0]
      }
      // 重置时间轴到起始位置
      timelineCurrentStep.value = 0
    } finally {
      isBatchLoading.value = false
      batchLoadProgress.value = 100
    }
  }

  return { apply2D }
}
