import assert from 'node:assert/strict'
import {
  buildVolumeDatasetPreloadPlan,
  collectVolumeDatasetPreloadFrames,
  shouldContinueVolumeFrameRequest,
} from './volumeLayerPreload.js'

const payload = {
  variable: 'mass_fraction_of_ch4',
  manifest_content: { dimensions: [2, 2, 2] },
  volume_dataset_frames: [
    {
      time_step: 0,
      manifest_url: '/data/manifest.json',
      bin_url: '/data/ch4_t000.bin',
    },
    {
      time_step: 1,
      manifest_url: '/data/manifest.json',
      bin_url: '/data/ch4_t001.bin',
    },
    {
      time_step: 2,
      manifest_url: '',
      bin_url: '/data/ch4_t002.bin',
    },
  ],
}

assert.equal(
  shouldContinueVolumeFrameRequest(3, () => 3),
  true,
  'continues a frame request while it is still the latest request',
)

assert.equal(
  shouldContinueVolumeFrameRequest(3, () => 4),
  false,
  'stops stale frame requests when a newer timeline request arrives',
)

assert.deepEqual(
  collectVolumeDatasetPreloadFrames(payload),
  [
    {
      frameIndex: 0,
      timeStep: 0,
      variable: 'mass_fraction_of_ch4',
      manifestUrl: '/data/manifest.json',
      binUrl: '/data/ch4_t000.bin',
      manifestData: payload.manifest_content,
    },
    {
      frameIndex: 1,
      timeStep: 1,
      variable: 'mass_fraction_of_ch4',
      manifestUrl: '/data/manifest.json',
      binUrl: '/data/ch4_t001.bin',
      manifestData: payload.manifest_content,
    },
  ],
  'collects only preloadable manifest/bin frames and preserves frame indexes',
)

assert.deepEqual(
  collectVolumeDatasetPreloadFrames({
    variable: 'temperature',
    manifest_url: '/single/manifest.json',
    bin_url: '/single/temperature.bin',
  }),
  [
    {
      frameIndex: 0,
      timeStep: null,
      variable: 'temperature',
      manifestUrl: '/single/manifest.json',
      binUrl: '/single/temperature.bin',
      manifestData: null,
    },
  ],
  'collects a single manifest/bin payload',
)

const manyFramesPayload = {
  variable: 'mass_fraction_of_ch4',
  volume_dataset_frames: Array.from({ length: 21 }, (_, index) => ({
    time_step: index * 10,
    manifest_url: '/data/manifest.json',
    bin_url: `/data/ch4_t${String(index).padStart(3, '0')}.bin`,
  })),
}

{
  const plan = buildVolumeDatasetPreloadPlan(manyFramesPayload, {
    currentFrameIndex: 10,
    windowRadius: 2,
    maxFrames: 8,
  })

  assert.deepEqual(
    plan.immediateFrames.map((frame) => frame.frameIndex),
    [10, 9, 11, 8, 12],
    'prioritizes the current frame, then nearby frames',
  )
  assert.deepEqual(
    plan.backgroundFrames.map((frame) => frame.frameIndex),
    [13, 14, 15],
    'continues background prefetch after the nearby window without loading every frame',
  )
}

{
  const plan = buildVolumeDatasetPreloadPlan(manyFramesPayload, {
    currentTimeStep: 160,
    windowRadius: 3,
    maxFrames: 4,
  })

  assert.deepEqual(
    plan.immediateFrames.map((frame) => frame.frameIndex),
    [16, 15, 17, 14],
    'resolves the current frame from time_step and honors the total frame cap',
  )
  assert.deepEqual(
    plan.backgroundFrames,
    [],
    'does not schedule background frames once the cap is reached',
  )
}
