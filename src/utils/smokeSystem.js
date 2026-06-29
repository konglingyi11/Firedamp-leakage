import * as THREE from 'three'

function resolveUpAxis(runtimeParams) {
  const axis = runtimeParams?.upAxis
  if (Array.isArray(axis) && axis.length >= 3) {
    const v = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize()
    if (v.lengthSq() > 0.001) return v
  }
  if (axis instanceof THREE.Vector3) {
    return axis.clone().normalize()
  }
  return new THREE.Vector3(0, 1, 0)
}

function getUpAxisIndex(up) {
  const x = Math.abs(up.x)
  const y = Math.abs(up.y)
  const z = Math.abs(up.z)
  if (z >= x && z >= y) return 2
  if (x >= y && x >= z) return 0
  return 1
}

const DEFAULT_UP_NORMAL = new THREE.Vector3(0, 1, 0)

export function createSmokeTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2

  ctx.clearRect(0, 0, size, size)

  // 主渐变：核心透明度降低、边缘极缓慢衰减，让单个粒子更透明、重叠后才成雾
  const base = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  base.addColorStop(0, 'rgba(255,255,255,0.42)')
  base.addColorStop(0.3, 'rgba(255,255,255,0.32)')
  base.addColorStop(0.6, 'rgba(255,255,255,0.18)')
  base.addColorStop(0.85, 'rgba(255,255,255,0.06)')
  base.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  // 叠加更多随机软斑块，让贴图不规则、更像真实烟雾
  ctx.globalCompositeOperation = 'lighter'
  for (let b = 0; b < 28; b++) {
    const bx = cx + (Math.random() - 0.5) * size * 0.6
    const by = cx + (Math.random() - 0.5) * size * 0.6
    const br = size * (0.15 + Math.random() * 0.32)
    const alpha = 0.06 + Math.random() * 0.10
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`)
    grad.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.35})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function buildFragmentShader() {
  return `
      uniform sampler2D uTexture;
      uniform float uTime;
      uniform float uDensity;
      uniform vec3 uScatter;
      uniform vec3 uAbsorb;
      varying float vAge;
      varying float vLifetime;
      varying vec3 vColor;
      varying vec4 vRandom;
      varying float vAlpha;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float rotAngle = vRandom.w * 6.28318 + uTime * (0.08 + vRandom.x * 0.12);
        float c = cos(rotAngle);
        float s = sin(rotAngle);
        uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        uv += 0.5;

        vec4 texColor = texture2D(uTexture, uv);

        // 用随机值破坏规则圆形，让不同粒子边缘形状不同
        float d = length(uv - 0.5) * 2.0;
        float edge = 0.45 + vRandom.y * 0.4;
        float shape = 1.0 - smoothstep(edge * 0.5, edge, d);

        // 密度核心更透、边缘更软，整体 alpha 压低，靠重叠融合成雾
        float density = pow(texColor.a, 1.6) * shape;
        vec3 smokeColor = mix(uScatter, uAbsorb, density);
        smokeColor = mix(smokeColor, vColor, 0.35);
        // 降低亮度避免反光感
        smokeColor *= 0.78;
        float alpha = density * vAlpha * uDensity * 0.5;
        if (alpha < 0.001) discard;
        // 预乘 alpha，配合 One / OneMinusSrcAlpha 混合，边缘更自然
        gl_FragColor = vec4(smokeColor * alpha, alpha);
      }
    `
}

export class SmokeSystem {
  constructor(count, texture, scene, runtimeParams) {
    this.count = count
    this.texture = texture
    this.scene = scene
    this.params = runtimeParams
    this.upAxis = resolveUpAxis(runtimeParams)
    this.upAxisIndex = getUpAxisIndex(this.upAxis)
    this.maxLifetime = runtimeParams.maxLifetime ?? 18
    this.spawnDuration = runtimeParams.spawnDuration ?? 0
    this.firstUpdate = true // 首帧时根据真实 elapsed 重新分配 startTime
    this.collisionRaycaster = new THREE.Raycaster()
    this.collisionRaycaster.firstHitOnly = true
    this.prevPosition = new THREE.Vector3()
    this.nextPosition = new THREE.Vector3()
    this.rayDirection = new THREE.Vector3()
    this.hitNormal = new THREE.Vector3()
    this.normalMatrix = new THREE.Matrix3()
    this.velocityScratch = new THREE.Vector3()
    this.collisionSegmentBox = new THREE.Box3()
    this.collisionCandidateBox = new THREE.Box3()
    this.collisionCandidates = []
    this.frameIndex = 0
    this.collisionProbeDirections = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ]
    this.gridSeeds = Array.isArray(runtimeParams.scalarField?.gridSeeds)
      ? runtimeParams.scalarField.gridSeeds
      : null
    this.surfaceSeeds = Array.isArray(runtimeParams.emitter?.surfaceSeeds)
      ? runtimeParams.emitter.surfaceSeeds
      : null

    this.geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(count * 3)
    this.velocities = new Float32Array(count * 3)
    this.lifetimes = new Float32Array(count)
    this.startTimes = new Float32Array(count)
    this.sizes = new Float32Array(count)
    this.colors = new Float32Array(count * 3)
    this.randoms = new Float32Array(count * 4)

    for (let i = 0; i < count; i++) {
      // 先做一次 reset 设置位置/速度/尺寸等属性，startTime 暂设为 0
      this.resetParticle(i, false, 0)
      // 标记为"未出生"：firstUpdate 时会根据真实 elapsed 重新分配
      this.startTimes[i] = Infinity
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(this.velocities, 3))
    this.geometry.setAttribute('lifetime', new THREE.BufferAttribute(this.lifetimes, 1))
    this.geometry.setAttribute('startTime', new THREE.BufferAttribute(this.startTimes, 1))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.geometry.setAttribute('random', new THREE.BufferAttribute(this.randoms, 4))

    function toColor(value, fallback) {
      const arr = value ?? fallback
      if (Array.isArray(arr)) return new THREE.Color(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0)
      return new THREE.Color(arr)
    }

    this.baseColor = toColor(runtimeParams.color?.particle, [0.22, 0.24, 0.26])
    this.scatterColor = toColor(runtimeParams.color?.scatter, [0.72, 0.74, 0.76])
    this.absorbColor = toColor(runtimeParams.color?.absorb, [0.48, 0.5, 0.53])

    this.uniforms = {
      uTime: { value: 0.0 },
      uTexture: { value: texture },
      uDensity: { value: runtimeParams.density ?? 0.65 },
      uScatter: { value: this.scatterColor },
      uAbsorb: { value: this.absorbColor },
    }

    const vertexShader = `
      attribute float lifetime;
      attribute float startTime;
      attribute float size;
      attribute vec3 color;
      attribute vec4 random;
      uniform float uTime;
      varying float vAge;
      varying float vLifetime;
      varying vec3 vColor;
      varying vec4 vRandom;
      varying float vAlpha;

      void main() {
        vLifetime = lifetime;
        vAge = uTime - startTime;
        vColor = color;
        vRandom = random;
        float lifeRatio = clamp(vAge / lifetime, 0.0, 1.0);
        // 淡入基于绝对秒数（1.5 秒），不受 lifetime 影响；淡出仍按寿命比例
        vAlpha = smoothstep(0.0, 1.5, vAge)
               * (1.0 - smoothstep(0.7, 1.0, lifeRatio));
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // 尺寸：持续增长到寿命 70%，让粒子随扩散变大变淡融合成雾
        float sizeOverLife = size * mix(0.6, 3.2, smoothstep(0.0, 0.7, lifeRatio))
                             * (1.0 - smoothstep(0.95, 1.0, lifeRatio) * 0.3);
        gl_PointSize = sizeOverLife * (300.0 / -mvPosition.z);
      }
    `

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: buildFragmentShader(),
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      // 预乘 alpha + One/OneMinusSrcAlpha，避免 NormalBlending 产生的黑边/圆斑感
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    })

    this.mesh = new THREE.Points(this.geometry, this.material)
    this.scene.add(this.mesh)
  }

  resetParticle(i, initial, elapsed) {
    const p = this.params
    const emit = p.emitter ?? {}
    const surfaceSeed = this.surfaceSeeds?.length
      ? this.surfaceSeeds[i % this.surfaceSeeds.length]
      : null
    const emitAngle = Math.random() * Math.PI * 2
    const emitRadius = Math.random() * (emit.radius ?? 2.5) * p.range
    const ex = emit.position?.[0] ?? 0
    const ey = emit.position?.[1] ?? -0.3
    const ez = emit.position?.[2] ?? 0
    const jitter = emit.heightJitter ?? 0.3

    const gridSeed = this.gridSeeds?.length
      ? this.gridSeeds[i % this.gridSeeds.length]
      : null
    let px = surfaceSeed
      ? surfaceSeed.x
      : gridSeed
      ? gridSeed.x
      : ex + Math.cos(emitAngle) * emitRadius
    let py = surfaceSeed
      ? surfaceSeed.y
      : gridSeed
      ? gridSeed.y
      : ey + Math.random() * jitter
    let pz = surfaceSeed
      ? surfaceSeed.z
      : gridSeed
      ? gridSeed.z
      : ez + Math.sin(emitAngle) * emitRadius
    const scalarField = p.scalarField
    if (!gridSeed && scalarField?.sample) {
      let best = { x: px, y: py, z: pz, value: -Infinity }
      const attempts = Math.max(1, Math.round(Number(scalarField.emitAttempts) || 10))
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const angle = Math.random() * Math.PI * 2
        const radius = Math.sqrt(Math.random()) * (emit.radius ?? 2.5) * p.range
        const cx = ex + Math.cos(angle) * radius
        const cy = ey + Math.random() * jitter
        const cz = ez + Math.sin(angle) * radius
        const sampled = this.sampleScalarField(scalarField, cx, cy, cz)
        if (sampled > best.value) best = { x: cx, y: cy, z: cz, value: sampled }
      }
      px = best.x
      py = best.y
      pz = best.z
    }

    this.positions[i * 3] = px
    this.positions[i * 3 + 1] = py
    this.positions[i * 3 + 2] = pz

    // 提高初始上升速度，让瓦斯更快向上扩散
    const upwardSpeed = surfaceSeed
      ? (0.18 + Math.random() * 0.12) * p.speed
      : gridSeed
      ? (0.012 + Math.random() * 0.028) * p.speed
      : (0.18 + Math.random() * 0.12) * p.speed
    const spreadSpeed = surfaceSeed
      ? (0.04 + Math.random() * 0.05) * p.range
      : gridSeed
      ? (0.003 + Math.random() * 0.006) * p.range
      : (0.04 + Math.random() * 0.05) * p.range

    // upAxisIndex 指定世界坐标中的“向上”轴；其余两轴为水平面
    const upIdx = this.upAxisIndex
    const hIdx1 = (upIdx + 1) % 3
    const hIdx2 = (upIdx + 2) % 3

    const nx = surfaceSeed?.nx ?? 0
    const ny = surfaceSeed?.ny ?? 1
    const nz = surfaceSeed?.nz ?? 0
    if (surfaceSeed) {
      // ny 语义上代表“向上”分量，nx/nz 为水平分量；根据 upAxisIndex 写入对应轴
      const baseSpeed = upwardSpeed * (0.8 + Math.random() * 0.4)
      this.velocities[i * 3 + hIdx1] =
        nx * baseSpeed + (Math.random() - 0.5) * spreadSpeed
      this.velocities[i * 3 + upIdx] =
        ny * baseSpeed * 1.25 + (Math.random() - 0.5) * upwardSpeed * 0.2
      this.velocities[i * 3 + hIdx2] =
        nz * baseSpeed + (Math.random() - 0.5) * spreadSpeed
    } else {
      // 球面均匀向外扩散：随机三维方向 + 上升
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      this.velocities[i * 3 + hIdx1] =
        Math.sin(phi) * Math.cos(theta) * spreadSpeed
      this.velocities[i * 3 + upIdx] =
        upwardSpeed * 1.2 + Math.cos(phi) * spreadSpeed
      this.velocities[i * 3 + hIdx2] =
        Math.sin(phi) * Math.sin(theta) * spreadSpeed
    }

    this.lifetimes[i] = this.maxLifetime * (0.6 + Math.random() * 0.4)
    this.startTimes[i] = initial
      ? elapsed - Math.random() * this.lifetimes[i]
      : elapsed

    const seedValue = Math.max(0, Math.min(1, Number(gridSeed?.value) || 0))
    const roll = Math.random()
    if (roll > 0.8) {
      this.sizes[i] = (7.5 + Math.random() * 3.5) * p.size
    } else if (roll > 0.3) {
      this.sizes[i] = (5.0 + Math.random() * 3.0) * p.size
    } else {
      this.sizes[i] = (3.0 + Math.random() * 2.0) * p.size
    }
    if (gridSeed) {
      this.sizes[i] *= 0.65 + seedValue * 0.9
    }

    const pc = p.color?.particle ?? [0.58, 0.6, 0.63]
    const shade = 0.88 + Math.random() * 0.1
    this.colors[i * 3] = pc[0] * shade
    this.colors[i * 3 + 1] = pc[1] * shade
    this.colors[i * 3 + 2] = pc[2] * shade

    this.randoms[i * 4] = Math.random()
    this.randoms[i * 4 + 1] = Math.random()
    this.randoms[i * 4 + 2] = Math.random()
    this.randoms[i * 4 + 3] = Math.random()
  }

  setRuntimeParams(runtimeParams) {
    this.params = { ...this.params, ...runtimeParams }
    this.gridSeeds = Array.isArray(this.params.scalarField?.gridSeeds)
      ? this.params.scalarField.gridSeeds
      : null
    this.surfaceSeeds = Array.isArray(this.params.emitter?.surfaceSeeds)
      ? this.params.emitter.surfaceSeeds
      : null
    if (runtimeParams.upAxis != null) {
      this.upAxis = resolveUpAxis(this.params)
      this.upAxisIndex = getUpAxisIndex(this.upAxis)
    }
    if (runtimeParams.maxLifetime != null) {
      this.maxLifetime = runtimeParams.maxLifetime
    }
    if (runtimeParams.density != null) {
      this.uniforms.uDensity.value = runtimeParams.density
    }
  }

  /**
   * 运行时更新烟雾颜色，避免销毁重建整个粒子系统。
   * @param {string|THREE.Color|Array<number>} color 基础颜色
   */
  setColor(color) {
    const base = Array.isArray(color) ? new THREE.Color(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0) : new THREE.Color(color)
    this.baseColor.copy(base)
    this.scatterColor.setRGB(base.r * 0.9, base.g * 0.9, base.b * 0.9)
    this.absorbColor.setRGB(base.r * 0.35, base.g * 0.35, base.b * 0.35)
    this.uniforms.uScatter.value = this.scatterColor
    this.uniforms.uAbsorb.value = this.absorbColor

    // 保证后续 resetParticle 生成的新粒子也使用新颜色
    if (!this.params.color) this.params.color = {}
    this.params.color.particle = [base.r, base.g, base.b]
    this.params.color.scatter = [base.r * 0.9, base.g * 0.9, base.b * 0.9]
    this.params.color.absorb = [base.r * 0.35, base.g * 0.35, base.b * 0.35]

    const particle = [base.r, base.g, base.b]
    const count = this.count
    for (let i = 0; i < count; i++) {
      const shade = 0.88 + Math.random() * 0.1
      this.colors[i * 3] = particle[0] * shade
      this.colors[i * 3 + 1] = particle[1] * shade
      this.colors[i * 3 + 2] = particle[2] * shade
    }
    const colorAttr = this.geometry.getAttribute('color')
    if (colorAttr) colorAttr.needsUpdate = true
  }

  toFieldPosition(fieldParams, x, y, z) {
    const emit = this.params.emitter?.position ?? [0, -0.3, 0]
    const ex = emit[0] ?? 0
    const ey = emit[1] ?? -0.3
    const ez = emit[2] ?? 0
    const scale = Math.max(0.001, Number(fieldParams.worldScale) || 10)
    const world = [x, y, z]
    const emitter = [ex, ey, ez]
    const upIdx = this.upAxisIndex
    const hIdx1 = (upIdx + 1) % 3
    const hIdx2 = (upIdx + 2) % 3
    // 将世界坐标的“向上”轴映射到标量场/速度场的 y 轴
    return [
      (world[hIdx1] - emitter[hIdx1]) / scale,
      (world[upIdx] - emitter[upIdx]) / scale - 0.5,
      (world[hIdx2] - emitter[hIdx2]) / scale,
    ]
  }

  sampleScalarField(fieldParams, x, y, z) {
    const value = fieldParams.sample(this.toFieldPosition(fieldParams, x, y, z)).value
    const min = Number(fieldParams.min)
    const max = Number(fieldParams.max)
    const rangeMin = Number.isFinite(min) ? min : 0
    const rangeMax = Number.isFinite(max) && max > rangeMin ? max : 1
    return Math.max(0, Math.min(1, (value - rangeMin) / (rangeMax - rangeMin)))
  }

  getCollisionCandidates(collision, previous, next, radius) {
    const entries = Array.isArray(collision?.entries) ? collision.entries : []
    const meshes = Array.isArray(collision?.meshes) ? collision.meshes : []
    if (!entries.length) return meshes

    const candidates = this.collisionCandidates
    candidates.length = 0
    this.collisionSegmentBox.makeEmpty()
    this.collisionSegmentBox.expandByPoint(previous)
    this.collisionSegmentBox.expandByPoint(next)
    this.collisionSegmentBox.expandByScalar(Math.max(radius * 2.5, 0.05))

    for (const entry of entries) {
      const box = entry?.box
      const mesh = entry?.mesh
      if (!mesh || !box) continue
      this.collisionCandidateBox.copy(box).expandByScalar(radius)
      if (this.collisionCandidateBox.intersectsBox(this.collisionSegmentBox)) {
        candidates.push(mesh)
      }
    }

    const maxCandidates = Math.max(
      1,
      Math.round(Number(collision?.maxCandidates) || 4),
    )
    if (candidates.length > maxCandidates) {
      candidates.length = maxCandidates
    }
    return candidates
  }

  resolveCollision(previous, next, velocity, delta) {
    const collision = this.params.collision
    const radius = Math.max(0.001, Number(collision?.radius) || 0.03)
    const meshes = this.getCollisionCandidates(
      collision,
      previous,
      next,
      radius,
    )
    if (!meshes.length) return false

    this.rayDirection.subVectors(next, previous)
    const distance = this.rayDirection.length()
    if (distance <= 1e-6) return false
    this.rayDirection.divideScalar(distance)

    this.collisionRaycaster.set(previous, this.rayDirection)
    this.collisionRaycaster.near = 0
    this.collisionRaycaster.far = distance + radius
    let hit = this.collisionRaycaster.intersectObjects(meshes, true)[0]

    // 仅在 proximity 开启时做 6 方向探测（默认关闭以节省性能）
    if (!hit && collision.proximity === true) {
      const probeDistance = Math.max(radius * 2.5, Number(collision.probeDistance) || 0.08)
      this.collisionRaycaster.far = probeDistance
      for (const direction of this.collisionProbeDirections) {
        this.collisionRaycaster.set(next, direction)
        hit = this.collisionRaycaster.intersectObjects(meshes, true)[0]
        if (hit) break
      }
    }
    const restitution = Math.max(0, Math.min(1, Number(collision.restitution) ?? 0.18))
    const slide = Math.max(0, Math.min(1, Number(collision.slide) ?? 0.72))

    if (!hit) {
      // 射线未命中时仍做“点在包围盒内”兜底：防止薄煤层/土层在帧间隔内被穿透
      for (const mesh of meshes) {
        const box = mesh.userData?.collisionBox
        if (box && !box.isEmpty()) {
          this.collisionCandidateBox.copy(box)
        } else {
          this.collisionCandidateBox.setFromObject(mesh)
        }
        if (this.collisionCandidateBox.containsPoint(next)) {
          const center = new THREE.Vector3()
          this.collisionCandidateBox.getCenter(center)
          const dx = Math.min(next.x - this.collisionCandidateBox.min.x, this.collisionCandidateBox.max.x - next.x)
          const dy = Math.min(next.y - this.collisionCandidateBox.min.y, this.collisionCandidateBox.max.y - next.y)
          const dz = Math.min(next.z - this.collisionCandidateBox.min.z, this.collisionCandidateBox.max.z - next.z)
          let push = dx
          this.hitNormal.set(next.x >= center.x ? 1 : -1, 0, 0)
          if (dy < push) {
            push = dy
            this.hitNormal.set(0, next.y >= center.y ? 1 : -1, 0)
          }
          if (dz < push) {
            push = dz
            this.hitNormal.set(0, 0, next.z >= center.z ? 1 : -1)
          }
          next.addScaledVector(this.hitNormal, push + radius)
          const normalSpeed = velocity.dot(this.hitNormal)
          if (normalSpeed < 0) {
            const bounce = collision.blockNormalVelocity ? 1 : 1 + restitution
            velocity.addScaledVector(this.hitNormal, -bounce * normalSpeed)
          }
          velocity.multiplyScalar(slide)
          next.addScaledVector(velocity, Math.max(0, delta) * 0.25)
          return true
        }
      }
      return false
    }

    this.hitNormal.copy(hit.face?.normal || DEFAULT_UP_NORMAL)
    this.normalMatrix.getNormalMatrix(hit.object.matrixWorld)
    this.hitNormal.applyNormalMatrix(this.normalMatrix).normalize()
    if (this.hitNormal.dot(this.rayDirection) > 0) {
      this.hitNormal.multiplyScalar(-1)
    }

    const normalSpeed = velocity.dot(this.hitNormal)
    if (normalSpeed < 0) {
      const bounce = collision.blockNormalVelocity ? 1 : 1 + restitution
      velocity.addScaledVector(this.hitNormal, -bounce * normalSpeed)
    }
    velocity.multiplyScalar(slide)
    next.copy(hit.point).addScaledVector(this.hitNormal, radius)
    next.addScaledVector(velocity, Math.max(0, delta) * 0.25)
    return true
  }

  update(elapsed, delta) {
    if (this.uniforms?.uTime) this.uniforms.uTime.value = elapsed
    let needsReset = false
    const p = this.params
    const pc = p.color?.particle ?? [0.58, 0.6, 0.63]
    const collision = p.collision
    const collisionMeshes = Array.isArray(collision?.meshes)
      ? collision.meshes
      : []
    const collisionStride = Math.max(
      1,
      Math.round(Number(collision?.stride) || 6),
    )
    const hasCollision = collisionMeshes.length > 0
    const velocityField = p.velocityField
    // 烟雾活动边界：超出此范围的粒子会被重生，让烟雾在模型包围盒尽头消失
    const bounds = p.bounds || null
    const boundsMargin = Number(p.boundsMargin) || 0.5
    const velocitySampleStride = Math.max(
      1,
      Math.round(Number(velocityField?.stride) || 2),
    )

    // 首帧：根据真实 elapsed 重新分配所有粒子的 startTime
    // 让粒子在 spawnDuration 内从当前时刻起逐步诞生
    if (this.firstUpdate) {
      this.firstUpdate = false
      const sd = this.spawnDuration > 0 ? this.spawnDuration : 0
      for (let i = 0; i < this.count; i++) {
        this.startTimes[i] = elapsed + (i / this.count) * sd
      }
      this.geometry.attributes.startTime.needsUpdate = true
    }

    for (let i = 0; i < this.count; i++) {
      let age = elapsed - this.startTimes[i]
      const lifetime = this.lifetimes[i]

      // 未出生的粒子跳过物理更新（startTime 在未来）
      if (age < 0) continue

      if (age > lifetime) {
        this.resetParticle(i, false, elapsed)
        needsReset = true
        age = 0
      }

      const t = age / lifetime
      const upIdx = this.upAxisIndex
      const hIdx1 = (upIdx + 1) % 3
      const hIdx2 = (upIdx + 2) % 3
      const pUp = i * 3 + upIdx
      const pH1 = i * 3 + hIdx1
      const pH2 = i * 3 + hIdx2
      const vUp = i * 3 + upIdx
      const vH1 = i * 3 + hIdx1
      const vH2 = i * 3 + hIdx2
      const currentUp = this.positions[pUp]

      const brownian = 0.02 * p.swirl
      this.velocities[pH1] += (Math.random() - 0.5) * brownian * delta
      this.velocities[pH2] += (Math.random() - 0.5) * brownian * delta
      this.velocities[pUp] += (Math.random() - 0.5) * brownian * delta

      // 三维漩涡切向力：让烟雾在三个轴向上都有旋转扩散
      const swirlStrength = 0.02 * p.swirl * (1.0 - t * 0.5)
      const d1 = this.positions[pH1]
      const d2 = this.positions[pH2]
      const du = this.positions[pUp]
      const dist = Math.sqrt(d1 * d1 + d2 * d2 + du * du) + 0.1
      // 绕“向上”轴的水平涡流
      this.velocities[pH1] += (-d2 / dist) * swirlStrength * delta
      this.velocities[pH2] += (d1 / dist) * swirlStrength * delta
      // 附加的竖直涡流分量
      this.velocities[pH1] += (-du / dist) * swirlStrength * 0.6 * delta
      this.velocities[pUp] += ((d1 - d2) / dist) * swirlStrength * 0.6 * delta
      this.velocities[pH2] += (du / dist) * swirlStrength * 0.6 * delta
      // 径向向外扩散力：适度水平蔓延，同时避免过度分散，利于顶部积聚
      const radialStrength = 0.012 * p.range * (1.0 - t * 0.3)
      this.velocities[pH1] += (d1 / dist) * radialStrength * delta
      this.velocities[pH2] += (d2 / dist) * radialStrength * delta
      // 浮力：沿 upAxis 明显上升，让瓦斯在上部快速积聚
      // 随高度增加浮力，顶部积聚效果更显著
      const emitterUp = (p.emitter?.position?.[upIdx] ?? 0)
      const heightFactor = 1.0 + Math.max(0.0, currentUp - emitterUp) * 0.25
      // 浮力系数：进一步降低整体上升速度
      const buoyancy = 0.01 * (p.speed || 0.2) * heightFactor * (1.0 - t * 0.3)
      this.velocities[vUp] += buoyancy * delta

      const swayH1 = Math.sin(elapsed * 0.2 + i * 0.13) * 0.003 * p.swirl
      const swayH2 = Math.cos(elapsed * 0.15 + i * 0.19) * 0.003 * p.swirl

      if (
        velocityField?.sample &&
        (i + this.frameIndex) % velocitySampleStride === 0
      ) {
        const sample = velocityField.sample(this.toFieldPosition(
          velocityField,
          this.positions[i * 3],
          this.positions[i * 3 + 1],
          this.positions[i * 3 + 2],
        ))
        const strength = Number(velocityField.strength) || 0
        if ((Number(sample.speed) || 0) > 1e-12) {
          // 速度场 vy 语义为“向上”分量，根据 upAxisIndex 写入对应轴
          this.velocities[vH1] += sample.vx * strength * delta
          this.velocities[vUp] += sample.vy * strength * delta
          this.velocities[vH2] += sample.vz * strength * delta
        }
      }

      this.prevPosition.set(
        this.positions[i * 3],
        this.positions[i * 3 + 1],
        this.positions[i * 3 + 2],
      )
      const nextH1 = this.positions[pH1] + this.velocities[vH1] * delta + swayH1
      const nextH2 = this.positions[pH2] + this.velocities[vH2] * delta + swayH2
      const nextUp = this.positions[pUp] + this.velocities[vUp] * delta
      const nextArr = [0, 0, 0]
      nextArr[hIdx1] = nextH1
      nextArr[hIdx2] = nextH2
      nextArr[upIdx] = nextUp
      this.nextPosition.set(nextArr[0], nextArr[1], nextArr[2])

      const shouldResolveCollision =
        hasCollision && (i + this.frameIndex) % collisionStride === 0
      if (shouldResolveCollision) {
        this.velocityScratch.set(
          this.velocities[i * 3],
          this.velocities[i * 3 + 1],
          this.velocities[i * 3 + 2],
        )
        this.resolveCollision(
          this.prevPosition,
          this.nextPosition,
          this.velocityScratch,
          delta,
        )
        this.velocities[i * 3] = this.velocityScratch.x
        this.velocities[i * 3 + 1] = this.velocityScratch.y
        this.velocities[i * 3 + 2] = this.velocityScratch.z
      }
      this.positions[i * 3] = this.nextPosition.x
      this.positions[i * 3 + 1] = this.nextPosition.y
      this.positions[i * 3 + 2] = this.nextPosition.z

      // 边界检测：粒子超出模型包围盒（带余量）则重生，让烟雾在尽头消失
      if (bounds) {
        const pArr = [
          this.positions[i * 3],
          this.positions[i * 3 + 1],
          this.positions[i * 3 + 2],
        ]
        const pUpAxis = pArr[upIdx]
        const pH1Axis = pArr[hIdx1]
        const pH2Axis = pArr[hIdx2]
        const bMin = [bounds.min.x, bounds.min.y, bounds.min.z]
        const bMax = [bounds.max.x, bounds.max.y, bounds.max.z]
        if (pH1Axis < bMin[hIdx1] - boundsMargin || pH1Axis > bMax[hIdx1] + boundsMargin ||
            pH2Axis < bMin[hIdx2] - boundsMargin || pH2Axis > bMax[hIdx2] + boundsMargin ||
            pUpAxis < bMin[upIdx] - boundsMargin || pUpAxis > bMax[upIdx] + boundsMargin) {
          this.resetParticle(i, false, elapsed)
          needsReset = true
          continue
        }
      }

      // 基于到原点距离的三维扩散扰动，让远处粒子继续向外蔓延
      const distFromOrigin = Math.sqrt(
        this.positions[i * 3] * this.positions[i * 3] +
        this.positions[i * 3 + 1] * this.positions[i * 3 + 1] +
        this.positions[i * 3 + 2] * this.positions[i * 3 + 2],
      )
      if (distFromOrigin > 0.3) {
        const distFactor = Math.min(1, distFromOrigin / (4.0 * p.range))
        const spread = 0.012 * distFactor
        this.velocities[vH1] += (Math.random() - 0.5) * spread * delta
        this.velocities[vH2] += (Math.random() - 0.5) * spread * delta
        this.velocities[vUp] += (Math.random() - 0.5) * spread * delta
        // 阻尼让粒子不会无限加速
        this.velocities[vUp] *= 1.0 - 0.005 * delta
      }

      const growthFactor = 1.0 + (0.03 + distFromOrigin * 0.02) * delta
      this.sizes[i] = Math.min(this.sizes[i] * growthFactor, 12.0 * p.size)

      if (distFromOrigin > 0.5) {
        const hr = Math.min(1, distFromOrigin / (4.0 * p.range))
        const newShade = Math.max(0.82, 0.95 - hr * 0.12)
        this.colors[i * 3] = pc[0] * newShade
        this.colors[i * 3 + 1] = pc[1] * newShade
        this.colors[i * 3 + 2] = pc[2] * newShade
      }

      const scalarField = p.scalarField
      if (scalarField?.sample) {
        const gas = this.sampleScalarField(
          scalarField,
          this.positions[i * 3],
          this.positions[i * 3 + 1],
          this.positions[i * 3 + 2],
        )
        const influence = Number(scalarField.influence) || 1
        const tint = scalarField.color ?? pc
        const mixAmount = Math.min(1, gas * influence)
        this.colors[i * 3] = this.colors[i * 3] * (1 - mixAmount) + tint[0] * mixAmount
        this.colors[i * 3 + 1] = this.colors[i * 3 + 1] * (1 - mixAmount) + tint[1] * mixAmount
        this.colors[i * 3 + 2] = this.colors[i * 3 + 2] * (1 - mixAmount) + tint[2] * mixAmount
        this.sizes[i] *= 1 + gas * 0.08 * influence * delta
      }
    }
    this.frameIndex = (this.frameIndex + 1) % collisionStride

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.velocity.needsUpdate = true
    this.geometry.attributes.size.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
    if (needsReset) {
      this.geometry.attributes.lifetime.needsUpdate = true
      this.geometry.attributes.startTime.needsUpdate = true
      this.geometry.attributes.random.needsUpdate = true
    }
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    if (this.mesh?.parent) {
      this.mesh.parent.remove(this.mesh)
    }
  }
}
