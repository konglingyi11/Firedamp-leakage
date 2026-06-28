import assert from 'node:assert/strict'
import {
  DEFAULT_COLOR_MAP_PAGE_SIZE,
  getColorMapPageItems,
  getColorMapTotal,
} from './colorMapPagination.js'

assert.equal(DEFAULT_COLOR_MAP_PAGE_SIZE, 10)

{
  const items = Array.from({ length: 15 }, (_, index) => ({ id: index + 1 }))
  assert.equal(getColorMapPageItems(items).length, 10)
  assert.equal(getColorMapPageItems(items)[9].id, 10)
  assert.deepEqual(
    getColorMapPageItems(items, 2).map((item) => item.id),
    [11, 12, 13, 14, 15],
  )
}

assert.deepEqual(getColorMapPageItems(null), [])
assert.equal(getColorMapTotal({ total: 15 }, 10), 15)
assert.equal(getColorMapTotal({ data: { total: 12 } }, 10), 12)
assert.equal(getColorMapTotal({}, 7), 7)
