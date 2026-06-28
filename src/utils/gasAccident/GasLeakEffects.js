import * as THREE from 'three'

/**
 * 点火源附近的粒子火花效果。
 * 使用 Three.js Points + BufferGeometry，生命周期结束后自动隐藏，
 * 适合在瓦斯泄漏→点火阶段作为视觉提示。
 */
export class SparkEffect {
  /**
   * @param {Object} options
   * @param {THREE.Vector3} [options.position=new THREE.Vector3()] 发射源位置
   * @param {THREE.Vector3} [options.direction=new THREE.Vector3(0,1,0)] 主发射方向
   * @param {number} [options.count=180] 粒子数量
   * @param {number} [options.range=1.5] 粒子散落半径
   * @param {number} [options.maxLifetime=0.7] 单粒子最大生命周期（秒）
   * @param {THREE.Color|string} [options.color='#ffaa33'] 火花颜色
   */
  constructor(options = {}) {
    this.position = options.position?.clone?.() || new THREE.Vector3()
    this.direction = options.direction?.clone?.() || new THREE.Vector3(0, 1, 0)
    this.direction.normalize()
    this.count = Math.max(0, Math.floor(options.count ?? 180))
    this.range = Math.max(0.01, options.range ?? 1.5)
    this.maxLifetime = Math.max(0.01, options.maxLifetime ?? 0.7)
    this.color = new THREE.Color(options.color ?? '#ffaa33')

    this._elapsed = 0
    this._geometry = new THREE.BufferGeometry()
    this._positions = new Float32Array(this.count * 3)
    this._velocities = new Float32Array(this.count * 3)
    this._lifetimes = new Float32Array(this.count)
    this._ages = new Float32Array(this.count)

    this._resetParticles(true)

    this._geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3))

    const material = new THREE.PointsMaterial({
      color: this.color,
      size: 0.18,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })

    this._points = new THREE.Points(this._geometry, material)
    this._points.position.copy(this.position)
    this._points.frustumCulled = false
  }

  /** 将火花加入场景 */
  addTo(scene) {
    if (scene && !this._points.parent) scene.add(this._points)
  }

  /** 将火花从场景中移除 */
  removeFrom(scene) {
    if (scene && this._points.parent === scene) scene.remove(this._points)
  }

  /** 设置发射源位置 */
  setPosition(x, y, z) {
    this.position.set(x, y, z)
    if (this._points) this._points.position.copy(this.position)
  }

  /**
   * 更新粒子位置与生命周期。
   * @param {number} delta 时间步长（秒）
   * @param {number} elapsed 累计运行时间（秒）
   */
  update(delta, elapsed) {
    if (!this._points?.visible || this.count === 0) return
    this._elapsed = elapsed

    const dt = Math.max(0, Math.min(delta, 0.05)) // 限制单帧步长，避免异常跳变
    const gravity = -2.8 // 重力加速度（单位/秒²）
    const spread = this.range * 0.6

    for (let i = 0; i < this.count; i++) {
      this._ages[i] += dt
      if (this._ages[i] >= this._lifetimes[i]) {
        this._respawnParticle(i, spread)
      }

      const idx = i * 3
      this._positions[idx] += this._velocities[idx] * dt
      this._positions[idx + 1] += this._velocities[idx + 1] * dt
      this._positions[idx + 2] += this._velocities[idx + 2] * dt
      this._velocities[idx + 1] += gravity * dt
    }

    this._geometry.attributes.position.needsUpdate = true
    const lifeRatio = this.count > 0
      ? this._lifetimes.reduce((sum, v, i) => sum + (1 - this._ages[i] / v), 0) / this.count
      : 0
    this._points.material.opacity = 0.2 + Math.max(0, lifeRatio) * 0.7
  }

  /** 释放 GPU/CPU 资源 */
  dispose() {
    this._points?.geometry?.dispose()
    this._points?.material?.dispose()
    this._points = null
    this._geometry = null
  }

  _resetParticles(initial = false) {
    const spread = this.range * 0.6
    for (let i = 0; i < this.count; i++) {
      this._respawnParticle(i, spread)
      if (initial) {
        // 初始时随机分布一部分年龄，避免同时生灭
        this._ages[i] = Math.random() * this._lifetimes[i]
      }
    }
  }

  _respawnParticle(i, spread) {
    const idx = i * 3
    this._positions[idx] = (Math.random() - 0.5) * spread * 0.3
    this._positions[idx + 1] = (Math.random() - 0.5) * spread * 0.3
    this._positions[idx + 2] = (Math.random() - 0.5) * spread * 0.3

    const coneAngle = Math.PI / 4
    const angle = Math.random() * Math.PI * 2
    const r = Math.sin(coneAngle * Math.random())
    const localDir = new THREE.Vector3(
      r * Math.cos(angle),
      Math.cos(coneAngle * Math.random()),
      r * Math.sin(angle),
    ).normalize()

    const dir = this.direction.clone().applyAxisAngle(
      new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      coneAngle * (Math.random() - 0.5),
    ).normalize()

    const speed = 1.5 + Math.random() * 3.5
    this._velocities[idx] = dir.x * speed + (Math.random() - 0.5) * spread
    this._velocities[idx + 1] = dir.y * speed + Math.random() * spread * 0.5
    this._velocities[idx + 2] = dir.z * speed + (Math.random() - 0.5) * spread
    this._lifetimes[i] = this.maxLifetime * (0.5 + Math.random() * 0.7)
    this._ages[i] = 0
  }
}

export default SparkEffect
