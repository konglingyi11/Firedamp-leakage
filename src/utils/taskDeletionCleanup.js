function sameId(a, b) {
  return String(a ?? '') === String(b ?? '')
}

export function shouldClearCurrentTask(currentTask, deletedTaskId) {
  return Boolean(currentTask?.id != null && sameId(currentTask.id, deletedTaskId))
}

export function layerBelongsToTask(layer, deletedTaskId) {
  if (!layer || deletedTaskId == null || deletedTaskId === '') return false
  if (
    sameId(layer.task_id, deletedTaskId) ||
    sameId(layer.taskId, deletedTaskId) ||
    sameId(layer.task?.id, deletedTaskId)
  ) {
    return true
  }

  const parts = String(layer.id ?? '').split(':')
  return parts.length >= 2 && sameId(parts[1], deletedTaskId)
}

export function cleanupDeletedTaskLayers(layers, deletedTaskId) {
  const list = Array.isArray(layers) ? layers : []
  const remainingLayers = list.filter((layer) => !layerBelongsToTask(layer, deletedTaskId))
  return {
    remainingLayers,
    removedCount: list.length - remainingLayers.length,
  }
}
