export const DEFAULT_PARTICLE_SETTINGS = {
  emitRate: 3,
  maxParticles: 2000,
  minLife: 50,
  maxLife: 150,
  velocityScale: 100,
  turbulenceStrength: 0,
  turbulenceSmoothing: 0.25,
  initialVelocity: [0, 0, 0],
  fieldInfluence: 0.08,
  inertia: 0.92,
  pointSize: 2,
  trailLength: 30,
  showTrails: false,
  emitter: [0, 0, 0],
  color: '#22d3ff',
}

const DEFAULT_SCENE_UNIT_SCALE = 0.01
const MIN_PARTICLE_FIELD_SPEED = 1e-6
const DEFAULT_INITIAL_LAUNCH_SPEED = 0.003

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function normalizeNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function resolveParticleInitialVelocity(
  sampledVelocity,
  settingsOrMinSpeed = {},
  fallbackMinSpeed = MIN_PARTICLE_FIELD_SPEED,
) {
  const hasSettings =
    settingsOrMinSpeed &&
    typeof settingsOrMinSpeed === 'object' &&
    !Array.isArray(settingsOrMinSpeed)
  const minSpeed = hasSettings
    ? fallbackMinSpeed
    : normalizeNumber(settingsOrMinSpeed, MIN_PARTICLE_FIELD_SPEED)
  if (hasSettings) {
    const launch = normalizeVector3(settingsOrMinSpeed.initialVelocity)
    if (Math.hypot(launch[0], launch[1], launch[2]) >= minSpeed) {
      return { vx: launch[0], vy: launch[1], vz: launch[2] }
    }
  }

  const velocity = {
    vx: normalizeNumber(sampledVelocity?.vx, 0),
    vy: normalizeNumber(sampledVelocity?.vy, 0),
    vz: normalizeNumber(sampledVelocity?.vz, 0),
  }
  const speed = Math.hypot(velocity.vx, velocity.vy, velocity.vz)
  if (speed >= minSpeed) return velocity
  return { vx: DEFAULT_INITIAL_LAUNCH_SPEED, vy: 0, vz: 0 }
}

export function resolveParticleAdvectedVelocity(
  sampledVelocity,
  previousVelocity,
  settingsOrMinSpeed = MIN_PARTICLE_FIELD_SPEED,
) {
  const hasSettings =
    settingsOrMinSpeed &&
    typeof settingsOrMinSpeed === 'object' &&
    !Array.isArray(settingsOrMinSpeed)
  const minSpeed = hasSettings
    ? normalizeNumber(settingsOrMinSpeed.minSpeed, MIN_PARTICLE_FIELD_SPEED)
    : normalizeNumber(settingsOrMinSpeed, MIN_PARTICLE_FIELD_SPEED)
  const sampled = {
    vx: normalizeNumber(sampledVelocity?.vx, 0),
    vy: normalizeNumber(sampledVelocity?.vy, 0),
    vz: normalizeNumber(sampledVelocity?.vz, 0),
  }
  const previous = {
    vx: normalizeNumber(previousVelocity?.vx, 0),
    vy: normalizeNumber(previousVelocity?.vy, 0),
    vz: normalizeNumber(previousVelocity?.vz, 0),
  }
  if (hasSettings) {
    const fieldInfluence = clamp(
      settingsOrMinSpeed.fieldInfluence ??
        settingsOrMinSpeed.field_influence ??
        DEFAULT_PARTICLE_SETTINGS.fieldInfluence,
      0,
      1,
    )
    const inertia = clamp(
      settingsOrMinSpeed.inertia ?? settingsOrMinSpeed.momentum ?? 1 - fieldInfluence,
      0,
      1,
    )
    const blended = {
      vx: previous.vx * inertia + sampled.vx * fieldInfluence,
      vy: previous.vy * inertia + sampled.vy * fieldInfluence,
      vz: previous.vz * inertia + sampled.vz * fieldInfluence,
    }
    if (Math.hypot(blended.vx, blended.vy, blended.vz) >= minSpeed) return blended
  }

  const sampledSpeed = Math.hypot(sampled.vx, sampled.vy, sampled.vz)
  if (sampledSpeed >= minSpeed) return sampled

  const previousSpeed = Math.hypot(previous.vx, previous.vy, previous.vz)
  if (previousSpeed >= minSpeed) return previous
  return resolveParticleInitialVelocity(sampled, minSpeed)
}

function readVector3(value) {
  if (Array.isArray(value)) return value.slice(0, 3)
  if (value && typeof value === 'object') {
    return [value.x, value.y, value.z]
  }
  return null
}

function isFiniteVector3(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => Number.isFinite(Number(item)))
  )
}

function normalizeVector3(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback
  return [0, 1, 2].map((index) => normalizeNumber(source[index], fallback[index]))
}

