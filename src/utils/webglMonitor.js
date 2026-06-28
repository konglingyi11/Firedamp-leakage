/**
 * WebGL 上下文监控工具
 * 用于检测和预防 WebGL 上下文泄漏
 */

let contextCount = 0
let isMonitoring = false

/**
 * 启动 WebGL 上下文监控
 */
export function startWebGLMonitoring() {
  if (isMonitoring) return
  isMonitoring = true

  // 拦截 getContext 方法
  const originalGetContext = HTMLCanvasElement.prototype.getContext

  HTMLCanvasElement.prototype.getContext = function (...args) {
    const context = originalGetContext.apply(this, args)

    if (args[0] === 'webgl' || args[0] === 'webgl2') {
      contextCount++
      console.log(`[WebGL Monitor] Context created. Total: ${contextCount}`)

      // 警告级别
      if (contextCount > 4) {
        console.warn(
          `[WebGL Monitor] ⚠️ 上下文数量较多: ${contextCount}，建议关闭一些可视化图层`,
        )
      }

      if (contextCount > 8) {
        console.error(
          `[WebGL Monitor] 🔴 危险：${contextCount} 个上下文！浏览器可能会强制回收最旧的上下文`,
        )
      }

      // 添加上下文丢失监听
      if (this) {
        this.addEventListener(
          'webglcontextlost',
          (event) => {
            console.error('[WebGL Monitor] Context lost on canvas:', this)
            contextCount = Math.max(0, contextCount - 1)
          },
          false,
        )
      }
    }

    return context
  }

  console.log('[WebGL Monitor] Monitoring started')
}

/**
 * 获取当前上下文数量
 */
export function getContextCount() {
  return contextCount
}

/**
 * 获取活动的 canvas 数量
 */
export function getActiveCanvasCount() {
  return document.querySelectorAll('canvas').length
}

/**
 * 检查 WebGL 健康状态
 */
export function checkWebGLHealth() {
  const canvases = document.querySelectorAll('canvas')
  const health = {
    canvasCount: canvases.length,
    contextCount: contextCount,
    status: 'healthy',
    warnings: [],
  }

  if (canvases.length > 6) {
    health.status = 'warning'
    health.warnings.push(`过多的 canvas 元素: ${canvases.length}`)
  }

  if (contextCount > 4) {
    health.status = 'warning'
    health.warnings.push(`过多的 WebGL 上下文: ${contextCount}`)
  }

  if (contextCount > 8) {
    health.status = 'critical'
    health.warnings.push(
      `危险：${contextCount} 个 WebGL 上下文，浏览器可能会回收上下文`,
    )
  }

  // 检查内存使用
  if (performance.memory) {
    const usedMB = performance.memory.usedJSHeapSize / 1048576
    const totalMB = performance.memory.totalJSHeapSize / 1048576
    const usagePercent = (usedMB / totalMB) * 100

    health.memory = {
      used: usedMB.toFixed(2) + ' MB',
      total: totalMB.toFixed(2) + ' MB',
      percent: usagePercent.toFixed(1) + '%',
    }

    if (usagePercent > 80) {
      health.status = 'warning'
      health.warnings.push(`内存使用率过高: ${usagePercent.toFixed(1)}%`)
    }
  }

  return health
}

/**
 * 启动定期健康检查
 */
export function startHealthCheck(interval = 30000) {
  setInterval(() => {
    const health = checkWebGLHealth()
    console.log('[WebGL Health Check]', health)

    if (health.status === 'warning') {
      console.warn('[WebGL Health Check] ⚠️ 警告:', health.warnings.join(', '))
    } else if (health.status === 'critical') {
      console.error('[WebGL Health Check] 🔴 严重:', health.warnings.join(', '))
    }
  }, interval)
}

/**
 * 获取 GPU 信息
 */
export function getGPUInfo() {
  const canvas = document.createElement('canvas')
  const gl =
    canvas.getContext('webgl') || canvas.getContext('experimental-webgl')

  if (!gl) {
    return {
      supported: false,
      vendor: 'Unknown',
      renderer: 'Unknown',
    }
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const info = {
    supported: true,
    vendor: 'Unknown',
    renderer: 'Unknown',
    version: gl.getParameter(gl.VERSION),
    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxCombinedTextureImageUnits: gl.getParameter(
      gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS,
    ),
  }

  if (debugInfo) {
    info.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    info.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
  }

  return info
}

/**
 * 检测 GPU 性能等级
 */
export function detectGPUTier() {
  const info = getGPUInfo()

  if (!info.supported) {
    return 'unsupported'
  }

  const renderer = info.renderer.toLowerCase()

  // 集成显卡（低端）
  if (
    renderer.includes('intel') &&
    !renderer.includes('iris') &&
    !renderer.includes('arc')
  ) {
    return 'low'
  }

  // 移动端 GPU
  if (
    renderer.includes('mali') ||
    renderer.includes('adreno') ||
    renderer.includes('powervr')
  ) {
    return 'low'
  }

  // 高端独立显卡
  if (
    renderer.includes('nvidia') ||
    renderer.includes('geforce') ||
    renderer.includes('rtx') ||
    renderer.includes('gtx')
  ) {
    return 'high'
  }

  if (renderer.includes('amd') || renderer.includes('radeon')) {
    return 'high'
  }

  // Intel Iris / Arc（中高端）
  if (renderer.includes('iris') || renderer.includes('arc')) {
    return 'medium'
  }

  // 默认中端
  return 'medium'
}

/**
 * 打印完整的诊断报告
 */
export function printDiagnostics() {
  console.group('🔍 WebGL 诊断报告')

  const health = checkWebGLHealth()
  console.log('健康状态:', health)

  const gpuInfo = getGPUInfo()
  console.log('GPU 信息:', gpuInfo)

  const gpuTier = detectGPUTier()
  console.log('GPU 等级:', gpuTier)

  const canvases = document.querySelectorAll('canvas')
  console.log('Canvas 元素:', canvases)

  console.groupEnd()
}
