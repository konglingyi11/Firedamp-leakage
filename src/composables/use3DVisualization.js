import {
  extractCatalogColormapColors,
  findCatalogColormapEntry,
  pickLocalCatalogColormapForRadarVolume,
} from '@/utils/volumeColormap.js'
import {
  parseColorToRgba,
  rgbByteToFloat01,
  alphaToFloat01,
} from '@/utils/color'
import { sanitizeRadarFrequencies } from '@/constants/radarFrequencies.js'
import {
  buildRadarMockVolumeVariableId,
  isRadarMockVolumeVariableId,
} from '@/utils/mockRadarVolume3d.js'

/** 与 use2DVisualization CMAP_MAP 一致：体渲染按变量 gasCmaps 选色带 */
const VOLUME_SCHEME_TO_CMAP = {
  default: 'coolwarm',
  thermal: 'hot',
  speed: 'viridis',
  multicolor: 'jet',
  grayscale: 'gray',
}

/**
 * 体渲染 + 流线参数构造（纯函数，不管理 timeline 状态）
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.currentTask
 * @param {import('vue').Ref} deps.visualization
 * @param {import('vue').Ref} deps.timelineTimeSteps
 * @param {Object} deps.layers - { buildGeneratedLayerId, buildGeneratedLayerLabel }
 * @param {Function} deps.resolveSelectedCmap
 * @param {import('vue').Ref<Array<{ id: string, name?: string, colors?: string[], color_map_url?: string }>>} [deps.colorMapCatalog] 接口色带列表
 */
