import assert from 'node:assert/strict'
import {
  resolveEffectiveVolumeUrl,
  resolveVolumeDatasetFrame,
  resolveVolumeFrameIndexFromPayload,
} from './volumeFrameUrl.js'

assert.equal(
  resolveEffectiveVolumeUrl('/data/frame-12.csv', {
    volume_urls: ['/data/frame-0.csv', '/data/frame-12.csv'],
  }),
  '/data/frame-12.csv',
  'uses the already resolved timeline frame URL instead of falling back to the first payload URL',
)

assert.equal(
  resolveEffectiveVolumeUrl('', {
    volume_urls: ['/data/frame-0.csv', '/data/frame-1.csv'],
  }),
  '/data/frame-0.csv',
  'falls back to the first payload URL when no resolved frame URL is available',
)

assert.equal(
  resolveVolumeFrameIndexFromPayload(
    {
      time_step: [12],
      volume_dataset_frames: [
        { time_step: 0, bin_url: '/data/frame-0.bin' },
        { time_step: 12, bin_url: '/data/frame-12.bin' },
      ],
    },
    { currentTimeStep: 12, currentStepIndex: 1 },
  ),
  1,
  'matches volume_dataset_frames by their own time_step before using a single-frame payload.time_step array',
)

assert.deepEqual(
  resolveVolumeDatasetFrame(
    {
      time_step: [12],
      volume_dataset_frames: [
        { time_step: 0, bin_url: '/data/frame-0.bin' },
        { time_step: 12, bin_url: '/data/frame-12.bin' },
      ],
    },
    12,
  ),
  { time_step: 12, bin_url: '/data/frame-12.bin' },
  'resolves the current dataset frame even when payload.time_step only contains the scrubbed step',
)
