import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './style.css'
import './theme.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// WebGL 监控和诊断（仅开发环境）
if (import.meta.env.DEV) {
  Promise.all([
    import('./utils/webglMonitor'),
    import('./utils/webglDiagnostics'),
    import('./utils/testWebGLFix'),
  ]).then(([monitor, diagnostics, test]) => {
    // 启动基础监控
    monitor.startWebGLMonitoring()
    monitor.startHealthCheck(30000) // 每 30 秒检查一次

    // 启动增强监控
    const enhancedMonitor = diagnostics.startEnhancedWebGLMonitoring()

    // 在控制台暴露诊断函数
    window.webglDiagnostics = {
      basic: monitor.printDiagnostics,
      full: diagnostics.runFullDiagnostics,
      canvases: diagnostics.getAllCanvasInfo,
      leaked: diagnostics.findLeakedCanvases,
      history: enhancedMonitor.printHistory,
    }

    console.log('[WebGL Monitor] 监控已启动')
    console.log('[WebGL Monitor] 可用命令:')
    console.log('  window.webglDiagnostics.basic()   - 基础诊断')
    console.log('  window.webglDiagnostics.full()    - 完整诊断')
    console.log('  window.webglDiagnostics.canvases() - Canvas 列表')
    console.log('  window.webglDiagnostics.leaked()  - 查找泄漏')
    console.log('  window.webglDiagnostics.history() - 创建历史')
    console.log('  window.testWebGLFix()             - 快速测试')
    console.log('  window.stressTest()               - 压力测试')
  })
}

const app = createApp(App)
app.use(router)
app.use(pinia)
app.use(ElementPlus, {
  locale: zhCn,
  // 配置 ElMessage 避免堆叠
  message: {
    max: 1, // 同时最多显示 1 条消息
    grouping: true, // 合并相同内容的消息
  },
})

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.mount('#app')
