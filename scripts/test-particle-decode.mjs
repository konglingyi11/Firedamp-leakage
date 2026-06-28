import assert from 'node:assert/strict'
import fs from 'node:fs'
import { decodeNormalizedUint16 } from '../src/utils/normalizedUint16.js'

const manifest = JSON.parse(fs.readFileSync('public/test-data/manifest.json', 'utf8'))
const dims = manifest.dimensions
const total = dims[0] * dims[1] * dims[2]

const velocity2 = manifest.variables.find((variable) => variable.slug === 'velocity2')
const buffer = fs.readFileSync(`public/test-data/${velocity2.file}`)
const raw = new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2)
const decoded = decodeNormalizedUint16(raw, velocity2.originalValueRange, total)

const centerIndex = 32 + 64 * (32 + 64 * 32)
const epsilon = 1e-9
const [rangeMin, rangeMax] = velocity2.originalValueRange
let decodedMin = Infinity
let decodedMax = -Infinity
for (const value of decoded) {
  if (value < decodedMin) decodedMin = value
  if (value > decodedMax) decodedMax = value
}

assert.ok(
  decoded[centerIndex] >= rangeMin - epsilon &&
    decoded[centerIndex] <= rangeMax + epsilon,
  `decoded center velocity2 should stay inside original range, got ${decoded[centerIndex]}`
)

assert.ok(
  decodedMax <= rangeMax + epsilon &&
    decodedMin >= rangeMin - epsilon,
  'all decoded velocity2 values should stay inside original range'
)

console.log('test-particle-decode passed')
