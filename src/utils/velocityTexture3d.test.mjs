import assert from 'node:assert/strict'
import {
  advanceVelocityParticle,
  buildVelocityArrowSamples,
  buildVelocityTexture3dData,
  sampleVelocityVectorAtNormalizedPosition,
  summarizeVelocityTexture3dData,
} from './velocityTexture3d.js'

{
  const textureData = buildVelocityTexture3dData({
    vx: new Float32Array([1, 2]),
    vy: new Float32Array([3, 4]),
    vz: new Float32Array([5, 6]),
    density: new Float32Array([0.25, 0.75]),
    voxelCount: 2,
  })

  assert.deepEqual(
    Array.from(textureData),
    [1, 3, 5, 0.25, 2, 4, 6, 0.75],
    'interleaves velocity xyz and density into RGBA voxel order',
  )
}

{
  const textureData = buildVelocityTexture3dData({
    vx: new Float32Array([0, -2]),
    vy: new Float32Array([0, 0]),
    vz: new Float32Array([0, 2]),
    voxelCount: 2,
  })

  assert.deepEqual(
    Array.from(textureData),
    [0, 0, 0, 1, -2, 0, 2, 1],
    'uses opaque density when no scalar field is provided',
  )
}

{
  const stats = summarizeVelocityTexture3dData(
    new Float32Array([0, 0, 0, 1, 3, 4, 0, 0.5]),
  )

  assert.equal(stats.voxelCount, 2)
  assert.equal(stats.maxSpeed, 5)
  assert.equal(stats.nonZeroVelocityCount, 1)
  assert.equal(stats.maxDensity, 1)
}

{
  const result = buildVelocityArrowSamples({
    dims: [2, 1, 1],
    vx: new Float32Array([1, 0]),
    vy: new Float32Array([0, 2]),
    vz: new Float32Array([0, 0]),
    stride: 1,
  })

  assert.equal(result.samples.length, 2)
  assert.deepEqual(result.samples[0], {
    index: 0,
    ix: 0,
    iy: 0,
    iz: 0,
    position: [-0.25, 0, 0],
    vector: [1, 0, 0],
    speed: 1,
  })
  assert.deepEqual(result.samples[1], {
    index: 1,
    ix: 1,
    iy: 0,
    iz: 0,
    position: [0.25, 0, 0],
    vector: [0, 2, 0],
    speed: 2,
  })
  assert.equal(result.maxSpeed, 2)
}

{
  const result = buildVelocityArrowSamples({
    dims: [1, 1, 1],
    vx: new Float32Array([3]),
    vy: new Float32Array([4]),
    vz: new Float32Array([12]),
    stride: 1,
  })

  assert.equal(result.samples.length, 1)
  assert.deepEqual(result.samples[0].vector, [3, 4, 12])
  assert.equal(result.samples[0].speed, 13)
  assert.equal(result.nonZeroVelocityCount, 1)
  assert.equal(result.cellCount, 1)
}

{
  const result = buildVelocityArrowSamples({
    dims: [1, 1, 1],
    vx: new Float32Array([0]),
    vy: new Float32Array([0]),
    vz: new Float32Array([0]),
    stride: 1,
  })

  assert.equal(result.samples.length, 1, 'keeps one arrow sample for each velocity cell')
  assert.deepEqual(result.samples[0].vector, [0, 0, 0])
  assert.equal(result.samples[0].speed, 0)
  assert.equal(result.nonZeroVelocityCount, 0)
  assert.equal(result.cellCount, 1)
}

{
  const result = buildVelocityArrowSamples({
    dims: [3, 1, 1],
    vx: new Float32Array([1, 2, 3]),
    vy: new Float32Array([0, 0, 0]),
    vz: new Float32Array([0, 0, 0]),
    stride: 2,
  })

  assert.deepEqual(
    result.samples.map((sample) => sample.ix),
    [0, 2],
    'respects the sampling stride for dense vector fields',
  )
}

{
  const field = {
    dims: [2, 1, 1],
    vx: new Float32Array([2, 4]),
    vy: new Float32Array([0, 0]),
    vz: new Float32Array([0, 0]),
  }

  assert.deepEqual(
    sampleVelocityVectorAtNormalizedPosition(field, [-0.25, 0, 0]),
    { vx: 2, vy: 0, vz: 0, speed: 2 },
    'samples the combined velocity vector at the first cell center',
  )
  assert.deepEqual(
    sampleVelocityVectorAtNormalizedPosition(field, [0.25, 0, 0]),
    { vx: 4, vy: 0, vz: 0, speed: 4 },
    'samples the combined velocity vector at the second cell center',
  )
}

{
  const particle = { position: [0, 0, 0], velocity: [0, 0, 0] }
  const field = {
    dims: [1, 1, 1],
    vx: new Float32Array([3]),
    vy: new Float32Array([4]),
    vz: new Float32Array([0]),
  }
  const next = advanceVelocityParticle(particle, field, {
    dt: 0.5,
    speedScale: 0.2,
  })

  assert.deepEqual(next.position, [0.3, 0.4, 0])
  assert.deepEqual(next.velocity, [3, 4, 0])
  assert.equal(next.speed, 5)
  assert.equal(next.outOfBounds, false)
}
