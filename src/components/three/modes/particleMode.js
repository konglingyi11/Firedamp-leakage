import * as THREE from 'three'
import {
  normalizeParticleSettings,
  resolveParticleAdvectedVelocity,
  resolveParticleEmitterFromField,
  resolveParticleInitialVelocity,
  resolveParticleSpawnPosition,
  sampleVelocityFromGrid,
  speedToParticleColor,
} from '@/utils/particleFlowCore'
import { randomLifetime, updateJitterVelocity } from '@/utils/particleJitter'

class FlowParticle {
  constructor(emitter, maxAge, trailLength) {
    this.position = new THREE.Vector3().fromArray(emitter)
    this.initialVelocity = new THREE.Vector3()
    this.velocity = new THREE.Vector3()
    this.age = maxAge
    this.maxAge = maxAge
    this.jitter = { x: 0, y: 0, z: 0 }
    this.trail = Array.from({ length: trailLength }, () =>
      new THREE.Vector3().fromArray(emitter),
    )
  }
}

function colorFromHex(value) {
  const color = new THREE.Color(value || '#22d3ff')
  return [color.r, color.g, color.b]
}

function fieldBoundsCenter(field) {
  const b = field?.bounds
  if (!b?.min || !b?.max) return null
  const min = b.min.map(Number)
  const max = b.max.map(Number)
  if (![0, 1, 2].every((i) => Number.isFinite(min[i]) && Number.isFinite(max[i])))
    return null
  if (![0, 1, 2].every((i) => max[i] > min[i])) return null
  return [0, 1, 2].map((i) => (min[i] + max[i]) * 0.5)
}

/**
 * 默认从单点发射（场网格中心或包围盒中心），便于观察扩散/轨迹；
 * 若在可视化里设置 useFieldSpawn / use_field_spawn 为 true，则恢复场内随机撒点。
 */
function resolveRuntimeSettings(rawSettings, field) {
  const normalized = normalizeParticleSettings(rawSettings)
  const hasManualEmitter =
    Array.isArray(rawSettings?.emitter) ||
    [rawSettings?.emitX, rawSettings?.emitY, rawSettings?.emitZ].some(
      (value) => value != null && Number(value) !== 0,
    )
  const userWantsVolumeSpawn =
    rawSettings?.useFieldSpawn === true || rawSettings?.use_field_spawn === true

  if (hasManualEmitter) {
    return normalized
  }

  const fieldEmitter = resolveParticleEmitterFromField(field)
  const emitter = Array.isArray(fieldEmitter) ? fieldEmitter : fieldBoundsCenter(field)

  if (Array.isArray(emitter)) {
    return {
      ...normalized,
      emitter,
      useFieldSpawn: userWantsVolumeSpawn,
    }
  }

  return normalized
}

function resolveInitialVelocity(field, position, settings) {
  const sampled = sampleVelocityFromGrid(field, position)
  const velocity = resolveParticleInitialVelocity(sampled, settings)
  return new THREE.Vector3(velocity.vx, velocity.vy, velocity.vz)
}

