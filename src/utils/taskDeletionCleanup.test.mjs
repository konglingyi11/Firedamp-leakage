import assert from 'node:assert/strict'
import {
  cleanupDeletedTaskLayers,
  layerBelongsToTask,
  shouldClearCurrentTask,
} from './taskDeletionCleanup.js'

assert.equal(layerBelongsToTask({ id: 'cloud:task-1:xy:0:temperature' }, 'task-1'), true)
assert.equal(layerBelongsToTask({ id: 'model:task-1' }, 'task-1'), true)
assert.equal(layerBelongsToTask({ task_id: 42 }, '42'), true)
assert.equal(layerBelongsToTask({ id: 'cloud:task-2:xy:0:temperature' }, 'task-1'), false)

assert.equal(shouldClearCurrentTask({ id: 42 }, '42'), true)
assert.equal(shouldClearCurrentTask({ id: 43 }, '42'), false)
assert.equal(shouldClearCurrentTask(null, '42'), false)

{
  const layers = [
    { id: 'cloud:task-1:xy:0:temperature' },
    { id: 'volume:task-2:pressure' },
    { id: 'bounds:task-1' },
  ]
  const cleaned = cleanupDeletedTaskLayers(layers, 'task-1')

  assert.deepEqual(cleaned.remainingLayers, [{ id: 'volume:task-2:pressure' }])
  assert.equal(cleaned.removedCount, 2)
}
