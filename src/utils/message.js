import { ElMessage } from 'element-plus'

/**
 * 自定义消息提示工具
 * 配置为同时最多显示 1 条消息，避免堆叠
 */

// 配置选项
const messageConfig = {
  duration: 3000, // 默认显示 3 秒
  grouping: true, // 合并相同内容的消息
  max: 1, // 同时最多显示 1 条消息
}

/**
 * 成功消息
 * @param {string|Object} options - 消息内容或配置对象
 */
export const success = (options) => {
  const config = typeof options === 'string' ? { message: options } : options
  return ElMessage.success({
    ...messageConfig,
    ...config,
  })
}

/**
 * 警告消息
 * @param {string|Object} options - 消息内容或配置对象
 */
export const warning = (options) => {
  const config = typeof options === 'string' ? { message: options } : options
  return ElMessage.warning({
    ...messageConfig,
    ...config,
  })
}

/**
 * 错误消息
 * @param {string|Object} options - 消息内容或配置对象
 */
export const error = (options) => {
  const config = typeof options === 'string' ? { message: options } : options
  return ElMessage.error({
    ...messageConfig,
    ...config,
  })
}

/**
 * 信息消息
 * @param {string|Object} options - 消息内容或配置对象
 */
export const info = (options) => {
  const config = typeof options === 'string' ? { message: options } : options
  return ElMessage.info({
    ...messageConfig,
    ...config,
  })
}

/**
 * 通用消息
 * @param {string|Object} options - 消息内容或配置对象
 */
export const message = (options) => {
  const config = typeof options === 'string' ? { message: options } : options
  return ElMessage({
    ...messageConfig,
    ...config,
  })
}

// 导出默认对象，方便使用
export default {
  success,
  warning,
  error,
  info,
  message,
}
