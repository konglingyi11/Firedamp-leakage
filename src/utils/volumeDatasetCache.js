export const FULL_VOLUME_DATASET_PAYLOAD_KEY = '__full_volume_dataset_payload__'

export function buildVolumeDatasetTaskCacheKey(taskId) {
  return `volume-dataset:${taskId}`
}

export function getFullVolumeDatasetCacheKeys(taskId) {
  return [FULL_VOLUME_DATASET_PAYLOAD_KEY, buildVolumeDatasetTaskCacheKey(taskId)]
}

/** 与自动体渲染 / 应用设置共用的完整 datasets 缓存结构 */
export function buildFullVolumeDatasetCachePayload(chunkData, options = {}) {
  const {
    taskId,
    timeSteps = [],
    variables = [],
    usePregen = true,
    loadSource = 'auto',
  } = options
  return {
    ...(chunkData || {}),
    task_id: taskId,
    time_step: timeSteps,
    variables,
    volume_dataset_all_variables: true,
    use_pregen: usePregen,
    loadSource,
  }
}

export function hasVolumeDatasetLocator(payload) {
  if (!payload || typeof payload !== 'object') return false
  return (
    (Array.isArray(payload.datasets) && payload.datasets.length > 0) ||
    (Array.isArray(payload.volume_dataset_frames) &&
      payload.volume_dataset_frames.length > 0)
  )
}
