import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SMOKE_CONFIG,
  normalizeSmokeConfig,
  sampleSmokeParticlesAtTime,
  applySmokeQueryOverrides,
  getSmokePlaybackDuration,
} from './smokeDataConfig.js'

test('normalizeSmokeConfig merges timeline', () => {
  const cfg = normalizeSmokeConfig({
    particles: { count: 1200 },
    timeline: [{ time: 0, density: 0.2 }, { time: 10, density: 0.9 }],
  })
  assert.equal(cfg.particles.count, 1200)
  assert.equal(cfg.timeline.length, 2)
})

test('sampleSmokeParticlesAtTime interpolates density', () => {
  const cfg = normalizeSmokeConfig({
    particles: { density: 0.5 },
    timeline: [
      { time: 0, density: 0.2 },
      { time: 10, density: 0.8 },
    ],
    playback: { loop: false, duration: 10 },
  })
  const mid = sampleSmokeParticlesAtTime(cfg, 5)
  assert.ok(mid.density > 0.45 && mid.density < 0.55)
})

test('applySmokeQueryOverrides', () => {
  const cfg = applySmokeQueryOverrides(DEFAULT_SMOKE_CONFIG, { density: '0.9', count: '1500' })
  assert.equal(cfg.particles.density, 0.9)
  assert.equal(cfg.particles.count, 1500)
})

test('getSmokePlaybackDuration from timeline', () => {
  const cfg = normalizeSmokeConfig({
    timeline: [{ time: 0 }, { time: 24 }],
    playback: {},
  })
  assert.equal(getSmokePlaybackDuration(cfg), 24)
})

test('normalizeSmokeConfig keeps gas layers', () => {
  const cfg = normalizeSmokeConfig({
    layers: [
      { scalar: 'mass_fraction_of_ch4', color: [0.1, 0.2, 0.3], threshold: 0.01 },
      'mass_fraction_of_co',
    ],
  })
  assert.equal(cfg.layers.length, 2)
  assert.equal(cfg.layers[0].scalar, 'mass_fraction_of_ch4')
  assert.deepEqual(cfg.layers[0].color, [0.1, 0.2, 0.3])
  assert.equal(cfg.layers[1].scalar, 'mass_fraction_of_co')
})
