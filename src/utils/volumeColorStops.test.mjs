import assert from 'node:assert/strict'
import {
  colorStopsToGradient,
  createDefaultColorStops,
  mappedColorStopsToGradient,
  normalizeColorStops,
  sampleMappedColorStops,
  sampleColorStops,
  withMappedColorStopColors,
} from './volumeColorStops.js'

const range = { vmin: 0, vmax: 0.04 }

assert.deepEqual(createDefaultColorStops(range), [
  { value: 0, color: '#1f8cff' },
  { value: 0.02, color: '#f43f5e' },
  { value: 0.04, color: '#39e600' },
])

assert.deepEqual(
  normalizeColorStops(
    [
      { value: 0.04, color: '#00ff00' },
      { value: 0, color: '#0000ff' },
      { value: 0.02, color: '#ff0000' },
    ],
    range,
  ),
  [
    { value: 0, color: '#0000ff', position: 0 },
    { value: 0.02, color: '#ff0000', position: 0.5 },
    { value: 0.04, color: '#00ff00', position: 1 },
  ],
)

assert.deepEqual(
  normalizeColorStops(
    [
      { value: -1, color: '#0000ff' },
      { value: 0.02, color: '#ff0000' },
      { value: 1, color: '#00ff00' },
    ],
    range,
  ),
  [
    { value: 0, color: '#0000ff', position: 0 },
    { value: 0.02, color: '#ff0000', position: 0.5 },
    { value: 0.04, color: '#00ff00', position: 1 },
  ],
)

assert.equal(
  colorStopsToGradient(
    [
      { value: 0, color: '#0000ff' },
      { value: 0.02, color: '#ff0000' },
      { value: 0.04, color: '#00ff00' },
    ],
    range,
    'vertical',
  ),
  'linear-gradient(0deg, #0000ff 0%, #ff0000 50%, #00ff00 100%)',
)

assert.deepEqual(
  sampleColorStops(
    [
      { value: 0, color: '#000000' },
      { value: 0.04, color: '#ffffff' },
    ],
    range,
    3,
  ),
  ['#000000', '#808080', '#ffffff'],
)

assert.deepEqual(
  sampleMappedColorStops(
    [
      { value: 0 },
      { value: 0.01 },
      { value: 0.04 },
    ],
    range,
    ['#000000', '#ffffff'],
    5,
  ),
  ['#000000', '#808080', '#aaaaaa', '#d5d5d5', '#ffffff'],
)

assert.equal(
  mappedColorStopsToGradient(
    [
      { value: 0 },
      { value: 0.02 },
      { value: 0.04 },
    ],
    range,
    ['#0000ff', '#00ff00'],
    'vertical',
    3,
  ),
  'linear-gradient(0deg, #0000ff 0%, #008080 50%, #00ff00 100%)',
)

assert.deepEqual(
  withMappedColorStopColors(
    [
      { value: 0, color: '#123456' },
      { value: 0.01, color: '#654321' },
      { value: 0.04, color: '#abcdef' },
    ],
    range,
    ['#0000ff', '#00ff00'],
  ),
  [
    { value: 0, color: '#0000ff', position: 0 },
    { value: 0.01, color: '#008080', position: 0.25 },
    { value: 0.04, color: '#00ff00', position: 1 },
  ],
)

assert.deepEqual(
  normalizeColorStops(
    [
      { value: 0, bandPosition: 0 },
      { value: 0.01, bandPosition: 0.8 },
      { value: 0.04, bandPosition: 1 },
    ],
    range,
  ),
  [
    { value: 0, color: '#1f8cff', position: 0, bandPosition: 0 },
    { value: 0.01, color: '#f43f5e', position: 0.25, bandPosition: 0.8 },
    { value: 0.04, color: '#39e600', position: 1, bandPosition: 1 },
  ],
)

assert.deepEqual(
  sampleMappedColorStops(
    [
      { value: 0, bandPosition: 0 },
      { value: 0.01, bandPosition: 0.8 },
      { value: 0.04, bandPosition: 1 },
    ],
    range,
    ['#000000', '#ffffff'],
    5,
  ),
  ['#000000', '#cccccc', '#dddddd', '#eeeeee', '#ffffff'],
)
