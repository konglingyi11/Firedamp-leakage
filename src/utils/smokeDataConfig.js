/** @typedef {{ time: number, count?: number, size?: number, speed?: number, range?: number, swirl?: number, density?: number }} SmokeKeyframe */

export const DEFAULT_SMOKE_CONFIG = {
  version: 1,
  scene: {
    background: '#1a1a2e',
    fogDensity: 0.012,
    autoRotateSpeed: 0.3,
  },
  camera: {
    position: [0, 5, 28],
    target: [0, 4, 0],
    fov: 55,
  },
  emitter: {
    position: [0, -0.3, 0],
    radius: 2.5,
    heightJitter: 0.3,
  },
  particles: {
    count: 800,
    size: 2.5,
    speed: 0.35,
    range: 1.0,
    swirl: 1.2,
    density: 1.05,
    maxLifetime: 18,
  },
  color: {
    scatter: [0.42, 0.43, 0.45],
    absorb: [0.12, 0.13, 0.15],
    particle: [0.22, 0.23, 0.25],
  },
  playback: {
    loop: true,
    duration: null,
    autoplay: true,
  },
  layers: [],
  timeline: [],
}

const PARTICLE_KEYS = ['count', 'size', 'speed', 'range', 'swirl', 'density']

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function parseColorTriplet(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback]
  return value.slice(0, 3).map((v, i) => clampNumber(v, 0, 1, fallback[i]))
}

function parseVec3(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback]
  return value.slice(0, 3).map((v, i) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback[i]
  })
}

function normalizeSmokeLayer(layer, index) {
  if (!layer || typeof layer !== 'object') return null
  const scalar = String(layer.scalar || layer.variable || layer.slug || '').trim()
  const scalarUrl = String(layer.scalarUrl || layer.scalar_url || layer.url || '').trim()
  if (!scalar && !scalarUrl) return null
  return {
    id: String(layer.id || scalar || scalarUrl || `gas-${index}`),
    name: String(layer.name || layer.label || scalar || `气体 ${index + 1}`),
    scalar,
    scalarUrl,
    visible: layer.visible !== false,
    color: parseColorTriplet(layer.color, DEFAULT_SMOKE_CONFIG.color.particle),
    influence: clampNumber(layer.influence, 0, 8, 1),
    min: Number.isFinite(Number(layer.min)) ? Number(layer.min) : 0,
    max: Number.isFinite(Number(layer.max)) ? Number(layer.max) : 1,
    threshold: Number.isFinite(Number(layer.threshold)) ? Number(layer.threshold) : 0,
    maxParticles: Math.max(0, Math.round(Number(layer.maxParticles) || 0)),
  }
}

/**
 * 将外部 JSON / 对象归一化为烟雾配置
 */
