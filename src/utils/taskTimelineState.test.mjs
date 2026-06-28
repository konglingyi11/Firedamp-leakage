import test from 'node:test'
import assert from 'node:assert/strict'

import { clearTaskTimelineState } from './taskTimelineState.js'

const refOf = (value) => ({ value })

test('clearTaskTimelineState removes stale timeline visibility state', () => {
  let debounceCleared = false
  let stopped = false
  const state = {
    clearTimelineToUEDebounce: () => {
      debounceCleared = true
    },
    timelineTimeSteps: refOf([0, 1, 2]),
    timelinePhysicalTimes: refOf([0, 0.5, 1]),
    timelineTotalSteps: refOf(2),
    postProcessingTimeStepsTaskId: refOf('task-58'),
    handleTimelineStop: () => {
      stopped = true
    },
    hasAppliedSettings: refOf(true),
    isTimelineCollapsed: refOf(false),
  }

  clearTaskTimelineState(state)

  assert.equal(debounceCleared, true)
  assert.equal(stopped, true)
  assert.deepEqual(state.timelineTimeSteps.value, [])
  assert.deepEqual(state.timelinePhysicalTimes.value, [])
  assert.equal(state.timelineTotalSteps.value, 0)
  assert.equal(state.postProcessingTimeStepsTaskId.value, null)
  assert.equal(state.hasAppliedSettings.value, false)
  assert.equal(state.isTimelineCollapsed.value, true)
})
