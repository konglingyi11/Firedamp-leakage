import assert from 'node:assert/strict'
import {
  computePlaneLayerCameraFocus,
  parseGeneratedLayerPlane,
} from './planeCameraFocus.js'

const sampleBounds = {
  xmin: -310,
  xmax: 310,
  ymin: -310,
  ymax: 310,
  zmin: 0,
  zmax: 620,
}

{
  const layer = {
    id: 'cloud:task1:xy:150:mass_fraction_of_nh3',
    kind: 'cloud',
  }
  const focus = computePlaneLayerCameraFocus({
    layer,
    geometryBounds: sampleBounds,
    distanceScale: 2,
    minDistance: 1,
  })
  assert.ok(focus)
  assert.equal(focus.plane, 'xy')
  assert.deepEqual(
    focus.target.map((value) => Number(value.toFixed(3))),
    [0, 0, 1.5],
  )
  assert.equal(
    Number((focus.position[2] - focus.target[2]).toFixed(3)),
    Number((Math.max(1, (620 / 100) * 2)).toFixed(3)),
    'xy plane camera sits on +Z looking toward the slice',
  )
}

{
  const layer = {
    id: 'vector:task1:xz:200:VelocityMagnitude',
    kind: 'vector',
  }
  const focus = computePlaneLayerCameraFocus({
    layer,
    geometryBounds: sampleBounds,
  })
  assert.ok(focus)
  assert.equal(focus.plane, 'xz')
  assert.deepEqual(
    focus.target.map((value) => Number(value.toFixed(3))),
    [0, 2, 0],
  )
  assert.ok(focus.position[1] > focus.target[1], 'xz plane camera sits on +Y')
}

{
  assert.equal(
    parseGeneratedLayerPlane({ id: 'volume:task1:xy:0:foo', kind: 'volume' }),
    null,
  )
}
