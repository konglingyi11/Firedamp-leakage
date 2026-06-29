import * as THREE from 'three'

/**
 * 创建火焰形态贴图（泪滴/不规则火舌），让粒子更像真实火焰。
 * 核心白热、中部橙黄、边缘暗红衰减，并叠加湍流细节。
 */
function createFlameSpriteTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2
  const cy = size * 0.68

  ctx.clearRect(0, 0, size, size)

  // 主渐变：底部亮、顶部暗，模拟火焰自下而上燃烧
  const grad = ctx.createRadialGradient(cx, cy + size * 0.12, 0, cx, cy, size * 0.55)
  grad.addColorStop(0, 'rgba(255,255,255,0.98)')
  grad.addColorStop(0.12, 'rgba(255,250,180,0.92)')
  grad.addColorStop(0.28, 'rgba(255,200,70,0.78)')
  grad.addColorStop(0.5, 'rgba(255,120,30,0.48)')
  grad.addColorStop(0.75, 'rgba(180,50,15,0.18)')
  grad.addColorStop(1, 'rgba(60,10,5,0)')

  // 泪滴形火焰轮廓
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(cx, size * 0.95)
  ctx.bezierCurveTo(size * 0.12, size * 0.72, size * 0.08, size * 0.22, cx, size * 0.04)
  ctx.bezierCurveTo(size * 0.92, size * 0.22, size * 0.88, size * 0.72, cx, size * 0.95)
  ctx.fill()

  // 叠加随机火舌/湍流斑块，让贴图不完全对称
  ctx.globalCompositeOperation = 'lighter'
  for (let b = 0; b < 10; b++) {
    const bx = cx + (Math.random() - 0.5) * size * 0.45
    const by = size * 0.2 + Math.random() * size * 0.65
    const br = size * (0.1 + Math.random() * 0.22)
    const a = 0.15 + Math.random() * 0.22
    const pg = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    pg.addColorStop(0, `rgba(255,190,70,${a})`)
    pg.addColorStop(1, 'rgba(255,60,20,0)')
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
    this.light = new THREE.PointLight(this.color, this.intensity * 8, this.size * 12, 2)
    this.light.position.set(0, this.size * 0.3, 0)
    this.group.add(this.light)

    // 粒子火焰核
    this.count = Math.floor(options.count ?? 1600)
    this.geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(this.count * 3)
    this.velocities = new Float32Array(this.count * 3)
    this.lifetimes = new Float32Array(this.count)
    this.ages = new Float32Array(this.count)
    this.sizes = new Float32Array(this.count)
    // 先设置 attribute，再重置粒子，避免 _respawnParticle 访问未初始化的 attribute
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('ageRatio', new THREE.BufferAttribute(new Float32Array(this.count), 1))
    this.geometry.setAttribute('heightRatio', new THREE.BufferAttribute(new Float32Array(this.count), 1))
    this._resetParticles(true)

    this.uniforms = {
      uTexture: { value: getFlameSpriteTexture() },
      uTime: { value: 0 },
    }

    const vertexShader = `
      attribute float size;
      attribute float ageRatio;
      attribute float heightRatio;
      uniform float uTime;
      varying float vAgeRatio;
      varying float vHeightRatio;
      void main() {
        vAgeRatio = ageRatio;
        vHeightRatio = heightRatio;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // 加大粒子尺寸，让火焰粒子充分重叠成连续火团
        gl_PointSize = size * (460.0 / -mvPosition.z);
      }
    `
    const fragmentShader = `
      uniform sampler2D uTexture;
      varying float vAgeRatio;
      varying float vHeightRatio;
      void main() {
        vec2 uv = gl_PointCoord;
        vec4 tex = texture2D(uTexture, uv);
        float d = length(uv - 0.5) * 2.0;

        // 底部年轻粒子：白黄核心 → 橙 → 红边缘
        // 顶部/老年粒子：更红、更暗、更透明，像烟
        float lifeFade = 1.0 - smoothstep(0.82, 1.0, vAgeRatio);
        float heightFade = 1.0 - smoothstep(0.8, 1.0, vHeightRatio);

        vec3 core = vec3(1.0, 0.96, 0.72);
        vec3 mid = vec3(1.0, 0.5, 0.06);
        vec3 edge = vec3(0.85, 0.12, 0.02);
        vec3 smoke = vec3(0.15, 0.12, 0.10);

        vec3 color = mix(core, mid, smoothstep(0.0, 0.5, d));
        color = mix(color, edge, smoothstep(0.5, 0.92, d));
        // 越老、越高，越向烟色过渡
        color = mix(color, smoke, (1.0 - lifeFade * 0.7) * (1.0 - heightFade * 0.6));

        // 径向 alpha：贴图 alpha 平滑衰减，让粒子边缘重叠融合成连续火团
        float alpha = tex.a * (1.0 - smoothstep(0.75, 1.0, d));
        alpha *= lifeFade * (0.85 + 0.15 * heightFade);
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // AdditiveBlending 让火焰更像发光体，重叠处更亮
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

  /**
   * 设置碰撞体网格列表，让火焰粒子不穿模。
   * 使用包围盒代理检测：粒子世界坐标进入任何碰撞体包围盒时立即重生。
   * @param {THREE.Mesh[]} meshes
   */
  setCollision(meshes) {
    this.collisionMeshes = Array.isArray(meshes) ? meshes : []
    this.collisionBoxes = this.collisionMeshes.map((m) => {
      m.updateMatrixWorld(true)
      return new THREE.Box3().setFromObject(m)
    })
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

    const jitter = Math.sin(elapsed * 8) * 0.1 + Math.cos(elapsed * 17) * 0.06
    this.light.intensity = (this.intensity * 4) * (0.85 + jitter)
    // 光源范围随蔓延扩大
    this.light.distance = this.size * 10 * (1 + this.spreadRadius / Math.max(1, this.maxSpreadRadius))

    const ageRatioAttr = this.geometry.attributes.ageRatio
    const heightRatioAttr = this.geometry.attributes.heightRatio
    const hasCollision = this.collisionBoxes && this.collisionBoxes.length > 0
    // group 的世界变换，用于把局部粒子坐标转世界坐标做碰撞检测
    const groupWorldPos = this.group.getWorldPosition(new THREE.Vector3())

    for (let i = 0; i < this.count; i++) {
      this.ages[i] += dt
      if (this.ages[i] >= this.lifetimes[i]) {
        this._respawnParticle(i)
      }
      const idx = i * 3
      const x = this.positions[idx]
      const y = this.positions[idx + 1]
      const z = this.positions[idx + 2]

      // 湍流：随高度和时间产生水平漂移，让火焰柱扭曲、更像真实火焰
      const turbulence = 0.25 + this.spreadRadius / Math.max(1, this.maxSpreadRadius) * 0.35
      this.velocities[idx] += (Math.sin(y * 2.5 + elapsed * 4 + i) * turbulence) * dt
      this.velocities[idx + 2] += (Math.cos(y * 2.1 + elapsed * 3.2 + i * 0.7) * turbulence) * dt

      this.positions[idx] += this.velocities[idx] * dt
      this.positions[idx + 1] += this.velocities[idx + 1] * dt
      this.positions[idx + 2] += this.velocities[idx + 2] * dt

      // 持续热力上升，但顶部减速，让粒子在顶部停留成烟
      const buoyancy = 0.45 + jitter * 0.25
      this.velocities[idx + 1] += buoyancy * dt
      // 水平速度阻尼降低，让粒子更容易横向扩散到边界
      this.velocities[idx] *= 1.0 - 0.25 * dt
      this.velocities[idx + 2] *= 1.0 - 0.25 * dt

      // 碰撞检测：粒子世界坐标进入碰撞体包围盒则重生该粒子
      if (hasCollision) {
        const wx = this.positions[idx] + groupWorldPos.x
        const wy = this.positions[idx + 1] + groupWorldPos.y
        const wz = this.positions[idx + 2] + groupWorldPos.z
        for (const box of this.collisionBoxes) {
          if (wx >= box.min.x && wx <= box.max.x &&
              wy >= box.min.y && wy <= box.max.y &&
              wz >= box.min.z && wz <= box.max.z) {
            this._respawnParticle(i)
            break
          }
        }
      }

      const ageRatio = Math.min(1, this.ages[i] / this.lifetimes[i])
      // 火焰高度随最大蔓延半径增长，避免大半径时粒子过早变烟
      const flameHeight = this.size * 3.5 + this.maxSpreadRadius * 0.35
      const heightRatio = Math.min(1, Math.max(0, y / flameHeight))

      ageRatioAttr.array[i] = ageRatio
      heightRatioAttr.array[i] = heightRatio

      // 大小：底部出生略小，中部最大，顶部如烟变大但变淡
      const sizeCurve = Math.sin(ageRatio * Math.PI) // 0→1→0
      const spreadScale = 1 + this.spreadRadius / Math.max(1, this.maxSpreadRadius) * 0.7
      const heightScale = 1 + heightRatio * 0.5
      // 放大基础尺寸让粒子充分重叠，融合成连续火团而非离散粒子
      this.sizes[i] = this.size * 1.1 * (0.5 + sizeCurve * 1.3) * spreadScale * heightScale
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.size.needsUpdate = true
    ageRatioAttr.needsUpdate = true
    heightRatioAttr.needsUpdate = true
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
      if (initial) {
        this.ages[i] = Math.random() * this.lifetimes[i]
        // 让初始粒子分布到一定高度，避免第一帧全部挤在底部
        const flameHeight = this.size * 3.5 + this.maxSpreadRadius * 0.35
        const y = this.positions[i * 3 + 1]
        this.geometry.attributes.heightRatio.array[i] = Math.min(1, Math.max(0, y / flameHeight))
      }
    }
  }

  _respawnParticle(i) {
    const idx = i * 3
    // 火焰蔓延：粒子在底部圆盘内生成，随上升向外扩散，形成柱状火区
    const effectiveSpread = Math.max(this.size * 0.18, this.spreadRadius * 0.85)
    const theta = Math.random() * Math.PI * 2
    // 圆盘内均匀分布：r^2 均匀，再开平方根
    const r = effectiveSpread * Math.sqrt(Math.random())
    this.positions[idx] = r * Math.cos(theta)
    // 底部略低，让火焰从地面/煤块表面升起
    this.positions[idx + 1] = (Math.random() - 0.5) * this.size * 0.12
    this.positions[idx + 2] = r * Math.sin(theta)

    // 初始速度：主要向上，带轻微水平随机
    const speed = 0.35 + Math.random() * 0.35
    const angle = Math.random() * Math.PI * 2
    const vr = 0.25 + Math.random() * 0.45
    this.velocities[idx] = vr * Math.cos(angle) * speed
    this.velocities[idx + 1] = (0.7 + Math.random() * 0.5) * speed
    this.velocities[idx + 2] = vr * Math.sin(angle) * speed

    // 长寿命：底部新生粒子 6.0-10.0 秒；蔓延越大寿命越长，让粒子能到达边界
    this.lifetimes[i] = (6.0 + Math.random() * 4.0) * (1 + this.spreadRadius / Math.max(1, this.maxSpreadRadius) * 0.8)
    this.ages[i] = 0
    this.sizes[i] = this.size * 1.0

    this.geometry.attributes.ageRatio.array[i] = 0
    this.geometry.attributes.heightRatio.array[i] = 0
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

/**
 * 爆炸后沿矿道方向蔓延的火球效果。
 * 由发光球体 + 内核 + 点光源 + 尾迹粒子组成，
 * 从起点沿指定方向移动一定距离，移动过程留下火焰尾迹，最后淡出消失。
 * 尾迹粒子在世界坐标系中独立运动，不随火球主体移动。
 */
export class FireballEffect {
  constructor(options = {}) {
    this.position = options.position?.clone?.() || new THREE.Vector3()
    this.direction = options.direction?.clone?.()?.normalize?.() || new THREE.Vector3(1, 0, 0)
    this.color = new THREE.Color(options.color ?? '#ff5500')
    this.intensity = options.intensity ?? 2.0
    this.radius = options.radius ?? 1.5
    this.speed = options.speed ?? 10 // 蔓延速度（单位/秒）
    this.maxDistance = options.maxDistance ?? 35
    this.duration = options.duration ?? 3.5
    this.particleCount = Math.floor(options.particleCount ?? 80)

    // 主体（跟随移动）：球体 + 内核 + 光源
    this.group = new THREE.Group()
    this.group.position.copy(this.position)

    this.light = new THREE.PointLight(this.color, this.intensity * 15, this.radius * 8, 2)
    this.group.add(this.light)

    const ballGeo = new THREE.SphereGeometry(1, 24, 24)
    const ballMat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    })
    this.ball = new THREE.Mesh(ballGeo, ballMat)
    this.ball.scale.setScalar(this.radius)
    this.group.add(this.ball)

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffcc,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    })
    this.core = new THREE.Mesh(ballGeo, coreMat)
    this.core.scale.setScalar(this.radius * 0.5)
    this.group.add(this.core)

    // 尾迹粒子（世界坐标系，独立于 group 移动）
    this.trailGeo = new THREE.BufferGeometry()
    this.trailPos = new Float32Array(this.particleCount * 3)
    this.trailVel = new Float32Array(this.particleCount * 3)
    this.trailAge = new Float32Array(this.particleCount)
    this.trailLife = new Float32Array(this.particleCount)
    this.trailSize = new Float32Array(this.particleCount)
    this.trailRandom = new Float32Array(this.particleCount * 2)
    for (let i = 0; i < this.particleCount; i++) {
      this.trailAge[i] = 1
      this.trailLife[i] = 1
    }
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3))
    this.trailGeo.setAttribute('aAge', new THREE.BufferAttribute(this.trailAge, 1))
    this.trailGeo.setAttribute('aLife', new THREE.BufferAttribute(this.trailLife, 1))
    this.trailGeo.setAttribute('aSize', new THREE.BufferAttribute(this.trailSize, 1))
    this.trailGeo.setAttribute('aRandom', new THREE.BufferAttribute(this.trailRandom, 2))

    this.trailUniforms = {
      uTexture: { value: getFlameSpriteTexture() },
      uColor: { value: this.color },
    }

    this.trailMat = new THREE.ShaderMaterial({
      uniforms: this.trailUniforms,
      vertexShader: `
        attribute float aSize;
        attribute float aAge;
        attribute float aLife;
        attribute vec2 aRandom;
        varying float vAgeRatio;
        void main() {
          vAgeRatio = aLife > 0.0 ? aAge / aLife : 1.0;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float flicker = 1.0 + 0.18 * sin(aAge * 12.0 + aRandom.x * 6.28)
                          + 0.08 * sin(aAge * 23.0 + aRandom.y * 6.28);
          gl_PointSize = aSize * flicker * (300.0 / -mvPosition.z);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform vec3 uColor;
        varying float vAgeRatio;
        void main() {
          vec2 uv = gl_PointCoord;
          vec4 tex = texture2D(uTexture, uv);
          if (tex.a < 0.01) discard;

          float d = length(uv - 0.5) * 2.0;
          float lifeFade = 1.0 - smoothstep(0.3, 1.0, vAgeRatio);

          // 火焰色温渐变：白热核心 -> 黄 -> 橙 -> 红 -> 烟灰
          vec3 core = vec3(1.0, 0.98, 0.85);
          vec3 hot = vec3(1.0, 0.78, 0.22);
          vec3 mid = vec3(1.0, 0.4, 0.04);
          vec3 edge = vec3(0.75, 0.12, 0.02);
          vec3 smoke = vec3(0.12, 0.10, 0.09);

          vec3 color = mix(core, hot, smoothstep(0.0, 0.22, d));
          color = mix(color, mid, smoothstep(0.22, 0.55, d));
          color = mix(color, edge, smoothstep(0.55, 0.92, d));
          color = mix(color, smoke, (1.0 - lifeFade) * 0.85);
          // 用配置颜色做轻微整体染色
          color = mix(color, uColor, 0.15);

          float alpha = tex.a * (1.0 - smoothstep(0.7, 1.0, d)) * lifeFade;
          if (alpha < 0.01) discard;

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    })
    this.trail = new THREE.Points(this.trailGeo, this.trailMat)
    this.trail.frustumCulled = false

    this.trailSpawnTimer = 0
    this.trailIndex = 0
    this.active = false
    this.elapsed = 0
    this.distance = 0
    this.group.visible = false
  }

  addTo(scene) {
    if (scene && !this.group.parent) scene.add(this.group)
    if (scene && !this.trail.parent) scene.add(this.trail)
  }

  removeFrom(scene) {
    if (scene && this.group.parent === scene) scene.remove(this.group)
    if (scene && this.trail.parent === scene) scene.remove(this.trail)
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z)
    this.group.position.copy(this.position)
  }

  setDirection(dir) {
    this.direction.copy(dir).normalize()
  }

  trigger() {
    this.active = true
    this.elapsed = 0
    this.distance = 0
    this.group.visible = true
    this.trail.visible = true
    this.group.position.copy(this.position)
    // 重置尾迹：全部标记为已死
    for (let i = 0; i < this.particleCount; i++) {
      this.trailAge[i] = 1
      this.trailLife[i] = 1
      this.trailSize[i] = 0
    }
    this.trailGeo.attributes.aAge.needsUpdate = true
    this.trailGeo.attributes.aLife.needsUpdate = true
    this.trailGeo.attributes.aSize.needsUpdate = true
    this.trailSpawnTimer = 0
    this.trailIndex = 0
  }

  update(delta) {
    const dt = Math.max(0, Math.min(delta, 0.05))

    // 活跃阶段：移动火球主体 + 生成尾迹粒子
    if (this.active) {
      this.elapsed += dt
      const t = Math.min(1, this.elapsed / this.duration)

      // 沿方向推进
      if (this.distance < this.maxDistance) {
        const moveDist = this.speed * dt
        this.distance += moveDist
        this.group.position.x += this.direction.x * moveDist
        this.group.position.y += this.direction.y * moveDist
        this.group.position.z += this.direction.z * moveDist
      }

      // 火球先膨胀后收缩
      const sizeScale = (0.5 + 0.5 * Math.sin(t * Math.PI)) * (1 - t * 0.4)
      this.ball.scale.setScalar(this.radius * Math.max(0.1, sizeScale))
      this.core.scale.setScalar(this.radius * 0.5 * Math.max(0.1, sizeScale))

      // 光强衰减
      this.light.intensity = this.intensity * 15 * (1 - t * 0.7)
      this.ball.material.opacity = 0.85 * (1 - t * 0.5)
      this.core.material.opacity = 0.95 * (1 - t * 0.5)

      // 生成尾迹粒子（每帧1-2个）
      this.trailSpawnTimer += dt
      const spawnInterval = 0.012
      while (this.trailSpawnTimer >= spawnInterval) {
        this.trailSpawnTimer -= spawnInterval
        this._spawnTrailParticle()
      }

      if (t >= 1) {
        this.active = false
        this.group.visible = false
      }
    }

    // 始终更新尾迹粒子：火球主体消失后尾迹仍要飘动并淡出消失
    let anyAlive = false
    for (let i = 0; i < this.particleCount; i++) {
      if (this.trailAge[i] >= this.trailLife[i]) continue
      anyAlive = true
      this.trailAge[i] += dt
      const idx = i * 3
      this.trailPos[idx] += this.trailVel[idx] * dt
      this.trailPos[idx + 1] += this.trailVel[idx + 1] * dt
      this.trailPos[idx + 2] += this.trailVel[idx + 2] * dt
      // 浮力始终沿世界 Y 轴向上，与火球运动方向解耦
      this.trailVel[idx + 1] += 1.2 * dt
      // 阻尼（帧率无关：每秒衰减到 50%）
      const damping = Math.pow(0.5, dt)
      this.trailVel[idx] *= damping
      this.trailVel[idx + 1] *= damping
      this.trailVel[idx + 2] *= damping
    }
    if (anyAlive) {
      this.trailGeo.attributes.position.needsUpdate = true
      this.trailGeo.attributes.aAge.needsUpdate = true
    } else if (!this.active) {
      // 火球已结束且尾迹全部消亡：隐藏尾迹
      this.trail.visible = false
    }
  }

  _spawnTrailParticle() {
    const i = this.trailIndex
    this.trailIndex = (this.trailIndex + 1) % this.particleCount
    const idx = i * 3
    // 在火球当前世界位置附近随机偏移生成
    const r = this.radius * 0.6
    this.trailPos[idx] = this.group.position.x + (Math.random() - 0.5) * r
    this.trailPos[idx + 1] = this.group.position.y + (Math.random() - 0.5) * r
    this.trailPos[idx + 2] = this.group.position.z + (Math.random() - 0.5) * r
    // 速度：反方向拖尾 + 世界向上浮力 + 随机扰动
    const back = 0.8
    this.trailVel[idx] = -this.direction.x * back + (Math.random() - 0.5) * 1.5
    this.trailVel[idx + 1] = -this.direction.y * back + (Math.random() - 0.5) * 1.5 + 0.9
    this.trailVel[idx + 2] = -this.direction.z * back + (Math.random() - 0.5) * 1.5
    this.trailAge[i] = 0
    this.trailLife[i] = 1.0 + Math.random() * 0.8
    this.trailSize[i] = this.radius * (0.7 + Math.random() * 0.6)
    this.trailRandom[i * 2] = Math.random()
    this.trailRandom[i * 2 + 1] = Math.random()
    this.trailGeo.attributes.aAge.needsUpdate = true
    this.trailGeo.attributes.aLife.needsUpdate = true
    this.trailGeo.attributes.aSize.needsUpdate = true
    this.trailGeo.attributes.aRandom.needsUpdate = true
  }

  dispose() {
    this.ball?.geometry?.dispose()
    this.ball?.material?.dispose()
    this.core?.material?.dispose()
    this.trailGeo?.dispose()
    this.trailMat?.dispose()
    this.light = null
    this.group = null
  }
}
