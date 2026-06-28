import assert from 'node:assert/strict'
import {
  clampMonitoringPointToBounds,
  normalizeMonitoringPointBounds,
  scenePointMetersToMonitoringPoint,
} from './monitoringPointDrag.js'

assert.deepEqual(
  scenePointMetersToMonitoringPoint(
    { id: 'p1', name: '入口监测点', z: 150 },
    { x: 1.25, y: -0.5, z: 0.9 },
  ),
  { id: 'p1', name: '入口监测点', x: 125, y: -50, z: 90 },
  'dragging converts scene meters back to monitoring-point centimeters on all three axes',
)

assert.deepEqual(
  scenePointMetersToMonitoringPoint(
    { id: 'p1', name: '入口监测点' },
    { x: -1, y: 2.5, z: 3 },
    { min: [0, 0, 10], max: [200, 200, 250] },
  ),
  { id: 'p1', name: '入口监测点', x: 0, y: 200, z: 250 },
  'dragging clamps the monitoring point inside centimeter model bounds',
)

assert.deepEqual(
  normalizeMonitoringPointBounds({
    xmin: 200,
    xmax: 0,
    ymin: -50,
    ymax: 50,
    zmin: 10,
    zmax: 30,
  }),
  { min: [0, -50, 10], max: [200, 50, 30] },
  'API-style geometry bounds are normalized and reversed axes are repaired',
)

assert.deepEqual(
  clampMonitoringPointToBounds(
    { id: 'p3', name: '表单点', x: -20, y: 250, z: 15 },
    { xmin: 0, xmax: 200, ymin: 0, ymax: 180, zmin: 20, zmax: 60 },
  ),
  { id: 'p3', name: '表单点', x: 0, y: 180, z: 20 },
  'form-submitted monitoring points are clamped inside API-style geometry bounds',
)

assert.deepEqual(
  scenePointMetersToMonitoringPoint(
    { id: 'p2', name: '无效高度', z: 'bad' },
    { x: 'bad', y: 0.25, z: 2 },
  ),
  { id: 'p2', name: '无效高度', x: 0, y: 25, z: 200 },
  'non-finite drag coordinates fall back to zero instead of leaking NaN into point state',
)
