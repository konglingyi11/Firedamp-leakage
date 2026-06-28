import * as THREE from 'three'

/**
 * 创建径向渐变贴图（圆形软边），让粒子不再是方块。
 * 多层径向渐变叠加，让边缘更柔和、核心更饱满。
 */
function createFlameSpriteTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2

  // 主渐变：核心亮、边缘缓慢衰减
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.2, 'rgba(255,255,255,0.92)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.8, 'rgba(255,255,255,0.18)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  // 叠加几个随机斑块，让贴图不完全对称，火焰更自然
  ctx.globalCompositeOperation = 'lighter'
  for (let b = 0; b < 4; b++) {
    const bx = cx + (Math.random() - 0.5) * size * 0.15
    const by = cx + (Math.random() - 0.5) * size * 0.15
    const br = size * (0.25 + Math.random() * 0.15)
    const pg = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    pg.addColorStop(0, 'rgba(255,255,255,0.3)')
    pg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = pg
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

let _flameSpriteTexture = null
function getFlameSpriteTexture() {
  if (!_flameSpriteTexture) _flameSpriteTexture = createFlameSpriteTexture()
  return _flameSpriteTexture
}

/**
 * 采空区瓦斯泄漏可视化用火焰效果。
 * 包含一个点光源和一团向上飘动的粒子，用于点火后的持续燃烧。
 * 粒子使用圆形软边贴图 + ShaderMaterial，颜色随生命周期从白→黄→橙→红渐变。
 */
export class FlameEffect {
  constructor(options = {}) {
    this.position = options.position?.clone?.() || new THREE.Vector3()
    this.color = new THREE.Color(options.color ?? '#ff6600')
    this.intensity = options.intensity ?? 1.5
    this.size = options.size ?? 2.5
    // 火焰蔓延：从点火点开始向外扩散的半径
    this.spreadRadius = options.spreadRadius ?? 0
    this.targetSpreadRadius = this.spreadRadius
    this.maxSpreadRadius = options.maxSpreadRadius ?? 8
    this.spreadSpeed = options.spreadSpeed ?? 1.5
    this.ignitedElapsed = 0

    this.group = new THREE.Group()
    this.group.position.copy(this.position)

    // 点光源
    this.light = new THREE.PointLight(this.color, this.intensity * 4, this.size * 8, 2)
    this.light.position.set(0, this.size * 0.3, 0)
    this.group.add(this.light)

    // 粒子火焰核
    this.count = Math.floor(options.count ?? 400)
    this.geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(this.count * 3)
    this.velocities = new Float32Array(this.count * 3)
    this.lifetimes = new Float32Array(this.count)
    this.ages = new Float32Array(this.count)
    this.sizes = new Float32Array(this.count)
    this._resetParticles(true)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))

    this.uniforms = {
      uTexture: { value: getFlameSpriteTexture() },
      uTime: { value: 0 },
    }

    const vertexShader = `
      attribute float size;
      uniform float uTime;
      varying float vAgeRatio;
      void main() {
        vAgeRatio = 1.0;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * (300.0 / -mvPosition.z);
      }
    `
    const fragmentShader = `
      uniform sampler2D uTexture;
      varying float vAgeRatio;
      void main() {
        vec2 uv = gl_PointCoord;
        vec4 tex = texture2D(uTexture, uv);
        // 从粒子中心到边缘的径向因子
        float d = length(uv - 0.5) * 2.0;
        // 颜色梯度：核心白黄 → 中部橙 → 外缘红 → 边缘透明
        vec3 core = vec3(1.0, 0.95, 0.7);
        vec3 mid = vec3(1.0, 0.55, 0.12);
        vec3 edge = vec3(0.85, 0.12, 0.02);
        vec3 color = mix(core, mid, smoothstep(0.0, 0.45, d));
        color = mix(color, edge, smoothstep(0.45, 0.85, d));
        // 边缘更慢衰减，让相邻粒子更容易重叠融合
        float alpha = tex.a * (1.0 - smoothstep(0.85, 1.0, d));
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.group.add(this.points)

    this.visible = false
    this.group.visible = false
  }

  addTo(scene) {
    if (scene && !this.group.parent) scene.add(this.group)
  }

  removeFrom(scene) {
    if (scene && this.group.parent === scene) scene.remove(this.group)
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z)
    this.group.position.copy(this.position)
  }

  setIntensity(v) {
    this.intensity = Math.max(0, v)
    this.light.intensity = this.intensity * 4
  }

  setVisible(v) {
    this.visible = v
    this.group.visible = v
    if (v) {
      this.ignitedElapsed = 0
      this.spreadRadius = 0
    }
  }

  setSpreadRadius(v) {
    this.targetSpreadRadius = Math.max(0, Math.min(this.maxSpreadRadius, v))
  }

  update(delta, elapsed) {
    if (!this.visible) return
    const dt = Math.max(0, Math.min(delta, 0.05))
    this.ignitedElapsed += dt
    // 火焰向目标蔓延半径平滑过渡
    const diff = this.targetSpreadRadius - this.spreadRadius
    if (Math.abs(diff) > 0.001) {
      this.spreadRadius += Math.sign(diff) * Math.min(Math.abs(diff), this.spreadSpeed * dt)
    }

    const jitter = Math.sin(elapsed * 10) * 0.08 + Math.cos(elapsed * 23) * 0.05
    this.light.intensity = (this.intensity * 4) * (0.85 + jitter)
    // 光源范围随蔓延扩大
    this.light.distance = this.size * 8 * (1 + this.spreadRadius / Math.max(1, this.maxSpreadRadius))

    for (let i = 0; i < this.count; i++) {
      this.ages[i] += dt
      if (this.ages[i] >= this.lifetimes[i]) {
        this._respawnParticle(i)
      }
      const idx = i * 3
      this.positions[idx] += this.velocities[idx] * dt
      this.positions[idx + 1] += this.velocities[idx + 1] * dt
      this.positions[idx + 2] += this.velocities[idx + 2] * dt
      // 热力上升加速（减弱，让粒子在火焰区停留更久）
      this.velocities[idx + 1] += (0.6 + jitter * 0.5) * dt
      // 水平速度衰减，让粒子聚拢成柱状
      this.velocities[idx] *= 1.0 - 0.5 * dt
      this.velocities[idx + 2] *= 1.0 - 0.5 * dt
      // 根据生命周期调整粒子大小：初期小、中期大、末期缓慢缩小
      const ageRatio = this.ages[i] / this.lifetimes[i]
      const sizeCurve = Math.sin(ageRatio * Math.PI) // 0→1→0
      // 越靠外的火焰粒子略大，形成蔓延感
      const spreadScale = 1 + this.spreadRadius / Math.max(1, this.maxSpreadRadius) * 0.6
      this.sizes[i] = this.size * 0.55 * (0.5 + sizeCurve * 0.9) * spreadScale
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.size.needsUpdate = true
    this.uniforms.uTime.value = elapsed
  }

  dispose() {
    this.geometry?.dispose()
    this.material?.dispose()
    this.light = null
    this.points = null
    this.group = null
  }

  _resetParticles(initial = false) {
    for (let i = 0; i < this.count; i++) {
      this._respawnParticle(i)
      if (initial) this.ages[i] = Math.random() * this.lifetimes[i]
    }
  }

  _respawnParticle(i) {
    const idx = i * 3
    // 火焰蔓延：粒子在 spreadRadius 范围内随机生成，形成向外扩散的火球/火区
    const effectiveSpread = Math.max(this.size * 0.22, this.spreadRadius)
    // 在球体内均匀分布：r^3 均匀，再开三次方根
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = effectiveSpread * Math.cbrt(Math.random())
    this.positions[idx] = r * Math.sin(phi) * Math.cos(theta)
    // Y 方向略偏上，模拟火焰向上蔓延的趋势
    this.positions[idx + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6 + (Math.random() - 0.5) * this.size * 0.15
    this.positions[idx + 2] = r * Math.cos(phi)
    // 降低初始速度，让粒子在火焰区停留更久
    const speed = 0.3 + Math.random() * 0.6
    const angle = Math.random() * Math.PI * 2
    const vr = Math.random() * 0.35
    this.velocities[idx] = vr * Math.cos(angle) * speed
    this.velocities[idx + 1] = (0.5 + Math.random() * 0.7) * speed
    this.velocities[idx + 2] = vr * Math.sin(angle) * speed
    // 延长寿命，让更多粒子同时存在；蔓延越大寿命略长
    this.lifetimes[i] = (0.7 + Math.random() * 0.6) * (1 + this.spreadRadius / Math.max(1, this.maxSpreadRadius) * 0.5)
    this.ages[i] = 0
    // 增大基础尺寸
    this.sizes[i] = this.size * 0.55
  }
}

/**
 * 采空区瓦斯泄漏可视化用爆炸效果。
 * 包含快速扩张的冲击波球面、闪光点光源和飞溅粒子。
 */
export class ExplosionEffect {
  constructor(options = {}) {
    this.position = options.position?.clone?.() || new THREE.Vector3()
    this.color = new THREE.Color(options.color ?? '#ffaa33')
    this.intensity = options.intensity ?? 1.2
    this.maxRadius = options.maxRadius ?? 12
    this.duration = options.duration ?? 1.2

    this.group = new THREE.Group()
    this.group.position.copy(this.position)

    // 闪光光源
    this.light = new THREE.PointLight(this.color, this.intensity * 20, this.maxRadius * 3, 2)
    this.group.add(this.light)

    // 冲击波球
    const geo = new THREE.SphereGeometry(1, 32, 32)
    const mat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.FrontSide,
    })
    this.shockwave = new THREE.Mesh(geo, mat)
    this.shockwave.scale.setScalar(0.01)
    this.shockwave.visible = false
    this.group.add(this.shockwave)

    // 飞溅粒子
    this.count = Math.floor(options.count ?? 200)
    this.particleGeo = new THREE.BufferGeometry()
    this.particlePos = new Float32Array(this.count * 3)
    this.particleVel = new Float32Array(this.count * 3)
    this.particleLife = new Float32Array(this.count)
    this.particleAge = new Float32Array(this.count)
    this._resetParticles(true)
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePos, 3))
    this.particleMat = new THREE.PointsMaterial({
      color: this.color,
      size: 0.25,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    this.particles = new THREE.Points(this.particleGeo, this.particleMat)
    this.particles.visible = false
    this.particles.frustumCulled = false
    this.group.add(this.particles)

    this.active = false
    this.elapsed = 0
    this.group.visible = false
  }

  addTo(scene) {
    if (scene && !this.group.parent) scene.add(this.group)
  }

  removeFrom(scene) {
    if (scene && this.group.parent === scene) scene.remove(this.group)
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z)
    this.group.position.copy(this.position)
  }

  trigger() {
    this.active = true
    this.elapsed = 0
    this.group.visible = true
    this.shockwave.visible = true
    this.particles.visible = true
    this.shockwave.scale.setScalar(0.01)
    this._resetParticles()
  }

  update(delta) {
    if (!this.active) return
    const dt = Math.max(0, Math.min(delta, 0.05))
    this.elapsed += dt
    const t = Math.min(1, this.elapsed / this.duration)
    const inv = 1 - t

    // 冲击波扩张并淡出
    const r = this.maxRadius * (0.05 + 0.95 * t)
    this.shockwave.scale.setScalar(r)
    this.shockwave.material.opacity = 0.35 * inv

    // 光源闪一下后快速衰减
    this.light.intensity = this.intensity * 20 * inv * inv

    // 粒子飞溅
    for (let i = 0; i < this.count; i++) {
      this.particleAge[i] += dt
      const idx = i * 3
      this.particlePos[idx] += this.particleVel[idx] * dt
      this.particlePos[idx + 1] += this.particleVel[idx + 1] * dt
      this.particlePos[idx + 2] += this.particleVel[idx + 2] * dt
      this.particleVel[idx + 1] -= 2.0 * dt // 重力
    }
    this.particleGeo.attributes.position.needsUpdate = true
    this.particleMat.opacity = inv

    if (t >= 1) {
      this.active = false
      this.group.visible = false
      this.shockwave.visible = false
      this.particles.visible = false
    }
  }

  dispose() {
    this.shockwave?.geometry?.dispose()
    this.shockwave?.material?.dispose()
    this.particleGeo?.dispose()
    this.particleMat?.dispose()
    this.light = null
    this.group = null
  }

  _resetParticles(initial = false) {
    for (let i = 0; i < this.count; i++) {
      const idx = i * 3
      this.particlePos[idx] = 0
      this.particlePos[idx + 1] = 0
      this.particlePos[idx + 2] = 0
      const speed = 4 + Math.random() * 8
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      this.particleVel[idx] = speed * Math.sin(phi) * Math.cos(theta)
      this.particleVel[idx + 1] = speed * Math.cos(phi)
      this.particleVel[idx + 2] = speed * Math.sin(phi) * Math.sin(theta)
      this.particleLife[i] = 0.5 + Math.random() * 0.6
      this.particleAge[i] = 0
    }
  }
}
