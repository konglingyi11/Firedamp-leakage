import assert from 'node:assert/strict'
import {
  seededUnit,
  simulatedRadarWaveSeries,
  simulatedRadarWaveSnapshot,
} from './simulatedRadarProbe.js'

const probeA = { id: 'pa', x: 10, y: 20, z: 5 }
const probeB = { id: 'pb', x: 99, y: -12, z: 180 }

assert.ok(seededUnit('x') >= 0 && seededUnit('x') < 1)
const emptySer = simulatedRadarWaveSeries(null, [0, 1])
assert.equal(emptySer.attenuation.length, 0)
assert.equal(emptySer.intensity.length, 0)

const xa = [0.0, 1.25, 2.77, 4.0]
const serA = simulatedRadarWaveSeries(probeA, xa)
const serB = simulatedRadarWaveSeries(probeB, xa)

assert.equal(serA.attenuation.length, 4)
assert.ok(serA.attenuation.some((v, i) => v !== serB.attenuation[i]))

const snap1 = simulatedRadarWaveSnapshot(probeA, 0, 11)
assert.notEqual(snap1.attenuation, '—')

const snap2 = simulatedRadarWaveSnapshot(probeA, 10, 11)
assert.notEqual(snap1.attenuation, snap2.attenuation)
