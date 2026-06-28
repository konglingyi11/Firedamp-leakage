import * as THREE from 'three'
import { getVentilationVector } from './GasAccidentPresets'

/**
 * 视觉适配器：把编排层算出的浓度/透明度/二次爆炸状态翻译成对
 * GasLeakEffect（粒子视觉对象）的调用。
 *
 * 通过 `applyIfSupported` 避免直接访问视觉对象内部可能不存在的属性，
 * 优先调用对象暴露的 setter / sync 方法，降低耦合。
 */
export class GasVisualAdapter {
  constructor(options = {}) {
    this.visuals = options.visuals || []
    this.getSettings = options.getSettings || (() => ({}))
  }

  setVisuals(visuals) {
    this.visuals = visuals || []
  }

  /**
   * 安全地给视觉对象设置属性或调用 setter。
   * 优先查找视觉对象暴露的接口（如 setOpacity），其次按路径写入内部属性。
   *
   * @param {Object} visual 视觉对象
   * @param {string} name 属性/方法名，支持路径如 'smoke.opacity'
   * @param {*} value 目标值
   * @returns {boolean} 是否成功应用
   */
  applyIfSupported(visual, name, value) {
    if (!visual || name == null) return false

    // 1. 优先调用同名的 setter 方法（如 setOpacity、setHeight）
    const setterName = `set${name.replace(/(^|\.)([a-z])/g, (_, __, char) => char.toUpperCase())}`
    if (typeof visual[setterName] === 'function') {
      visual[setterName](value)
      return true
    }

    // 2. 按路径写入内部属性，路径中任一节点不存在则安全跳过
    const keys = name.split('.')
    let target = visual
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      if (target == null || typeof target !== 'object') return false
      target = target[key]
    }
    const lastKey = keys[keys.length - 1]
    if (target != null && typeof target === 'object') {
      target[lastKey] = value
      return true
    }
    return false
  }

  syncAccumulationVisuals(sourceStates) {
    const s = this.getSettings()
    if (!s) return
    const upper = s.methaneUpperExplosiveLimit
    const lower = s.methaneLowerExplosiveLimit
    const explosiveRange = Math.max(0.1, upper - lower)

    this.visuals.forEach((gasLeak, index) => {
      if (!gasLeak) return
      const state = sourceStates[index]
      const methane = state?.methanePercent || 0
      const localConcentration = Math.max(0.18, Math.min(1, methane / upper))
      const localRangeFactor = Math.max(0, Math.min(1, (methane - lower * 0.45) / explosiveRange))
      const localAccumulation = Math.max(0, Math.min(1, (state?.accumulationSeconds || 0) / Math.max(8, s.minIgnitionDelay)))

      if (typeof gasLeak.setConcentration === 'function') {
        gasLeak.setConcentration(localConcentration)
      }

      const baseSmokeOpacity = gasLeak._baseSmokeOpacity ?? s.gasOpacity
      const baseDiffuseOpacity = gasLeak._baseDiffuseOpacity ?? s.gasDiffuseOpacity
      const smokeMod = 0.85 + localRangeFactor * 0.35 + localAccumulation * 0.15
      const diffuseMod = 0.8 + localRangeFactor * 0.45 + localAccumulation * 0.25

      this.applyIfSupported(gasLeak, 'smoke.opacity', baseSmokeOpacity * smokeMod)
      this.applyIfSupported(gasLeak, 'diffuseSmoke.opacity', baseDiffuseOpacity * diffuseMod)
      this.applyIfSupported(gasLeak, 'smoke.height', (1.0 + localConcentration * 0.45) * s.upperAccumulation)
      this.applyIfSupported(gasLeak, 'diffuseSmoke.height', (0.7 + localConcentration * 0.55) * s.upperAccumulation)
      this.applyIfSupported(gasLeak, 'smoke.verticalSpread', s.gasVerticalSpread * (0.9 + localAccumulation * 0.25))
      this.applyIfSupported(gasLeak, 'diffuseSmoke.verticalSpread', s.gasVerticalSpread * (1.15 + localAccumulation * 0.35))

      if (typeof gasLeak.smoke?.syncMaterial === 'function') gasLeak.smoke.syncMaterial()
      if (typeof gasLeak.diffuseSmoke?.syncMaterial === 'function') gasLeak.diffuseSmoke.syncMaterial()
    })
  }

  syncIgnitedVisuals(sourceStates) {
    this.visuals.forEach((gasLeak, index) => {
      if (!gasLeak) return
      const state = sourceStates[index]
      if (state?.ignited) {
        const smokeOpacity = Math.min(this._readPath(gasLeak, 'smoke.opacity') ?? 1, 0.08)
        const diffuseOpacity = Math.min(this._readPath(gasLeak, 'diffuseSmoke.opacity') ?? 1, 0.028)
        this.applyIfSupported(gasLeak, 'smoke.opacity', smokeOpacity)
        this.applyIfSupported(gasLeak, 'diffuseSmoke.opacity', diffuseOpacity)
        if (typeof gasLeak.smoke?.syncMaterial === 'function') gasLeak.smoke.syncMaterial()
        if (typeof gasLeak.diffuseSmoke?.syncMaterial === 'function') gasLeak.diffuseSmoke.syncMaterial()
      }
    })
  }

  syncAftermathToxicVisuals(dangerRatioByPpm) {
    const s = this.getSettings()
    if (!s) return
    const toxicOpacity = s.toxicSmokeOpacity * (0.75 + Math.max(0, Math.min(1, dangerRatioByPpm)) * 0.75)
    this.visuals.forEach((gasLeak) => {
      if (!gasLeak?.aftermath) return
      this.applyIfSupported(gasLeak, 'aftermath.toxicOpacity', toxicOpacity)
    })
  }

  applyAllSettings(settingsOverride) {
    const s = settingsOverride || this.getSettings()
    const ventilationVector = getVentilationVector(s)
    this.visuals.forEach((gasLeak) => {
      if (!gasLeak) return
      if (s.gasColor != null && typeof gasLeak.setColor === 'function') {
        const c = s.gasColor
        gasLeak.setColor(c instanceof THREE.Color ? c : new THREE.Color(c))
      }
      if (s.gasDensity != null && typeof gasLeak.setDensity === 'function') {
        gasLeak.setDensity(s.gasDensity)
      }
      if (typeof gasLeak.applyVisualOverrides === 'function') {
        gasLeak.applyVisualOverrides({ settings: s, ventilationVector })
      }
    })
  }

  setSparking(primaryIndex) {
    this.visuals.forEach((gasLeak, index) => {
      if (gasLeak && typeof gasLeak.setSparking === 'function') {
        gasLeak.setSparking(index === primaryIndex)
      }
    })
  }

  clearSparking() {
    this.visuals.forEach((gasLeak) => {
      if (gasLeak && typeof gasLeak.setSparking === 'function') {
        gasLeak.setSparking(false)
      }
    })
  }

  /**
   * 安全读取视觉对象内部路径值，仅用于读回已有值做计算，不用于写操作。
   * @param {Object} visual
   * @param {string} path
   * @returns {*|undefined}
   */
  _readPath(visual, path) {
    if (!visual || path == null) return undefined
    const keys = path.split('.')
    let target = visual
    for (const key of keys) {
      if (target == null || typeof target !== 'object') return undefined
      target = target[key]
    }
    return target
  }
}

export default GasVisualAdapter
