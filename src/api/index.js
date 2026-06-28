import workerApi from './worker'
import taskApi from './task'
import healthApi from './health'
import modelApi from './model'
import postProcessingApi from './postProcessing'
import ribbonApi from './ribbon'

/**
 * Fluent API 统一导出
 * 提供所有 API 模块的命名导出和默认导出
 */

// 命名导出 - 推荐使用
export { workerApi, taskApi, healthApi, modelApi, postProcessingApi, ribbonApi }

// 默认导出 - 组合对象
export default {
  worker: workerApi,
  task: taskApi,
  health: healthApi,
  model: modelApi,
  postProcessing: postProcessingApi,
  ribbon: ribbonApi,
}

/**
 * Composition API 风格的导出
 * 用于 Vue 3 Composition API
 * @returns {Object} API 模块对象
 * @example
 * import { useFluentApi } from '@/api'
 * const { worker, task, health, model, postProcessing, ribbon } = useFluentApi()
 */
export const useFluentApi = () => {
  return {
    worker: workerApi,
    task: taskApi,
    health: healthApi,
    model: modelApi,
    postProcessing: postProcessingApi,
    ribbon: ribbonApi,
  }
}
