import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveRenderPixelRatio } from './renderQuality.js'

test('caps default rendering pixel ratio at 2', () => {
  assert.equal(resolveRenderPixelRatio({ devicePixelRatio: 3 }), 2)
  assert.equal(resolveRenderPixelRatio({ devicePixelRatio: 1.25 }), 1.25)
})

test('caps volume rendering pixel ratio below the default for high quality and interaction', () => {
  assert.equal(
    resolveRenderPixelRatio({
      devicePixelRatio: 2,
      isVolumeActive: true,
      lowQuality: false,
    }),
    1.5,
  )
  assert.equal(
    resolveRenderPixelRatio({
      devicePixelRatio: 2,
      isVolumeActive: true,
      lowQuality: true,
    }),
    1,
  )
})
