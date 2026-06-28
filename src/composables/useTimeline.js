import { ref, inject } from 'vue'
import { resolveAnimationSpeedMultiplier } from '@/utils/sanitize'
import { VIZ_STATE_KEY } from './useVisualizationState'

/**
 * 时间轴播放控制：纯状态 + play/pause/stop/seek
 */
export function useTimeline(vizStateArg) {
  const vizState =
    vizStateArg ??
    inject(VIZ_STATE_KEY) ?? {
      visualization: ref({ animationSpeed: 24 }),
      timelineCurrentStep: ref(0),
      timelineTotalSteps: ref(0),
      timelinePhysicalTimes: ref([]),
      timelineTimeSteps: ref([]),
      isTimelineCollapsed: ref(true),
      hasAppliedSettings: ref(false),
      isTimelinePlaying: ref(false),
    }
  
  const {
    visualization,
    timelineCurrentStep,
    timelineTotalSteps,
    timelinePhysicalTimes,
    timelineTimeSteps,
    isTimelineCollapsed,
    hasAppliedSettings,
    isTimelinePlaying,
  } = vizState

  let timelineInterval = null

  const handleTimelinePlay = () => {
    if (timelineTotalSteps.value <= 0) {
      return
    }
    if (timelineCurrentStep.value >= timelineTotalSteps.value) {
      timelineCurrentStep.value = 0
    }
    isTimelinePlaying.value = true

    if (!timelineInterval) {
      timelineInterval = setInterval(
        () => {
          if (timelineCurrentStep.value < timelineTotalSteps.value) {
            timelineCurrentStep.value++
            if (timelineCurrentStep.value >= timelineTotalSteps.value) {
              handleTimelinePause()
            }
          } else {
            handleTimelinePause()
          }
        },
        1000 /
          Math.max(
            resolveAnimationSpeedMultiplier(visualization.value.animationSpeed),
            0.1,
          ),
      )
    }
  }

  const handleTimelinePause = () => {
    isTimelinePlaying.value = false
    if (timelineInterval) {
      clearInterval(timelineInterval)
      timelineInterval = null
    }
  }

  const handleTimelineStop = () => {
    isTimelinePlaying.value = false
    timelineCurrentStep.value = 0
    if (timelineInterval) {
      clearInterval(timelineInterval)
      timelineInterval = null
    }
  }

  const handleTimelineSeek = (step) => {
    timelineCurrentStep.value = step
  }

  const handleTimelineToggle = (hasApplied) => {
    if (!(hasApplied ?? hasAppliedSettings.value)) return
    isTimelineCollapsed.value = !isTimelineCollapsed.value
  }

  return {
    timelineCurrentStep,
    timelineTotalSteps,
    timelinePhysicalTimes,
    timelineTimeSteps,
    isTimelinePlaying,
    isTimelineCollapsed,
    hasAppliedSettings,
    handleTimelinePlay,
    handleTimelinePause,
    handleTimelineStop,
    handleTimelineSeek,
    handleTimelineToggle,
  }
}
