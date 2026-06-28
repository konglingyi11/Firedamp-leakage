import { request } from '@/utils/request'

/**
 * Worker 节点管理 API
 * 提供计算节点的注册、心跳、状态监控和管理功能
 */
export const workerApi = {
  /**
   * 发送 Worker 节点心跳
   * Worker 节点定期调用此接口保持在线状态
   * @param {Object} data - 心跳数据
   * @param {string} data.hostname - 主机名（必填）
   * @param {string} data.ip_address - IP 地址（必填）
   * @param {number} data.port - 端口号（必填）
   * @param {string} [data.status='idle'] - 节点状态: 'idle' | 'busy' | 'offline'
   * @param {Object} [data.system_info] - 系统信息
   * @param {number} [data.system_info.cpu_usage] - CPU 使用率 (0-100)
   * @param {number} [data.system_info.memory_usage] - 内存使用率 (0-100)
   * @param {number} [data.system_info.disk_usage] - 磁盘使用率 (0-100)
   * @returns {Promise<Object>} 响应结果
   * @returns {Promise<string>} result.worker_id - Worker ID
   * @returns {Promise<string>} result.status - 当前状态
   * @returns {Promise<string>} result.message - 响应消息
   */
  workerHeartbeat(data) {
    return request.post('/api/v1/workers/heartbeat', data)
  },

  /**
   * 获取当前所有活跃的 Worker 节点列表
   * 响应体通常为 { code, message, data: Worker[] }；经 request 拦截器后多为 Worker[]。
   * @param {Object} [params] - 查询参数
   * @param {string} [params.status] - 状态过滤: 'idle' | 'busy' | 'offline'
   * @returns {Promise<Array>} Worker 节点数组
   * @returns {Promise<string>} result[].id - Worker ID
   * @returns {Promise<string>} result[].hostname - 主机名
   * @returns {Promise<string>} result[].ip_address - IP 地址
   * @returns {Promise<number>} result[].port - 端口号
   * @returns {Promise<string>} result[].status - 节点状态
   * @returns {Promise<string>} [result[].current_task_id] - 当前任务 ID
   * @returns {Promise<number>} result[].max_fluent_threads - 可用于 Fluent 的最大线程数
   * @returns {Promise<number>} result[].reserved_threads - 为系统保留的线程数
   * @returns {Promise<number>} result[].used_fluent_threads - 已占用的 Fluent 线程数
   * @returns {Promise<number>} result[].available_fluent_threads - 当前可用的 Fluent 线程数
   * @returns {Promise<number>} result[].running_fluent_count - 运行中的 Fluent 实例数
   * @returns {Promise<string>} result[].last_heartbeat - 最后心跳时间
   * @returns {Promise<string>} result[].registered_at - 注册时间
   * @returns {Promise<boolean>} result[].is_active - 是否活跃
   */
  getWorkers(params) {
    return request.get('/api/v1/workers/', params)
  },

  /**
   * 获取指定 Worker 节点的详细信息（GET /api/v1/workers/{worker_id}）
   * 响应体通常为 { code, message, data: Worker }；经 request 拦截器后多为 Worker 对象。
   * @param {string} workerId - Worker ID
   * @returns {Promise<Object>} Worker 详细信息（字段与列表项一致）
   * @returns {Promise<string>} result.id - Worker ID
   * @returns {Promise<string>} result.hostname - 主机名
   * @returns {Promise<string>} result.ip_address - IP 地址
   * @returns {Promise<number>} result.port - 端口号
   * @returns {Promise<string>} result.status - 节点状态
   * @returns {Promise<string>} [result.current_task_id] - 当前任务 ID
   * @returns {Promise<number>} result.max_fluent_threads - 可用于 Fluent 的最大线程数
   * @returns {Promise<number>} result.reserved_threads - 为系统保留的线程数
   * @returns {Promise<number>} result.used_fluent_threads - 已占用的 Fluent 线程数
   * @returns {Promise<number>} result.available_fluent_threads - 当前可用的 Fluent 线程数
   * @returns {Promise<number>} result.running_fluent_count - 运行中的 Fluent 实例数
   * @returns {Promise<string>} result.last_heartbeat - 最后心跳时间
   * @returns {Promise<string>} result.registered_at - 注册时间
   * @returns {Promise<boolean>} result.is_active - 是否活跃
   */
  getWorkerInfo(workerId) {
    return request.get(`/api/v1/workers/${workerId}`)
  },

  /**
   * 强制复位指定的 Worker 节点
   * 停止所有仿真任务并清理环境，将节点恢复到初始状态
   * @param {string} workerId - Worker ID
   * @returns {Promise<Object>} 复位操作结果
   * @returns {Promise<boolean>} result.success - 是否成功
   * @returns {Promise<string>} result.message - 结果消息
   * @returns {Promise<string>} result.status - 节点当前状态
   * @returns {Promise<Array>} result.stopped_tasks - 被停止的任务列表
   */
  resetWorker(workerId) {
    return request.post(`/api/v1/workers/${workerId}/reset`)
  },
}

export default workerApi
