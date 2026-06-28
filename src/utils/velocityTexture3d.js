function readComponent(array, index, fallback = 0) {
  const value = Number(array?.[index])
  return Number.isFinite(value) ? value : fallback
}

export function buildVelocityTexture3dData({
  vx,
  vy,
  vz,
  density,
  voxelCount,
}) {
  const count = Math.max(0, Math.round(Number(voxelCount) || 0))
  const data = new Float32Array(count * 4)
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4
    data[offset] = readComponent(vx, i)
    data[offset + 1] = readComponent(vy, i)
    data[offset + 2] = readComponent(vz, i)
    data[offset + 3] = readComponent(density, i, 1)
  }
  return data
}

export function summarizeVelocityTexture3dData(data) {
  const voxelCount = Math.floor((data?.length || 0) / 4)
  let maxSpeed = 0
  let maxDensity = 0
  let nonZeroVelocityCount = 0
  for (let i = 0; i < voxelCount; i += 1) {
    const offset = i * 4
    const speed = Math.hypot(
      readComponent(data, offset),
      readComponent(data, offset + 1),
      readComponent(data, offset + 2),
    )
    const density = readComponent(data, offset + 3)
    if (speed > 1e-12) nonZeroVelocityCount += 1
    maxSpeed = Math.max(maxSpeed, speed)
    maxDensity = Math.max(maxDensity, density)
  }
  return { voxelCount, maxSpeed, maxDensity, nonZeroVelocityCount }
}

function normalizeCellCenterPosition(index, count) {
  const n = Math.max(1, Math.round(Number(count) || 1))
  return (index + 0.5) / n - 0.5
}

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function normalizedPositionToGridIndex(value, count) {
  const n = Math.max(1, Math.round(Number(count) || 1))
  return clamp((Number(value) + 0.5) * n - 0.5, 0, n - 1)
}

function sampleAxis(value, count) {
  const f = normalizedPositionToGridIndex(value, count)
  const hiLimit = Math.max(0, Math.round(Number(count) || 1) - 1)
  const lo = Math.max(0, Math.min(hiLimit, Math.floor(f)))
  const hi = Math.max(0, Math.min(hiLimit, lo + 1))
  return { lo, hi, t: hi === lo ? 0 : f - lo }
}

function roundPositionComponent(value) {
  return Number(Number(value).toFixed(12))
}

export function buildVelocityArrowSamples({
  dims,
  vx,
  vy,
  vz,
  stride = 1,
  minSpeed = 0,
}) {
  const nx = Math.max(1, Math.round(Number(dims?.[0]) || 1))
  const ny = Math.max(1, Math.round(Number(dims?.[1]) || 1))
  const nz = Math.max(1, Math.round(Number(dims?.[2]) || 1))
  const step = Math.max(1, Math.round(Number(stride) || 1))
  const threshold = Math.max(0, Number(minSpeed) || 0)
  const samples = []
  let maxSpeed = 0
  let nonZeroVelocityCount = 0

  for (let iz = 0; iz < nz; iz += step) {
    for (let iy = 0; iy < ny; iy += step) {
      for (let ix = 0; ix < nx; ix += step) {
        const index = ix + nx * (iy + ny * iz)
        const vector = [
          readComponent(vx, index),
          readComponent(vy, index),
          readComponent(vz, index),
        ]
        const speed = Math.hypot(vector[0], vector[1], vector[2])
        maxSpeed = Math.max(maxSpeed, speed)
        if (speed > 1e-12) nonZeroVelocityCount += 1
        if (speed < threshold) continue
        samples.push({
          index,
          ix,
          iy,
          iz,
          position: [
            normalizeCellCenterPosition(ix, nx),
            normalizeCellCenterPosition(iy, ny),
            normalizeCellCenterPosition(iz, nz),
          ],
          vector,
          speed,
        })
      }
    }
  }

  return {
    samples,
    maxSpeed,
    dims: [nx, ny, nz],
    stride: step,
    cellCount: samples.length,
    nonZeroVelocityCount,
  }
}

