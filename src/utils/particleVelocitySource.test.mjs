import assert from 'node:assert/strict'
import {
  buildParticleVelocityDatasetRequest,
  findParticleDatasetSource,
  particleSourceHasVelocity,
  particleSourceMayContainVelocityManifest,
} from './particleVelocitySource.js'

{
  assert.equal(
    particleSourceHasVelocity({ manifest_url: '/test-data/manifest.json' }),
    false,
    'does not treat any manifest_url as a velocity source; plain volume manifests can be stale cache entries',
  )
  assert.equal(
    particleSourceMayContainVelocityManifest({
      manifest_url: '/test-data/manifest.json',
    }),
    true,
    'backend velocity requests may still return manifest-only datasets whose manifest must be inspected',
  )
}

{
  const source = findParticleDatasetSource(
    {
      datasets: [
        {
          time_step: 0,
          manifest_url: '/test-data/t000/manifest.json',
          bin_urls: {
            velocity0: '/test-data/t000/velocity0.bin',
            velocity1: '/test-data/t000/velocity1.bin',
            velocity2: '/test-data/t000/velocity2.bin',
          },
        },
        {
          time_step: 1,
          manifest_url: '/test-data/t001/manifest.json',
          bin_urls: {
            velocity0: '/test-data/t001/velocity0.bin',
            velocity1: '/test-data/t001/velocity1.bin',
            velocity2: '/test-data/t001/velocity2.bin',
          },
        },
      ],
    },
    1,
  )

  assert.equal(source.manifest_url, '/test-data/t001/manifest.json')
}

{
  const request = buildParticleVelocityDatasetRequest({
    taskId: 'task-1',
    timeSteps: [0, 10, 20],
    usePregen: true,
    resolution: 160,
  })

  assert.deepEqual(request, {
    task_id: 'task-1',
    time_step: [0, 10, 20],
    variables: ['Velocity:0', 'Velocity:1', 'Velocity:2'],
    use_pregen: true,
    resolution: 160,
  })
}
