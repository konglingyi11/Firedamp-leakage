import { request } from '@/utils/request'
import {
  isGoafMockEnabled,
  createMockGoafTask,
  createMockGoafMetadata,
} from './mockGoafTask'

/**
 * 任务管理 API
 * 提供仿真任务的完整生命周期管理功能
 */
export const taskApi = {
  /**
   * 获取任务列表
   * @param {Object} [params] - 查询参数
   * @param {number} [params.page=1] - 页码，从1开始
   * @param {number} [params.page_size=20] - 每页数量
   * @param {string} [params.status] - 任务状态过滤: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
   * @param {string} [params.worker_id] - Worker 节点 ID 过滤
   * @param {string} [params.model_id] - 模型 ID 过滤
   * @returns {Promise<Object>} 任务列表分页数据
   * @returns {Promise<Object>} result.items - 任务列表
   * @returns {Promise<number>} result.total - 总数量
   * @returns {Promise<number>} result.page - 当前页码
   * @returns {Promise<number>} result.page_size - 每页数量
   */
  getTasks(params) {
    if (isGoafMockEnabled()) {
      return Promise.resolve({
        items: [createMockGoafTask()],
        total: 1,
        page: params?.page ?? 1,
        page_size: params?.page_size ?? 10,
      })
    }
    return request.get('/api/v1/tasks/', params)
  },

  /**
   * 基于模型创建新的仿真任务
   * @param {Object} data - 任务创建数据
   * @param {string} data.model_id - 模型 ID（必填）
   * @param {string} data.name - 任务名称（必填）
   * @param {string} [data.description] - 任务描述
   * @param {Object} [data.params] - 任务参数配置
   * @param {number} [data.params.operating_temperature] - 操作温度 (K)
   * @param {number} [data.params.operating_pressure] - 操作压力 (Pa)
   * @param {number} [data.params.humidity] - 湿度 (%)
   * @param {Array<Object>} [data.params.boundary_conditions] - 边界条件列表
   * @returns {Promise<Object>} 创建的任务详情
   * @returns {Promise<string>} result.id - 任务 ID
   * @returns {Promise<string>} result.name - 任务名称
   * @returns {Promise<string>} result.status - 任务状态
   * @returns {Promise<string>} result.created_at - 创建时间
   */
  createTask(data) {
    return request.post('/api/v1/tasks/', data)
  },

  /**
   * 获取任务对应的可选物理变量列表
   * 包含标准变量（温度、压力等）和组分质量分数变量
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Array<string>>} 物理变量名称列表
   * @example
   * // 返回示例: ['Temperature', 'Pressure', 'VelocityMagnitude', 'Mass_fraction_of_co2', ...]
   */
  getTaskVariables(taskId) {
    return request.get(`/api/v1/tasks/${taskId}/variables`)
  },

  /**
   * 更新仿真任务的配置参数
   * @param {string} taskId - 任务 ID
   * @param {Object} data - 更新数据
   * @param {string} [data.name] - 任务名称
   * @param {string} [data.description] - 任务描述
   * @param {Object} [data.params] - 任务参数配置
   * @param {number} [data.params.operating_temperature] - 操作温度 (K)
   * @param {number} [data.params.operating_pressure] - 操作压力 (Pa)
   * @param {Array<Object>} [data.params.boundary_conditions] - 边界条件列表
   * @returns {Promise<Object>} 更新后的任务详情
   */
  updateTask(taskId, data) {
    return request.put(`/api/v1/tasks/${taskId}`, data)
  },

  /**
   * 删除指定的仿真任务
   * 注意：删除任务会同时删除相关的计算结果和后处理数据
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 删除结果
   * @returns {Promise<boolean>} result.success - 是否成功
   * @returns {Promise<string>} result.message - 结果消息
   */
  deleteTask(taskId) {
    return request.delete(`/api/v1/tasks/${taskId}`)
  },

  /**
   * 启动仿真任务执行
   * @param {string} taskId - 任务 ID
   * @param {Object} data - 运行配置
   * @param {string} data.worker_id - 指定执行任务的 Worker ID（必填）
   * @param {Object} [data.runtime_config] - 运行时参数配置
   * @param {number} [data.runtime_config.time_steps=100] - 时间步数
   * @param {number} [data.runtime_config.time_step_size=0.01] - 时间步长 (s)
   * @param {number} [data.runtime_config.iterations_per_time_step=10] - 每个时间步的迭代次数
   * @param {number} [data.runtime_config.processes=1] - 并行进程数
   * @returns {Promise<Object>} 任务启动结果
   * @returns {Promise<string>} result.task_id - 任务 ID
   * @returns {Promise<string>} result.status - 任务状态
   * @returns {Promise<string>} result.worker_id - 执行的 Worker ID
   */
  runTask(taskId, data) {
    return request.post(`/api/v1/tasks/${taskId}/run`, data)
  },

  /**
   * 强制停止正在运行的仿真任务
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 停止结果
   * @returns {Promise<boolean>} result.success - 是否成功
   * @returns {Promise<string>} result.message - 结果消息
   * @returns {Promise<string>} result.status - 任务当前状态
   */
  stopTask(taskId) {
    return request.post(`/api/v1/tasks/${taskId}/stop`)
  },

  /**
   * 获取仿真任务的实时执行进度
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 任务进度信息
   * @returns {Promise<string>} result.status - 任务状态: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
   * @returns {Promise<number>} result.progress - 进度百分比 (0-100)
   * @returns {Promise<number>} result.current_time_step - 当前时间步
   * @returns {Promise<number>} result.total_time_steps - 总时间步数
   * @returns {Promise<number>} result.elapsed_time - 已用时间 (秒)
   * @returns {Promise<number>} result.estimated_remaining_time - 预计剩余时间 (秒)
   * @returns {Promise<string>} result.message - 状态消息
   */
  getTaskProgress(taskId) {
    if (isGoafMockEnabled()) {
      return Promise.resolve({
        status: 'completed',
        progress: 100,
        current_time_step: 10,
        total_time_steps: 10,
        elapsed_time: 0,
        estimated_remaining_time: 0,
        message: '模拟任务已完成',
      })
    }
    return request.get(`/api/v1/tasks/${taskId}/progress`)
  },

  /**
   * 获取后处理预生成进度
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 进度信息
   */
  getTaskPregenProgress(taskId) {
    if (isGoafMockEnabled()) {
      return Promise.resolve({
        total: 0,
        completed: 0,
        failed: 0,
        progress: 100,
        status: 'completed',
      })
    }
    return request.get(`/api/v1/pregen/tasks/${taskId}/progress`)
  },

  /**
   * 手动触发后处理预生成
   * 根据任务 ID 触发预生成；若该任务已有预生成在运行则幂等，不重复触发。
   * @param {string} taskId - 任务 ID（必填）
   * @returns {Promise<Object>} 成功时通常返回 202，data 可为 null
   */
  triggerTaskPregen(taskId) {
    return request.post(`/api/v1/pregen/tasks/${taskId}/trigger`)
  },

  /**
   * 获取指定仿真任务的详细信息
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 任务详细信息
   * @returns {Promise<string>} result.id - 任务 ID
   * @returns {Promise<string>} result.name - 任务名称
   * @returns {Promise<string>} result.description - 任务描述
   * @returns {Promise<string>} result.status - 任务状态
   * @returns {Promise<string>} result.model_id - 关联的模型 ID
   * @returns {Promise<string>} result.worker_id - 执行的 Worker ID
   * @returns {Promise<Object>} result.params - 任务参数配置
   * @returns {Promise<Object>} result.runtime_config - 运行时配置
   * @returns {Promise<string>} result.created_at - 创建时间
   * @returns {Promise<string>} result.updated_at - 更新时间
   * @returns {Promise<string>} result.started_at - 开始时间
   * @returns {Promise<string>} result.completed_at - 完成时间
   */
  getTaskDetail(taskId) {
    if (isGoafMockEnabled()) {
      return Promise.resolve(createMockGoafTask({ id: taskId }))
    }
    return request.get(`/api/v1/tasks/${taskId}`)
  },

  /**
   * 获取任务的元数据信息
   * 包含几何信息、网格信息、物理参数等
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 任务元数据
   * @returns {Promise<Object>} result.geometry - 几何信息（边界框、中心点等）
   * @returns {Promise<Object>} result.mesh - 网格信息（节点数、单元数等）
   * @returns {Promise<Object>} result.physics - 物理参数信息
   * @returns {Promise<Array<string>>} result.variables - 可用的物理变量列表
   * @returns {Promise<Array<Object>>} result.boundary_conditions - 边界条件列表
   */
  getTaskMetadata(taskId) {
    if (isGoafMockEnabled()) {
      return Promise.resolve(createMockGoafMetadata())
    }
    return request.get(`/api/v1/tasks/${taskId}/metadata`)
  },

  /**
   * 获取当前活跃的 Worker 列表（快捷方法）
   * @deprecated 建议使用 workerApi.getWorkers()
   * @returns {Promise<Array>} Worker 节点列表
   */
  getWorkers() {
    return request.get('/api/v1/workers/')
  },

  /**
   * 复位指定的 Worker 节点（快捷方法）
   * @deprecated 建议使用 workerApi.resetWorker()
   * @param {string} workerId - Worker ID
   * @returns {Promise<Object>} 复位结果
   */
  resetWorker(workerId) {
    return request.post(`/api/v1/workers/${workerId}/reset`)
  },
}

export default taskApi