export function use3DVisualization({
  currentTask,
  visualization,
  timelineTimeSteps,
  layers,
  resolveSelectedCmap,
  colorMapCatalog,
}) {
  /** 从 gasCmaps 中查找色带方案，支持大小写不敏感匹配 */
  function lookupGasScheme(gasCmaps, variableId) {
    if (!gasCmaps || !variableId) return undefined
    if (gasCmaps[variableId] != null && String(gasCmaps[variableId]).trim() !== '') {
      return gasCmaps[variableId]
    }
    const lowerId = String(variableId).toLowerCase()
    for (const [key, value] of Object.entries(gasCmaps)) {
      if (String(key).toLowerCase() === lowerId && value != null && String(value).trim() !== '') {
        return value
      }
    }
    return undefined
  }

  function findApiColorMapEntry(scheme) {
    return findCatalogColormapEntry(colorMapCatalog?.value, scheme)
  }
  function listVolumeVariableIdsForUE() {
    const volVarsRaw = visualization.value.volume_variables
    const volVars = Array.isArray(volVarsRaw)
      ? volVarsRaw.filter((x) => x != null && String(x).trim() !== '')
      : []
    const radarBands = sanitizeRadarFrequencies(
      visualization.value.radar_frequencies ?? visualization.value.radar_frequency,
    )
    const primaryVar = String(visualization.value.variable || '').trim()

    let base = []
    if (volVars.length > 0) {
      base = [...volVars]
    } else if (primaryVar) {
      // 兼容仅写入 visualization.variable、未同步 volume_variables 的旧路径
      base = [primaryVar]
    }

    if (radarBands.length > 0) {
      base.push(...radarBands.map((id) => buildRadarMockVolumeVariableId(id)))
    }

    return [...new Set(base.map((x) => String(x).trim()).filter(Boolean))]
  }

  const volumeColorEntryForUE = (hex) => {
    const c = parseColorToRgba(hex || '#ffffff')
    const h = typeof hex === 'string' && hex.trim() ? hex.trim() : '#ffffff'
    return {
      color_hex: h,
      r: rgbByteToFloat01(c.r),
      g: rgbByteToFloat01(c.g),
      b: rgbByteToFloat01(c.b),
      a: alphaToFloat01(c.a),
      rgba: c.rgba,
    }
  }

  /** 体渲染 CSV 缓存/预取性能参数（与 UE 侧 Performance 面板一致，snake_case 下发） */
  function volumeCsvPerformanceForUe() {
    const c = visualization.value?.volume_csv
    const maxFrames = Number(c?.frame_memory_cache_max_frames)
    const ahead = Number(c?.prefetch_ahead_frames)
    const concurrent = Number(c?.prefetch_max_concurrent_requests)
    const warmup = Number(c?.warmup_prefetch_frames_at_init)
    return {
      enable_csv_frame_memory_cache: !!c?.enable_frame_memory_cache,
      csv_frame_memory_cache_max_frames:
        Number.isFinite(maxFrames) && maxFrames >= 0
          ? Math.round(maxFrames)
          : 1,
      enable_csv_prefetch: !!c?.enable_prefetch,
      csv_prefetch_ahead_frames:
        Number.isFinite(ahead) && ahead >= 0 ? Math.round(ahead) : 0,
      csv_prefetch_max_concurrent_requests:
        Number.isFinite(concurrent) && concurrent >= 1
          ? Math.round(concurrent)
          : 1,
      // 与「初始化预取全部帧」互斥：全量预取时不下发预热帧数
      csv_warmup_prefetch_frames_at_init: c?.prefetch_all_frames_at_init
        ? 0
        : Number.isFinite(warmup) && warmup >= 0
          ? Math.round(warmup)
          : 0,
      csv_prefetch_all_frames_at_init: !!c?.prefetch_all_frames_at_init,
      preserve_csv_cache_on_reinit: !!c?.preserve_csv_cache_on_reinit,
    }
  }

  function getVolumeTextureCommonFieldsForUE(variableId) {
    const taskId = currentTask.value?.id
    const varId =
      variableId != null && String(variableId).trim() !== ''
        ? String(variableId).trim()
        : null
    if (!varId) return null
    const isRadarMock = isRadarMockVolumeVariableId(varId)
    const hasTask = taskId != null && String(taskId).trim() !== ''
    if (!hasTask && !isRadarMock) return null
    const effectiveTaskId = hasTask ? String(taskId) : 'local-radar-mock'
    let gasScheme = lookupGasScheme(visualization.value.gasCmaps, varId)
    if (
      isRadarMockVolumeVariableId(varId) &&
      (gasScheme == null || String(gasScheme).trim() === '')
    ) {
      const picked = pickLocalCatalogColormapForRadarVolume(
        visualization.value,
        colorMapCatalog?.value,
      )
      if (picked) gasScheme = picked
    }
    const apiColorEntry = findApiColorMapEntry(gasScheme)
    const volumeCmap = apiColorEntry
      ? resolveSelectedCmap()
      : gasScheme === 'custom'
        ? resolveSelectedCmap()
        : gasScheme && VOLUME_SCHEME_TO_CMAP[gasScheme]
          ? VOLUME_SCHEME_TO_CMAP[gasScheme]
          : resolveSelectedCmap()
    const volumeCustomColors = apiColorEntry
      ? extractCatalogColormapColors(apiColorEntry)
      : gasScheme === 'custom'
        ? visualization.value.manualColors || null
        : visualization.value.colorScheme === 'custom' &&
            (gasScheme == null || gasScheme === '')
          ? visualization.value.manualColors || null
          : null
    const gasHex =
      lookupGasScheme(visualization.value.gasColors, varId) != null
        ? lookupGasScheme(visualization.value.gasColors, varId)
        : '#ffffff'
    const rgbaColor = parseColorToRgba(gasHex)

    const basePayload = {
      task_id: effectiveTaskId,
      id: layers.buildGeneratedLayerId('volume', { volumeVariable: varId }),
      name: layers.buildGeneratedLayerLabel('volume', {
        volumeVariable: varId,
      }),
      ...volumeCsvPerformanceForUe(),
      resolution: (() => {
        const pregenConfig = currentTask.value?.pregen_config || currentTask.value?.params?.pregen_config
        const pregenResolution = Number(pregenConfig?.volume?.resolution || pregenConfig?.volume?.ratio)
        if (Number.isFinite(pregenResolution) && pregenResolution > 0) {
          return Math.min(512, Math.max(8, Math.round(pregenResolution)))
        }
        const n = Number(visualization.value.volume_resolution)
        if (Number.isFinite(n) && n > 0) {
          return Math.min(512, Math.max(8, Math.round(n)))
        }
        return 64
      })(),
      ...(() => {
        const mode = visualization.value.volume_res_mode || 'resolution'
        if (mode !== 'sampling') return {}
        return {
          sampling_ratio:
            visualization.value.sampling_ratio != null
              ? Number(visualization.value.sampling_ratio)
              : 1,
        }
      })(),
      density_scale:
        visualization.value.density_scale != null
          ? Number(visualization.value.density_scale)
          : 100,
      step_count:
        visualization.value.step_count != null
          ? Math.max(1, Math.round(Number(visualization.value.step_count)))
          : 128,
      use_pregen: visualization.value.usePregen,
      variable: varId,
      cmap: volumeCmap,
      custom_colors: volumeCustomColors,
      color: rgbaColor.rgba,
      color_hex: gasHex,
      r: rgbByteToFloat01(rgbaColor.r),
      g: rgbByteToFloat01(rgbaColor.g),
      b: rgbByteToFloat01(rgbaColor.b),
      a: alphaToFloat01(rgbaColor.a),
      variable_color_map: { [varId]: volumeColorEntryForUE(gasHex) },
    }
    if (apiColorEntry) {
      if (apiColorEntry.id) basePayload.color_map_id = apiColorEntry.id
      if (apiColorEntry.color_map_url) {
        basePayload.color_map_url = apiColorEntry.color_map_url
      }
    }
    return basePayload
  }

  function unwrapVolumeChunk(input) {
    let current = input
    let guard = 0
    while (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      current.data &&
      typeof current.data === 'object' &&
      guard < 4
    ) {
      const currentKeys = Object.keys(current)
      const nestedKeys = Object.keys(current.data || {})
      const hasUsefulTopLevelField = [
        'items',
        'datasets',
        'variable',
        'name',
        'positions_urls',
        'colors_urls',
        'positions_url',
        'colors_url',
        'csv_urls',
        'csv_url',
        'urls',
        'volume_urls',
        'volume_frame_urls',
        'data_urls',
        'frame_urls',
      ].some((key) => key in current)
      const nestedHasUsefulField = [
        'items',
        'datasets',
        'variable',
        'name',
        'positions_urls',
        'colors_urls',
        'positions_url',
        'colors_url',
        'csv_urls',
        'csv_url',
        'urls',
        'volume_urls',
        'volume_frame_urls',
        'data_urls',
        'frame_urls',
      ].some((key) => key in current.data)
      if (hasUsefulTopLevelField) break
      if (
        !nestedHasUsefulField &&
        currentKeys.length > 1 &&
        nestedKeys.length === 0
      )
        break
      current = current.data
      guard += 1
    }
    return current
  }

  function resolveVolumeVariableFromChunk(chunkData, fallbackVariableId) {
    const fallback =
      fallbackVariableId != null && String(fallbackVariableId).trim() !== ''
        ? String(fallbackVariableId).trim()
        : ''
    const chunk = unwrapVolumeChunk(chunkData)
    if (!chunk || typeof chunk !== 'object') return fallback

    if (Array.isArray(chunk.items) && fallback) {
      const matchedItem = chunk.items.find((item) => {
        const name = String(item?.variable || item?.name || '').trim()
        return name && name === fallback
      })
      const matchedVariable = String(
        matchedItem?.variable || matchedItem?.name || '',
      ).trim()
      if (matchedVariable) return matchedVariable
    }

    const directVariable = String(chunk.variable || chunk.name || '').trim()
    if (directVariable) return directVariable
    return fallback
  }

  function cleanUrlList(arr) {
    if (!Array.isArray(arr)) return []
    return arr
      .map((u) => (typeof u === 'string' ? u.replace(/[`\s]/g, '') : u))
      .filter(Boolean)
  }

  function normalizeVolumeVariableKey(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-:()]+/g, '')
  }

  function resolveVolumeVariableFileUrl(variable) {
    if (!variable || typeof variable !== 'object') return ''
    return String(
      variable.file_url ??
        variable.bin_url ??
        variable.file ??
        variable.url ??
        variable.data_url ??
        variable.volume_url ??
      '',
    ).trim()
  }

  function resolveVolumeDatasetBinUrl(dataset, variableId) {
    if (!dataset || typeof dataset !== 'object') return ''
    const targetVariable = normalizeVolumeVariableKey(variableId)
    const matchedVariable = Array.isArray(dataset.variables)
      ? dataset.variables.find((item) => {
          const name = normalizeVolumeVariableKey(item?.name)
          const slug = normalizeVolumeVariableKey(item?.slug)
          return (
            (targetVariable && name === targetVariable) ||
            (targetVariable && slug === targetVariable)
          )
        })
      : null
    const legacyUrl = resolveVolumeVariableFileUrl(matchedVariable)
    if (legacyUrl) return legacyUrl

    const binUrls = dataset.bin_urls
    if (!binUrls || typeof binUrls !== 'object') return ''
    for (const [key, url] of Object.entries(binUrls)) {
      if (!targetVariable || normalizeVolumeVariableKey(key) === targetVariable) {
        const resolvedUrl = String(url || '').trim()
        if (resolvedUrl) return resolvedUrl
      }
    }
    return ''
  }

  function resolveVolumeVariableRange(variable) {
    if (!variable || typeof variable !== 'object') return []
    if (Array.isArray(variable.original_value_range)) {
      return variable.original_value_range
    }
    if (Array.isArray(variable.originalValueRange)) {
      return variable.originalValueRange
    }
    return []
  }

  function extractVolumeDatasetFramesFromChunk(
    chunkData,
    variableId,
    chunkTimeSteps = [],
  ) {
    const chunk = unwrapVolumeChunk(chunkData)
    const datasets = Array.isArray(chunk?.datasets) ? chunk.datasets : []
    if (!datasets.length) return []

    const targetVariable = normalizeVolumeVariableKey(variableId)
    return datasets
      .map((dataset, index) => {
        if (!dataset || typeof dataset !== 'object') return null
        const matchedVariable = Array.isArray(dataset.variables)
          ? dataset.variables.find((item) => {
              const name = normalizeVolumeVariableKey(item?.name)
              const slug = normalizeVolumeVariableKey(item?.slug)
              return (
                (targetVariable && name === targetVariable) ||
                (targetVariable && slug === targetVariable)
              )
            })
          : null

        const manifestUrl = String(dataset.manifest_url || '').trim()
        const binUrl = resolveVolumeDatasetBinUrl(dataset, variableId)
        if (!manifestUrl || !binUrl) return null

        const range = resolveVolumeVariableRange(matchedVariable)
        const rawTimeStep =
          dataset.time_step ??
          dataset.timeStep ??
          dataset.step ??
          dataset.simulation_time_step ??
          chunkTimeSteps[index]
        return {
          time_step: Number(rawTimeStep),
          manifest_url: manifestUrl,
          bin_url: binUrl,
          dimensions: Array.isArray(dataset.dimensions) ? dataset.dimensions : [],
          origin: Array.isArray(dataset.origin) ? dataset.origin : [],
          spacing: Array.isArray(dataset.spacing) ? dataset.spacing : [],
          value_type:
            matchedVariable?.value_type ?? matchedVariable?.valueType,
          normalized: matchedVariable?.normalized,
          normalize_mode:
            matchedVariable?.normalize_mode ?? matchedVariable?.normalizeMode,
          original_value_range: range,
          vmin:
            range.length > 0 && Number.isFinite(Number(range[0]))
              ? Number(range[0])
              : null,
          vmax:
            range.length > 1 && Number.isFinite(Number(range[1]))
              ? Number(range[1])
              : null,
        }
      })
      .filter((item) => item && Number.isFinite(item.time_step))
  }

  function extractVolumeUrlsFromChunk(chunkData, variableId) {
    const empty = { positions: [], colors: [], urls: [] }
    if (!chunkData || typeof chunkData !== 'object') return empty
    const d = unwrapVolumeChunk(chunkData)

    // 如果指定了变量 ID，尝试从 items 数组中筛选该变量的数据
    if (variableId != null && Array.isArray(d.items)) {
      const targetVar = String(variableId)
      const item = d.items.find(
        (it) => it && String(it.variable || it.name || '') === targetVar,
      )
      if (item) {
        return {
          positions: item.positions_url ? [item.positions_url] : [],
          colors: item.colors_url ? [item.colors_url] : [],
          urls: [],
        }
      }
    }

    // 如果指定了变量 ID，尝试从按变量分组的结构中获取
    if (variableId != null && d[variableId]) {
      const varData = d[variableId]
      if (
        Array.isArray(varData.positions_urls) &&
        Array.isArray(varData.colors_urls)
      ) {
        return {
          positions: varData.positions_urls,
          colors: varData.colors_urls,
          urls: [],
        }
      }
      if (Array.isArray(varData.items)) {
        const positions = []
        const colors = []
        for (const it of varData.items) {
          if (it && typeof it === 'object') {
            if (it.positions_url) positions.push(it.positions_url)
            if (it.colors_url) colors.push(it.colors_url)
          }
        }
        return { positions, colors, urls: [] }
      }
    }

    // 默认逻辑：顶级字段
    if (Array.isArray(d.positions_urls) && Array.isArray(d.colors_urls)) {
      return { positions: d.positions_urls, colors: d.colors_urls, urls: [] }
    }
    if (Array.isArray(d.items)) {
      const positions = []
      const colors = []
      for (const it of d.items) {
        if (it && typeof it === 'object') {
          if (it.positions_url) positions.push(it.positions_url)
          if (it.colors_url) colors.push(it.colors_url)
        }
      }
      return { positions, colors, urls: [] }
    }
    if (
      typeof d.positions_url === 'string' ||
      typeof d.colors_url === 'string'
    ) {
      return {
        positions: typeof d.positions_url === 'string' ? [d.positions_url] : [],
        colors: typeof d.colors_url === 'string' ? [d.colors_url] : [],
        urls: [],
      }
    }
    for (const k of [
      'csv_urls',
      'urls',
      'volume_urls',
      'volume_frame_urls',
      'data_urls',
      'frame_urls',
    ]) {
      if (Array.isArray(d[k])) {
        return { positions: [], colors: [], urls: d[k] }
      }
    }
    if (typeof d.csv_url === 'string') {
      return { positions: [], colors: [], urls: [d.csv_url] }
    }
    return empty
  }

  function buildVolumeTextureChunkUePayload(
    variableId,
    chunkTimeSteps,
    positionsUrls,
    colorsUrls,
    urlsList,
    chunkData,
  ) {
    const base = getVolumeTextureCommonFieldsForUE(variableId)
    if (!base) return null
    const filteredTimeSteps = (
      Array.isArray(chunkTimeSteps) ? chunkTimeSteps : []
    )
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t))
    if (filteredTimeSteps.length === 0) return null
    const pos = cleanUrlList(positionsUrls)
    const col = cleanUrlList(colorsUrls)
    const urls = cleanUrlList(urlsList)
    const vmin = Number(chunkData?.val_min ?? chunkData?.vmin)
    const vmax = Number(chunkData?.val_max ?? chunkData?.vmax)
    const requestedVariable =
      variableId != null && String(variableId).trim() !== ''
        ? String(variableId).trim()
        : ''
    const resolvedVariable =
      requestedVariable || resolveVolumeVariableFromChunk(chunkData, variableId)
    const payload = {
      ...base,
      time_step: filteredTimeSteps,
      texture_time_steps: filteredTimeSteps,
      variable: resolvedVariable || base.variable,
      ...(Number.isFinite(vmin) && { val_min: vmin }),
      ...(Number.isFinite(vmax) && { val_max: vmax }),
    }
    const datasetFrames = extractVolumeDatasetFramesFromChunk(
      chunkData,
      resolvedVariable || variableId,
      filteredTimeSteps,
    )
    if (datasetFrames.length > 0) {
      payload.volume_dataset_frames = datasetFrames
      const currentFrame = datasetFrames[0]
      if (currentFrame?.manifest_url) payload.manifest_url = currentFrame.manifest_url
      if (currentFrame?.bin_url) payload.bin_url = currentFrame.bin_url
      if (Number.isFinite(currentFrame?.time_step)) {
        payload.source_time_step = currentFrame.time_step
      }
      if (!Number.isFinite(vmin) && Number.isFinite(currentFrame?.vmin)) {
        payload.val_min = currentFrame.vmin
      }
      if (!Number.isFinite(vmax) && Number.isFinite(currentFrame?.vmax)) {
        payload.val_max = currentFrame.vmax
      }
      const chunk = unwrapVolumeChunk(chunkData)
      if (Array.isArray(chunk?.datasets) && chunk.datasets.length > 0) {
        payload.datasets = chunk.datasets
      }
      return payload
    }
    if (pos.length || col.length) {
      payload.positions_urls = pos
      payload.colors_urls = col
    }
    if (urls.length) payload.urls = urls
    return payload
  }

  function buildVolumeTextureParamsForUE(timeStep, variableId) {
    const base = getVolumeTextureCommonFieldsForUE(variableId)
    if (!base) return null

    // 如果传入了具体的时间步，只使用该时间步
    if (timeStep != null && timeStep !== '') {
      const singleTimeStep = Number(timeStep)
      if (Number.isFinite(singleTimeStep)) {
        return {
          ...base,
          time_step: [singleTimeStep],
        }
      }
    }

    // 否则使用所有时间步（用于初始化）
    const rawTimeSteps =
      timelineTimeSteps.value.length > 0 ? [...timelineTimeSteps.value] : []
    const fromTimeline = rawTimeSteps
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t))
    const timeStepArray = fromTimeline
    if (timeStepArray.length === 0) return null
    return {
      ...base,
      time_step: timeStepArray,
    }
  }

  function resolveSimulationTimeStepAtSlideIndex(slideIndex) {
    if (timelineTimeSteps.value.length > slideIndex) {
      return timelineTimeSteps.value[slideIndex]
    }
    return slideIndex === 0 ? 1 : slideIndex
  }

  function getTaskStreamlineConfig() {
    return (
      currentTask.value?.pregen_config?.streamline ??
      currentTask.value?.params?.pregen_config?.streamline ??
      null
    )
  }

  function getStreamlineGenerationParams() {
    const sc = visualization.value.streamline
    const taskStreamlineConfig = getTaskStreamlineConfig()
    const params = {
      seed_count:
        taskStreamlineConfig?.seed_count ?? sc?.seed_count ?? 50,
      points_per_streamline:
        taskStreamlineConfig?.points_per_streamline ??
        sc?.points_per_streamline ??
        40,
    }
    const center = taskStreamlineConfig?.center ?? sc?.center
    const radius = taskStreamlineConfig?.radius ?? sc?.radius
    const maximumStreamlineLength =
      taskStreamlineConfig?.maximum_streamline_length ??
      sc?.maximum_streamline_length

    if (center != null) params.center = center
    if (radius != null) params.radius = radius
    if (maximumStreamlineLength != null) {
      params.maximum_streamline_length = maximumStreamlineLength
    }
    return params
  }

  function buildStreamlineUeParams(simTimeStep, extra = null) {
    const sc = visualization.value.streamline
    const taskId = currentTask.value?.id
    if (!taskId || simTimeStep === undefined || simTimeStep === null)
      return null
    const streamlineColor = parseColorToRgba(sc?.color ?? '#ffffff')
    const base = {
      task_id: taskId,
      use_pregen: visualization.value.usePregen ?? true,
      time_step: simTimeStep,
      ...getStreamlineGenerationParams(),
      line_width: sc?.line_width ?? 0.38,
      display_time: sc?.display_time ?? 5,
      color: sc?.color ?? '#ffffff',
      color_r: rgbByteToFloat01(streamlineColor.r),
      color_g: rgbByteToFloat01(streamlineColor.g),
      color_b: rgbByteToFloat01(streamlineColor.b),
      color_a: alphaToFloat01(streamlineColor.a),
    }
    return extra && typeof extra === 'object' ? { ...base, ...extra } : base
  }

  function buildStreamlineApiParams(timeSteps) {
    const sc = visualization.value.streamline
    const taskId = currentTask.value?.id
    const steps = (Array.isArray(timeSteps) ? timeSteps : [timeSteps])
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t))
    return {
      task_id: taskId,
      use_pregen: visualization.value.usePregen ?? true,
      time_step: steps,
      ...getStreamlineGenerationParams(),
      line_width: sc?.line_width ?? 0.38,
      display_time: sc?.display_time ?? 5,
      color: sc?.color ?? '#ffffff',
    }
  }

  return {
    listVolumeVariableIdsForUE,
    volumeColorEntryForUE,
    getVolumeTextureCommonFieldsForUE,
    cleanUrlList,
    extractVolumeUrlsFromChunk,
    buildVolumeTextureChunkUePayload,
    buildVolumeTextureParamsForUE,
    resolveSimulationTimeStepAtSlideIndex,
    buildStreamlineUeParams,
    buildStreamlineApiParams,
  }
}
