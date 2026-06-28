import assert from 'node:assert/strict'
import {
  normalizeParticleSettings,
  resolveParticleAdvectedVelocity,
  resolveParticleFieldGridFromSource,
  resolveParticleInitialVelocity,
  resolveParticleSpawnPosition,
} from './particleFlowCore.js'

{
  const grid = resolveParticleFieldGridFromSource({
    dimensions: [160, 160, 160],
    origin: [-250, -250, 0],
    spacing: [3.1446540880503147, 3.1446540880503147, 3.1446540880503147],
  })

  assert.deepEqual(grid.dims, [160, 160, 160])
  assert.deepEqual(grid.origin, [-2.5, -2.5, 0])
  assert.deepEqual(
    grid.spacing.map((value) => Number(value.toFixed(12))),
    [0.031446540881, 0.031446540881, 0.031446540881],
    'converts Fluent/test-bin cm grid coordinates to Three.js scene meters',
  )
}

{
  const field = {
    bounds: {
      min: [-2.5, -2.5, 0],
      max: [2.5, 2.5, 5],
    },
  }
  const position = resolveParticleSpawnPosition(
    { emitter: [0, 0, 0], useFieldSpawn: true },
    field,
    () => 0.5,
  )

  assert.deepEqual(
    position,
    [0, 0, 2.5],
    'auto particle seeding uses the full velocity-field bounds instead of a tiny emitter disk',
  )
}

{
  const field = {
    bounds: {
      min: [-2.5, -2.5, 0],
      max: [2.5, 2.5, 5],
    },
  }
  const randomValues = [0, 1, 0]
  const position = resolveParticleSpawnPosition(
    { emitter: [1, 2, 3], useFieldSpawn: false },
    field,
    () => randomValues.shift() ?? 0,
  )

  assert.deepEqual(
    position,
    [1.002, 2, 2.999],
    'manual emitter settings still spawn from the configured emitter point (tiny jitter)',
  )
}

{
  const settings = normalizeParticleSettings({
    initialVx: 0.4,
    initialVy: -0.2,
    initialVz: 0.1,
    fieldInfluence: 0.25,
  })

  assert.deepEqual(
    settings.initialVelocity,
    [0.4, -0.2, 0.1],
    'particle settings keep the configured launch velocity',
  )
  assert.equal(settings.inertia, 0.75)
  assert.equal(settings.fieldInfluence, 0.25)
}

{
  const initial = resolveParticleInitialVelocity(
    { vx: 0.1, vy: 0, vz: 0 },
    { initialVelocity: [0.4, -0.2, 0.1] },
  )

  assert.deepEqual(
    initial,
    { vx: 0.4, vy: -0.2, vz: 0.1 },
    'configured launch velocity overrides the sampled velocity at birth',
  )
}

{
  const velocity = resolveParticleAdvectedVelocity(
    { vx: 1, vy: 0, vz: 0 },
    { vx: 0.4, vy: -0.2, vz: 0.1 },
    { inertia: 0.75, fieldInfluence: 0.25 },
  )

  assert.deepEqual(
    velocity,
    { vx: 0.55, vy: -0.15000000000000002, vz: 0.07500000000000001 },
    'particle velocity eases from launch momentum toward the sampled velocity field',
  )
}
