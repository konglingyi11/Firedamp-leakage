/**
 * WebGL 单例修复测试脚本
 * 在浏览器控制台运行以验证修复效果
 */

export async function testWebGLFix() {
  console.clear()
  console.log('🧪 开始 WebGL 单例修复测试...\n')

  // 1. 检查初始状态
  console.group('1️⃣ 初始状态检查')
  const initialCanvases = document.querySelectorAll('canvas').length
  console.log(`Canvas 数量: ${initialCanvases}`)

  if (window.webglDiagnostics) {
    const info = window.webglDiagnostics.canvases()
    const webglCount = info.filter((c) => c.hasWebGL).length
    console.log(`WebGL 上下文: ${webglCount}`)

    if (webglCount > 2) {
      console.warn(`⚠️ 上下文数量偏多: ${webglCount}`)
    } else {
      console.log(`✅ 上下文数量正常: ${webglCount}`)
    }
  }
  console.groupEnd()

  // 2. 检查场景管理器
  console.group('2️⃣ 场景管理器检查')
  try {
    const { getDiagnostics } = await import('./sceneManager.js')
    const sceneDiag = getDiagnostics()
    console.log('场景管理器状态:', sceneDiag)

    if (sceneDiag.refCount > 1) {
      console.warn(`⚠️ 引用计数偏高: ${sceneDiag.refCount}`)
    } else {
      console.log(`✅ 引用计数正常: ${sceneDiag.refCount}`)
    }
  } catch (error) {
    console.error('❌ 无法加载场景管理器:', error)
  }
  console.groupEnd()

  // 3. 检查渲染器管理器
  console.group('3️⃣ 渲染器管理器检查')
  try {
    const { getRefCount, hasRenderer } = await import('./rendererManager.js')
    console.log('渲染器存在:', hasRenderer())
    console.log('渲染器引用计数:', getRefCount())

    if (getRefCount() > 1) {
      console.warn(`⚠️ 渲染器引用计数偏高: ${getRefCount()}`)
    } else {
      console.log(`✅ 渲染器引用计数正常: ${getRefCount()}`)
    }
  } catch (error) {
    console.error('❌ 无法加载渲染器管理器:', error)
  }
  console.groupEnd()

  // 4. 检查泄漏
  console.group('4️⃣ 泄漏检查')
  if (window.webglDiagnostics) {
    const leaked = window.webglDiagnostics.leaked()
    if (leaked.length === 0) {
      console.log('✅ 未发现泄漏的 canvas')
    } else {
      console.warn(`⚠️ 发现 ${leaked.length} 个可能泄漏的 canvas`)
    }
  }
  console.groupEnd()

  // 5. 内存检查
  console.group('5️⃣ 内存使用检查')
  if (performance.memory) {
    const usedMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(2)
    const totalMB = (performance.memory.totalJSHeapSize / 1048576).toFixed(2)
    const limitMB = (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2)
    const usagePercent = (
      (performance.memory.usedJSHeapSize / performance.memory.totalJSHeapSize) *
      100
    ).toFixed(1)

    console.log(`已用: ${usedMB} MB`)
    console.log(`总计: ${totalMB} MB`)
    console.log(`限制: ${limitMB} MB`)
    console.log(`使用率: ${usagePercent}%`)

    if (usagePercent > 80) {
      console.warn(`⚠️ 内存使用率偏高: ${usagePercent}%`)
    } else {
      console.log(`✅ 内存使用率正常: ${usagePercent}%`)
    }
  } else {
    console.log('ℹ️ 浏览器不支持 performance.memory')
  }
  console.groupEnd()

  // 6. 总结
  console.log('\n📊 测试总结:')
  const issues = []

  if (initialCanvases > 3) {
    issues.push(`Canvas 数量偏多 (${initialCanvases})`)
  }

  if (window.webglDiagnostics) {
    const info = window.webglDiagnostics.canvases()
    const webglCount = info.filter((c) => c.hasWebGL).length
    if (webglCount > 2) {
      issues.push(`WebGL 上下文偏多 (${webglCount})`)
    }
  }

  if (issues.length === 0) {
    console.log('✅ 所有检查通过！WebGL 单例修复生效。')
  } else {
    console.warn('⚠️ 发现以下问题:')
    issues.forEach((issue) => console.warn(`  - ${issue}`))
  }

  console.log('\n💡 提示:')
  console.log('  - 进行一些操作（切换任务、调整参数等）')
  console.log('  - 然后再次运行此测试查看变化')
  console.log('  - 运行 window.webglDiagnostics.full() 查看详细信息')
}

/**
 * 压力测试：模拟用户操作
 */
export async function stressTest() {
  console.clear()
  console.log('🔥 开始压力测试...\n')
  console.log('⚠️ 此测试会模拟频繁的用户操作')
  console.log('⚠️ 请在测试前后运行 testWebGLFix() 对比结果\n')

  const initialInfo = window.webglDiagnostics?.canvases() || []
  const initialWebGLCount = initialInfo.filter((c) => c.hasWebGL).length
  console.log(`初始 WebGL 上下文: ${initialWebGLCount}`)

  // 模拟操作
  console.log('\n开始模拟操作...')

  // 等待一段时间让用户手动操作
  console.log('请在接下来的 30 秒内进行以下操作:')
  console.log('  1. 切换任务')
  console.log('  2. 切换可视化类型（2D ↔ 3D）')
  console.log('  3. 切换气体变量')
  console.log('  4. 播放时间轴动画')
  console.log('  5. 切换图层显隐')

  await new Promise((resolve) => setTimeout(resolve, 30000))

  // 检查结果
  console.log('\n📊 压力测试结果:')
  const finalInfo = window.webglDiagnostics?.canvases() || []
  const finalWebGLCount = finalInfo.filter((c) => c.hasWebGL).length
  const increase = finalWebGLCount - initialWebGLCount

  console.log(`初始 WebGL 上下文: ${initialWebGLCount}`)
  console.log(`最终 WebGL 上下文: ${finalWebGLCount}`)
  console.log(`增加数量: ${increase}`)

  if (increase === 0) {
    console.log('✅ 完美！上下文数量没有增加')
  } else if (increase <= 1) {
    console.log('✅ 良好！上下文数量仅增加 1 个（可能是临时上下文）')
  } else if (increase <= 3) {
    console.warn(`⚠️ 注意！上下文数量增加了 ${increase} 个`)
  } else {
    console.error(`❌ 严重！上下文数量增加了 ${increase} 个，可能存在泄漏`)
  }

  // 检查泄漏
  if (window.webglDiagnostics) {
    const leaked = window.webglDiagnostics.leaked()
    if (leaked.length > 0) {
      console.warn(`⚠️ 发现 ${leaked.length} 个可能泄漏的 canvas`)
    }
  }

  console.log('\n运行 window.webglDiagnostics.full() 查看详细信息')
}

// 导出到 window 以便在控制台使用
if (typeof window !== 'undefined') {
  window.testWebGLFix = testWebGLFix
  window.stressTest = stressTest

  console.log('🧪 WebGL 测试工具已加载')
  console.log('运行以下命令进行测试:')
  console.log('  window.testWebGLFix()  - 快速测试')
  console.log('  window.stressTest()    - 压力测试')
}
