import * as THREE from 'three'

/**
 * 巷道采煤工艺流程控制器：
 *  阶段 1 mining  —— 采煤机截割滚筒旋转，煤块从工作面飞溅
 *  阶段 2 filling —— 碎石按"由远及近、由下而上"顺序逐颗填充采空区
 *  阶段 3 leaking —— 填充完成，瓦斯从碎石缝隙渗出（触发外部回调）
 *
 * 通过 onPhaseChange 回调通知调用方进入新阶段，
 * 调用方据此激活 raymarch / particle 瓦斯系统。
 */
export class TunnelProcessController {
  constructor({
    drums,
    machineGroup,
    rockInstanced,
    rocks,
    coalUnitGeo,
    coalMat,
    sceneGroup,
    onPhaseChange,
    miningDuration = 9,
    fillingDuration = 7,
    mineRange = 2.0,
  }) {
    this.drums = drums || []
    this.machineGroup = machineGroup || null
    this.rockInstanced = rockInstanced
    this.rocks = rocks || []
    this.coalUnitGeo = coalUnitGeo
    this.coalMat = coalMat
    this.sceneGroup = sceneGroup
    this.onPhaseChange = onPhaseChange

    this.miningDuration = miningDuration
    this.fillingDuration = fillingDuration
    this.mineRange = mineRange

    this.phase = 'idle' // idle → mining → filling → leaking
    this.phaseTime = 0
    this.drumSpin = 0

    // 记录采煤机初始位置（工作面中心），清零 Z 偏移
    this._machineOriginZ = this.machineGroup?.position.z || 0
    if (this.machineGroup) this.machineGroup.position.z = 0

    this._dummy = new THREE.Object3D()
    this._spawnAccum = 0
    this.miningCoals = []
    this._lastMachineZ = 0

    this._hideAllRocks()
  }

  start() {
    this.reset()
    this.phase = 'mining'
    this.phaseTime = 0
    this._lastMachineZ = 0
    this.onPhaseChange?.('mining')
  }

  reset() {
    this.phase = 'idle'
    this.phaseTime = 0
    this.drumSpin = 0
    // 重置滚筒旋转
    this.drums.forEach((d) => { d.rotation.set(0, 0, 0) })
    // 采煤机回到工作面中心
    if (this.machineGroup) this.machineGroup.position.z = 0
    this._lastMachineZ = 0
    // 清理采煤飞溅煤块
    this._clearMiningCoals()
    // 隐藏所有岩石
    this._hideAllRocks()
    this.onPhaseChange?.('idle')
  }

  update(delta) {
    if (this.phase === 'idle') return

    this.phaseTime += delta

    if (this.phase === 'mining') {
      this._updateMining(delta)
      if (this.phaseTime >= this.miningDuration) {
        this.phase = 'filling'
        this.phaseTime = 0
        this.onPhaseChange?.('filling')
      }
    } else if (this.phase === 'filling') {
      this._updateFilling()
      // 滚筒减速停转
      this.drumSpin = Math.max(0, this.drumSpin - delta * 4)
      this._spinDrums(delta)
      if (this.phaseTime >= this.fillingDuration) {
        this.phase = 'leaking'
        this.phaseTime = 0
        this.onPhaseChange?.('leaking')
      }
    } else if (this.phase === 'leaking') {
      // 瓦斯渗出阶段，岩石不再变化
    }

    this._updateMiningCoals(delta)
  }

  // ---------- 阶段 1：采煤（左右往返截割） ----------

  _updateMining(delta) {
    // 滚筒加速旋转
    this.drumSpin = Math.min(8, this.drumSpin + delta * 3)
    this._spinDrums(delta)

    // 采煤机沿工作面 Z 向往返：右 → 左 → 回中
    const p = Math.min(1, this.phaseTime / this.miningDuration)
    const z = this._computeMineTraverse(p)
    if (this.machineGroup) this.machineGroup.position.z = z

    // 飞溅煤块数量与移动速度正相关：移动越快，截割越剧烈
    const moveSpeed = Math.abs(z - this._lastMachineZ) / Math.max(delta, 1e-4)
    this._lastMachineZ = z
    const rate = 14 + Math.min(26, moveSpeed * 6)
    this._spawnAccum += delta * rate
    while (this._spawnAccum >= 1) {
      this._spawnAccum -= 1
      this._spawnMiningCoal()
    }
  }

  // 0~0.45 右行至 +mineRange，0.45~0.9 左行至 -mineRange，0.9~1 回中
  _computeMineTraverse(p) {
    const r = this.mineRange
    const ease = (t) => t * t * (3 - 2 * t)
    if (p < 0.45) {
      return ease(p / 0.45) * r
    } else if (p < 0.9) {
      const t = (p - 0.45) / 0.45
      return r + ease(t) * (-2 * r)
    } else {
      const t = (p - 0.9) / 0.1
      return -r + ease(t) * r
    }
  }

