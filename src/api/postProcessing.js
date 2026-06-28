import { request } from '@/utils/request'
import {
  convertMultiTimeStepToPng,
  convertTimeStepResultsToPng,
} from '@/utils/multiTimeStepConverter'
import {
  isGoafMockEnabled,
  createMockGoafTimeSteps,
  createMockGoafGeometryBounds,
} from './mockGoafTask'

const volumeDatasetCache = new Map()

function normalizeVolumeDatasetList(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function normalizeVolumeDatasetNumberList(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

function makeVolumeDatasetScopeKey(body, usePregen) {
  return JSON.stringify({
    task_id: body.task_id,
    use_pregen: usePregen ?? null,
    resolution: body.resolution ?? null,
    sampling_ratio: body.sampling_ratio ?? null,
  })
}

function hasVolumeDatasetSuperset(cachedValues, requestedValues) {
  if (!cachedValues.length) return false
  return requestedValues.every((item) => cachedValues.includes(item))
}

function cloneVolumeDatasetResponse(response) {
  if (!response || typeof response !== 'object') return response
  return {
    ...response,
    datasets: Array.isArray(response.datasets)
      ? response.datasets.map((dataset) =>
          dataset && typeof dataset === 'object' ? { ...dataset } : dataset,
        )
      : response.datasets,
  }
}

function getVolumeDatasetTimeStep(dataset, fallback) {
  const raw =
    dataset?.time_step ??
    dataset?.timeStep ??
    dataset?.step ??
    dataset?.simulation_time_step ??
    fallback
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : raw
}

function pickVolumeDatasetFromCache(entry, requestTimeSteps) {
  const response = cloneVolumeDatasetResponse(entry.response)
  if (!response || !Array.isArray(response.datasets)) return response

  const datasetByStep = new Map()
  response.datasets.forEach((dataset, index) => {
    const step = getVolumeDatasetTimeStep(dataset, entry.timeSteps[index])
    datasetByStep.set(String(step), dataset)
  })
  const requestedStepKeys = requestTimeSteps.map((step) => String(step))
  const datasets = []

  for (const stepKey of requestedStepKeys) {
    const dataset = datasetByStep.get(stepKey)
    if (dataset !== undefined) {
      datasets.push(dataset)
    }
  }

  return {
    ...response,
    time_step: requestTimeSteps,
    time_steps: requestTimeSteps,
    datasets,
  }
}

function findVolumeDatasetCacheEntry(scopeKey, timeSteps, variables) {
  const entries = volumeDatasetCache.get(scopeKey)
  if (!entries) return null

  return entries.find((entry) => {
    const hasRequestedTimeSteps = hasVolumeDatasetSuperset(
      entry.timeSteps,
      timeSteps,
    )
    if (!hasRequestedTimeSteps) return false

    if (!variables.length) return !entry.variables.length
    if (!entry.variables.length) return true
    return hasVolumeDatasetSuperset(entry.variables, variables)
  })
}

export default {
  /**
   * 生成流线 CSV（支持单时间步或多时间步分片，与云图 multi-time-step 用法一致）
   * @param {Object} data - 生成请求参数
   * @param {string} data.task_id - 任务ID
   * @param {number|Array<number>} data.time_step - 单个时间步或时间步数组
   * @returns {Promise<Object>} - 常为 { csv_urls: string[] }（经 axios 拦截器已解包 data）
   */
  generateStreamline(data) {
    const { use_pregen, ...rest } = data
    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }
    const body = { ...rest }
    if (body.time_step !== undefined) {
      body.time_step = Array.isArray(body.time_step)
        ? body.time_step
        : [body.time_step]
    }
    return request.post('/api/v1/post-processing/streamline', body, config)
  },

  /**
   * 获取任务可用时间步
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>} - 包含时间步列表及物理时间列表 (time_steps, physical_times)
   */
  getTaskTimeSteps(taskId) {
    if (isGoafMockEnabled()) {
      return Promise.resolve(createMockGoafTimeSteps())
    }
    return request.get(`/api/v1/post-processing/time-steps/${taskId}`)
  },

  /**
   * 获取指定多个时间步的云图
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {string} data.plane_type - 切面类型 (xy, yz, xz)
   * @param {number} data.plane_offset - 切面偏移量
   * @param {number|Array<number>} data.time_step - 单个时间步或时间步数组，例如 10 或 [0, 10, 20, 30]
   * @param {string} data.variable - 物理变量
   * @param {string} [data.quality='1k'] - 画质等级: 1k, 2k, 4k
   * @param {string} [data.cmap='coolwarm'] - 颜色映射
   * @param {Array<string>|null} [data.custom_colors] - 自定义颜色列表
   * @param {number} [data.vmin] - 颜色映射最小值
   * @param {number} [data.vmax] - 颜色映射最大值
   * @param {string} [data.quality_preset='1k'] - 渲染质量预设 (1k/2k/4k)
   * @param {boolean} [data.transparent_background=true] - 是否启用透明背景
   * @param {boolean} [data.convertToPng=false] - 是否转换为PNG（供UE使用）
   * @param {string} [data.pngFormat='dataurl'] - PNG格式: 'dataurl' | 'bloburl' | 'blob' | 'arraybuffer'
   * @param {Function} [data.onProgress] - PNG转换进度回调
   * @param {boolean} [data.use_pregen=true] - 是否使用预生成数据
   * @returns {Promise<Object|Array<Object>>} - 单个时间步返回对象，多个时间步返回数组
   */
  async generateContour(data) {
    const {
      convertToPng = false,
      pngFormat = 'dataurl',
      onProgress,
      use_pregen,
      task_id,
      plane_type,
      plane_offset,
      time_step,
      variable,
      cmap,
      custom_colors,
      vmin,
      vmax,
      quality_preset,
      quality,
      transparent_background,
    } = data

    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }

    const requestData = {
      task_id,
      plane_type,
      plane_offset,
      variable,
      vmin,
      vmax,
    }
    if (Array.isArray(custom_colors) && custom_colors.length > 0) {
      requestData.custom_colors = custom_colors
    } else if (cmap != null && cmap !== '') {
      requestData.cmap = cmap
    } else {
      requestData.cmap = 'coolwarm'
    }

    const resolvedQP = quality_preset ?? quality
    if (resolvedQP != null) requestData.quality_preset = resolvedQP
    if (transparent_background != null)
      requestData.transparent_background = transparent_background

    // 确保 time_step 是数组 (API 要求)
    if (time_step !== undefined) {
      requestData.time_step = Array.isArray(time_step) ? time_step : [time_step]
    }

    const result = await request.post(
      '/api/v1/post-processing/contour/multi-time-step',
      requestData,
      config,
    )

    // 如果需要转换为PNG
    if (convertToPng && result) {
      try {
        const convertedResult = await convertMultiTimeStepToPng(
          result,
          { scale: 2, backgroundColor: 'white', format: pngFormat },
          onProgress,
        )
        return convertedResult
      } catch (error) {
        console.error('PNG转换失败，返回原始数据:', error)
        return result
      }
    }

    return result
  },

  /**
   * 获取指定时间步的云图 (兼容旧接口，实际调用 generateContour)
   */
  async getContourByTimeStep(data) {
    return this.generateContour(data)
  },

  /**
   * @deprecated 请使用 generateContour 或 generateVector
   * 生成序列帧精灵图
   */
  generateSpriteSheet(data) {
    return request.post('/api/v1/post-processing/sprite-sheet', data)
  },

  /**
   * 获取任务的物理变量列表
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>} - 物理变量列表
   */
  getTaskVariables(taskId) {
    if (isGoafMockEnabled()) {
      return Promise.resolve([
        'Temperature',
        'Pressure',
        'VelocityMagnitude',
        'Mass_fraction_of_ch4',
      ])
    }
    return request.get(`/api/v1/tasks/${taskId}/variables`)
  },

  /**
   * 获取指定多个时间步的矢量图
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {string} data.plane_type - 切面类型 (xy, yz, xz)
   * @param {number} data.plane_offset - 切面偏移量
   * @param {number|Array<number>} data.time_step - 单个时间步或时间步数组，例如 10 或 [0, 10, 20, 30]
   * @param {string} [data.quality] - 兼容字段：画质等级（会映射到 quality_preset）
   * @param {string} [data.color='black'] - 矢量图颜色
   * @param {number} [data.vmin] - 颜色映射最小值
   * @param {number} [data.vmax] - 颜色映射最大值
   * @param {boolean} [data.convertToPng=false] - 是否转换为PNG（供UE使用）
   * @param {string} [data.pngFormat='dataurl'] - PNG格式: 'dataurl' | 'bloburl' | 'blob' | 'arraybuffer'
   * @param {Function} [data.onProgress] - PNG转换进度回调
   * @param {string} [data.quality_preset='1k'] - 矢量画质预设（新版字段）
   * @param {boolean} [data.transparent_background=true] - PNG 背景透明
   * @param {number} [data.glyph_density=4] - 字形密度
   * @param {number} [data.line_width=1] - 线宽
   * @param {boolean} [data.use_pregen=true] - 是否使用预生成数据
   * @returns {Promise<Object|Array<Object>>} - 单个时间步返回对象，多个时间步返回数组
   */
  async generateVector(data) {
    const {
      convertToPng = false,
      pngFormat = 'dataurl',
      onProgress,
      use_pregen,
      // 解构出符合 DTO 的参数，避免传入额外参数导致 422 错误
      task_id,
      plane_type,
      plane_offset,
      time_step,
      color,
      streamline_color,
      arrow_color,
      seed_color,
      quality_preset,
      quality,
      transparent_background = true,
      glyph_density = 4,
      line_width = 1,
      vmin,
      vmax,
    } = data

    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }

    const resolvedQualityPreset = quality_preset ?? quality ?? '1k'

    // 构造请求体，仅包含 API 允许的字段
    const requestData = {
      task_id,
      plane_type,
      plane_offset,
      color,
      quality_preset: resolvedQualityPreset,
      transparent_background,
      glyph_density,
      line_width,
      vmin,
      vmax,
    }
    if (streamline_color != null) requestData.streamline_color = streamline_color
    if (arrow_color != null) requestData.arrow_color = arrow_color
    if (seed_color != null) requestData.seed_color = seed_color

    // 确保 time_step 是数组 (API 要求)
    if (time_step !== undefined) {
      requestData.time_step = Array.isArray(time_step) ? time_step : [time_step]
    }

    const result = await request.post(
      '/api/v1/post-processing/vector/multi-time-step',
      requestData,
      config,
    )

    // 如果需要转换为PNG
    if (convertToPng && result) {
      try {
        const convertedResult = await convertMultiTimeStepToPng(
          result,
          { scale: 2, backgroundColor: 'white', format: pngFormat },
          onProgress,
        )
        return convertedResult
      } catch (error) {
        console.error('PNG转换失败，返回原始数据:', error)
        return result
      }
    }

    return result
  },

  /**
   * 获取指定时间步的矢量图 (兼容旧接口，实际调用 generateVector)
   */
  async getVectorByTimeStep(data) {
    return this.generateVector(data)
  },

  /**
   * 获取点探测数据
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {string|string[]} data.variables - 物理变量（单个或数组，新接口支持多变量一次请求）
   * @param {number} data.x - X坐标 (cm)
   * @param {number} data.y - Y坐标 (cm)
   * @param {number} data.z - Z坐标 (cm)
   * @param {boolean} [data.use_pregen=true] - 是否使用预生成数据
   * @returns {Promise<Object>} - 点探测数据列表 (随时间步变化)
   */
  getPointProbeData(data) {
    const { use_pregen, ...rest } = data
    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }
    return request.post('/api/v1/post-processing/point-probe', rest, config)
  },

  /**
   * 生成体渲染数据 (Volume)
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {number|Array<number>} data.time_step - 时间步（接口要求数组；传单个数字时会自动包成 [n]）
   * @param {string} [data.variable] - 物理变量（多变量体渲染时与前端分片一致）
   * @param {number} [data.resolution] - 结构化网格分辨率，如 64（与可视化面板的 volume_resolution 一致）
   * @param {number} [data.sampling_ratio] - 随机采样比例 (0, 1]
   * @param {boolean} [data.use_pregen=true] - 是否优先使用预生成缓存
   * @returns {Promise<Object>} - 体渲染数据信息（可能含 urls / positions_urls+colors_urls 等，由后端约定）
   */
  generateVolume(data) {
    const { use_pregen, ...rest } = data
    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }
    const body = { ...rest }
    if (body.time_step !== undefined) {
      body.time_step = Array.isArray(body.time_step)
        ? body.time_step
        : [body.time_step]
    }
    return request.post('/api/v1/post-processing/volume', body, config)
  },

  /**
   * 获取体渲染数据集清单 (manifest + bin)
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {number|Array<number>} data.time_step - 时间步（接口要求数组；传单个数字时会自动包成 [n]）
   * @param {number} [data.resolution] - 结构化网格分辨率
   * @param {number} [data.sampling_ratio] - 随机采样比例
   * @param {string|Array<string>} [data.variables] - 变量名数组
   * @param {boolean} [data.use_pregen=true] - 是否优先使用预生成缓存
   * @returns {Promise<Object>} - 数据集信息，包含 datasets 列表
   */
  async getVolumeDataset(data) {
    const {
      use_pregen,
      task_id,
      time_step,
      resolution,
      sampling_ratio,
      variables,
      variable,
    } = data || {}

    if (task_id == null || String(task_id).trim() === '') {
      throw new Error('volume-dataset 接口缺少必填参数 task_id')
    }
    if (time_step === undefined || time_step === null) {
      throw new Error('volume-dataset 接口缺少必填参数 time_step')
    }

    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }

    const body = {
      task_id: String(task_id).trim(),
      time_step: normalizeVolumeDatasetNumberList(time_step),
    }
    if (body.time_step.length === 0) {
      throw new Error('volume-dataset 接口缺少有效 time_step')
    }

    if (resolution !== undefined) body.resolution = resolution
    if (sampling_ratio !== undefined) body.sampling_ratio = sampling_ratio

    const resolvedVariables = variables ?? variable
    if (resolvedVariables !== undefined) {
      body.variables = normalizeVolumeDatasetList(resolvedVariables)
    }

    const requestVariables = normalizeVolumeDatasetList(body.variables || [])
    const scopeKey = makeVolumeDatasetScopeKey(body, use_pregen)
    const cachedEntry = findVolumeDatasetCacheEntry(
      scopeKey,
      body.time_step,
      requestVariables,
    )
    if (cachedEntry) {
      if (cachedEntry.response) {
        return pickVolumeDatasetFromCache(cachedEntry, body.time_step)
      }
      return cachedEntry.promise.then((response) =>
        pickVolumeDatasetFromCache({ ...cachedEntry, response }, body.time_step),
      )
    }

    const entry = {
      timeSteps: [...body.time_step],
      variables: [...requestVariables],
      response: null,
      promise: null,
    }
    entry.promise = request
      .post('/api/v1/post-processing/volume-dataset', body, config)
      .then((response) => {
        entry.response = response
        return response
      })
      .catch((error) => {
        const entries = volumeDatasetCache.get(scopeKey) || []
        volumeDatasetCache.set(
          scopeKey,
          entries.filter((item) => item !== entry),
        )
        throw error
      })

    const entries = volumeDatasetCache.get(scopeKey) || []
    entries.push(entry)
    volumeDatasetCache.set(scopeKey, entries)

    return entry.promise
  },

  /**
   * 生成体渲染纹理贴图 (Volume Texture)
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {number|Array<number>} data.time_step - 单个时间步或时间步数组（分片批量）
   * @param {string} data.variable - 物理变量 (例如: Pressure)
   * @param {number|null} [data.resolution=64] - 结构化网格分辨率，如 64
   * @param {number|null} [data.sampling_ratio=1] - 随机采样比例，范围 (0, 1]
   * @param {boolean} [data.use_pregen=true] - 是否优先使用预生成缓存
   * @returns {Promise<Object>} - 纹理贴图信息 (positions_url, colors_url, val_min, val_max)
   */
  generateVolumeTexture(data) {
    const { use_pregen, ...rest } = data
    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }
    const body = { ...rest }
    if (body.time_step !== undefined) {
      body.time_step = Array.isArray(body.time_step)
        ? body.time_step
        : [body.time_step]
    }
    return request.post('/api/v1/post-processing/volume-texture', body, config)
  },

  /**
   * 批量获取指定多个时间步的云图
   * 注意：此方法直接调用后端的 multi-time-step 接口，该接口支持一次请求多个时间步
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {Array<number>} data.time_steps - 时间步数组，例如 [0, 10, 20, 30]
   * @param {string} data.plane_type - 切面类型 (xy, yz, xz)
   * @param {number} data.plane_offset - 切面偏移量
   * @param {string} data.variable - 物理变量
   * @param {string} [data.quality='1k'] - 画质等级: 1k, 2k, 4k
   * @param {string} [data.cmap='coolwarm'] - 颜色映射
   * @param {Array<string>|null} [data.custom_colors] - 自定义颜色列表
   * @param {boolean} [data.convertToPng=false] - 是否转换为PNG（供UE使用）
   * @param {Function} [data.onProgress] - PNG转换进度回调
   * @returns {Promise<Array<Object>>} - 云图信息数组，每个元素包含 time_step 和对应的云图数据
   */
  async getContoursByTimeSteps(data) {
    const { time_steps, convertToPng = false, onProgress, ...baseParams } = data

    try {
      // 直接调用支持多时间步的接口
      const result = await this.generateContour({
        ...baseParams,
        time_step: time_steps, // 传递时间步数组
        convertToPng,
        onProgress,
      })

      // 后端返回格式：{ contour_frame_urls: [...], vmin: ..., vmax: ..., ... }
      if (
        result &&
        result.contour_frame_urls &&
        Array.isArray(result.contour_frame_urls)
      ) {
        // 将 URLs 数组映射到对应的时间步
        return result.contour_frame_urls.map((url, index) => ({
          time_step: time_steps[index],
          success: true,
          data: {
            contour_frame_url: url,
            // 如果有PNG URLs，也添加进去
            png_url: result.png_frame_urls
              ? result.png_frame_urls[index]
              : null,
            svg_url: result.svg_frame_urls ? result.svg_frame_urls[index] : url,
            vmin: result.vmin,
            vmax: result.vmax,
            physical_width: result.physical_width,
            physical_height: result.physical_height,
            geometric_center: result.geometric_center,
          },
        }))
      }

      // 兼容旧格式：如果后端返回数组
      if (Array.isArray(result)) {
        return result.map((item, index) => ({
          time_step: time_steps[index],
          success: true,
          data: item,
        }))
      }

      // 兼容单个时间步的情况
      return [
        {
          time_step: Array.isArray(time_steps) ? time_steps[0] : time_steps,
          success: true,
          data: result,
        },
      ]
    } catch (error) {
      console.error('Failed to get contours for time steps:', error)
      // 返回失败结果
      return time_steps.map((timeStep) => ({
        time_step: timeStep,
        success: false,
        error: error.message || 'Unknown error',
      }))
    }
  },

  /**
   * 批量获取指定多个时间步的矢量图
   * 注意：此方法直接调用后端的 multi-time-step 接口，该接口支持一次请求多个时间步
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {Array<number>} data.time_steps - 时间步数组，例如 [0, 10, 20, 30]
   * @param {string} data.plane_type - 切面类型 (xy, yz, xz)
   * @param {number} data.plane_offset - 切面偏移量
   * @param {string} [data.quality='2k'] - 画质等级: 1k, 2k, 4k
   * @param {string} [data.color='black'] - 箭头颜色
   * @param {number} [data.sampling=1] - 采样步长
   * @param {number} [data.scale=1] - 箭头大小缩放因子
   * @param {boolean} [data.convertToPng=false] - 是否转换为PNG（供UE使用）
   * @param {Function} [data.onProgress] - PNG转换进度回调
   * @returns {Promise<Array<Object>>} - 矢量图信息数组，每个元素包含 time_step 和对应的矢量图数据
   */
  async getVectorsByTimeSteps(data) {
    const { time_steps, convertToPng = false, onProgress, ...baseParams } = data

    try {
      // 直接调用支持多时间步的接口
      const result = await this.generateVector({
        ...baseParams,
        time_step: time_steps, // 传递时间步数组
        convertToPng,
        onProgress,
      })

      // 后端返回格式：{ vector_frame_urls: [...], ... }
      if (
        result &&
        result.vector_frame_urls &&
        Array.isArray(result.vector_frame_urls)
      ) {
        // 将 URLs 数组映射到对应的时间步
        return result.vector_frame_urls.map((url, index) => ({
          time_step: time_steps[index],
          success: true,
          data: {
            vector_url: url,
            // 如果有PNG URLs，也添加进去
            png_url: result.png_frame_urls
              ? result.png_frame_urls[index]
              : null,
            svg_url: result.svg_frame_urls ? result.svg_frame_urls[index] : url,
            vmin: result.vmin,
            vmax: result.vmax,
            physical_width: result.physical_width,
            physical_height: result.physical_height,
            geometric_center: result.geometric_center,
          },
        }))
      }

      // 兼容旧格式：如果后端返回数组
      if (Array.isArray(result)) {
        return result.map((item, index) => ({
          time_step: time_steps[index],
          success: true,
          data: item,
        }))
      }

      // 兼容单个时间步的情况
      return [
        {
          time_step: Array.isArray(time_steps) ? time_steps[0] : time_steps,
          success: true,
          data: result,
        },
      ]
    } catch (error) {
      console.error('Failed to get vectors for time steps:', error)
      // 返回失败结果
      return time_steps.map((timeStep) => ({
        time_step: timeStep,
        success: false,
        error: error.message || 'Unknown error',
      }))
    }
  },

  /**
   * 获取几何边界
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>} - 几何边界信息
   */
  getGeometryBounds(taskId) {
    if (isGoafMockEnabled()) {
      return Promise.resolve(createMockGoafGeometryBounds())
    }
    return request.get(
      '/api/v1/post-processing/geometry-bounds?task_id=' + taskId,
    )
  },

  /**
   * 获取指定平面的全时间变量范围
   * @param {Object} data - 请求参数
   * @param {string} data.task_id - 任务ID
   * @param {string} data.plane_type - 切片平面类型 (XY, XZ, YZ)
   * @param {number} data.plane_offset - 切片平面偏移量，单位为厘米 (cm)
   * @param {boolean} [data.use_pregen] - 是否使用预生成数据
   * @returns {Promise<Object>} - 包含 vmin, vmax, aligned_plane_offset 等信息
   */
  getPlaneVariableBounds(data) {
    const { use_pregen, ...rest } = data
    const config = {}
    if (use_pregen !== undefined) {
      config.params = { use_pregen }
    }
    return request.post(
      '/api/v1/post-processing/contour/plane-variable-bounds',
      rest,
      config,
    )
  },
}
