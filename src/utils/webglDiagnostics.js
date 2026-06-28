/**
 * WebGL 上下文诊断工具
 * 用于分析和定位 WebGL 上下文泄漏的根源
 */

/**
 * 获取所有 canvas 元素的详细信息
 */
export function getAllCanvasInfo() {
  const canvases = document.querySelectorAll('canvas')
  const info = []

  canvases.forEach((canvas, index) => {
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2')
    const gl2 = canvas.getContext('webgl2')

    const rect = canvas.getBoundingClientRect()
    const isVisible = rect.width > 0 && rect.height > 0
    const isInDOM = document.body.contains(canvas)

    // 尝试获取 canvas 的父组件信息
    let parentInfo = 'unknown'
    let currentElement = canvas.parentElement
    while (currentElement) {
      if (currentElement.className) {
        parentInfo = currentElement.className
        break
      }
      currentElement = currentElement.parentElement
    }

    info.push({
      index,
      id: canvas.id || `canvas-${index}`,
      width: canvas.width,
      height: canvas.height,
      displayWidth: rect.width,
      displayHeight: rect.height,
      hasWebGL: !!gl,
      hasWebGL2: !!gl2,
      isContextLost: gl?.isContextLost() ?? null,
      isVisible,
      isInDOM,
      parentClass: parentInfo,
      canvas: canvas, // 保留引用以便进一步检查
    })
  })

  return info
}

/**
 * 打印详细的 WebGL 诊断报告
 */
export function printDetailedDiagnostics() {
  console.group('🔍 详细 WebGL 诊断报告')

  const canvasInfo = getAllCanvasInfo()

  console.log(`📊 总计: ${canvasInfo.length} 个 canvas 元素`)
  console.log(`✅ 可见: ${canvasInfo.filter((c) => c.isVisible).length} 个`)
  console.log(`❌ 不可见: ${canvasInfo.filter((c) => !c.isVisible).length} 个`)
  console.log(`🌐 有 WebGL: ${canvasInfo.filter((c) => c.hasWebGL).length} 个`)
  console.log(
    `🌐 有 WebGL2: ${canvasInfo.filter((c) => c.hasWebGL2).length} 个`,
  )
  console.log(
    `💀 上下文丢失: ${canvasInfo.filter((c) => c.isContextLost).length} 个`,
  )
  console.log(`🗑️ 不在 DOM: ${canvasInfo.filter((c) => !c.isInDOM).length} 个`)

  console.group('📋 Canvas 详细列表')
  canvasInfo.forEach((info) => {
    const status = []
    if (!info.isVisible) status.push('不可见')
    if (!info.isInDOM) status.push('不在DOM')
    if (info.isContextLost) status.push('上下文丢失')
    if (info.width === 0 || info.height === 0) status.push('尺寸为0')

    const statusText = status.length > 0 ? ` [${status.join(', ')}]` : ''

    console.log(
      `${info.index}. ${info.id} - ${info.width}x${info.height} - ${info.parentClass}${statusText}`,
    )
  })
  console.groupEnd()

  // 按父组件分组统计
  const byParent = {}
  canvasInfo.forEach((info) => {
    const parent = info.parentClass
    if (!byParent[parent]) {
      byParent[parent] = []
    }
    byParent[parent].push(info)
  })

  console.group('📦 按父组件分组')
  Object.entries(byParent).forEach(([parent, canvases]) => {
    console.log(`${parent}: ${canvases.length} 个 canvas`)
  })
  console.groupEnd()

  // 检查内存使用
  if (performance.memory) {
    const usedMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(2)
    const totalMB = (performance.memory.totalJSHeapSize / 1048576).toFixed(2)
    const limitMB = (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2)
    const usagePercent = (
      (performance.memory.usedJSHeapSize / performance.memory.totalJSHeapSize) *
      100
    ).toFixed(1)

    console.group('💾 内存使用')
    console.log(`已用: ${usedMB} MB`)
    console.log(`总计: ${totalMB} MB`)
    console.log(`限制: ${limitMB} MB`)
    console.log(`使用率: ${usagePercent}%`)
    console.groupEnd()
  }

  console.groupEnd()

  return canvasInfo
}

/**
 * 查找可能泄漏的 canvas（不可见但仍在 DOM 中）
 */