export function createParticleMode(options) {
  const {
    getDynamicGroup,
    getIsEnabled,
    getVisibleParticleLayers,
    getParticleSettings,
    requestVelocityField,
  } = options

  let particleSystem = null
  let velocityField = null
  let loadToken = 0
  let currentFieldKey = ''

  function disposeObject(object) {
    object?.removeFromParent?.()
    object?.geometry?.dispose?.()
    object?.material?.dispose?.()
  }

  function dispose() {
    if (particleSystem) {
      disposeObject(particleSystem.points)
      disposeObject(particleSystem.trails)
      particleSystem = null
    }
    velocityField = null
    currentFieldKey = ''
    const group = getDynamicGroup?.()
    if (group) {
      while (group.children.length) disposeObject(group.children[0])
    }
  }

  let resetLogCount = 0
  function resetParticle(particle, settings, field = null) {
    particle.position.fromArray(resolveParticleSpawnPosition(settings, field))
    particle.age = 0
    particle.maxAge = randomLifetime(settings.minLife, settings.maxLife)
    particle.initialVelocity.copy(
      resolveInitialVelocity(field, particle.position.toArray(), settings),
    )
    particle.velocity.copy(particle.initialVelocity)
    if (resetLogCount < 2) {
      console.log('[ParticleMode] reset particle', resetLogCount, 'pos:', particle.position.x.toFixed(1), particle.position.y.toFixed(1), particle.position.z.toFixed(1), 'vel:', particle.velocity.x.toFixed(2), particle.velocity.y.toFixed(2), particle.velocity.z.toFixed(2), 'field:', !!field)
      resetLogCount++
    }
    particle.jitter.x = 0
    particle.jitter.y = 0
    particle.jitter.z = 0
    for (const point of particle.trail) point.copy(particle.position)
  }

  function createSystem(settings) {
    const group = getDynamicGroup?.()
    if (!group) return null
    const maxParticles = settings.maxParticles
    const trailLength = settings.trailLength
    const particles = []
    const positions = new Float32Array(maxParticles * 3)
    const colors = new Float32Array(maxParticles * 3)
    const sizes = new Float32Array(maxParticles)
    const baseColor = colorFromHex(settings.color)

    for (let i = 0; i < maxParticles; i++) {
      const particle = new FlowParticle(
        settings.emitter,
        randomLifetime(settings.minLife, settings.maxLife),
        trailLength,
      )
      resetParticle(particle, settings, velocityField)
      particles.push(particle)
      positions.set(particle.position.toArray(), i * 3)
      colors.set(baseColor, i * 3)
      sizes[i] = settings.pointSize
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPointSize: { value: settings.pointSize } },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        uniform float uPointSize;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uPointSize * clamp(56.0 / max(-mvPosition.z, 0.1), 0.35, 16.0), 1.0, 32.0) * size / max(uPointSize, 0.1);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          float edge = smoothstep(1.0, 0.55, r2);
          float core = smoothstep(0.35, 0.0, r2);
          gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.45), (edge + core * 0.35) * 0.9);
        }
      `,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    points.renderOrder = 820
    group.add(points)

    const trailPositions = new Float32Array(maxParticles * trailLength * 3)
    const trailColors = new Float32Array(maxParticles * trailLength * 3)
    const trailGeo = new THREE.BufferGeometry()
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3))
    const trailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader:
        'attribute vec3 color; varying vec3 vColor; void main() { vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 0.28); }',
    })
    const trails = new THREE.LineSegments(trailGeo, trailMat)
    trails.frustumCulled = false
    trails.renderOrder = 810
    if (settings.showTrails) group.add(trails)

    return {
      points,
      trails,
      particles,
      positions,
      colors,
      sizes,
      trailPositions,
      trailColors,
      emitAccum: 0,
      settingsKey: JSON.stringify({
        maxParticles: settings.maxParticles,
        trailLength: settings.trailLength,
      }),
    }
  }

  function ensureSystem(settings) {
    const key = JSON.stringify({
      maxParticles: settings.maxParticles,
      trailLength: settings.trailLength,
    })
    if (particleSystem?.settingsKey === key) return
    dispose()
    particleSystem = createSystem(settings)
  }

  function resetAllParticles(settings, field) {
    if (!particleSystem) return
    for (const particle of particleSystem.particles) {
      resetParticle(particle, settings, field)
    }
  }

  async function sync() {
    const group = getDynamicGroup?.()
    if (!group) return
    const visibleLayers = getVisibleParticleLayers?.() || []
    group.visible = Boolean(getIsEnabled?.() && visibleLayers.length)
    if (!group.visible) {
      console.log('[ParticleMode] sync: not visible, disposing')
      dispose()
      return
    }
    console.log('[ParticleMode] sync: visible, layers:', visibleLayers.length, 'hasSystem:', !!particleSystem)

    const settings = resolveRuntimeSettings(getParticleSettings?.(), velocityField)
    ensureSystem(settings)
    const fieldKey = visibleLayers
      .map((layer) => `${layer.id}:${layer.time_step ?? ''}`)
      .join('|')
    if (currentFieldKey === fieldKey && velocityField) return
    currentFieldKey = fieldKey
    const token = ++loadToken
    try {
      const field = await requestVelocityField?.(visibleLayers[0])
      console.log('[ParticleMode] field loaded:', !!field, 'token ok:', token === loadToken, 'dims:', field?.dims)
      if (token !== loadToken) return
      velocityField = field || null
      if (velocityField) {
        const s = resolveRuntimeSettings(getParticleSettings?.(), velocityField)
        console.log('[ParticleMode] reset particles, emitter:', s.emitter, 'maxParticles:', s.maxParticles)
        resetAllParticles(s, velocityField)
      }
    } catch (error) {
      console.warn('[ParticleMode] velocity field load failed:', error)
      if (token === loadToken) velocityField = null
    }
  }

  function tick() {
    if (!getIsEnabled?.() || !particleSystem || !velocityField) {
      if (getIsEnabled?.() && !velocityField) console.log('[ParticleMode] tick: enabled but no velocityField')
      return
    }
    const settings = resolveRuntimeSettings(getParticleSettings?.(), velocityField)
    const ps = particleSystem
    const dt = 0.016 * settings.velocityScale
    ps.points.visible = true
    if (ps.trails.parent && !settings.showTrails) ps.trails.removeFromParent()
    if (!ps.trails.parent && settings.showTrails) getDynamicGroup?.()?.add(ps.trails)

    ps.emitAccum += settings.emitRate
    while (ps.emitAccum >= 1) {
      ps.emitAccum -= 1
      const dead = ps.particles.find((particle) => particle.age >= particle.maxAge)
      if (dead) resetParticle(dead, settings, velocityField)
    }

    for (let i = 0; i < ps.particles.length; i++) {
      const particle = ps.particles[i]
      const sampledVelocity = sampleVelocityFromGrid(
        velocityField,
        particle.position.toArray(),
      )
      const velocity = resolveParticleAdvectedVelocity(
        sampledVelocity,
        {
          vx: particle.velocity.x,
          vy: particle.velocity.y,
          vz: particle.velocity.z,
        },
        settings,
      )
      particle.velocity.set(velocity.vx, velocity.vy, velocity.vz)
      updateJitterVelocity(
        particle.jitter,
        settings.turbulenceStrength,
        settings.turbulenceSmoothing,
      )
      particle.position.x += (particle.velocity.x + particle.jitter.x) * dt
      particle.position.y += (particle.velocity.y + particle.jitter.y) * dt
      particle.position.z += (particle.velocity.z + particle.jitter.z) * dt
      particle.age += 1

      if (particle.age >= particle.maxAge) {
        resetParticle(particle, settings, velocityField)
      }

      for (let t = particle.trail.length - 1; t > 0; t--) {
        particle.trail[t].copy(particle.trail[t - 1])
      }
      particle.trail[0].copy(particle.position)

      ps.positions.set(particle.position.toArray(), i * 3)
      const speed = Math.hypot(
        particle.velocity.x + particle.jitter.x,
        particle.velocity.y + particle.jitter.y,
        particle.velocity.z + particle.jitter.z,
      )
      ps.colors.set(speedToParticleColor(speed), i * 3)
      const lifeRatio = 1 - particle.age / particle.maxAge
      ps.sizes[i] = settings.pointSize * Math.max(0.3, lifeRatio)
    }

    ps.points.geometry.attributes.position.needsUpdate = true
    ps.points.geometry.attributes.color.needsUpdate = true
    ps.points.geometry.attributes.size.needsUpdate = true
    ps.points.material.uniforms.uPointSize.value = settings.pointSize

    if (settings.showTrails) {
      let offset = 0
      for (let i = 0; i < ps.particles.length; i++) {
        const particle = ps.particles[i]
        for (let t = 0; t < particle.trail.length; t++) {
          const fade = 1 - t / particle.trail.length
          ps.trailPositions[offset] = particle.trail[t].x
          ps.trailColors[offset++] = ps.colors[i * 3] * fade
          ps.trailPositions[offset] = particle.trail[t].y
          ps.trailColors[offset++] = ps.colors[i * 3 + 1] * fade
          ps.trailPositions[offset] = particle.trail[t].z
          ps.trailColors[offset++] = ps.colors[i * 3 + 2] * fade
        }
      }
      ps.trails.geometry.attributes.position.needsUpdate = true
      ps.trails.geometry.attributes.color.needsUpdate = true
    }
  }

  return { sync, tick, dispose }
}
