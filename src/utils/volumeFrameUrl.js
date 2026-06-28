export function resolveEffectiveVolumeUrl(resolvedFrameUrl, payload) {
  const explicitUrl =
    typeof resolvedFrameUrl === 'string' ? resolvedFrameUrl.trim() : ''
  if (explicitUrl) return explicitUrl

  const volumeUrls = Array.isArray(payload?.volume_urls)
    ? payload.volume_urls
    : []
  const firstUrl =
    typeof volumeUrls[0] === 'string' ? volumeUrls[0].trim() : ''
  return firstUrl
}

export function resolveVolumeFrameIndexFromPayload(
  payload,
  { currentTimeStep, currentStepIndex, forceFirstFrame = false } = {},
) {
  if (forceFirstFrame) return 0

  const frames = Array.isArray(payload?.volume_dataset_frames)
    ? payload.volume_dataset_frames
    : []
  const frameIndexByTimeStep = frames.findIndex(
    (frame) => Number(frame?.time_step) === Number(currentTimeStep),
  )
  if (frameIndexByTimeStep >= 0) return frameIndexByTimeStep

  const indexByTimeStep = Array.isArray(payload?.time_step)
    ? payload.time_step.findIndex(
        (item) => Number(item) === Number(currentTimeStep),
      )
    : -1
  if (indexByTimeStep >= 0) return indexByTimeStep

  const stepIndex = Number(currentStepIndex)
  if (Number.isFinite(stepIndex) && stepIndex >= 0) return stepIndex
  return 0
}

export function resolveVolumeDatasetFrame(payload, currentTimeStep) {
  const frames = Array.isArray(payload?.volume_dataset_frames)
    ? payload.volume_dataset_frames
    : []
  if (!frames.length) return null
  const matched = frames.find(
    (frame) => Number(frame?.time_step) === Number(currentTimeStep),
  )
  return matched || frames[0]
}
