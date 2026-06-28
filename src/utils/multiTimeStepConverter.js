/**
 * Multi-Time-Step SVG转PNG转换工具
 * 用于处理批量时间步的SVG数据，转换为PNG供UE使用
 */

import {
  batchConvertSvgToPngDataUrls,
  batchConvertSvgToPngUrls,
  batchConvertSvgToPngBlobs,
  batchConvertSvgToPngArrayBuffers,
  revokeBatchBlobUrls,
} from './svgToPng'

/**
 * 处理multi-time-step接口返回的数据，转换SVG为PNG
 * @param {Object} multiTimeStepData - 后端返回的multi-time-step数据
 * @param {Array<string>} multiTimeStepData.contour_frame_urls - 云图SVG URL数组
 * @param {Array<string>} multiTimeStepData.vector_frame_urls - 矢量图SVG URL数组
 * @param {Object} options - 转换选项
 * @param {number} options.scale - 缩放比例，默认2
 * @param {string} options.backgroundColor - 背景色，默认'white'
 * @param {string} options.format - 输出格式: 'dataurl' | 'bloburl' | 'blob' | 'arraybuffer'，默认'dataurl'
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Object>} 包含PNG数据的对象
 */
export async function convertMultiTimeStepToPng(
  multiTimeStepData,
  options = {},
  onProgress = null,
) {
  const {
    scale = 2,
    backgroundColor = 'white',
    format = 'dataurl', // 'dataurl' | 'bloburl' | 'blob' | 'arraybuffer'
  } = options

  const result = {
    ...multiTimeStepData,
    png_frame_urls: null, // PNG数据（供UE使用）
    svg_frame_urls: null, // 原始SVG URL数组（供Vue使用）
    png_format: format, // 标记PNG数据格式
  }

  try {
    // 判断是云图还是矢量图
    const svgUrls =
      multiTimeStepData.contour_frame_urls ||
      multiTimeStepData.vector_frame_urls ||
      []

    if (svgUrls.length === 0) {
      console.warn('没有找到SVG URL数组')
      return result
    }

    // 保存原始SVG URLs供Vue使用
    result.svg_frame_urls = svgUrls

    

    // 根据格式选择转换方法
    let pngData
    switch (format) {
      case 'bloburl':
        pngData = await batchConvertSvgToPngUrls(
          svgUrls,
          { scale, backgroundColor },
          onProgress,
        )
        break

      case 'blob':
        pngData = await batchConvertSvgToPngBlobs(
          svgUrls,
          { scale, backgroundColor },
          onProgress,
        )
        break

      case 'arraybuffer':
        pngData = await batchConvertSvgToPngArrayBuffers(
          svgUrls,
          { scale, backgroundColor },
          onProgress,
        )
        break

      case 'dataurl':
      default:
        pngData = await batchConvertSvgToPngDataUrls(
          svgUrls,
          { scale, backgroundColor },
          onProgress,
        )
        break
    }

    // 保存PNG数据供UE使用
    result.png_frame_urls = pngData

    

    return result
  } catch (error) {
    console.error('批量转换失败:', error)
    throw error
  }
}

/**
 * 处理云图multi-time-step数据
 * @param {Object} contourData - 云图数据
 * @param {Object} options - 转换选项
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Object>} 转换后的数据
 */
export async function convertContourMultiTimeStep(
  contourData,
  options = {},
  onProgress = null,
) {
  return convertMultiTimeStepToPng(contourData, options, onProgress)
}

/**
 * 处理矢量图multi-time-step数据
 * @param {Object} vectorData - 矢量图数据
 * @param {Object} options - 转换选项
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Object>} 转换后的数据
 */
export async function convertVectorMultiTimeStep(
  vectorData,
  options = {},
  onProgress = null,
) {
  return convertMultiTimeStepToPng(vectorData, options, onProgress)
}

/**
 * 从API响应中提取并转换PNG URLs
 * 适用于getContoursByTimeSteps和getVectorsByTimeSteps的返回数据
 * @param {Array<Object>} timeStepResults - API返回的时间步结果数组
 * @param {Object} options - 转换选项
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Array<Object>>} 包含PNG URLs的结果数组
 */
export async function convertTimeStepResultsToPng(
  timeStepResults,
  options = {},
  onProgress = null,
) {
  const { scale = 2, backgroundColor = 'white' } = options

  // 提取所有SVG URLs
  const svgUrls = timeStepResults
    .filter((result) => result.success && result.data)
    .map(
      (result) => result.data.contour_frame_url || result.data.vector_url || '',
    )
    .filter((url) => url)

  if (svgUrls.length === 0) {
    console.warn('没有找到有效的SVG URLs')
    return timeStepResults
  }

  

  // 批量转换
  const pngDataUrls = await batchConvertSvgToPngDataUrls(
    svgUrls,
    { scale, backgroundColor },
    onProgress,
  )

  // 将PNG URLs添加到结果中
  let pngIndex = 0
  const enhancedResults = timeStepResults.map((result) => {
    if (result.success && result.data) {
      const hasSvg =
        result.data.contour_frame_url || result.data.vector_url || false

      if (hasSvg) {
        return {
          ...result,
          data: {
            ...result.data,
            // 保留原始SVG URL供Vue使用
            svg_url:
              result.data.contour_frame_url || result.data.vector_url || '',
            // 添加PNG URL供UE使用
            png_url: pngDataUrls[pngIndex++],
          },
        }
      }
    }
    return result
  })

  

  return enhancedResults
}

/**
 * 清理转换生成的临时URLs
 * @param {Object} convertedData - 包含PNG URLs的数据
 */
export function cleanupConvertedUrls(convertedData) {
  if (convertedData.png_frame_urls) {
    revokeBatchBlobUrls(convertedData.png_frame_urls)
  }
}
