/**
 * SVG转PNG工具函数
 * 支持从URL或SVG字符串转换，处理CORS问题
 */

/**
 * 将SVG URL转换为PNG Blob
 * @param {string} svgUrl - SVG图片的URL
 * @param {Object} options - 转换选项
 * @param {number} options.scale - 缩放比例，默认为1（原始大小）
 * @param {string} options.backgroundColor - 背景色，默认透明
 * @returns {Promise<Blob>} PNG图片的Blob对象
 */
export async function svgUrlToPngBlob(svgUrl, options = {}) {
  const { scale = 1, backgroundColor = 'transparent' } = options

  return new Promise((resolve, reject) => {
    try {
      // 直接使用Image加载SVG
      const img = new Image()

      // 如果是同源或支持CORS的URL，设置crossOrigin
      if (svgUrl.startsWith('http')) {
        img.crossOrigin = 'anonymous'
      }

      img.onload = () => {
        try {
          // 创建Canvas
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')

          // 设置Canvas尺寸（应用缩放）
          const width = img.naturalWidth || img.width
          const height = img.naturalHeight || img.height

          canvas.width = width * scale
          canvas.height = height * scale

          // 绘制背景（如果需要）
          if (backgroundColor !== 'transparent') {
            ctx.fillStyle = backgroundColor
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          }

          // 绘制SVG到Canvas
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          // 转换为PNG Blob
          canvas.toBlob(
            (pngBlob) => {
              if (pngBlob) {
                resolve(pngBlob)
              } else {
                reject(new Error('Canvas转PNG失败'))
              }
            },
            'image/png',
            1.0,
          )
        } catch (error) {
          reject(new Error('Canvas绘制失败: ' + error.message))
        }
      }

      img.onerror = (error) => {
        console.error('图片加载失败:', error)
        reject(new Error('图片加载失败，可能存在跨域限制'))
      }

      img.src = svgUrl
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 将SVG字符串转换为PNG Blob
 * @param {string} svgString - SVG的XML字符串
 * @param {Object} options - 转换选项
 * @param {number} options.scale - 缩放比例，默认为1
 * @param {string} options.backgroundColor - 背景色，默认透明
 * @returns {Promise<Blob>} PNG图片的Blob对象
 */
export async function svgStringToPngBlob(svgString, options = {}) {
  const { scale = 1, backgroundColor = 'transparent' } = options

  return new Promise((resolve, reject) => {
    try {
      // 1. 创建临时Image对象
      const img = new Image()
      const blob = new Blob([svgString], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)

      img.onload = () => {
        try {
          // 2. 创建Canvas
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')

          // 3. 设置Canvas尺寸（应用缩放）
          canvas.width = img.width * scale
          canvas.height = img.height * scale

          // 4. 绘制背景（如果需要）
          if (backgroundColor !== 'transparent') {
            ctx.fillStyle = backgroundColor
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          }

          // 5. 绘制SVG到Canvas
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          // 6. 转换为PNG Blob
          canvas.toBlob(
            (pngBlob) => {
              URL.revokeObjectURL(url)
              if (pngBlob) {
                resolve(pngBlob)
              } else {
                reject(new Error('Canvas转PNG失败'))
              }
            },
            'image/png',
            1.0,
          )
        } catch (error) {
          URL.revokeObjectURL(url)
          reject(error)
        }
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('SVG图片加载失败'))
      }

      img.src = url
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 将SVG URL转换为PNG DataURL
 * @param {string} svgUrl - SVG图片的URL
 * @param {Object} options - 转换选项
 * @returns {Promise<string>} PNG的DataURL
 */
export async function svgUrlToPngDataUrl(svgUrl, options = {}) {
  const blob = await svgUrlToPngBlob(svgUrl, options)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 下载SVG为PNG文件
 * @param {string} svgUrl - SVG图片的URL
 * @param {string} filename - 保存的文件名（不含扩展名）
 * @param {Object} options - 转换选项
 */
export async function downloadSvgAsPng(
  svgUrl,
  filename = 'image',
  options = {},
) {
  try {
    const blob = await svgUrlToPngBlob(svgUrl, options)
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = `${filename}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // 延迟释放URL，确保下载完成
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 100)
  } catch (error) {
    console.error('下载PNG失败:', error)
    throw error
  }
}

/**
 * 直接下载图片（适用于同源或已配置CORS的图片）
 * @param {string} imageUrl - 图片URL
 * @param {string} filename - 文件名
 */
export function downloadImageDirect(imageUrl, filename = 'image') {
  const link = document.createElement('a')
  link.href = imageUrl
  link.download = filename
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * 批量将SVG URL数组转换为PNG Blob URL数组
 * @param {Array<string>} svgUrls - SVG URL数组
 * @param {Object} options - 转换选项
 * @param {Function} onProgress - 进度回调 (current, total) => void
 * @returns {Promise<Array<string>>} PNG Blob URL数组
 */
export async function batchConvertSvgToPngUrls(
  svgUrls,
  options = {},
  onProgress = null,
) {
  const pngUrls = []
  const total = svgUrls.length

  for (let i = 0; i < svgUrls.length; i++) {
    try {
      const blob = await svgUrlToPngBlob(svgUrls[i], options)
      const url = URL.createObjectURL(blob)
      pngUrls.push(url)

      if (onProgress) {
        onProgress(i + 1, total)
      }
    } catch (error) {
      console.error(`转换第 ${i + 1} 个SVG失败:`, error)
      // 失败时保留原SVG URL
      pngUrls.push(svgUrls[i])
    }
  }

  return pngUrls
}

/**
 * 批量将SVG URL数组转换为PNG DataURL数组
 * @param {Array<string>} svgUrls - SVG URL数组
 * @param {Object} options - 转换选项
 * @param {Function} onProgress - 进度回调 (current, total) => void
 * @returns {Promise<Array<string>>} PNG DataURL数组
 */
export async function batchConvertSvgToPngDataUrls(
  svgUrls,
  options = {},
  onProgress = null,
) {
  const pngDataUrls = []
  const total = svgUrls.length

  for (let i = 0; i < svgUrls.length; i++) {
    try {
      const dataUrl = await svgUrlToPngDataUrl(svgUrls[i], options)
      pngDataUrls.push(dataUrl)

      if (onProgress) {
        onProgress(i + 1, total)
      }
    } catch (error) {
      console.error(`转换第 ${i + 1} 个SVG失败:`, error)
      // 失败时保留原SVG URL
      pngDataUrls.push(svgUrls[i])
    }
  }

  return pngDataUrls
}

/**
 * 批量将SVG URL数组转换为PNG Blob数组
 * @param {Array<string>} svgUrls - SVG URL数组
 * @param {Object} options - 转换选项
 * @param {Function} onProgress - 进度回调 (current, total) => void
 * @returns {Promise<Array<Blob>>} PNG Blob数组
 */
export async function batchConvertSvgToPngBlobs(
  svgUrls,
  options = {},
  onProgress = null,
) {
  const pngBlobs = []
  const total = svgUrls.length

  for (let i = 0; i < svgUrls.length; i++) {
    try {
      const blob = await svgUrlToPngBlob(svgUrls[i], options)
      pngBlobs.push(blob)

      if (onProgress) {
        onProgress(i + 1, total)
      }
    } catch (error) {
      console.error(`转换第 ${i + 1} 个SVG失败:`, error)
      // 失败时返回null
      pngBlobs.push(null)
    }
  }

  return pngBlobs
}

/**
 * 批量将SVG URL数组转换为PNG ArrayBuffer数组
 * @param {Array<string>} svgUrls - SVG URL数组
 * @param {Object} options - 转换选项
 * @param {Function} onProgress - 进度回调 (current, total) => void
 * @returns {Promise<Array<ArrayBuffer>>} PNG ArrayBuffer数组
 */
export async function batchConvertSvgToPngArrayBuffers(
  svgUrls,
  options = {},
  onProgress = null,
) {
  const arrayBuffers = []
  const total = svgUrls.length

  for (let i = 0; i < svgUrls.length; i++) {
    try {
      const blob = await svgUrlToPngBlob(svgUrls[i], options)
      const arrayBuffer = await blob.arrayBuffer()
      arrayBuffers.push(arrayBuffer)

      if (onProgress) {
        onProgress(i + 1, total)
      }
    } catch (error) {
      console.error(`转换第 ${i + 1} 个SVG失败:`, error)
      // 失败时返回null
      arrayBuffers.push(null)
    }
  }

  return arrayBuffers
}

/**
 * 释放批量转换生成的Blob URLs
 * @param {Array<string>} blobUrls - Blob URL数组
 */
export function revokeBatchBlobUrls(blobUrls) {
  blobUrls.forEach((url) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  })
}
