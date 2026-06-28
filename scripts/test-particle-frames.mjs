import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getVelocityFrameSet, getVelocityFrameCount } from '../src/utils/velocityFrames.js'

const singleManifest = JSON.parse(fs.readFileSync('public/test-data/manifest.json', 'utf8'))
const multiManifest = JSON.parse(fs.readFileSync('public/test-data-multistep/manifest.json', 'utf8'))

assert.equal(getVelocityFrameCount(singleManifest), 1)
assert.deepEqual(getVelocityFrameSet(singleManifest, 0).map((frame) => frame.file), [
  'velocity0_vortex.bin',
  'velocity1_vortex.bin',
  'velocity2_vortex.bin',
])

assert.equal(getVelocityFrameCount(multiManifest), 36)
assert.deepEqual(getVelocityFrameSet(multiManifest, 5).map((frame) => frame.file), [
  'velocity0_t005.bin',
  'velocity1_t005.bin',
  'velocity2_t005.bin',
])
assert.deepEqual(getVelocityFrameSet(multiManifest, 999).map((frame) => frame.file), [
  'velocity0_t035.bin',
  'velocity1_t035.bin',
  'velocity2_t035.bin',
])
assert.equal(getVelocityFrameSet(multiManifest, 5)[0].time, 1)

console.log('test-particle-frames passed')
