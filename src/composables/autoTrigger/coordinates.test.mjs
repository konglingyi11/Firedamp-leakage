import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAutoPlaneCoords,
  clampAutoPlaneOffset,
  isInsideOpenPlaneInterval,
} from './coordinates.js'

test('auto plane coordinates start at a + spacing and truncate toward zero', () => {
  assert.deepEqual(buildAutoPlaneCoords(-634.1, -614.1, 10), [-624])
  assert.deepEqual(buildAutoPlaneCoords(10.5, 30.5, 10), [20])
})

test('auto plane coordinates exclude boundary values in open interval', () => {
  assert.deepEqual(
    buildAutoPlaneCoords(0, 300, 10),
    Array.from({ length: 29 }, (_, index) => (index + 1) * 10),
  )
  assert.deepEqual(
    buildAutoPlaneCoords(0, 300.0000001, 10),
    Array.from({ length: 29 }, (_, index) => (index + 1) * 10),
  )
  assert.equal(isInsideOpenPlaneInterval(300, 0, 300), false)
  assert.equal(isInsideOpenPlaneInterval(0, 0, 300), false)
  assert.equal(isInsideOpenPlaneInterval(150, 0, 300), true)
})

test('auto plane coordinates do not add a trailing plane when remaining range is below spacing', () => {
  assert.deepEqual(buildAutoPlaneCoords(0, 25, 10), [10, 20])
  assert.deepEqual(buildAutoPlaneCoords(0, 9, 10), [])
})

test('auto plane offset clamp keeps coordinates inside open interval', () => {
  assert.equal(clampAutoPlaneOffset(-634.1, -634.1, 20), -634)
  assert.equal(clampAutoPlaneOffset(10.5, -20, 10.5), 10)
  assert.equal(clampAutoPlaneOffset(300, 0, 300), 299)
  assert.equal(clampAutoPlaneOffset(0, 0, 300), 1)
})