export function resolveParticleEmitterFromManifest(
  manifest,
  unitScale = DEFAULT_SCENE_UNIT_SCALE,
) {
  if (!manifest || typeof manifest !== 'object') return null
  const rawPoint =
    readVector3(manifest.particleEmitter) ||
    readVector3(manifest.particle_emitter) ||
    readVector3(manifest.emitter) ||
    readVector3(manifest.emitterPoint) ||
    readVector3(manifest.emitter_point) ||
    readVector3(manifest.sourcePoint) ||
    readVector3(manifest.source_point) ||
    readVector3(manifest.releasePoint) ||
    readVector3(manifest.release_point) ||
    readVector3(manifest.leakPoint) ||
    readVector3(manifest.leak_point)
  if (!isFiniteVector3(rawPoint)) return null

  const point = rawPoint.map(Number)
  const dims = Array.isArray(manifest.dimensions)
    ? manifest.dimensions
    : Array.isArray(manifest.dims)
      ? manifest.dims
      : null
  const origin = readVector3(manifest.origin)
  const spacing = readVector3(manifest.spacing)
  const isNormalizedPoint = point.every((value) => value >= 0 && value <= 1)
  if (
    isNormalizedPoint &&
    isFiniteVector3(dims) &&
    isFiniteVector3(origin) &&
    isFiniteVector3(spacing)
  ) {
    return point.map(
      (value, index) =>
        (Number(origin[index]) +
          value * Math.max(0, Number(dims[index]) - 1) * Number(spacing[index])) *
        unitScale,
    )
  }

  return point.map((value) => value * unitScale)
}

export function resolveParticleEmitterFromField(field) {
  if (Array.isArray(field?.emitter)) return field.emitter
  const dims = field?.dims
  const origin = field?.origin
  const spacing = field?.spacing
  if (!isFiniteVector3(dims) || !isFiniteVector3(origin) || !isFiniteVector3(spacing)) {
    return null
  }
  return [0, 1, 2].map(
    (index) =>
      Number(origin[index]) +
      Math.max(0, Number(dims[index]) - 1) * Number(spacing[index]) * 0.5,
  )
}

export function resolveParticleFieldGridFromSource(
  source,
  unitScale = DEFAULT_SCENE_UNIT_SCALE,
) {
  const dimsSource = source?.dimensions || source?.dims || [64, 64, 64]
  const originSource = source?.origin || [0, 0, 0]
  const spacingSource = source?.spacing || [1, 1, 1]
  const dims = [0, 1, 2].map((index) =>
    Math.max(1, Math.round(normalizeNumber(dimsSource?.[index], 64))),
  )
  const origin = [0, 1, 2].map(
    (index) => normalizeNumber(originSource?.[index], 0) * unitScale,
  )
  const spacing = [0, 1, 2].map(
    (index) => normalizeNumber(spacingSource?.[index], 1) * unitScale,
  )
  return { dims, origin, spacing }
}

export function normalizeParticleSettings(settings = {}) {
  const rawMinLife = clamp(
    settings.minLife ?? settings.min_particle_life ?? DEFAULT_PARTICLE_SETTINGS.minLife,
    1,
    2000,
  )
  const rawMaxLife = clamp(
    settings.maxLife ?? settings.max_particle_life ?? DEFAULT_PARTICLE_SETTINGS.maxLife,
    1,
    3000,
  )
  const minLife = Math.min(rawMinLife, rawMaxLife)
  const maxLife = Math.max(rawMinLife, rawMaxLife)
  const emitterSource = Array.isArray(settings.emitter)
    ? settings.emitter
    : [settings.emitX, settings.emitY, settings.emitZ]
  const initialVelocitySource = Array.isArray(settings.initialVelocity)
    ? settings.initialVelocity
    : Array.isArray(settings.initial_velocity)
      ? settings.initial_velocity
      : [settings.initialVx, settings.initialVy, settings.initialVz]
  const hasManualEmitter =
    Array.isArray(settings.emitter) ||
    [settings.emitX, settings.emitY, settings.emitZ].some(
      (value) => value != null && Number(value) !== 0,
    )
  const rawFieldInfluence = clamp(
    settings.fieldInfluence ??
      settings.field_influence ??
      DEFAULT_PARTICLE_SETTINGS.fieldInfluence,
    0,
    1,
  )
  const fieldInfluence = rawFieldInfluence
  const inertia = clamp(
    settings.inertia ?? settings.momentum ?? 1 - fieldInfluence,
    0,
    1,
  )

  return {
    emitRate: clamp(settings.emitRate ?? settings.emit_rate, 0, 60),
    maxParticles: Math.round(
      clamp(
        settings.maxParticles ?? settings.max_particles,
        100,
        10000,
      ),
    ),
    minLife,
    maxLife,
    velocityScale: clamp(
      settings.velocityScale ??
        settings.velocity_scale ??
        DEFAULT_PARTICLE_SETTINGS.velocityScale,
      0,
      1000,
    ),
    turbulenceStrength: clamp(
      settings.turbulenceStrength ?? settings.turbulence_strength,
      0,
      0.02,
    ),
    turbulenceSmoothing: clamp(
      settings.turbulenceSmoothing ?? settings.turbulence_smoothing,
      0,
      1,
    ),
    initialVelocity: normalizeVector3(
      initialVelocitySource,
      DEFAULT_PARTICLE_SETTINGS.initialVelocity,
    ),
    fieldInfluence,
    inertia,
    pointSize: clamp(settings.pointSize ?? settings.point_size, 0.5, 12),
    trailLength: Math.round(
      clamp(settings.trailLength ?? settings.trail_length, 2, 120),
    ),
    showTrails: settings.showTrails ?? settings.show_trails ?? true,
    emitter: [0, 1, 2].map((index) =>
      normalizeNumber(emitterSource[index], DEFAULT_PARTICLE_SETTINGS.emitter[index]),
    ),
    useFieldSpawn: settings.useFieldSpawn ?? settings.use_field_spawn ?? !hasManualEmitter,
    color: settings.color || DEFAULT_PARTICLE_SETTINGS.color,
  }
}

