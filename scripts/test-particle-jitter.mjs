import assert from 'node:assert/strict'
import { createSeededRandom, updateJitterVelocity } from '../src/utils/particleJitter.js'

const jitter = { x: 0, y: 0, z: 0 }
const random = createSeededRandom(123)

updateJitterVelocity(jitter, 0.0002, 1, random)
const magnitude = Math.hypot(jitter.x, jitter.y, jitter.z)
assert.ok(magnitude <= 0.000200001, `jitter magnitude should be capped by strength, got ${magnitude}`)
assert.ok(magnitude > 0.00001, 'jitter should move away from zero when strength is positive')

const previous = { ...jitter }
updateJitterVelocity(jitter, 0.0002, 0, random)
assert.deepEqual(jitter, previous, 'zero smoothing should preserve previous jitter')

updateJitterVelocity(jitter, 0, 1, random)
assert.equal(jitter.x, 0)
assert.equal(jitter.y, 0)
assert.equal(jitter.z, 0)

console.log('test-particle-jitter passed')