  _spinDrums(delta) {
    const angle = this.drumSpin * delta
    this.drums.forEach((d) => { d.rotation.z += angle })
  }

  _spawnMiningCoal() {
    if (!this.coalUnitGeo || !this.coalMat) return
    const drum = this.drums[Math.floor(Math.random() * this.drums.length)]
    if (!drum) return

    const worldPos = new THREE.Vector3()
    drum.getWorldPosition(worldPos)

    const s = 0.08 + Math.random() * 0.14
    const coal = new THREE.Mesh(this.coalUnitGeo, this.coalMat)
    coal.scale.setScalar(s)
    coal.position.copy(worldPos)
    coal.position.x += (Math.random() - 0.5) * 0.4

    // 煤块朝 -X（巷道内）飞溅并向上抛
    coal.userData = {
      velocity: new THREE.Vector3(
        -1.5 - Math.random() * 2.5,
        1.0 + Math.random() * 2.5,
        (Math.random() - 0.5) * 2.0,
      ),
      rotSpeed: (Math.random() - 0.5) * 6,
      lifetime: 0,
      maxLifetime: 1.2 + Math.random() * 0.8,
      floorY: 0.25,
      baseScale: s,
    }
    this.sceneGroup.add(coal)
    this.miningCoals.push(coal)
  }

  _updateMiningCoals(delta) {
    for (let i = this.miningCoals.length - 1; i >= 0; i--) {
      const c = this.miningCoals[i]
      c.userData.lifetime += delta
      if (c.userData.lifetime > c.userData.maxLifetime) {
        c.parent?.remove(c)
        this.miningCoals.splice(i, 1)
        continue
      }
      c.userData.velocity.y -= 9.8 * delta
      c.position.addScaledVector(c.userData.velocity, delta)
      if (c.position.y < c.userData.floorY) {
        c.position.y = c.userData.floorY
        c.userData.velocity.set(0, 0, 0)
        // 落地后随剩余生命期缩小消失
        const fadeStart = c.userData.maxLifetime * 0.6
        if (c.userData.lifetime > fadeStart) {
          const fade = Math.max(0, 1 - (c.userData.lifetime - fadeStart) / (c.userData.maxLifetime - fadeStart))
          c.scale.setScalar(c.userData.baseScale * fade)
        }
      }
      c.rotation.x += c.userData.rotSpeed * delta
      c.rotation.z += c.userData.rotSpeed * delta * 0.5
    }
  }

  _clearMiningCoals() {
    this.miningCoals.forEach((c) => c.parent?.remove(c))
    this.miningCoals = []
  }

  // ---------- 阶段 2：碎石填充 ----------

  _updateFilling() {
    const progress = Math.min(1, this.phaseTime / this.fillingDuration)
    // 每颗岩石在全局进度的 [fillOrder, fillOrder + fillWindow] 区间内放大
    const fillWindow = 0.45

    let changed = false
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i]
      const localT = (progress - r.fillOrder * (1 - fillWindow)) / fillWindow
      const s = Math.min(1, Math.max(0, localT))
      // smoothstep 缓动
      const eased = s * s * (3 - 2 * s)

      if (eased <= 0) {
        this._dummy.scale.set(0, 0, 0)
      } else {
        this._dummy.scale.set(r.sx * eased, r.sy * eased, r.sz * eased)
        changed = true
      }
      this._dummy.position.set(r.x, r.y, r.z)
      this._dummy.rotation.set(r.rotX, r.rotY, r.rotZ)
      this._dummy.updateMatrix()
      this.rockInstanced.setMatrixAt(i, this._dummy.matrix)
    }
    if (changed) this.rockInstanced.instanceMatrix.needsUpdate = true
  }

  _hideAllRocks() {
    if (!this.rockInstanced || !this.rocks.length) return
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i]
      this._dummy.position.set(r.x, r.y, r.z)
      this._dummy.rotation.set(r.rotX, r.rotY, r.rotZ)
      this._dummy.scale.set(0, 0, 0)
      this._dummy.updateMatrix()
      this.rockInstanced.setMatrixAt(i, this._dummy.matrix)
    }
    this.rockInstanced.instanceMatrix.needsUpdate = true
  }

  // ---------- 状态查询 ----------

  getPhaseText() {
    if (this.phase === 'idle') return '待机 — 点击"启动流程"开始'
    if (this.phase === 'mining') {
      const p = Math.min(1, this.phaseTime / this.miningDuration)
      const side = p < 0.45 ? '截割右侧煤壁' : p < 0.9 ? '截割左侧煤壁' : '回中收尾'
      return `阶段 1/3 采煤机${side} ${this.phaseTime.toFixed(1)}s`
    }
    if (this.phase === 'filling') {
      return `阶段 2/3 碎石填充采空区 ${this.phaseTime.toFixed(1)}s`
    }
    if (this.phase === 'leaking') return '阶段 3/3 瓦斯从碎石缝隙渗出'
    return ''
  }

  dispose() {
    this._clearMiningCoals()
  }
}
