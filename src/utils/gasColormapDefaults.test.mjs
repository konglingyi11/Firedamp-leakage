import assert from 'node:assert/strict'
import { assignDistinctGasColormaps } from './gasColormapDefaults.js'

const gases = [{ id: 'ch4' }, { id: 'co' }, { id: 'h2s' }, { id: 'nh3' }]
const options = [
  { value: 'viridis' },
  { value: 'plasma' },
  { value: 'magma' },
]

assert.deepEqual(
  assignDistinctGasColormaps(gases, options, {}),
  {
    ch4: 'viridis',
    co: 'plasma',
    h2s: 'magma',
    nh3: 'viridis',
  },
  'assigns gas variables by rotating through available color maps',
)

assert.deepEqual(
  assignDistinctGasColormaps(gases, options, {
    ch4: 'plasma',
    co: 'missing',
  }),
  {
    ch4: 'plasma',
    co: 'viridis',
    h2s: 'magma',
    nh3: 'viridis',
  },
  'keeps valid existing selections and avoids duplicates while replacements are available',
)

assert.deepEqual(
  assignDistinctGasColormaps(gases, options, {
    ch4: 'plasma',
    co: 'plasma',
    h2s: 'magma',
  }),
  {
    ch4: 'plasma',
    co: 'viridis',
    h2s: 'magma',
    nh3: 'viridis',
  },
  'replaces duplicate existing selections while unused color maps are available',
)

assert.deepEqual(
  assignDistinctGasColormaps(gases, [], { ch4: 'plasma' }),
  {},
  'returns an empty map when no color maps are available',
)
