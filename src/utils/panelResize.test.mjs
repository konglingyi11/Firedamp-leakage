import assert from 'node:assert/strict'
import { resizePanelSize } from './panelResize.js'

const bounds = {
  minWidth: 196,
  maxWidth: 360,
  minHeight: 520,
  maxHeight: 760,
}

assert.deepEqual(
  resizePanelSize({ width: 196, height: 620 }, { dx: 80, dy: 60 }, bounds),
  { width: 276, height: 680 },
)

assert.deepEqual(
  resizePanelSize({ width: 220, height: 620 }, { dx: -200, dy: -200 }, bounds),
  { width: 196, height: 520 },
)

assert.deepEqual(
  resizePanelSize({ width: 320, height: 720 }, { dx: 200, dy: 200 }, bounds),
  { width: 360, height: 760 },
)