export function findLeakedCanvases() {
  const canvasInfo = getAllCanvasInfo()

  const leaked = canvasInfo.filter((info) => {
    // 不可见但在 DOM 中，或者尺寸为 0
    return (
      info.isInDOM && (!info.isVisible || info.width === 0 || info.height === 0)
    )
  })

  if (leaked.length > 0) {
    console.warn(`⚠️ 发现 ${leaked.length} 个可能泄漏的 canvas:`)
    leaked.forEach((info) => {
      console.warn(`  - ${info.id} (${info.parentClass})`)
    })
  } else {
    console.log('✅ 未发现明显泄漏的 canvas')
  }

  return leaked
}

/**
 * 监控 WebGL 上下文创建（增强版）
 */
export function startEnhancedWebGLMonitoring() {
  let contextCount = 0
  const contextMap = new WeakMap()
  const creationStack = []

  const originalGetContext = HTMLCanvasElement.prototype.getContext

  HTMLCanvasElement.prototype.getContext = function (...args) {
    const context = originalGetContext.apply(this, args)

    if (args[0] === 'webgl' || args[0] === 'webgl2') {
      contextCount++

      // 记录创建堆栈
      const stack = new Error().stack
      const stackLines = stack.split('\n').slice(2, 6).join('\n')

      // 尝试识别创建来源
      let source = 'unknown'
      if (stackLines.includes('ThreeVisualizationCanvas')) {
        source = 'ThreeVisualizationCanvas'
      } else if (stackLines.includes('THREE.WebGLRenderer')) {
        source = 'THREE.WebGLRenderer'
      }

      creationStack.push({
        count: contextCount,
        source,
        timestamp: Date.now(),
        stack: stackLines,
      })

      console.log(
        `[WebGL Monitor] 🆕 Context #${contextCount} created by ${source}`,
      )

      if (contextCount > 4) {
        console.warn(
          `[WebGL Monitor] ⚠️ 上下文数量较多: ${contextCount}`,
          `\n来源: ${source}`,
          `\n堆栈:\n${stackLines}`,
        )
      }

      if (contextCount > 8) {
        console.error(
          `[WebGL Monitor] 🔴 危险：${contextCount} 个上下文！`,
          `\n来源: ${source}`,
          `\n堆栈:\n${stackLines}`,
        )

        // 打印创建历史
        console.group('📜 上下文创建历史')
        creationStack.forEach((entry) => {
          console.log(
            `#${entry.count} - ${entry.source} @ ${new Date(entry.timestamp).toLocaleTimeString()}`,
          )
        })
        console.groupEnd()
      }

      // 添加上下文丢失监听
      if (this) {
        this.addEventListener(
          'webglcontextlost',
          (event) => {
            console.error(`[WebGL Monitor] 💀 Context lost (${source})`)
            contextCount = Math.max(0, contextCount - 1)
          },
          false,
        )
      }
    }

    return context
  }

  console.log('[WebGL Monitor] 增强监控已启动')

  // 返回获取统计信息的函数
  return {
    getCount: () => contextCount,
    getHistory: () => [...creationStack],
    printHistory: () => {
      console.group('📜 WebGL 上下文创建历史')
      creationStack.forEach((entry) => {
        console.log(
          `#${entry.count} - ${entry.source} @ ${new Date(entry.timestamp).toLocaleTimeString()}`,
        )
      })
      console.groupEnd()
    },
  }
}

/**
 * 一键诊断：运行所有诊断工具
 */
export function runFullDiagnostics() {
  console.clear()
  console.log('🔬 开始完整 WebGL 诊断...\n')

  printDetailedDiagnostics()
  console.log('\n')
  findLeakedCanvases()

  console.log('\n✅ 诊断完成')
  console.log('💡 提示: 在控制台运行以下命令进行持续监控:')
  console.log(
    '   import { startEnhancedWebGLMonitoring } from "@/utils/webglDiagnostics"',
  )
  console.log('   const monitor = startEnhancedWebGLMonitoring()')
  console.log('   monitor.printHistory() // 查看创建历史')
}

// 导出到 window 以便在控制台使用
if (typeof window !== 'undefined') {
  window.__webglDiagnostics = {
    printDetailedDiagnostics,
    findLeakedCanvases,
    startEnhancedWebGLMonitoring,
    runFullDiagnostics,
    getAllCanvasInfo,
  }
}
