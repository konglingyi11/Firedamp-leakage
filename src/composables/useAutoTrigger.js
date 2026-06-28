import { ElMessage, ElMessageBox } from 'element-plus'
import postProcessingApi from '@/api/postProcessing.js'
import { taskApi } from '@/api/task.js'
import { gasNameMap } from '@/constants/gasVariables.js'
import { getVariableDisplayName } from '@/utils/gas'
import {
  sanitizeGlyphDensity,
  sanitizeVectorLineWidth,
  sanitizeVectorQualityPreset,
  sanitizeVectorTransparentBackground,
} from '@/utils/sanitize'
import {
  getCachedTaskVariables,
  setCachedTaskVariables,
} from '@/utils/taskVariablesCache'
import { resolvePregenVectorColorPayload } from '@/utils/vectorPregen'
import {
  isPregenProgressComplete,
  normalizePregenProgressResponse,
} from '@/utils/pregenProgress'
import {
  buildAutoPlaneCoords as buildCoords,
  clampAutoPlaneOffset as clampOffset,
} from './autoTrigger/coordinates.js'
import {
  buildFullVolumeDatasetCachePayload,
  getFullVolumeDatasetCacheKeys,
} from '@/utils/volumeDatasetCache.js'

/**
 * 自动触发可视化加载 composable
 * 从 HomeView.vue 提取，负责在进入首页或激活任务时自动加载预生成的体渲染/流线/矢量图数据。
 *
 * @param {Object} deps - 依赖注入
 * @param {import('@/stores/task').useTaskStore} deps.taskStore - 任务 store
 * @param {import('@/stores/visualization').useVisualizationStore} deps.vizStore - 可视化 store
 * @param {Object} deps.ueMsg - UE 消息总线 (useUeMessageBus 返回值)
 * @param {Object} deps.timeline - 时间轴 composable (useTimeline 返回值)
 * @param {Object} deps.layers - 图层管理 (useGeneratedLayers 返回值)
 * @param {Object} deps.viz3d - 3D 可视化 (use3DVisualization 返回值)
 * @param {Function} deps.sendTimelineStepToUE - 发送时间轴步进到 UE 的函数
 */
