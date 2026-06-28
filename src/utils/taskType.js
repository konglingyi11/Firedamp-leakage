/**
 * 任务类型判断工具
 */

/** 判断是否为会议室任务 */
export function isMeetingRoomTask(task) {
  return String(task?.name || '').trim() === '会议室'
}

/** 判断是否为采空区（瓦斯泄漏演示）任务：任务名包含“采空区” */
export function isGoafTask(task) {
  return String(task?.name || '').includes('采空区')
}

/** 判断当前任务是否需要禁用人物模型 */
export function isPersonModelDisabled(task) {
  return isGoafTask(task)
}
