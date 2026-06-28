import test from 'node:test'
import assert from 'node:assert/strict'

import { useVisualizationState } from './useVisualizationState.js'

test('streamline defaults use a red color', () => {
  const { visualization } = useVisualizationState()

  assert.equal(visualization.value.streamline.color, '#ff3b30')
})
