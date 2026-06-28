import assert from 'node:assert/strict'
import {
  formatModelDeleteError,
  isModelReferencedByTask,
  parseAssociatedTaskNames,
} from './modelDeleteError.js'

assert.deepEqual(
  parseAssociatedTaskNames('任务521-72(c250efe2-7258-4145..., 任务522-01(uuid)'),
  ['任务521-72', '任务522-01'],
)

assert.equal(
  isModelReferencedByTask('模型已被任务引用，无法删除。关联任务：任务521-72(...)'),
  true,
)

{
  const { message, referencedByTask } = formatModelDeleteError(
    '模型已被任务引用，无法删除。关联任务：任务521-72(c250efe2-7258-4145...',
  )
  assert.equal(referencedByTask, true)
  assert.match(message, /任务521-72/)
  assert.match(message, /任务列表/)
}

{
  const { message, referencedByTask } = formatModelDeleteError('权限不足')
  assert.equal(referencedByTask, false)
  assert.equal(message, '权限不足')
}