export function sampleVelocityVectorAtNormalizedPosition(field, position) {
  if (!field?.vx || !field?.vy || !field?.vz) {
    return { vx: 0, vy: 0, vz: 0, speed: 0 }
  }
  const nx = Math.max(1, Math.round(Number(field.dims?.[0]) || 1))
  const ny = Math.max(1, Math.round(Number(field.dims?.[1]) || 1))
  const nz = Math.max(1, Math.round(Number(field.dims?.[2]) || 1))
  const sx = sampleAxis(position?.[0] ?? 0, nx)
  const sy = sampleAxis(position?.[1] ?? 0, ny)
  const sz = sampleAxis(position?.[2] ?? 0, nz)
  const index = (x, y, z) => x + nx * (y + ny * z)
  const mask = field.nonZeroMask
  if (mask) {
    const i000 = index(sx.lo, sy.lo, sz.lo)
    const i100 = index(sx.hi, sy.lo, sz.lo)
    const i010 = index(sx.lo, sy.hi, sz.lo)
    const i110 = index(sx.hi, sy.hi, sz.lo)
    const i001 = index(sx.lo, sy.lo, sz.hi)
    const i101 = index(sx.hi, sy.lo, sz.hi)
    const i011 = index(sx.lo, sy.hi, sz.hi)
    const i111 = index(sx.hi, sy.hi, sz.hi)
    if (
      !mask[i000] &&
      !mask[i100] &&
      !mask[i010] &&
      !mask[i110] &&
      !mask[i001] &&
      !mask[i101] &&
      !mask[i011] &&
      !mask[i111]
    ) {
      return { vx: 0, vy: 0, vz: 0, speed: 0 }
    }
  }
  const lerp = (a, b, t) => a + (b - a) * t
  const sample = (array) => {
    const c000 = readComponent(array, index(sx.lo, sy.lo, sz.lo))
    const c100 = readComponent(array, index(sx.hi, sy.lo, sz.lo), c000)
    const c010 = readComponent(array, index(sx.lo, sy.hi, sz.lo), c000)
    const c110 = readComponent(array, index(sx.hi, sy.hi, sz.lo), c000)
    const c001 = readComponent(array, index(sx.lo, sy.lo, sz.hi), c000)
    const c101 = readComponent(array, index(sx.hi, sy.lo, sz.hi), c000)
    const c011 = readComponent(array, index(sx.lo, sy.hi, sz.hi), c000)
    const c111 = readComponent(array, index(sx.hi, sy.hi, sz.hi), c000)
    return lerp(
      lerp(lerp(c000, c100, sx.t), lerp(c010, c110, sx.t), sy.t),
      lerp(lerp(c001, c101, sx.t), lerp(c011, c111, sx.t), sy.t),
      sz.t,
    )
  }
  const vx = sample(field.vx)
  const vy = sample(field.vy)
  const vz = sample(field.vz)
  return { vx, vy, vz, speed: Math.hypot(vx, vy, vz) }
}

export function advanceVelocityParticle(
  particle,
  field,
  { dt = 1 / 60, speedScale = 1, bounds = 0.5 } = {},
) {
  const position = Array.isArray(particle?.position) ? particle.position : [0, 0, 0]
  const sampled = sampleVelocityVectorAtNormalizedPosition(field, position)
  const nextPosition = [
    roundPositionComponent(position[0] + sampled.vx * speedScale * dt),
    roundPositionComponent(position[1] + sampled.vy * speedScale * dt),
    roundPositionComponent(position[2] + sampled.vz * speedScale * dt),
  ]
  const limit = Math.max(0, Number(bounds) || 0.5)
  return {
    ...particle,
    position: nextPosition,
    velocity: [sampled.vx, sampled.vy, sampled.vz],
    speed: sampled.speed,
    outOfBounds: nextPosition.some((value) => value < -limit || value > limit),
  }
}
