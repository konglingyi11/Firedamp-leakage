import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveGeneratedLayerDefaultVisible } from './generatedLayerDefaults.js'

test('streamline generated layers are hidden by default', () => {
  assert.equal(resolveGeneratedLayerDefaultVisible('streamline'), false)
})

test('non-streamline generated layers keep the existing visible default', () => {
  assert.equal(resolveGeneratedLayerDefaultVisible('volume'), true)
  assert.equal(resolveGeneratedLayerDefaultVisible('vector'), true)
})
