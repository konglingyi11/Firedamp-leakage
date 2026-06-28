export function clearTaskTimelineState({
  clearTimelineToUEDebounce,
  timelineTimeSteps,
  timelinePhysicalTimes,
  timelineTotalSteps,
  postProcessingTimeStepsTaskId,
  handleTimelineStop,
  hasAppliedSettings,
  isTimelineCollapsed,
}) {
  clearTimelineToUEDebounce?.()
  timelineTimeSteps.value = []
  timelinePhysicalTimes.value = []
  timelineTotalSteps.value = 0
  postProcessingTimeStepsTaskId.value = null

  handleTimelineStop()
  hasAppliedSettings.value = false
  isTimelineCollapsed.value = true
}
