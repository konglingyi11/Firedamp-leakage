import * as THREE from 'three'

/**
 * 瓦斯浓度场预测器
 *
 * 根据离散传感器点位（x, y, z, value）预测空间中任意位置的瓦斯浓度。
 * 默认使用反距离加权插值（IDW），预留了克里金（Kriging）、径向基函数（RBF）等扩展接口。
 *
 * 适用场景：
 * - 已知少量传感器实测值，推断整个采空区/巷道的瓦斯分布。
 * - 为 3D 可视化提供浓度热力图、等值面数据。
 * - 为预警引擎补充“未布设传感器位置”的风险评估。
 */

/** 支持的预测方法 */
export const PREDICTION_METHODS = {
  IDW: 'idw',
  KRIGING: 'kriging',
  RBF: 'rbf',
}

/**
 * @typedef {Object} SensorSample
 * @property {THREE.Vector3|{x:number,y:number,z:number}} position 传感器空间位置（m）
 * @property {number} value 实测值（如 CH₄ 体积百分比）
 * @property {string} [id] 传感器编号
 * @property {number} [weight=1] 额外权重（用于标记可信传感器或重点区域）
 */

export class GasFieldPredictor {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.method='idw'] 预测方法：'idw' | 'kriging' | 'rbf'
   * @param {number} [options.power=2] IDW 幂次，越大近处传感器影响越强
   * @param {number} [options.maxRadius=50] 最大影响半径（m），超出该半径的传感器不参与计算
   * @param {number} [options.minPoints=1] 参与计算的最少传感器数量，不足时返回 defaultValue
   * @param {number} [options.defaultValue=0] 无法预测时的默认值
   * @param {number} [options.smooth=0.001] 平滑因子，避免距离为 0 时除零
   */
  constructor(options = {}) {
    this.method = options.method || PREDICTION_METHODS.IDW
    this.power = Math.max(0.1, options.power ?? 2)
    this.maxRadius = Math.max(0, options.maxRadius ?? 50)
    this.minPoints = Math.max(0, options.minPoints ?? 1)
    this.defaultValue = options.defaultValue ?? 0
    this.smooth = Math.max(1e-9, options.smooth ?? 0.001)

    /** @type {SensorSample[]} */
    this.sensors = []
  }

  /**
   * 设置/更新传感器样本
   * @param {SensorSample[]} sensors
   */
  setSensors(sensors) {
    this.sensors = (sensors || []).map((s) => {
      const pos = s.position?.clone
        ? s.position.clone()
        : new THREE.Vector3(s.position?.x ?? 0, s.position?.y ?? 0, s.position?.z ?? 0)
      return {
        id: s.id || '',
        position: pos,
        value: Number(s.value) || 0,
        weight: Number(s.weight) || 1,
      }
    })
  }

  /**
   * 预测单点浓度
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position
   * @returns {{value:number, confidence:number, contributors:number}} 预测值 + 置信度 + 参与传感器数
   */
  predict(position) {
    const target = position?.clone
      ? position.clone()
      : new THREE.Vector3(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0)

    if (this.sensors.length === 0) {
      return { value: this.defaultValue, confidence: 0, contributors: 0 }
    }

    switch (this.method) {
      case PREDICTION_METHODS.IDW:
        return this._predictIDW(target)
      case PREDICTION_METHODS.KRIGING:
        // 后续可替换为真实克里金实现
        return this._predictIDW(target)
      case PREDICTION_METHODS.RBF:
        // 后续可替换为真实 RBF 实现
        return this._predictIDW(target)
      default:
        return this._predictIDW(target)
    }
  }

  /**
   * 预测规则网格上的浓度场
   * @param {Object} bounds
   * @param {{x:number,y:number,z:number}} bounds.min 最小角点
   * @param {{x:number,y:number,z:number}} bounds.max 最大角点
   * @param {{x:number,y:number,z:number}} [bounds.resolution={x:10,y:10,z:10}] 各轴采样数
   * @returns {{positions:Float32Array, values:Float32Array, dimensions:{x:number,y:number,z:number}}}
   */
  predictGrid(bounds) {
    const min = bounds.min || { x: 0, y: 0, z: 0 }
    const max = bounds.max || { x: 100, y: 20, z: 100 }
    const res = bounds.resolution || { x: 20, y: 5, z: 20 }

    const count = res.x * res.y * res.z
    const positions = new Float32Array(count * 3)
    const values = new Float32Array(count)

    let index = 0
    for (let ix = 0; ix < res.x; ix++) {
      for (let iy = 0; iy < res.y; iy++) {
        for (let iz = 0; iz < res.z; iz++) {
          const px = min.x + (max.x - min.x) * (ix / Math.max(1, res.x - 1))
          const py = min.y + (max.y - min.y) * (iy / Math.max(1, res.y - 1))
          const pz = min.z + (max.z - min.z) * (iz / Math.max(1, res.z - 1))

          positions[index * 3] = px
          positions[index * 3 + 1] = py
          positions[index * 3 + 2] = pz

          const result = this.predict({ x: px, y: py, z: pz })
          values[index] = result.value
          index++
        }
      }
    }

    return { positions, values, dimensions: { x: res.x, y: res.y, z: res.z } }
  }

  /**
   * 获取某位置的最近传感器信息，用于辅助判断
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position
   */
  getNearestSensor(position) {
    const target = position?.clone
      ? position.clone()
      : new THREE.Vector3(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0)

    let nearest = null
    let minDist = Infinity
    this.sensors.forEach((s) => {
      const d = target.distanceTo(s.position)
      if (d < minDist) {
        minDist = d
        nearest = s
      }
    })
    return nearest ? { sensor: nearest, distance: minDist } : null
  }

  // ==================== 内部算法实现 ====================

  _predictIDW(target) {
    let weightedSum = 0
    let weightSum = 0
    let contributors = 0
    let minDistance = Infinity

    for (const s of this.sensors) {
      const dist = target.distanceTo(s.position)
      minDistance = Math.min(minDistance, dist)

      // 恰好落在传感器位置，直接返回
      if (dist < this.smooth) {
        return { value: s.value, confidence: 1, contributors: 1, nearestDistance: 0 }
      }

      // 超出影响半径，忽略
      if (this.maxRadius > 0 && dist > this.maxRadius) continue

      const w = s.weight / Math.pow(dist, this.power)
      weightedSum += w * s.value
      weightSum += w
      contributors++
    }

    if (contributors < this.minPoints || weightSum <= 0) {
      return { value: this.defaultValue, confidence: 0, contributors, nearestDistance: minDistance }
    }

    const value = weightedSum / weightSum
    // 置信度：参与点越多、越近越可信
    const confidence = Math.min(1, contributors / 4) * Math.max(0, 1 - minDistance / this.maxRadius)

    return {
      value: Number(value.toFixed(6)),
      confidence: Number(confidence.toFixed(4)),
      contributors,
      nearestDistance: Number(minDistance.toFixed(3)),
    }
  }
}

export default GasFieldPredictor