export function useAutoTrigger({
  taskStore,
  vizStore,
  ueMsg,
  timeline,
  layers,
  viz3d,
  sendTimelineStepToUE,
  playerRef,
  isMounted = () => true,
}) {
  let autoLoadPromise = null
  let autoLoadTaskId = null
  const autoLoadedTaskIds = new Set()
  const autoTimeStepsByTaskId = new Map()
  const autoPhysicalTimesByTaskId = new Map()
  const autoVariablesByTaskId = new Map()
  const AUTO_CONTOUR_EXCLUDED_VARS = new Set([
    'mass_fraction_of_air',
    'mass_fraction_of_co2',
    'mass_fraction_of_h2o',
  ])
  const AUTO_CONTOUR_PREFERRED_VARS = new Set(
    Object.keys(gasNameMap)
      .map((id) => String(id).toLowerCase())
      .filter((id) => !AUTO_CONTOUR_EXCLUDED_VARS.has(id)),
  )
  const AUTO_VOLUME_EXCLUDED_VARS = new Set([
    'pressure',
    'temperature',
    'mass_fraction_of_air',
  ])

  function filterExcludedVars(vars) {
    return vars.filter((id) => !AUTO_CONTOUR_EXCLUDED_VARS.has(String(id).toLowerCase()))
  }

  async function ensureTaskVariables(taskId) {
    if (!taskId) return []
    if (autoVariablesByTaskId.has(taskId)) {
      return autoVariablesByTaskId.get(taskId)
    }
    const cachedVariables = getCachedTaskVariables(taskId)
    if (cachedVariables) {
      autoVariablesByTaskId.set(taskId, cachedVariables)
      return cachedVariables
    }

    const res = await postProcessingApi.getTaskVariables(taskId)
    const variables = setCachedTaskVariables(taskId, res)
    if (variables.length === 0) {
      throw new Error('任务变量接口没有返回有效变量')
    }
    autoVariablesByTaskId.set(taskId, variables)
    return variables
  }

  async function resolveAutoVolumeVariables(taskId) {
    const allVariables = await ensureTaskVariables(taskId)
    // 自动体渲染只加载气体等目标变量，跳过基础场变量。
    const filteredVariables = allVariables.filter(variable => {
      const varLower = String(variable).toLowerCase()
      return !varLower.includes('velocity') && !AUTO_VOLUME_EXCLUDED_VARS.has(varLower)
    })
    return filteredVariables
  }

  function formatAutoLoadText(stageLabel, detail) {
    if (!stageLabel) return detail
    if (!detail) return stageLabel
    return `${stageLabel} · ${detail}`
  }

  function formatPlaneTag(plane, offset) {
    const planeText =
      String(plane ?? '')
        .trim()
        .toUpperCase() || 'XY'
    const n = Number(offset)
    if (!Number.isFinite(n)) return planeText
    const rounded =
      Math.abs(n - Math.round(n)) < 0.001
        ? Math.round(n)
        : Math.round(n * 100) / 100
    return `${planeText} ${rounded}`
  }

  function formatContourProgressText(stageLabel, variable, plane, offset) {
    const variableText = getVariableDisplayName(variable)
    const planeText =
      String(plane ?? '')
        .trim()
        .toUpperCase() || 'XY'
    return formatAutoLoadText(
      stageLabel,
      `${variableText} · 云图 · ${planeText}`,
    )
  }

  function hideGeneratedLayersByKind(kind) {
    const targets = layers.generatedVizLayers.value.filter(
      (layer) => layer.kind === kind,
    )
    for (const layer of targets) {
      layer.visible = false
      layers.sendVizLayerVisibilityToUE(layer)
    }
    if (targets.length > 0) {
    }
  }

  function markGeneratedLayersReady(kind, matcher = null) {
    const targets = layers.generatedVizLayers.value.filter((layer) => {
      if (layer.kind !== kind) return false
      return typeof matcher === 'function' ? matcher(layer) : true
    })
    for (const layer of targets) {
      layer.ready = true
    }
  }

  // ── 工具：解析有效时间步 ──
  function parseValidTimeSteps(raw) {
    return raw
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => Number.isFinite(Number(t)) && Number(t) !== 0)
      .map(({ i }) => raw[i])
  }

  function setTimelinePhysicalTimes(physicalTimes) {
    if (!timeline.timelinePhysicalTimes) return
    timeline.timelinePhysicalTimes.value = physicalTimes
  }

  function getTimelinePhysicalTimes() {
    return timeline.timelinePhysicalTimes?.value || []
  }

  /** 确保时间步已加载，若未加载则从 API 获取 */
  async function ensureTimeSteps(taskId) {
    if (!taskId) return []
    if (autoTimeStepsByTaskId.has(taskId)) {
      const cachedPhysicalTimes = autoPhysicalTimesByTaskId.get(taskId)
      if (Array.isArray(cachedPhysicalTimes)) {
        setTimelinePhysicalTimes(cachedPhysicalTimes)
      }
      return autoTimeStepsByTaskId.get(taskId)
    }

    const res = await postProcessingApi.getTaskTimeSteps(taskId)
    const raw = res.data?.time_steps || res.time_steps || []
    const physicalTimes = res.data?.physical_times || res.physical_times || []
    const steps = parseValidTimeSteps(raw)
    if (steps.length === 0) {
      throw new Error('时间步接口没有返回有效时间步')
    }
    const validPhysicalTimes =
      Array.isArray(physicalTimes) && physicalTimes.length === raw.length
        ? raw
            .map((t, i) => ({ t, physicalTime: physicalTimes[i] }))
            .filter(({ t }) => Number.isFinite(Number(t)) && Number(t) !== 0)
            .map(({ physicalTime }) => physicalTime)
        : steps

    autoTimeStepsByTaskId.set(taskId, steps)
    autoPhysicalTimesByTaskId.set(taskId, validPhysicalTimes)
    timeline.timelineTimeSteps.value = steps
    setTimelinePhysicalTimes(validPhysicalTimes)
    timeline.timelineTotalSteps.value = steps.length - 1
    vizStore.previewFrameCount.value = steps.length
    return steps
  }

  function buildAuto2DParamsForUE(plane, offset, steps, kind, opts = {}) {
    const taskId = taskStore.currentTaskId
    if (!taskId || !Array.isArray(steps) || steps.length === 0) return null

    const filteredSteps = steps.filter((t) => Number.isFinite(t) && t !== 0)
    if (filteredSteps.length === 0) return null

    const viz = vizStore.visualization.value
    const minOffset = opts.minOffset
    const maxOffset = opts.maxOffset
    const payload = {
      task_id: taskId,
      plane_type: plane,
      plane_offset: clampOffset(offset, minOffset, maxOffset),
      time_step: filteredSteps,
      quality: '2k',
      use_pregen: true,
    }

    if (kind === 'contour') {
      const variable = opts.variable
      if (!variable) return null
      payload.variable = variable
      const cmap = opts.cmap ?? viz.cmap ?? 'coolwarm'
      const hasExplicitCustomColors = Array.isArray(opts.customColors)
      const customColors = hasExplicitCustomColors
        ? opts.customColors.filter(Boolean)
        : Array.isArray(viz.custom_colors) && viz.custom_colors.length > 0
          ? viz.custom_colors.filter(Boolean)
          : null
      if (customColors) {
        payload.custom_colors = customColors
      } else {
        payload.cmap = cmap
      }
      payload.id = layers.buildGeneratedLayerId('contour', {
        variable,
        plane,
        coordinate: offset,
      })
      payload.name = layers.buildGeneratedLayerLabel('contour', {
        variable,
        plane,
        coordinate: offset,
      })
      payload.kind = 'contour'
    } else {
      payload.color = viz.vectorColor || '#ffffff'
      payload.id = layers.buildGeneratedLayerId('vector', {
        plane,
        coordinate: offset,
      })
      payload.name = layers.buildGeneratedLayerLabel('vector', {
        plane,
        coordinate: offset,
      })
      payload.kind = 'vector'
    }

    return payload
  }

  async function resolveAutoContourVariables(taskId) {
    const allVars = await ensureTaskVariables(taskId)
    const matchedPreferred = allVars.filter((id) =>
      AUTO_CONTOUR_PREFERRED_VARS.has(String(id).toLowerCase()),
    )
    if (matchedPreferred.length > 0) return matchedPreferred

    return allVars.filter((id) => {
      const lower = String(id).toLowerCase()
      return (
        lower.startsWith('mass_fraction_of_') &&
        !AUTO_CONTOUR_EXCLUDED_VARS.has(lower)
      )
    })
  }

  function getContourEntryMap(contourConfig) {
    if (!Array.isArray(contourConfig)) return {}
    return contourConfig.reduce((acc, item) => {
      const variable = String(item?.variable || '').trim()
      if (!variable) return acc
      acc[variable] = item
      return acc
    }, {})
  }

  async function resolveAutoSmokeVariables(taskId) {
    return resolveAutoContourVariables(taskId)
  }

  async function autoTriggerSmokeIfNeeded(task, progressOptions = {}) {
    const { stageLabel = '', keepBatchOpen = false } = progressOptions
    if (!isMounted()) return
    if (!task?.id) return

    vizStore.isBatchLoading.value = true
    vizStore.batchLoadingText.value = formatAutoLoadText(stageLabel, '烟雾层')
    vizStore.batchLoadCurrent.value = 0
    vizStore.batchLoadTotal.value = 1
    vizStore.batchLoadProgress.value = 0

    try {
      layers.registerGeneratedLayer('smoke', {
        smokeTotal: true,
        visible: false,
        ready: true,
        loaded: true,
        loadSource: 'auto',
      })
      if (isMounted()) {
        vizStore.batchLoadCurrent.value = 1
        vizStore.batchLoadProgress.value = 100
      }
      markGeneratedLayersReady('smoke')
    } catch (error) {
      console.error('[自动烟雾层] 注册失败:', error)
      ElMessage.error('烟雾层自动加载失败')
    } finally {
      if (!keepBatchOpen && isMounted()) {
        vizStore.isBatchLoading.value = false
      }
    }
  }

  // ── 自动体渲染 ──

  async function autoTriggerVolumeIfNeeded(task, progressOptions = {}) {
    const { stageLabel = '', keepBatchOpen = false } = progressOptions
    if (!isMounted()) return
    if (!task) return
    const pregen = task.pregen_config ?? task.params?.pregen_config
    if (!pregen) return

    const volumeConfig = pregen.volume ?? pregen.volume_texture
    if (!volumeConfig) return

    const vol = pregen.volume_texture ?? pregen.volume
    const resolution = vol?.resolution
    const samplingRatio = vol?.sampling_ratio

    const volumeMode =
      samplingRatio != null && samplingRatio > 0 ? 'sampling' : 'resolution'
    const resolvedResolution =
      resolution != null && resolution > 0 ? Number(resolution) : 64
    const resolvedSamplingRatio =
      samplingRatio != null && samplingRatio > 0 ? Number(samplingRatio) : null

    // 切换到 3D 体渲染模式
    vizStore.visualizationDimension.value = '3d'
    vizStore.visualization3DType.value = 'volume'
    vizStore.visualization.value.volume_res_mode = volumeMode
    vizStore.visualization.value.volume_resolution = resolvedResolution
    if (resolvedSamplingRatio != null) {
      vizStore.visualization.value.sampling_ratio = resolvedSamplingRatio
    }

    // 设置体渲染变量列表
    let resolvedVolumeVars
    try {
      resolvedVolumeVars = await resolveAutoVolumeVariables(task.id)
    } catch (error) {
      console.warn('[自动体渲染] 获取变量失败，停止自动加载:', error)
      return
    }
    if (!resolvedVolumeVars.length) return
    // 仍按全部变量请求/缓存体数据；不写 volume_variables，避免左侧与「可视化选项」初始显示全选。
    vizStore.visualization.value.volume_variables = []
    vizStore.visualization.value.variable = resolvedVolumeVars[0]

    // 获取时间步
    let steps
    try {
      steps = await ensureTimeSteps(task.id)
    } catch (e) {
      console.warn('[自动体渲染] 获取时间步失败:', e)
      return
    }
    if (!steps.length) return

    // 单次请求
    const taskId = task.id
    const varIds = [...resolvedVolumeVars]

    vizStore.isBatchLoading.value = true
    vizStore.batchLoadingText.value = formatAutoLoadText(stageLabel, '体渲染')
    vizStore.batchLoadCurrent.value = 0
    vizStore.batchLoadTotal.value = 1
    vizStore.batchLoadProgress.value = 0

    try {
      // 获取最新的任务详情，确保预生成配置是最新的
      const taskDetailRes = await taskApi.getTaskDetail(taskId)
      const latestTask = taskDetailRes?.data || taskDetailRes
      const latestPregen = latestTask?.pregen_config || latestTask?.params?.pregen_config
      
      // 从最新的任务详情中提取体渲染配置
      const latestVolumeConfig = latestPregen?.volume ?? latestPregen?.volume_texture
      const latestRes = latestVolumeConfig?.resolution
      const latestSamplingRatio = latestVolumeConfig?.sampling_ratio
      
      const latestResolvedResolution = latestRes != null && latestRes > 0 ? Number(latestRes) : 64
      const latestResolvedSamplingRatio = latestSamplingRatio != null && latestSamplingRatio > 0 ? Number(latestSamplingRatio) : null
      
      const allSteps = steps.filter((t) => t !== 0)
      // 一次请求所有时间步和所有变量
      const requestBody = {
        task_id: taskId,
        time_step: allSteps,
        variables: varIds,
        resolution: latestResolvedResolution,
        use_pregen: true,
      }
      if (latestResolvedSamplingRatio != null) {
        requestBody.sampling_ratio = latestResolvedSamplingRatio
      }

      console.log('[自动体渲染] 请求参数:', {
        taskId,
        resolution: latestResolvedResolution,
        samplingRatio: latestResolvedSamplingRatio,
        variablesCount: varIds.length,
        timeStepsCount: allSteps.length
      })

      const chunkRes = await postProcessingApi.getVolumeDataset(requestBody)
      const chunkData = chunkRes?.data ?? chunkRes

      playerRef.value?.cacheVolumePayload?.(
        buildFullVolumeDatasetCachePayload(chunkData, {
          taskId,
          timeSteps: allSteps,
          variables: varIds,
          usePregen: true,
          loadSource: 'auto',
        }),
        getFullVolumeDatasetCacheKeys(taskId),
      )

      const registeredVars = new Set()
      for (const vid of varIds) {
        if (!registeredVars.has(vid)) {
          layers.registerGeneratedLayer('volume', {
            volumeVariable: vid,
            visible: false,
            ready: true,
            loaded: true,
            usePregen: true,
            loadSource: 'auto',
          })
          registeredVars.add(vid)
        }
        const payload = viz3d.buildVolumeTextureChunkUePayload(
          vid,
          allSteps,
          [],
          [],
          [],
          chunkData || {},
        )
        if (!payload) continue
        // 写入本地 canvas 状态，使 volumeMode.sync() 能读取到 bin 文件地址
        playerRef.value?.cacheVolumePayload?.(payload)
        ueMsg.updateCloudTexture(payload)
      }

      // 只注册和缓存体渲染图层，默认不点亮，交给用户在图层列表中手动打开。
      markGeneratedLayersReady('volume')

      if (isMounted()) {
        vizStore.batchLoadProgress.value = 100
      }
    } catch (err) {
      console.error('[自动体渲染] 体渲染请求失败:', err)
      ElMessage.error('体渲染数据自动加载失败')
    } finally {
      if (!keepBatchOpen) {
        if (isMounted()) {
          vizStore.isBatchLoading.value = false
        }
      }
    }
  }

  // ── 自动流线图 ──

  async function autoTriggerStreamlineIfNeeded(task, progressOptions = {}) {
    const { stageLabel = '', keepBatchOpen = false } = progressOptions
    if (!isMounted()) return
    if (!task) {
      return
    }
    const pregen = task.pregen_config ?? task.params?.pregen_config
    if (!pregen) {
      return
    }

    const streamlineConfig = pregen.streamline
    if (!streamlineConfig) {
      return
    }

    const seedCount = streamlineConfig.seed_count
    const pointsPerStreamline = streamlineConfig.points_per_streamline
    if (
      (seedCount == null || seedCount <= 0) &&
      (pointsPerStreamline == null || pointsPerStreamline <= 0)
    ) {
      return
    }

    // 切换模式
    vizStore.visualizationDimension.value = '3d'
    vizStore.visualization3DType.value = 'streamline'

    if (!vizStore.visualization.value.streamline) {
      vizStore.visualization.value.streamline = {}
    }
    if (seedCount != null && seedCount > 0) {
      vizStore.visualization.value.streamline.seed_count = seedCount
    }
    if (pointsPerStreamline != null && pointsPerStreamline > 0) {
      vizStore.visualization.value.streamline.points_per_streamline =
        pointsPerStreamline
    }
    if (streamlineConfig.center != null) {
      vizStore.visualization.value.streamline.center = streamlineConfig.center
    }
    if (streamlineConfig.radius != null) {
      vizStore.visualization.value.streamline.radius = streamlineConfig.radius
    }
    if (streamlineConfig.maximum_streamline_length != null) {
      vizStore.visualization.value.streamline.maximum_streamline_length =
        streamlineConfig.maximum_streamline_length
    }
    vizStore.visualization.value.usePregen = true

    // 获取时间步
    let steps
    try {
      steps = await ensureTimeSteps(task.id)
    } catch (e) {
      console.warn('[自动流线] 获取时间步失败:', e)
      return
    }
    if (!steps.length) return

    const CHUNK_SIZE = 30
    const totalChunks = Math.max(1, Math.ceil(steps.length / CHUNK_SIZE))

    vizStore.isBatchLoading.value = true
    vizStore.batchLoadingText.value = formatAutoLoadText(stageLabel, '流线图')
    vizStore.batchLoadCurrent.value = 0
    vizStore.batchLoadTotal.value = totalChunks
    vizStore.batchLoadProgress.value = 0

    let done = 0
    try {
      // 先清空之前的流线（直接操作 Three.js，不走 UE）
      if (playerRef.value?.clearStreamlinePayload) {
        playerRef.value.clearStreamlinePayload()
      }

      const chunkJobs = Array.from({ length: totalChunks }, (_, i) => {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, steps.length)
        return { i, chunkTimeSteps: steps.slice(start, end) }
      })

      const resolvedSeedCount =
        vizStore.visualization.value.streamline?.seed_count ?? seedCount ?? 50
      const resolvedPointsPerStreamline =
        vizStore.visualization.value.streamline?.points_per_streamline ??
        pointsPerStreamline ??
        40
      const resolvedCenter =
        vizStore.visualization.value.streamline?.center ??
        streamlineConfig.center
      const resolvedRadius =
        vizStore.visualization.value.streamline?.radius ??
        streamlineConfig.radius
      const resolvedMaximumStreamlineLength =
        vizStore.visualization.value.streamline?.maximum_streamline_length ??
        streamlineConfig.maximum_streamline_length

      const chunkPromises = chunkJobs.map((job) => {
        const apiParams = {
          task_id: task.id,
          time_step: job.chunkTimeSteps,
          seed_count: resolvedSeedCount,
          points_per_streamline: resolvedPointsPerStreamline,
          use_pregen: true,
        }
        if (resolvedCenter != null) apiParams.center = resolvedCenter
        if (resolvedRadius != null) apiParams.radius = resolvedRadius
        if (resolvedMaximumStreamlineLength != null) {
          apiParams.maximum_streamline_length =
            resolvedMaximumStreamlineLength
        }

        return postProcessingApi
          .generateStreamline(apiParams)
          .then((chunkRes) => {
            const chunkData = chunkRes?.data ?? chunkRes
            let csvUrls = []
            if (Array.isArray(chunkData?.csv_urls)) {
              csvUrls = chunkData.csv_urls
            } else if (typeof chunkData?.csv_url === 'string') {
              csvUrls = [chunkData.csv_url]
            }
            done += 1
            if (isMounted()) {
              vizStore.batchLoadCurrent.value = done
              vizStore.batchLoadProgress.value = Math.round(
                (done / totalChunks) * 100,
              )
            }
            return { ...job, csvUrls }
          })
          .catch((err) => {
            console.warn(`[自动流线] 批次 ${job.i} 请求失败:`, err)
            done += 1
            if (isMounted()) {
              vizStore.batchLoadCurrent.value = done
              vizStore.batchLoadProgress.value = Math.round(
                (done / totalChunks) * 100,
              )
            }
            return { ...job, csvUrls: [] }
          })
      })

      const chunkResults = await Promise.all(chunkPromises)
      chunkResults.sort((a, b) => a.i - b.i)

      const displaySimStep = viz3d.resolveSimulationTimeStepAtSlideIndex(
        timeline.timelineCurrentStep.value,
      )

      // 合并所有 chunk 的 csv_urls 和 csv_time_steps，避免逐个覆盖导致只有最后一个 chunk 的数据
      const allCsvUrls = []
      const allCsvTimeSteps = []
      for (const r of chunkResults) {
        const { chunkTimeSteps, csvUrls } = r
        const cleanUrls = csvUrls
          .map((u) => (typeof u === 'string' ? u.replace(/[`\s]/g, '') : u))
          .filter(Boolean)
        if (cleanUrls.length === 0) continue
        allCsvUrls.push(...cleanUrls)
        allCsvTimeSteps.push(...chunkTimeSteps)
      }

      if (allCsvUrls.length > 0) {
        const payload = viz3d.buildStreamlineUeParams(displaySimStep, {
          csv_urls: allCsvUrls,
          csv_time_steps: allCsvTimeSteps,
        })
        console.log('[自动流线] 设置流线图 payload:', {
          csvUrlCount: allCsvUrls.length,
          timeStepCount: allCsvTimeSteps.length,
          displaySimStep,
          hasPlayerRef: !!playerRef.value,
          hasSetMethod: !!playerRef.value?.setStreamlinePayload,
        })
        // 直接设置到 Three.js，不走 UE
        if (playerRef.value?.setStreamlinePayload) {
          playerRef.value.setStreamlinePayload(payload)
          console.log('[自动流线] 流线图 payload 已设置')
        } else {
          console.warn(
            '[自动流线] playerRef 或 setStreamlinePayload 方法不可用',
          )
        }
      } else {
        console.warn('[自动流线] 没有可用的 CSV URLs')
      }

      layers.registerGeneratedLayer('streamline')
      console.log('[自动流线] 流线图图层已注册')
      markGeneratedLayersReady('streamline')
      console.log('[自动流线] 流线图图层标记为就绪')

      if (isMounted()) {
        vizStore.batchLoadProgress.value = 100
      }
    } catch (err) {
      console.error('[自动流线] 流线请求失败:', err)
      ElMessage.error('流线数据自动加载失败')
    } finally {
      if (!keepBatchOpen) {
        if (isMounted()) {
          vizStore.isBatchLoading.value = false
        }
      }
    }
  }

  // ── 自动矢量图 ──

  async function autoTriggerVectorIfNeeded(task, progressOptions = {}) {
    const { stageLabel = '', keepBatchOpen = false } = progressOptions
    if (!isMounted()) return
    if (!task) return
    const pregen = task.pregen_config ?? task.params?.pregen_config
    if (!pregen) return

    const vectorConfig = pregen.vector
    if (!vectorConfig) return

    // 只删除模拟矢量图层（isMock: true），保留手动加载的真实图层
    const mockVectorLayers = layers.generatedVizLayers.value.filter(
      (l) => l.kind === 'vector' && l.isMock === true,
    )
    for (const layer of mockVectorLayers) {
      layers.removeGeneratedLayer(layer)
    }
    if (mockVectorLayers.length > 0) {
      console.log(`[自动矢量图] 已清理 ${mockVectorLayers.length} 个模拟图层`)
    }

    // plane_spacing 在 pregen_config 根目录下，而非 vector 对象内
    const planeSpacing = Number(
      pregen.plane_spacing ?? vectorConfig.plane_spacing,
    )
    if (planeSpacing == null || planeSpacing <= 0) {
      console.warn('[自动矢量图] plane_spacing 无效:', planeSpacing)
      return
    }

    // 1. 获取几何边界
    let bounds
    try {
      const res = await postProcessingApi.getGeometryBounds(task.id)
      bounds = res?.data ?? res
    } catch (e) {
      console.warn('[自动矢量图] 获取几何边界失败:', e)
      return
    }
    const rawXMin = bounds?.xmin ?? bounds?.x_min ?? 0
    const rawXMax = bounds?.xmax ?? bounds?.x_max ?? 0
    const rawYMin = bounds?.ymin ?? bounds?.y_min ?? 0
    const rawYMax = bounds?.ymax ?? bounds?.y_max ?? 0
    const rawZMin = bounds?.zmin ?? bounds?.z_min ?? 0
    const rawZMax = bounds?.zmax ?? bounds?.z_max ?? 0
    const xmin = Number(rawXMin)
    const xmax = Number(rawXMax)
    const ymin = Number(rawYMin)
    const ymax = Number(rawYMax)
    const zmin = Number(rawZMin)
    const zmax = Number(rawZMax)
    if ([xmin, xmax, ymin, ymax, zmin, zmax].some((v) => !Number.isFinite(v))) {
      console.warn('[自动矢量图] 几何边界存在非数值:', bounds)
      return
    }

    const allPlanes = [
      { plane: 'xy', coords: buildCoords(zmin, zmax, planeSpacing) },
      { plane: 'yz', coords: buildCoords(xmin, xmax, planeSpacing) },
      { plane: 'xz', coords: buildCoords(ymin, ymax, planeSpacing) },
    ]

    // 3. 获取时间步
    let steps
    try {
      steps = await ensureTimeSteps(task.id)
    } catch (e) {
      console.warn('[自动矢量图] 获取时间步失败:', e)
      return
    }
    if (!steps.length) return

    // 4. 矢量请求参数
    const VECTOR_BATCH = 120
    const vectorColorParams = resolvePregenVectorColorPayload(
      vectorConfig,
      vizStore.visualization.value.vectorColor || '#ffffff',
    )
    const makeBaseParams = (plane, offset, minOffset, maxOffset) => ({
      task_id: task.id,
      plane_type: plane,
      plane_offset: clampOffset(offset, minOffset, maxOffset),
      quality: '2k',
      convertToPng: false,
      ...vectorColorParams,
      quality_preset: sanitizeVectorQualityPreset(vectorConfig.quality_preset),
      transparent_background: sanitizeVectorTransparentBackground(
        vectorConfig.transparent_background,
      ),
      glyph_density: sanitizeGlyphDensity(vectorConfig.glyph_density),
      line_width: sanitizeVectorLineWidth(vectorConfig.line_width),
      use_pregen: true,
    })

    const getPlaneMinOffset = (plane) => {
      if (plane === 'xy') return zmin
      if (plane === 'yz') return xmin
      if (plane === 'xz') return ymin
      return null
    }

    const getPlaneMaxOffset = (plane) => {
      if (plane === 'xy') return zmax
      if (plane === 'yz') return xmax
      if (plane === 'xz') return ymax
      return null
    }

    const totalTimeStepCount = steps.filter((t) => t !== 0).length
    const totalCoordCount = allPlanes.reduce((s, p) => s + p.coords.length, 0)
    const batchesPerCoordinate =
      totalTimeStepCount > 0 ? Math.ceil(totalTimeStepCount / VECTOR_BATCH) : 0
    const totalBatches = totalCoordCount * batchesPerCoordinate

    vizStore.isBatchLoading.value = true
    vizStore.batchLoadingText.value = formatAutoLoadText(stageLabel, '矢量图')
    vizStore.batchLoadCurrent.value = 0
    vizStore.batchLoadTotal.value = totalBatches
    vizStore.batchLoadProgress.value = 0

    // 注册图层
    for (const { plane, coords } of allPlanes) {
      for (const offset of coords) {
        layers.registerGeneratedLayer('vector', {
          plane,
          coordinate: offset,
          visible: false,
        })
      }
    }

    let doneBatches = 0
    let hasError = false

    try {
      // 构建所有批次请求，并行执行
      const batchJobs = []
      for (const { plane, coords } of allPlanes) {
        for (const offset of coords) {
          const filteredSteps = steps.filter((t) => t !== 0)
          for (let i = 0; i < filteredSteps.length; i += VECTOR_BATCH) {
            const batch = filteredSteps.slice(i, i + VECTOR_BATCH)
            batchJobs.push({ plane, offset, batch, batchIndex: i })
          }
        }
      }

      const batchPromises = batchJobs.map((job) => {
        return postProcessingApi
          .getVectorsByTimeSteps({
            ...makeBaseParams(
              job.plane,
              job.offset,
              getPlaneMinOffset(job.plane),
              getPlaneMaxOffset(job.plane),
            ),
            time_steps: job.batch,
          })
          .then((res) => {
            doneBatches++
            if (isMounted()) {
              vizStore.batchLoadCurrent.value = doneBatches
              vizStore.batchLoadProgress.value = Math.round(
                (doneBatches / totalBatches) * 100,
              )
            }
            return { ...job, results: res ?? [] }
          })
          .catch((err) => {
            console.warn(
              `[自动矢量图] plane=${job.plane} offset=${job.offset} 请求失败:`,
              err,
            )
            hasError = true
            doneBatches++
            if (isMounted()) {
              vizStore.batchLoadCurrent.value = doneBatches
              vizStore.batchLoadProgress.value = Math.round(
                (doneBatches / totalBatches) * 100,
              )
            }
            return { ...job, results: [] }
          })
      })

      const allResults = await Promise.all(batchPromises)

      // 按 (plane, offset) 分组，汇总结果后更新图层
      const layerEntriesMap = new Map()
      for (const { plane, offset, results } of allResults) {
        const key = `${plane}::${offset}`
        if (!layerEntriesMap.has(key)) {
          layerEntriesMap.set(key, { plane, offset, entries: [] })
        }
        const entry = layerEntriesMap.get(key)
        if (Array.isArray(results)) {
          for (const result of results) {
            if (!result.success) continue
            const svgUrl =
              result.data?.svg_url ||
              result.data?.vector_url ||
              result.data?.contour_frame_url ||
              result.data?.url
            const pngUrl = result.data?.png_url || svgUrl
            entry.entries.push({
              time_step: result.time_step,
              svg_url: svgUrl,
              png_url: pngUrl,
              url: pngUrl,
              data: result.data,
            })
          }
        }
      }

      // 更新图层
      for (const [, { plane, offset, entries }] of layerEntriesMap) {
        const layerId = layers.buildGeneratedLayerId('vector', {
          plane,
          coordinate: offset,
        })
        const layer = layers.generatedVizLayers.value.find(
          (l) => String(l.id) === String(layerId),
        )
        if (layer) {
          layer.images.push(...entries)
          layer.ready = true
        }
      }

      // 通知 UE
      for (const { plane, coords } of allPlanes) {
        for (const offset of coords) {
          const filteredSteps = steps.filter((t) => t !== 0)
          if (filteredSteps.length === 0) continue
          const payload = buildAuto2DParamsForUE(
            plane,
            offset,
            filteredSteps,
            'vector',
            {
              minOffset: getPlaneMinOffset(plane),
              maxOffset: getPlaneMaxOffset(plane),
            },
          )
          if (payload) {
            const layerId = layers.buildGeneratedLayerId('vector', {
              plane,
              coordinate: offset,
            })
            const layer = layers.generatedVizLayers.value.find(
              (l) => String(l.id) === String(layerId),
            )
            if (layer) {
              layer.images = layer.images || []
            }
            ueMsg.update2DVectorParams(payload)
          }
        }
      }
      const vecLayers = layers.generatedVizLayers.value.filter(
        (l) => l.kind === 'vector',
      )
      markGeneratedLayersReady('vector')
      for (const lyr of vecLayers) {
        layers.sendVizLayerVisibilityToUE(lyr)
      }
      sendTimelineStepToUE(0)

      if (isMounted()) {
        vizStore.batchLoadProgress.value = 100
      }
      if (hasError) {
        ElMessage.warning('矢量图数据自动加载完成（部分平面/时间步加载失败）')
      }
    } catch (err) {
      console.error('[自动矢量图] 请求失败:', err)
      ElMessage.error('矢量图数据自动加载失败')
    } finally {
      if (!keepBatchOpen) {
        if (isMounted()) {
          vizStore.isBatchLoading.value = false
        }
      }
    }
  }

  // ── 入口：进入首页时检测并自动加载 ──

  async function autoTriggerContourIfNeeded(task, progressOptions = {}) {
    const { stageLabel = '', keepBatchOpen = false } = progressOptions
    if (!isMounted()) return
    if (!task) return
    const pregen = task.pregen_config ?? task.params?.pregen_config
    if (!pregen) return

    const contourConfig = pregen.contour
    if (!contourConfig) return

    // 只删除模拟云图图层（isMock: true），保留手动加载的真实图层
    const mockContourLayers = layers.generatedVizLayers.value.filter(
      (l) =>
        ((l.kind === 'contour' || l.kind === 'cloud') && l.isMock === true) ||
        (l.kind === 'radar_cloud' && l.isMock === true),
    )
    for (const layer of mockContourLayers) {
      layers.removeGeneratedLayer(layer)
    }
    if (mockContourLayers.length > 0) {
      console.log(`[自动云图] 已清理 ${mockContourLayers.length} 个模拟图层`)
    }

    const contourEntryMap = getContourEntryMap(contourConfig)
    let apiVariables
    try {
      apiVariables = await ensureTaskVariables(task.id)
    } catch (error) {
      console.warn('[自动云图] 获取变量失败，停止自动加载:', error)
      return
    }
    const apiVariableSet = new Set(apiVariables)
    const contourVariables = Array.isArray(contourConfig)
      ? contourConfig
          .map((item) => String(item?.variable || '').trim())
          .filter((variable) => variable && apiVariableSet.has(variable))
      : await resolveAutoContourVariables(task.id)
    if (!contourVariables.length) {
      console.warn('[自动云图] 未解析到可自动请求的气体变量')
      return
    }

    const planeSpacing = Number(
      pregen.plane_spacing ?? contourConfig.plane_spacing,
    )
    if (planeSpacing == null || planeSpacing <= 0) {
      console.warn('[自动云图] plane_spacing 无效:', planeSpacing)
      return
    }

    let bounds
    try {
      const res = await postProcessingApi.getGeometryBounds(task.id)
      bounds = res?.data ?? res
    } catch (e) {
      console.warn('[自动云图] 获取几何边界失败:', e)
      return
    }

    const rawXMin = bounds?.xmin ?? bounds?.x_min ?? 0
    const rawXMax = bounds?.xmax ?? bounds?.x_max ?? 0
    const rawYMin = bounds?.ymin ?? bounds?.y_min ?? 0
    const rawYMax = bounds?.ymax ?? bounds?.y_max ?? 0
    const rawZMin = bounds?.zmin ?? bounds?.z_min ?? 0
    const rawZMax = bounds?.zmax ?? bounds?.z_max ?? 0
    const xmin = Number(rawXMin)
    const xmax = Number(rawXMax)
    const ymin = Number(rawYMin)
    const ymax = Number(rawYMax)
    const zmin = Number(rawZMin)
    const zmax = Number(rawZMax)
    if ([xmin, xmax, ymin, ymax, zmin, zmax].some((v) => !Number.isFinite(v))) {
      console.warn('[自动云图] 几何边界存在非法数值:', bounds)
      return
    }

    const allPlanes = [
      { plane: 'xy', coords: buildCoords(zmin, zmax, planeSpacing) },
      { plane: 'yz', coords: buildCoords(xmin, xmax, planeSpacing) },
      { plane: 'xz', coords: buildCoords(ymin, ymax, planeSpacing) },
    ]

    let steps
    try {
      steps = await ensureTimeSteps(task.id)
    } catch (e) {
      console.warn('[自动云图] 获取时间步失败:', e)
      return
    }
    if (!steps.length) return

    const filteredSteps = steps.filter((t) => t !== 0)
    if (!filteredSteps.length) {
      console.warn('[自动云图] 没有可用于请求的非 0 时间步')
      return
    }

    const CONTOUR_BATCH = 60
    const contourCmap = contourConfig.cmap ?? 'coolwarm'
    const contourCustomColors = Array.isArray(contourConfig.custom_colors)
      ? contourConfig.custom_colors.filter(Boolean)
      : []
    const contourVariableCmaps =
      contourConfig.variable_cmaps ?? contourConfig.gas_cmaps ?? {}

    const getPlaneMinOffset = (plane) => {
      if (plane === 'xy') return zmin
      if (plane === 'yz') return xmin
      if (plane === 'xz') return ymin
      return null
    }

    const getPlaneMaxOffset = (plane) => {
      if (plane === 'xy') return zmax
      if (plane === 'yz') return xmax
      if (plane === 'xz') return ymax
      return null
    }

    const totalCoordCount = allPlanes.reduce(
      (sum, p) => sum + p.coords.length,
      0,
    )
    const batchesPerLayer = Math.ceil(filteredSteps.length / CONTOUR_BATCH)
    const totalBatches =
      contourVariables.length * totalCoordCount * batchesPerLayer

    if (totalBatches <= 0) return

    const rawExisting = vizStore.visualization.value.variable
    const existingStr =
      rawExisting != null && String(rawExisting).trim() !== ''
        ? String(rawExisting).trim()
        : ''
    const primaryCloudVar =
      existingStr &&
      contourVariables.some((id) => String(id) === existingStr)
        ? existingStr
        : contourVariables[0]

    // 预生成仍按 contourVariables 全量拉取；勾选默认只保留主变量，避免云图气体默认全选
    vizStore.visualization.value.cloud_variables = [primaryCloudVar]
    if (
      !vizStore.visualization.value.variable ||
      !contourVariables.some(
        (id) =>
          String(id) === String(vizStore.visualization.value.variable).trim(),
      )
    ) {
      vizStore.visualization.value.variable = primaryCloudVar
    }

    vizStore.isBatchLoading.value = true
    vizStore.batchLoadingText.value = formatAutoLoadText(stageLabel, '云图')
    vizStore.batchLoadCurrent.value = 0
    vizStore.batchLoadTotal.value = totalBatches
    vizStore.batchLoadProgress.value = 0

    for (const variable of contourVariables) {
      for (const { plane, coords } of allPlanes) {
        for (const offset of coords) {
          layers.registerGeneratedLayer('contour', {
            variable,
            plane,
            coordinate: offset,
            visible: false,
          })
          const layerId = layers.buildGeneratedLayerId('contour', {
            variable,
            plane,
            coordinate: offset,
          })
          const layer = layers.generatedVizLayers.value.find(
            (l) => String(l.id) === String(layerId),
          )
          if (layer) {
            layer.images = []
            layer.physicalTimes = []
            layer.physicalWidth = null
            layer.physicalHeight = null
            layer.vmin = null
            layer.vmax = null
            layer.ready = false
            layer.loaded = false
          }
        }
      }
    }

    let doneBatches = 0
    let hasError = false

    try {
      // 构建所有批次请求，并行执行
      const batchJobs = []
      for (const variable of contourVariables) {
        for (const { plane, coords } of allPlanes) {
          for (const offset of coords) {
            for (let i = 0; i < filteredSteps.length; i += CONTOUR_BATCH) {
              const batch = filteredSteps.slice(i, i + CONTOUR_BATCH)
              batchJobs.push({ variable, plane, offset, batch, batchIndex: i })
            }
          }
        }
      }

      const timeStepToPhysicalTime = new Map()
      if (
        Array.isArray(timeline.timelineTimeSteps.value) &&
        Array.isArray(getTimelinePhysicalTimes())
      ) {
        timeline.timelineTimeSteps.value.forEach((timeStep, index) => {
          const physicalTime = getTimelinePhysicalTimes()[index]
          if (physicalTime != null) {
            timeStepToPhysicalTime.set(Number(timeStep), physicalTime)
          }
        })
      }

      const syncContourLayerFromBatch = (job, entries, vmin, vmax) => {
        if (!entries.length) return

        const layerId = layers.buildGeneratedLayerId('contour', {
          variable: job.variable,
          plane: job.plane,
          coordinate: job.offset,
        })
        const layer = layers.generatedVizLayers.value.find(
          (l) => String(l.id) === String(layerId),
        )
        if (!layer) return

        layer.images = Array.isArray(layer.images) ? layer.images : []
        for (const frameEntry of entries) {
          const exists = layer.images.some(
            (img) => Number(img.time_step) === Number(frameEntry.time_step),
          )
          if (!exists) {
            layer.images.push(frameEntry)
          }
        }
        layer.images.sort((a, b) => Number(a.time_step) - Number(b.time_step))
        layer.physicalTimes = layer.images.map((img) => {
          const physicalTime = timeStepToPhysicalTime.get(Number(img.time_step))
          return physicalTime ?? img.time_step
        })
        layer.ready = true
        layer.loaded = true
        if (vmin != null) layer.vmin = vmin
        if (vmax != null) layer.vmax = vmax
        const contourEntry = contourEntryMap[job.variable]
        const entryCustomColors = Array.isArray(contourEntry?.custom_colors)
          ? contourEntry.custom_colors.filter(Boolean)
          : []
        const variableCmap = contourVariableCmaps?.[job.variable] || contourCmap
        if (entryCustomColors.length > 0) {
          layer.custom_colors = entryCustomColors
          layer.cmap = contourCmap
        } else if (variableCmap === 'custom' && contourCustomColors.length > 0) {
          layer.custom_colors = contourCustomColors
          layer.cmap = contourCmap
        } else {
          layer.custom_colors = null
          layer.cmap = variableCmap === 'custom' ? 'coolwarm' : variableCmap
        }

        const firstData = layer.images[0]?.data
        const physicalWidth = Number(
          firstData?.physical_width ?? firstData?.physicalWidth,
        )
        const physicalHeight = Number(
          firstData?.physical_height ?? firstData?.physicalHeight,
        )
        if (Number.isFinite(physicalWidth) && physicalWidth > 0) {
          layer.physicalWidth = physicalWidth
        }
        if (Number.isFinite(physicalHeight) && physicalHeight > 0) {
          layer.physicalHeight = physicalHeight
        }

        const payload = buildAuto2DParamsForUE(
          job.plane,
          job.offset,
          layer.images.map((img) => img.time_step),
          'contour',
          {
            variable: job.variable,
            cmap:
              Array.isArray(contourEntryMap[job.variable]?.custom_colors) &&
              contourEntryMap[job.variable].custom_colors.length > 0
                ? contourCmap
                : contourVariableCmaps?.[job.variable] === 'custom'
                  ? contourCmap
                  : contourVariableCmaps?.[job.variable] || contourCmap,
            customColors:
              Array.isArray(contourEntryMap[job.variable]?.custom_colors) &&
              contourEntryMap[job.variable].custom_colors.length > 0
                ? contourEntryMap[job.variable].custom_colors
                : contourVariableCmaps?.[job.variable] === 'custom'
                  ? contourCustomColors
                  : [],
            minOffset: getPlaneMinOffset(job.plane),
            maxOffset: getPlaneMaxOffset(job.plane),
          },
        )
        if (payload) {
          ueMsg.update2DContourParams1({
            ...payload,
            urls: layer.images.map((img) => img.png_url || img.svg_url || img.url),
            vmin: layer.vmin,
            vmax: layer.vmax,
            physical_width: layer.physicalWidth,
            physical_height: layer.physicalHeight,
            geometric_center: firstData?.geometric_center,
            horizontal_axis: firstData?.horizontal_axis,
            vertical_axis: firstData?.vertical_axis,
          })
        }
      }

      const CONTOUR_REQUEST_CONCURRENCY = 6
      const runContourBatchJob = (job) => {
        const contourEntry = contourEntryMap[job.variable]
        const entryCustomColors = Array.isArray(
          contourEntry?.custom_colors,
        )
          ? contourEntry.custom_colors.filter(Boolean)
          : []
        const variableCmap =
          contourVariableCmaps?.[job.variable] || contourCmap
        const useCustomColors =
          entryCustomColors.length > 0 ||
          (variableCmap === 'custom' && contourCustomColors.length > 0)

        const params = {
          task_id: task.id,
          plane_type: job.plane,
          plane_offset: clampOffset(
            job.offset,
            getPlaneMinOffset(job.plane),
            getPlaneMaxOffset(job.plane),
          ),
          variable: job.variable,
          use_pregen: true,
          time_steps: job.batch,
        }
        if (useCustomColors) {
          params.custom_colors =
            entryCustomColors.length > 0
              ? entryCustomColors
              : contourCustomColors
        }

        return postProcessingApi
          .getContoursByTimeSteps(params)
          .then((results) => {
            doneBatches++
            if (isMounted()) {
              vizStore.batchLoadCurrent.value = doneBatches
              vizStore.batchLoadProgress.value = Math.round(
                (doneBatches / totalBatches) * 100,
              )
            }
            const entries = []
            let vmin = null
            let vmax = null
            if (Array.isArray(results)) {
              for (const result of results) {
                if (!result?.success) continue
                const svgUrl =
                  result.data?.svg_url ||
                  result.data?.contour_frame_url ||
                  result.data?.url
                const pngUrl = result.data?.png_url || svgUrl
                entries.push({
                  time_step: result.time_step,
                  svg_url: svgUrl,
                  png_url: pngUrl,
                  url: pngUrl,
                  data: result.data,
                })
                if (vmin == null && result.data?.vmin != null) {
                  vmin = result.data.vmin
                }
                if (vmax == null && result.data?.vmax != null) {
                  vmax = result.data.vmax
                }
              }
            }
            syncContourLayerFromBatch(job, entries, vmin, vmax)
            return { ...job, entries, vmin, vmax }
          })
          .catch((err) => {
            console.warn(
              `[自动云图] variable=${job.variable} plane=${job.plane} offset=${job.offset} 请求失败:`,
              err,
            )
            hasError = true
            doneBatches++
            if (isMounted()) {
              vizStore.batchLoadCurrent.value = doneBatches
              vizStore.batchLoadProgress.value = Math.round(
                (doneBatches / totalBatches) * 100,
              )
            }
            return { ...job, entries: [], vmin: null, vmax: null }
          })
      }

      let nextBatchJobIndex = 0
      const contourWorkers = Array.from(
        { length: Math.min(CONTOUR_REQUEST_CONCURRENCY, batchJobs.length) },
        async () => {
          while (nextBatchJobIndex < batchJobs.length) {
            const job = batchJobs[nextBatchJobIndex++]
            await runContourBatchJob(job)
          }
        },
      )

      await Promise.all(contourWorkers)

      markGeneratedLayersReady('contour')
      sendTimelineStepToUE(0)

      if (isMounted()) {
        vizStore.batchLoadProgress.value = 100
      }
      if (hasError) {
        ElMessage.warning(
          '云图数据自动加载完成（部分气体/平面/时间步加载失败）',
        )
      }
    } catch (err) {
      ElMessage.error('云图数据自动加载失败')
    } finally {
      if (!keepBatchOpen) {
        if (isMounted()) {
          vizStore.isBatchLoading.value = false
        }
      }
    }
  }

  async function tryAutoLoadOnHomeEnter() {
    const task = taskStore.currentTask

    if (!task) {
      return
    }

    // 只有已完成的任务才自动加载可视化数据
    if (task.status !== 'completed') {
      console.log('[自动加载] 任务未完成，跳过自动加载:', task.status)
      return
    }

    // 当前任务已经自动加载过且未切换任务，避免重复加载
    if (autoLoadedTaskIds.has(task.id)) {
      console.log('[自动加载] 当前任务已加载过，跳过:', task.id)
      return
    }

    if (autoLoadPromise && autoLoadTaskId === task.id) {
      return autoLoadPromise
    }

    autoLoadTaskId = task.id
    autoLoadPromise = (async () => {
      layers.purgeExcludedGeneratedLayers?.()
      // 自动加载必须使用接口返回的时间步和变量，任一接口失败都停止后续加载。
      try {
        await Promise.all([ensureTimeSteps(task.id), ensureTaskVariables(task.id)])
      } catch (error) {
        console.warn('[自动加载] 时间步或变量接口失败，停止自动加载:', error)
        return false
      }

      const pregen = task.pregen_config ?? task.params?.pregen_config

      if (!pregen) {
        return
      }

      // 检查预生成进度，只有预生成完成后才开始自动加载
      let pregenStatus = null
      let pregenProgressValue = 0
      try {
        const pregenProgressRes = await taskApi.getTaskPregenProgress(task.id)
        const pregenProgress = normalizePregenProgressResponse(pregenProgressRes)
        pregenStatus = pregenProgress.status
        pregenProgressValue = pregenProgress.progress

        console.log('[自动加载] 预生成状态:', {
          status: pregenStatus,
          progress: pregenProgressValue,
          majorPhase: pregenProgress.majorPhaseName,
          minorPhase: pregenProgress.minorPhaseName,
        })

        // 只有预生成完成（completed）或进度达到 100% 时才继续
        if (!isPregenProgressComplete(pregenProgress)) {
          console.log(
            '[自动加载] 预生成未完成，跳过自动加载。状态:',
            pregenStatus,
            '进度:',
            pregenProgressValue,
          )
          return
        }
      } catch (error) {
        console.warn('[自动加载] 获取预生成进度失败，跳过自动加载:', error)
        return
      }

      const autoJobs = []
      let volumeAutoJob = null
      let hasVolumeAutoJob = false
      if (pregen.volume || pregen.volume_texture) {
        hasVolumeAutoJob = true
        volumeAutoJob = {
          label: '体渲染',
          run: (opts) => autoTriggerVolumeIfNeeded(task, opts),
        }
        autoJobs.push(volumeAutoJob)
        autoJobs.push({
          label: '烟雾层',
          run: (opts) => autoTriggerSmokeIfNeeded(task, opts),
        })
      }
      if (pregen.streamline) {
        autoJobs.push({
          label: '流线图',
          run: (opts) => autoTriggerStreamlineIfNeeded(task, opts),
        })
      }
      if (pregen.vector) {
        autoJobs.push({
          label: '矢量图',
          run: (opts) => autoTriggerVectorIfNeeded(task, opts),
        })
      }
      if (pregen.contour) {
        autoJobs.push({
          label: '云图',
          run: (opts) => autoTriggerContourIfNeeded(task, opts),
        })
      }

      if (autoJobs.length === 0) {
        return
      }

      try {
        await ElMessageBox.confirm(
          `检测到可自动加载的预生成数据：${autoJobs.map((j) => j.label).join('、')}，是否继续？`,
          '确认自动加载',
          {
            confirmButtonText: '继续加载',
            cancelButtonText: '取消',
            type: 'warning',
            customClass: 'worker-dialog',
            closeOnClickModal: false,
            closeOnPressEscape: false,
          },
        )
      } catch {
        ElMessage.info('已取消自动加载')
        return false
      }

      const runAutoJob = (job) =>
        job
          .run({
            stageLabel: `自动加载`,
            keepBatchOpen: true,
          })
          .catch((error) => {
            console.error(`[自动加载] ${job.label} 执行失败:`, error)
          })

      console.log('[自动加载] 开始执行任务:', autoJobs.map((j) => j.label).join(', '))
      if (volumeAutoJob) {
        await runAutoJob(volumeAutoJob)
      }

      const remainingJobs = autoJobs.filter((job) => job !== volumeAutoJob)
      await Promise.all(remainingJobs.map((job) => runAutoJob(job)))

      // 首页自动加载完成后：若包含体渲染任务，默认进入体渲染显示
      if (hasVolumeAutoJob) {
        vizStore.visualizationDimension.value = '3d'
        vizStore.visualization3DType.value = 'volume'
      }

      if (isMounted()) {
        vizStore.batchLoadProgress.value = 100
        vizStore.batchLoadCurrent.value = vizStore.batchLoadTotal.value
        vizStore.batchLoadingText.value = `自动加载完成 ${autoJobs.length}/${autoJobs.length}`
        vizStore.isBatchLoading.value = false
      }
      timeline.hasAppliedSettings.value = true
      timeline.isTimelineCollapsed.value = false
      autoLoadedTaskIds.add(task.id)
      return true
    })()

    try {
      return await autoLoadPromise
    } finally {
      if (autoLoadTaskId === task.id) {
        autoLoadPromise = null
        autoLoadTaskId = null
      }
    }
  }

  return {
    autoTriggerVolumeIfNeeded,
    autoTriggerSmokeIfNeeded,
    autoTriggerStreamlineIfNeeded,
    autoTriggerVectorIfNeeded,
    autoTriggerContourIfNeeded,
    tryAutoLoadOnHomeEnter,
    resetAutoLoadState: () => {
      autoLoadedTaskIds.clear()
      autoTimeStepsByTaskId.clear()
      autoPhysicalTimesByTaskId.clear()
      autoVariablesByTaskId.clear()
      autoLoadPromise = null
      autoLoadTaskId = null
    },
  }
}