function isFiniteBounds(bounds) {
  return (
    isFiniteVector3(bounds?.min) &&
    isFiniteVector3(bounds?.max) &&
    [0, 1, 2].every((index) => Number(bounds.max[index]) > Number(bounds.min[index]))
  )
}

/** 点发射时在发射点附近极小的盘内抖动，避免所有粒子同一像素；默认单点扩散观感 */
const POINT_SPAWN_DISK_RADIUS = 0.002
const POINT_SPAWN_Z_JITTER = 0.001

export function resolveParticleSpawnPosition(settings, field, randomFn = Math.random) {
  if (settings?.useFieldSpawn && isFiniteBounds(field?.bounds)) {
    return [0, 1, 2].map((index) => {
      const min = Number(field.bounds.min[index])
      const max = Number(field.bounds.max[index])
      return min + (max - min) * randomFn()
    })
  }

  const emitter = Array.isArray(settings?.emitter)
    ? settings.emitter
    : DEFAULT_PARTICLE_SETTINGS.emitter
  const [emitX, emitY, emitZ] = [0, 1, 2].map((index) =>
    normalizeNumber(emitter[index], DEFAULT_PARTICLE_SETTINGS.emitter[index]),
  )
  const angle = randomFn() * Math.PI * 2
  const radius = randomFn() * POINT_SPAWN_DISK_RADIUS
  return [
    emitX + Math.cos(angle) * radius,
    emitY + Math.sin(angle) * radius,
    emitZ + (randomFn() - 0.5) * POINT_SPAWN_Z_JITTER * 2,
  ]
}

function sampleAxis(value, origin, spacing, count) {
  const safeSpacing = Number(spacing) || 1
  const f = (Number(value) - Number(origin || 0)) / safeSpacing
  const lo = Math.max(0, Math.min(count - 2, Math.floor(f)))
  const hi = Math.min(count - 1, lo + 1)
  const t = Math.max(0, Math.min(1, f - lo))
  return { lo, hi, t }
}

export function sampleVelocityFromGrid(field, position) {
  if (!field?.vx || !field?.vy || !field?.vz) {
    return { vx: 0, vy: 0, vz: 0 }
  }
  const dims = field.dims || [0, 0, 0]
  const nx = Math.max(2, Number(dims[0]) || 2)
  const ny = Math.max(2, Number(dims[1]) || 2)
  const nz = Math.max(2, Number(dims[2]) || 2)
  const origin = field.origin || [0, 0, 0]
  const spacing = field.spacing || [1, 1, 1]
  const px = position?.[0] ?? 0
  const py = position?.[1] ?? 0
  const pz = position?.[2] ?? 0
  const sx = sampleAxis(px, origin[0], spacing[0], nx)
  const sy = sampleAxis(py, origin[1], spacing[1], ny)
  const sz = sampleAxis(pz, origin[2], spacing[2], nz)
  const index = (x, y, z) => x + nx * (y + ny * z)
  const lerp = (a, b, t) => a + (b - a) * t

  const sample = (array) => {
    const c000 = array[index(sx.lo, sy.lo, sz.lo)] ?? 0
    const c100 = array[index(sx.hi, sy.lo, sz.lo)] ?? c000
    const c010 = array[index(sx.lo, sy.hi, sz.lo)] ?? c000
    const c110 = array[index(sx.hi, sy.hi, sz.lo)] ?? c000
    const c001 = array[index(sx.lo, sy.lo, sz.hi)] ?? c000
    const c101 = array[index(sx.hi, sy.lo, sz.hi)] ?? c000
    const c011 = array[index(sx.lo, sy.hi, sz.hi)] ?? c000
    const c111 = array[index(sx.hi, sy.hi, sz.hi)] ?? c000
    return lerp(
      lerp(lerp(c000, c100, sx.t), lerp(c010, c110, sx.t), sy.t),
      lerp(lerp(c001, c101, sx.t), lerp(c011, c111, sx.t), sy.t),
      sz.t,
    )
  }

  return {
    vx: sample(field.vx),
    vy: sample(field.vy),
    vz: sample(field.vz),
  }
}

export function speedToParticleColor(speed) {
  const t = Math.max(0, Math.min(1, Number(speed) / 2))
  if (t < 0.5) {
    const s = t * 2
    return [0, s, 1 - s * 0.5]
  }
  const s = (t - 0.5) * 2
  return [s, 1, 0.5 - s * 0.5]
}
