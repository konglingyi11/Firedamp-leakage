import assert from 'node:assert/strict'
import { randomLifetime } from '../src/utils/particleJitter.js'

assert.equal(randomLifetime(100, 200, () => 0), 100)
assert.equal(randomLifetime(100, 200, () => 1), 200)
assert.equal(randomLifetime(200, 100, () => 0.5), 150)
assert.equal(randomLifetime(-10, 0, () => 0.5), 1)

console.log('test-particle-lifetime passed')
