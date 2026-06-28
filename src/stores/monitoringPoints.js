import { defineStore } from 'pinia'
import { ref } from 'vue'
import { normalizeMonitoringPoints } from '@/utils/monitoringPointLayers'

const DEFAULT_TASK_KEY = 'default'

function resolveTaskKey(taskId) {
  return taskId != null && String(taskId).trim() !== ''
    ? String(taskId).trim()
    : DEFAULT_TASK_KEY
}

export const useMonitoringPointStore = defineStore('monitoringPoints', () => {
  const pointsByTask = ref({})

  function getPoints(taskId) {
    return normalizeMonitoringPoints(pointsByTask.value[resolveTaskKey(taskId)])
  }

  function setPoints(taskId, points) {
    pointsByTask.value = {
      ...pointsByTask.value,
      [resolveTaskKey(taskId)]: normalizeMonitoringPoints(points),
    }
  }

  function clearPoints(taskId) {
    const key = resolveTaskKey(taskId)
    const next = { ...pointsByTask.value }
    delete next[key]
    pointsByTask.value = next
  }

  return {
    pointsByTask,
    getPoints,
    setPoints,
    clearPoints,
  }
})
