import { request } from '@/utils/request'

/**
 * 健康检查 API
 * 提供系统健康状态监控功能
 */
export const healthApi = {
  /**
   * 获取服务健康状态
   * 用于监控系统整体运行状况
   * @returns {Promise<Object>} 健康状态信息
   * @returns {Promise<string>} result.status - 健康状态: 'healthy' | 'degraded' | 'unhealthy'
   * @returns {Promise<string>} result.version - 服务版本号
   * @returns {Promise<number>} result.uptime - 运行时间（秒）
   * @returns {Promise<Object>} result.services - 各服务状态
   * @returns {Promise<string>} result.services.database - 数据库状态
   * @returns {Promise<string>} result.services.fluent - Fluent 服务状态
   * @returns {Promise<string>} result.services.storage - 存储服务状态
   * @returns {Promise<Object>} result.statistics - 统计信息
   * @returns {Promise<number>} result.statistics.total_workers - Worker 总数
   * @returns {Promise<number>} result.statistics.active_workers - 活跃 Worker 数
   * @returns {Promise<number>} result.statistics.total_tasks - 任务总数
   * @returns {Promise<number>} result.statistics.running_tasks - 运行中任务数
   * @returns {Promise<string>} result.timestamp - 时间戳
   */
  getHealthStatus() {
    return request.get('/api/v1/health/')
  },
}

export default healthApi
