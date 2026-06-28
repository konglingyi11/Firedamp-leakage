import assert from 'node:assert/strict'
import { computeMonitoringCameraFocus } from './monitoringCamera.js'

{
  const focus = computeMonitoringCameraFocus({
    cameraPosition: [10, 0, 0],
    controlsTarget: [0, 0, 0],
    point: [1, 2, 3],
  })

  assert.deepEqual(focus.target, [1, 2, 3])
  assert.deepEqual(
    focus.position.map((value) => Number(value.toFixed(6))),
    [11, 2, 3],
    'keeps the current view offset while retargeting to the monitoring point',
  )
}

{
  const focus = computeMonitoringCameraFocus({
    cameraPosition: [0, 0, 0],
    controlsTarget: [0, 0, 0],
    point: [1, 2, 3],
    fallbackDistance: 8,
  })

  assert.deepEqual(focus.target, [1, 2, 3])
  assert.equal(
    Number(
      Math.hypot(
        focus.position[0] - focus.target[0],
        focus.position[1] - focus.target[1],
        focus.position[2] - focus.target[2],
      ).toFixed(6),
    ),
    8,
    'uses a stable fallback distance when the current camera offset is invalid',
  )
}
