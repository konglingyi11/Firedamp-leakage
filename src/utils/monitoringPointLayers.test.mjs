import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyMonitoringLayerVisibility,
  buildMonitoringPointLayers,
  normalizeMonitoringPoints,
} from './monitoringPointLayers.js'

test('normalizes monitoring points before sharing them across components', () => {
  assert.deepEqual(
    normalizeMonitoringPoints([
      { id: 'p1', name: '入口监测点', x: '12.5', y: null, z: 8 },
    ]),
    [
    { id: 'p1', name: '入口监测点', x: 12.5, y: 0, z: 8, visible: true },
    ],
  )
})

test('builds one generated layer per monitoring point', () => {
  const layers = buildMonitoringPointLayers(
    [
      { id: 'p1', name: '入口监测点', x: 1, y: 2, z: 3 },
      { id: 'p:2', name: '出口监测点', visible: false },
    ],
    'task-1',
  )

  assert.deepEqual(
    layers.map((layer) => ({
      id: layer.id,
      kind: layer.kind,
      label: layer.label,
      visible: layer.visible,
      pointId: layer.pointId,
    })),
    [
      {
        id: 'monitor:task-1:p1',
        kind: 'monitor',
        label: '入口监测点',
        visible: true,
        pointId: 'p1',
      },
      {
        id: 'monitor:task-1:p%3A2',
        kind: 'monitor',
        label: '出口监测点',
        visible: false,
        pointId: 'p:2',
      },
    ],
  )
})

test('applies monitor layer visibility back to the owning point', () => {
  const points = [
    { id: 'p1', name: '入口监测点', visible: true },
    { id: 'p2', name: '出口监测点', visible: true },
  ]

  const next = applyMonitoringLayerVisibility(
    points,
    { id: 'monitor:task-1:p2' },
    false,
  )

  assert.equal(next[0].visible, true)
  assert.equal(next[1].visible, false)
})
