export function createSeededRandom(seed = Date.now()) {
  let state = Math.max(1, Math.floor(Number(seed) || 1)) >>> 0
  return function random() {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function updateJitterVelocity(jitter, strength, smoothing, random = Math.random) {
  const safeStrength = Math.max(0, Number(strength) || 0)
  const blend = Math.max(0, Math.min(1, Number(smoothing) || 0))
  if (safeStrength <= 0) {
    jitter.x = 0
    jitter.y = 0
    jitter.z = 0
    return jitter
  }

  const theta = random() * Math.PI * 2
  const z = random() * 2 - 1
  const radius = Math.sqrt(Math.max(0, 1 - z * z))
  const targetX = Math.cos(theta) * radius * safeStrength
  const targetY = Math.sin(theta) * radius * safeStrength
  const targetZ = z * safeStrength

  jitter.x += (targetX - jitter.x) * blend
  jitter.y += (targetY - jitter.y) * blend
  jitter.z += (targetZ - jitter.z) * blend
  return jitter
}

export function randomLifetime(minFrames, maxFrames, random = Math.random) {
  const min = Math.max(1, Math.round(Number(minFrames) || 1))
  const max = Math.max(1, Math.round(Number(maxFrames) || min))
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return low + random() * (high - low)
}
