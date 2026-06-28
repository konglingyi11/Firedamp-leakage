import { ElMessage } from 'element-plus'
import { useApply2D } from './useApply2D'
import { useApply3D } from './useApply3D'

/**
 * 可视化设置应用聚合 Composable
 * 
 * 职责：
 * 1. 协调 2D 与 3D 可视化应用的入参调度。
 * 2. 处理点击「应用设置」后的全局反馈（消息、Loading、Timeline 状态切换）。
 * 3. 作为 facade 简化 HomeView 的调用逻辑。
 */
export function useApplySettings(options) {
  const {
    visualizationDimension,
    visualization2DType,
    visualization3DType,
    visualization,
    hasAppliedSettings,
    isTimelineCollapsed,
  } = options.refs

  const {
    handleTimelineStop,
  } = options.methods

  // 初始化子领域的应用逻辑
  const { apply2D } = useApply2D(options)
  const { apply3D, loadVolumeLayer } = useApply3D(options)

  const runAfterApplySuccess = async (hooks = {}) => {
    if (typeof handleTimelineStop === 'function') {
      handleTimelineStop()
    }

    hasAppliedSettings.value = true
    isTimelineCollapsed.value = false

    if (typeof hooks.afterSuccess === 'function') {
      await hooks.afterSuccess()
    }
  }

  const hasSelectedValues = (raw) =>
    Array.isArray(raw)
      ? raw.some((x) => x != null && String(x).trim() !== '')
      : raw != null && String(raw).trim() !== ''

  const snapshotVisualizationInputs = () => {
    const viz = visualization.value || {}
    return {
      variable: viz.variable,
      cloud_variables: Array.isArray(viz.cloud_variables)
        ? [...viz.cloud_variables]
        : viz.cloud_variables,
      volume_variables: Array.isArray(viz.volume_variables)
        ? [...viz.volume_variables]
        : viz.volume_variables,
      radar_frequencies: Array.isArray(viz.radar_frequencies)
        ? [...viz.radar_frequencies]
        : viz.radar_frequencies,
      radar_frequency: viz.radar_frequency,
    }
  }

  const restoreVisualizationInputs = (snapshot) => {
    const viz = visualization.value
    if (!viz || !snapshot) return
    viz.variable = snapshot.variable
    viz.cloud_variables = snapshot.cloud_variables
    viz.volume_variables = snapshot.volume_variables
    viz.radar_frequencies = snapshot.radar_frequencies
    viz.radar_frequency = snapshot.radar_frequency
  }

  const applyWithMode = async ({
    dimension,
    type2d,
    type3d,
    suppressGas = false,
    suppressRadar = false,
  }) => {
    const inputSnapshot = snapshotVisualizationInputs()
    const viz = visualization.value || {}
    visualizationDimension.value = dimension
    if (type2d) visualization2DType.value = type2d
    if (type3d) visualization3DType.value = type3d

    if (suppressGas) {
      viz.variable = ''
      viz.cloud_variables = []
      viz.volume_variables = []
    }
    if (suppressRadar) {
      viz.radar_frequencies = []
      viz.radar_frequency = ''
    }

    try {
      if (dimension === '2d') {
        await apply2D()
      } else if (dimension === '3d') {
        await apply3D()
      }
    } finally {
      restoreVisualizationInputs(inputSnapshot)
    }
  }

  const buildSelectedInputApplyJobs = () => {
    const viz = visualization.value || {}
    const hasCloudGas = hasSelectedValues(viz.cloud_variables)
    const hasVolumeGas = hasSelectedValues(viz.volume_variables)
    const hasRadar = hasSelectedValues(viz.radar_frequencies ?? viz.radar_frequency)
    const jobs = []

    if (hasCloudGas) {
      jobs.push({
        key: 'gas-cloud',
        dimension: '2d',
        type2d: 'cloud',
        suppressRadar: true,
      })
    }
    if (hasVolumeGas) {
      jobs.push({
        key: 'gas-volume',
        dimension: '3d',
        type3d: 'volume',
        suppressRadar: true,
      })
    }

    if (hasRadar) {
      const useVolumeRadar = visualizationDimension.value === '3d'
      jobs.push(
        useVolumeRadar
          ? {
              key: 'radar-volume',
              dimension: '3d',
              type3d: 'volume',
              suppressGas: true,
            }
          : {
              key: 'radar-cloud',
              dimension: '2d',
              type2d: 'cloud',
              suppressGas: true,
            },
      )
    }

    return jobs
  }

  /**
   * 核心分发逻辑
   * @param {{ afterSuccess?: () => void | Promise<void> }} [hooks] 应用成功后的回调；介质与调制等专用入口使用
   */
  const applyVisualizationSettings = (hooks = {}) => {
    // 使用 setTimeout 将耗时的异步请求流推迟到下一次事件循环
    setTimeout(async () => {
      try {
        if (visualizationDimension.value === '2d') {
          await apply2D()
        } else if (visualizationDimension.value === '3d') {
          await apply3D()
        }

        await runAfterApplySuccess(hooks)
        
      } catch (error) {
        console.error('[useApplySettings] 应用可视化设置发生意外错误:', error)
        ElMessage.error('应用设置异常，请尝试刷新页面或检查后台服务')
      }
    }, 0)
  }

  /**
   * 可视化选项面板使用：按左侧选择拆分应用任务。
   * 气体和雷达选择互不覆盖；当两者都存在时，同一次点击会分别触发对应加载。
   */
  const applySelectedInputsSettings = (hooks = {}) => {
    setTimeout(async () => {
      const prev = {
        dimension: visualizationDimension.value,
        type2d: visualization2DType.value,
        type3d: visualization3DType.value,
      }

      try {
        const jobs = buildSelectedInputApplyJobs()
        if (!jobs.length) {
          await applyWithMode(prev)
        } else {
          for (const job of jobs) {
            await applyWithMode(job)
          }
        }

        visualizationDimension.value = prev.dimension
        visualization2DType.value = prev.type2d
        visualization3DType.value = prev.type3d

        await runAfterApplySuccess(hooks)
      } catch (error) {
        visualizationDimension.value = prev.dimension
        visualization2DType.value = prev.type2d
        visualization3DType.value = prev.type3d
        console.error('[useApplySettings] 应用可视化选择发生意外错误:', error)
        ElMessage.error('应用设置异常，请尝试刷新页面或检查后台服务')
      }
    }, 0)
  }

  return {
    applyVisualizationSettings,
    applySelectedInputsSettings,
    loadVolumeLayer,
  }
}