export function normalizeSmokeConfig(raw = {}) {
  const base = structuredClone(DEFAULT_SMOKE_CONFIG)
  const src = raw && typeof raw === 'object' ? raw : {}

  if (src.scene && typeof src.scene === 'object') {
    if (typeof src.scene.background === 'string') {
      base.scene.background = src.scene.background
    }
    base.scene.fogDensity = clampNumber(
      src.scene.fogDensity,
      0,
      0.08,
      base.scene.fogDensity,
    )
    base.scene.autoRotateSpeed = clampNumber(
      src.scene.autoRotateSpeed,
      0,
      2,
      base.scene.autoRotateSpeed,
    )
  }

  if (src.camera && typeof src.camera === 'object') {
    base.camera.position = parseVec3(src.camera.position, base.camera.position)
    base.camera.target = parseVec3(src.camera.target, base.camera.target)
    base.camera.fov = clampNumber(src.camera.fov, 20, 100, base.camera.fov)
  }

  if (src.emitter && typeof src.emitter === 'object') {
    base.emitter.position = parseVec3(src.emitter.position, base.emitter.position)
    base.emitter.radius = clampNumber(src.emitter.radius, 0.1, 20, base.emitter.radius)
    base.emitter.heightJitter = clampNumber(
      src.emitter.heightJitter,
      0,
      5,
      base.emitter.heightJitter,
    )
  }

  if (src.particles && typeof src.particles === 'object') {
    const p = src.particles
    base.particles.count = Math.round(clampNumber(p.count, 100, 5000, base.particles.count))
    base.particles.size = clampNumber(p.size, 0.5, 12, base.particles.size)
    base.particles.speed = clampNumber(p.speed, 0.05, 3, base.particles.speed)
    base.particles.range = clampNumber(p.range, 0.1, 5, base.particles.range)
    base.particles.swirl = clampNumber(p.swirl, 0, 5, base.particles.swirl)
    base.particles.density = clampNumber(p.density, 0.1, 2, base.particles.density)
    base.particles.maxLifetime = clampNumber(
      p.maxLifetime,
      2,
      60,
      base.particles.maxLifetime,
    )
  }

  if (src.color && typeof src.color === 'object') {
    base.color.scatter = parseColorTriplet(src.color.scatter, base.color.scatter)
    base.color.absorb = parseColorTriplet(src.color.absorb, base.color.absorb)
    base.color.particle = parseColorTriplet(src.color.particle, base.color.particle)
  }

  if (src.playback && typeof src.playback === 'object') {
    base.playback.loop = src.playback.loop !== false
    base.playback.autoplay = src.playback.autoplay !== false
    const duration = Number(src.playback.duration)
    base.playback.duration = Number.isFinite(duration) && duration > 0 ? duration : null
  }

  const rawLayers = Array.isArray(src.layers)
    ? src.layers
    : Array.isArray(src.gases)
      ? src.gases
      : []
  base.layers = rawLayers
    .map((layer, index) => {
      if (typeof layer === 'string') {
        return normalizeSmokeLayer({ scalar: layer }, index)
      }
      return normalizeSmokeLayer(layer, index)
    })
    .filter(Boolean)

  if (Array.isArray(src.timeline)) {
    base.timeline = src.timeline
      .map((frame) => {
        const time = Number(frame?.time)
        if (!Number.isFinite(time) || time < 0) return null
        const out = { time }
        for (const key of PARTICLE_KEYS) {
          if (frame[key] != null) {
            out[key] = Number(frame[key])
          }
        }
        return out
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time)
  }

  return base
}

/**
 * 路由 query 覆盖配置（便于联调）
 * 支持: config, count, size, speed, range, swirl, density, time
 */
export function applySmokeQueryOverrides(config, query = {}) {
  const next = structuredClone(config)
  const p = next.particles

  if (query.count != null) p.count = Math.round(clampNumber(query.count, 100, 5000, p.count))
  if (query.size != null) p.size = clampNumber(query.size, 0.5, 12, p.size)
  if (query.speed != null) p.speed = clampNumber(query.speed, 0.05, 3, p.speed)
  if (query.range != null) p.range = clampNumber(query.range, 0.1, 5, p.range)
  if (query.swirl != null) p.swirl = clampNumber(query.swirl, 0, 5, p.swirl)
  if (query.density != null) p.density = clampNumber(query.density, 0.1, 2, p.density)

  return next
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpOptional(a, b, t) {
  if (a == null && b == null) return undefined
  if (a == null) return b
  if (b == null) return a
  return lerp(a, b, t)
}

/**
 * 按时间轴采样粒子参数（无 timeline 时返回 particles 静态段）
 */
export function sampleSmokeParticlesAtTime(config, timeSec = 0) {
  const base = { ...config.particles }
  const frames = config.timeline
  if (!frames?.length) return base

  const duration =
    config.playback.duration ??
    frames[frames.length - 1].time

  let t = timeSec
  if (config.playback.loop && duration > 0) {
    t = ((t % duration) + duration) % duration
  } else {
    t = Math.min(t, duration)
  }

  if (t <= frames[0].time) {
    return mergeParticleFrame(base, frames[0])
  }

  const last = frames[frames.length - 1]
  if (t >= last.time) {
    return mergeParticleFrame(base, last)
  }

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i]
    const b = frames[i + 1]
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time || 1
      const u = (t - a.time) / span
      const out = { ...base }
      for (const key of PARTICLE_KEYS) {
        const v = lerpOptional(a[key], b[key], u)
        if (v != null && Number.isFinite(v)) out[key] = v
      }
      return out
    }
  }

  return base
}

function mergeParticleFrame(base, frame) {
  const out = { ...base }
  for (const key of PARTICLE_KEYS) {
    if (frame[key] != null && Number.isFinite(Number(frame[key]))) {
      out[key] = Number(frame[key])
    }
  }
  return out
}

export function getSmokePlaybackDuration(config) {
  if (config.playback.duration > 0) return config.playback.duration
  const frames = config.timeline
  if (!frames?.length) return 0
  return frames[frames.length - 1].time
}

export function smokeConfigToRuntimeParams(config, particles) {
  return {
    size: particles.size,
    speed: particles.speed,
    range: particles.range,
    swirl: particles.swirl,
    density: particles.density,
    emitter: { ...config.emitter },
    color: { ...config.color },
    maxLifetime: particles.maxLifetime ?? config.particles.maxLifetime,
  }
}

export async function loadSmokeConfigFromUrl(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`加载烟雾配置失败: ${res.status} ${url}`)
  }
  const json = await res.json()
  return normalizeSmokeConfig(json)
}
