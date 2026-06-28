import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRadarStreamlineMock,
  buildRadarStreamlineMockPayload,
  clampPointToRadarBounds,
  DEFAULT_RADAR_STREAMLINE_BOUNDS,
  normalizeRadarEmitter,
  resolveRadarStreamlineBounds,
} from './mockRadarStreamline.js'

function pointInBounds(point, bounds) {
  return (
    point[0] >= bounds.xmin &&
    point[0] <= bounds.xmax &&
    point[1] >= bounds.ymin &&
    point[1] <= bounds.ymax &&
    point[2] >= bounds.zmin &&
    point[2] <= bounds.zmax
  )
}

test('normalizeRadarEmitter defaults to origin', () => {
  assert.deepEqual(normalizeRadarEmitter(null), { x: 0, y: 0, z: 0 })
  assert.deepEqual(normalizeRadarEmitter({ x: 12, y: -3.5, z: 8 }), {
    x: 12,
    y: -3.5,
    z: 8,
  })
})

test('resolveRadarStreamlineBounds falls back to default cube', () => {
  assert.deepEqual(resolveRadarStreamlineBounds(null), DEFAULT_RADAR_STREAMLINE_BOUNDS)
})

test('buildRadarStreamlineMock keeps all points inside bounds and starts at emitter', () => {
  const emitter = { x: -3200, y: 120, z: 450 }
  const bounds = { xmin: -4000, xmax: 4000, ymin: -2000, ymax: 2000, zmin: -1500, zmax: 1500 }
  const mock = buildRadarStreamlineMock({
    emitter,
    bounds,
    seedCount: 12,
    pointsPerStreamline: 24,
  })

  assert.equal(mock.streamlines.length, 12)
  for (const line of mock.streamlines) {
    assert.ok(line.length >= 2)
    assert.deepEqual(line[0], [emitter.x, emitter.y, emitter.z])
    for (const point of line) {
      assert.ok(pointInBounds(point, bounds))
    }
  }
})

test('changing emitter moves streamline seeds', () => {
  const bounds = { xmin: -1000, xmax: 1000, ymin: -1000, ymax: 1000, zmin: -1000, zmax: 1000 }
  const a = buildRadarStreamlineMock({ emitter: { x: -800, y: 0, z: 0 }, bounds, seedCount: 4 })
  const b = buildRadarStreamlineMock({ emitter: { x: 800, y: 0, z: 0 }, bounds, seedCount: 4 })
  assert.notDeepEqual(a.streamlines[0][0], b.streamlines[0][0])
})

test('buildRadarStreamlineMockPayload exposes inline streamlines', () => {
  const payload = buildRadarStreamlineMockPayload({
    taskId: 'task-1',
    emitter: { x: 0, y: 0, z: 0 },
  })
  assert.equal(payload.task_id, 'task-1')
  assert.ok(Array.isArray(payload.streamlines))
  assert.ok(payload.streamlines.length > 0)
})

test('clampPointToRadarBounds clamps out-of-range emitter', () => {
  const clamped = clampPointToRadarBounds(
    { x: 99999, y: -99999, z: 0 },
    DEFAULT_RADAR_STREAMLINE_BOUNDS,
  )
  assert.equal(clamped.x, DEFAULT_RADAR_STREAMLINE_BOUNDS.xmax)
  assert.equal(clamped.y, DEFAULT_RADAR_STREAMLINE_BOUNDS.ymin)
})
