export function collectVolumeDatasetPreloadFrames(payload) {
  if (!payload || typeof payload !== 'object') return []

  const variable = String(payload.variable || '').trim()
  const manifestData = payload.manifest_content || null

  if (
    Array.isArray(payload.volume_dataset_frames) &&
    payload.volume_dataset_frames.length > 0
  ) {
    return payload.volume_dataset_frames
      .map((frame, index) => {
        const manifestUrl = String(frame?.manifest_url || '').trim()
        const binUrl = String(frame?.bin_url || '').trim()
        if (!manifestUrl || !binUrl) return null
        const parsedTimeStep = Number(frame?.time_step)
        return {
          frameIndex: index,
          timeStep: Number.isFinite(parsedTimeStep) ? parsedTimeStep : null,
          variable: String(frame?.variable || variable).trim(),
          manifestUrl,
          binUrl,
          manifestData,
        }
      })
      .filter(Boolean)
  }

  const manifestUrl = String(payload.manifest_url || '').trim()
  const binUrl = String(payload.bin_url || '').trim()
  if (!manifestUrl || !binUrl) return []

  const parsedTimeStep = Number(payload.source_time_step ?? payload.time_step)
  return [
    {
      frameIndex: 0,
      timeStep: Number.isFinite(parsedTimeStep) ? parsedTimeStep : null,
      variable,
      manifestUrl,
      binUrl,
      manifestData,
    },
  ]
}

function resolveCurrentFrameIndex(frames, options) {
  const byIndex = Number(options?.currentFrameIndex)
  if (
    Number.isInteger(byIndex) &&
    byIndex >= 0 &&
    byIndex < frames.length
  ) {
    return byIndex
  }

  const targetTimeStep = Number(options?.currentTimeStep)
  if (Number.isFinite(targetTimeStep)) {
    const matchedIndex = frames.findIndex(
      (frame) => Number(frame?.timeStep) === targetTimeStep,
    )
    if (matchedIndex >= 0) return matchedIndex
  }

  return 0
}

function pushUniqueFrame(result, used, frames, index, maxFrames) {
  if (result.length >= maxFrames) return
  if (!Number.isInteger(index) || index < 0 || index >= frames.length) return
  const frame = frames[index]
  const key = `${frame.manifestUrl}::${frame.binUrl}::${frame.frameIndex}`
  if (used.has(key)) return
  used.add(key)
  result.push(frame)
}

export function buildVolumeDatasetPreloadPlan(payload, options = {}) {
  const frames = collectVolumeDatasetPreloadFrames(payload)
  if (!frames.length) {
    return { immediateFrames: [], backgroundFrames: [] }
  }

  const maxFrames = Math.max(
    1,
    Math.min(frames.length, Math.floor(Number(options.maxFrames) || 32)),
  )
  const windowRadius = Math.max(
    0,
    Math.floor(Number(options.windowRadius) || 6),
  )
  const currentIndex = resolveCurrentFrameIndex(frames, options)
  const used = new Set()
  const immediateFrames = []

  pushUniqueFrame(immediateFrames, used, frames, currentIndex, maxFrames)
  for (let offset = 1; offset <= windowRadius; offset += 1) {
    pushUniqueFrame(immediateFrames, used, frames, currentIndex - offset, maxFrames)
    pushUniqueFrame(immediateFrames, used, frames, currentIndex + offset, maxFrames)
  }

  const backgroundFrames = []
  const remainingBudget = maxFrames - immediateFrames.length
  if (remainingBudget <= 0) {
    return { immediateFrames, backgroundFrames }
  }

  for (
    let index = currentIndex + windowRadius + 1;
    index < frames.length && backgroundFrames.length < remainingBudget;
    index += 1
  ) {
    pushUniqueFrame(
      backgroundFrames,
      used,
      frames,
      index,
      remainingBudget,
    )
  }

  for (
    let index = currentIndex - windowRadius - 1;
    index >= 0 && backgroundFrames.length < remainingBudget;
    index -= 1
  ) {
    pushUniqueFrame(
      backgroundFrames,
      used,
      frames,
      index,
      remainingBudget,
    )
  }

  return { immediateFrames, backgroundFrames }
}

export function shouldContinueVolumeFrameRequest(requestToken, getLatestToken) {
  return Number(requestToken) === Number(getLatestToken?.())
}
