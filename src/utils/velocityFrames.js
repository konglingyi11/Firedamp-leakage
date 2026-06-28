export const VELOCITY_SLUGS = ['velocity0', 'velocity1', 'velocity2']

function normalizeVelocityKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:()]+/g, '')
}

function getFile(entry) {
  return entry?.file || entry?.file_url || entry?.url || entry?.bin_url || ''
}

export function getVelocityVariables(manifest) {
  const variables = Array.isArray(manifest?.variables) ? manifest.variables : []
  const velocityVariables = VELOCITY_SLUGS.map((slug) => {
    const target = normalizeVelocityKey(slug)
    return variables.find((variable) => {
      return (
        normalizeVelocityKey(variable?.slug) === target ||
        normalizeVelocityKey(variable?.name) === target
      )
    })
  })
  if (velocityVariables.some((variable) => !variable)) {
    throw new Error('manifest 中未找到 velocity0/1/2 变量')
  }
  return velocityVariables
}

export function getVelocityFrameCount(manifest) {
  const velocityVariables = getVelocityVariables(manifest)
  const frameCounts = velocityVariables.map((variable) => Array.isArray(variable.frames) ? variable.frames.length : 0)
  const maxFrameCount = Math.max(...frameCounts)
  return maxFrameCount > 0 ? maxFrameCount : 1
}

export function getVelocityFrameSet(manifest, frameIndex) {
  const velocityVariables = getVelocityVariables(manifest)
  const frameCount = getVelocityFrameCount(manifest)
  const index = Math.max(0, Math.min(frameCount - 1, Math.round(Number(frameIndex) || 0)))

  return velocityVariables.map((variable) => {
    const frame = Array.isArray(variable.frames) && variable.frames.length
      ? variable.frames[Math.min(index, variable.frames.length - 1)]
      : null
    const file = getFile(frame) || getFile(variable)
    if (!file) throw new Error(`${variable.slug} 缺少 bin 文件`)
    return {
      variable,
      file,
      time: frame?.time,
      valueRange: variable.originalValueRange || variable.original_value_range || [-0.0003, 0.0003],
    }
  })
}
