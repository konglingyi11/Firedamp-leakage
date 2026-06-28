export const PARTICLE_VELOCITY_VARIABLES = ['velocity0', 'velocity1', 'velocity2']
export const PARTICLE_VELOCITY_REQUEST_VARIABLES = [
  'Velocity:0',
  'Velocity:1',
  'Velocity:2',
]

function normalizeVelocityKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:()]+/g, '')
}

function hasManifestUrl(source) {
  return Boolean(
    source &&
      typeof source === 'object' &&
      String(source.manifest_url || source.manifestUrl || '').trim(),
  )
}

function hasDirectVelocityFiles(source) {
  return Boolean(
    resolveParticleVariableUrl(source, 'velocity0') &&
      resolveParticleVariableUrl(source, 'velocity1') &&
      resolveParticleVariableUrl(source, 'velocity2'),
  )
}

function resolveParticleVariableUrl(source, variableName) {
  if (!source || typeof source !== 'object') return ''
  const target = normalizeVelocityKey(variableName)
  const direct =
    source?.bin_urls?.[variableName] ||
    source?.binUrls?.[variableName] ||
    source?.velocity_urls?.[variableName] ||
    source?.velocityUrls?.[variableName]
  if (direct) return String(direct)
  for (const map of [
    source?.bin_urls,
    source?.binUrls,
    source?.velocity_urls,
    source?.velocityUrls,
  ]) {
    if (!map || typeof map !== 'object') continue
    for (const [key, url] of Object.entries(map)) {
      if (normalizeVelocityKey(key) === target && url) return String(url)
    }
  }
  const variables = Array.isArray(source.variables) ? source.variables : []
  const hit = variables.find((item) => {
    const name = normalizeVelocityKey(item?.name)
    const slug = normalizeVelocityKey(item?.slug)
    return name === target || slug === target
  })
  return String(
    hit?.file_url ||
      hit?.bin_url ||
      hit?.file ||
      hit?.url ||
      hit?.data_url ||
      '',
  )
}

export function particleSourceHasVelocity(source) {
  return hasDirectVelocityFiles(source)
}

export function particleSourceMayContainVelocityManifest(source) {
  return hasDirectVelocityFiles(source) || hasManifestUrl(source)
}

function findMatchingSource(sources, timeStep) {
  const target = String(timeStep)
  return (
    sources.find((source) => {
      const raw =
        source?.time_step ??
        source?.timeStep ??
        source?.step ??
        source?.simulation_time_step
      return String(raw) === target && particleSourceHasVelocity(source)
    }) || sources.find((source) => particleSourceHasVelocity(source))
  )
}

export function findParticleDatasetSource(payload, timeStep) {
  if (!payload || typeof payload !== 'object') return null
  const datasets = Array.isArray(payload.datasets) ? payload.datasets : []
  const matchedDataset = findMatchingSource(datasets, timeStep)
  if (matchedDataset) return matchedDataset

  const frames = Array.isArray(payload.volume_dataset_frames)
    ? payload.volume_dataset_frames
    : []
  const matchedFrame = findMatchingSource(frames, timeStep)
  if (matchedFrame) return matchedFrame

  return particleSourceHasVelocity(payload) ? payload : null
}

export function buildParticleVelocityDatasetRequest({
  taskId,
  timeSteps,
  usePregen,
  resolution,
  samplingRatio,
}) {
  const resolvedTaskId = String(taskId ?? '').trim()
  const resolvedTimeSteps = (Array.isArray(timeSteps) ? timeSteps : [timeSteps])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (!resolvedTaskId || resolvedTimeSteps.length === 0) return null

  const request = {
    task_id: resolvedTaskId,
    time_step: resolvedTimeSteps,
    variables: [...PARTICLE_VELOCITY_REQUEST_VARIABLES],
    use_pregen: Boolean(usePregen),
  }
  const nResolution = Number(resolution)
  if (Number.isFinite(nResolution) && nResolution > 0) {
    request.resolution = Math.max(8, Math.min(512, Math.round(nResolution)))
  }
  const nSamplingRatio = Number(samplingRatio)
  if (Number.isFinite(nSamplingRatio) && nSamplingRatio > 0) {
    request.sampling_ratio = nSamplingRatio
  }
  return request
}
