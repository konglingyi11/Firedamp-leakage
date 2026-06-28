/**
 * 解析后端返回的关联任务片段，提取可读任务名（去掉 UUID 等括号内容）
 * @param {string} taskPart
 * @returns {string[]}
 */
export function parseAssociatedTaskNames(taskPart) {
  if (!taskPart || typeof taskPart !== 'string') {
    return []
  }

  return taskPart
    .split(/[,，;；]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const name = segment.split(/[(（]/)[0]?.trim()
      return name || segment
    })
    .filter(Boolean)
}

/**
 * 模型是否因被任务占用而无法删除
 * @param {string} [rawMessage]
 * @returns {boolean}
 */
export function isModelReferencedByTask(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return false
  }
  return (
    rawMessage.includes('任务引用') ||
    rawMessage.includes('关联任务') ||
    rawMessage.includes('被任务')
  )
}

/**
 * 将模型删除失败的后端 message 转为更易读的提示
 * @param {string} [rawMessage]
 * @returns {{ message: string, referencedByTask: boolean }}
 */
export function formatModelDeleteError(rawMessage) {
  if (!isModelReferencedByTask(rawMessage)) {
    return {
      message: rawMessage?.trim() || '模型删除失败，请稍后重试',
      referencedByTask: false,
    }
  }

  const taskPart =
    rawMessage.split('关联任务：')[1] ||
    rawMessage.split('关联任务:')[1] ||
    ''
  const taskNames = parseAssociatedTaskNames(taskPart)

  if (taskNames.length === 0) {
    return {
      message:
        '无法删除：该模型正被任务使用。请先在「任务列表」中删除或处理关联任务后再试。',
      referencedByTask: true,
    }
  }

  const displayNames = taskNames.slice(0, 5)
  const quoted = displayNames.map((name) => `「${name}」`).join('、')
  const overflow =
    taskNames.length > displayNames.length
      ? `等共 ${taskNames.length} 个任务`
      : ''

  return {
    message: `无法删除：该模型正被任务 ${quoted}${overflow} 使用。请先在「任务列表」中删除这些任务后再试。`,
    referencedByTask: true,
  }
}
