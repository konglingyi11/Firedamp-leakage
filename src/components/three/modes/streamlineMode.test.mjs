import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import { createStreamlineMode } from './streamlineMode.js'

function installCanvasStub() {
  const previousDocument = globalThis.document
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') {
        throw new Error(`Unexpected element requested: ${tag}`)
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            createRadialGradient() {
              return {
                addColorStop() {},
              }
            },
            fillStyle: '',
            fillRect() {},
          }
        },
      }
    },
  }
  return () => {
    globalThis.document = previousDocument
  }
}

function createModeHarness({ isEnabled = true, isVisible = true, payload } = {}) {
  const dynamicGroup = new THREE.Group()
  const mode = createStreamlineMode({
    getDynamicGroup: () => dynamicGroup,
    getSceneMode: () => 'streamline',
    getVisualization: () => ({
      streamline: {
        color: '#ffffff',
        line_width: 0.38,
        seed_count: 8,
      },
    }),
    getActiveStreamlinePayload: () => payload || ({
      lines: [
        [
          [0, 0, 0],
          [0.25, 0.25, 0.25],
          [0.5, 0.5, 0.5],
        ],
      ],
    }),
    getIsEnabled: () => isEnabled,
    getIsVisible: () => isVisible,
    getCurrentTimeStep: () => 0,
    getCurrentStepIndex: () => 0,
    getIsPlaying: () => false,
  })
  return { dynamicGroup, mode }
}

function countArrowHelpers(object) {
  let count = 0
  object.traverse?.((child) => {
    if (
      child instanceof THREE.ArrowHelper ||
      child.type === 'ArrowHelper' ||
      child.userData?.isStreamlineArrow
    ) {
      count += 1
    }
  })
  return count
}

function countStartCaps(object) {
  let count = 0
  object.traverse?.((child) => {
    if (child.userData?.isStreamlineStartCap) {
      count += 1
    }
  })
  return count
}

function findStreamlineParticles(object) {
  let particles = null
  object.traverse?.((child) => {
    if (!particles && child instanceof THREE.Points) {
      particles = child
    }
  })
  return particles
}

test('sync clears rendered streamline meshes when mode becomes disabled', async () => {
  const restoreDocument = installCanvasStub()
  try {
    const active = createModeHarness({ isEnabled: true })
    active.mode.buildFallback()
    assert.equal(active.dynamicGroup.children.length > 0, true)

    const disabled = createModeHarness({ isEnabled: false })
    disabled.dynamicGroup.add(...active.dynamicGroup.children)
    await disabled.mode.sync()

    assert.equal(disabled.dynamicGroup.children.length, 0)
  } finally {
    restoreDocument()
  }
})

test('sync clears rendered streamline meshes when layer is hidden', async () => {
  const restoreDocument = installCanvasStub()
  try {
    const { dynamicGroup, mode } = createModeHarness({ isEnabled: true, isVisible: true })
    mode.buildFallback()
    assert.equal(dynamicGroup.children.length > 0, true)

    const hiddenMode = createStreamlineMode({
      getDynamicGroup: () => dynamicGroup,
      getSceneMode: () => 'streamline',
      getVisualization: () => ({
        streamline: {
          color: '#ffffff',
          line_width: 0.38,
          seed_count: 8,
        },
      }),
      getActiveStreamlinePayload: () => ({
        lines: [
          [
            [0, 0, 0],
            [0.25, 0.25, 0.25],
            [0.5, 0.5, 0.5],
          ],
        ],
      }),
      getIsEnabled: () => true,
      getIsVisible: () => false,
      getCurrentTimeStep: () => 0,
      getCurrentStepIndex: () => 0,
      getIsPlaying: () => false,
    })

    await hiddenMode.sync()

    assert.equal(dynamicGroup.children.length, 0)
  } finally {
    restoreDocument()
  }
})

test('sync renders one terminal arrow for bidirectional branches from the same seed', async () => {
  const restoreDocument = installCanvasStub()
  try {
    const { dynamicGroup, mode } = createModeHarness({
      payload: {
        lines: [
          [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
          ],
          [
            [0, 0, 0],
            [-1, 0, 0],
            [-2, 0, 0],
          ],
        ],
      },
    })

    await mode.sync()

    assert.equal(countArrowHelpers(dynamicGroup), 1)
  } finally {
    restoreDocument()
  }
})

test('streamline sync does not render moving particles', async () => {
  const restoreDocument = installCanvasStub()
  try {
    const { dynamicGroup, mode } = createModeHarness()

    await mode.sync()

    const particles = findStreamlineParticles(dynamicGroup)
    assert.equal(particles, null)
  } finally {
    restoreDocument()
  }
})

test('sync does not render streamline start caps', async () => {
  const restoreDocument = installCanvasStub()
  try {
    const { dynamicGroup, mode } = createModeHarness()

    await mode.sync()

    assert.equal(countStartCaps(dynamicGroup), 0)
  } finally {
    restoreDocument()
  }
})
