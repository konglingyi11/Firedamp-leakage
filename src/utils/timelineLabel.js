export function formatTimelineValue(stepIndex, physicalTimes) {
  if (Array.isArray(physicalTimes) && physicalTimes.length > stepIndex) {
    const time = Number(physicalTimes[stepIndex])
    if (Number.isFinite(time)) {
      return `${time.toFixed(4)} s`
    }
  }
  return `Step ${Number(stepIndex) + 1}`
}

export function formatTimelineRange(currentStepIndex, totalStepIndex, physicalTimes) {
  if (Number(totalStepIndex) < 0) return '0 / 0'
  return `${formatTimelineValue(currentStepIndex, physicalTimes)} / ${formatTimelineValue(totalStepIndex, physicalTimes)}`
}
