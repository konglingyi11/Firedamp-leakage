import * as THREE from 'three'
import { SparkEffect } from './GasLeakEffects'
import { GAS_SOURCE_TYPE_FACTORS, resolveSettings } from './GasAccidentPresets'
import { GasVisualAdapter } from './GasVisualAdapter'

/**
 * 瓦斯灾害编排层 - 三阶段状态机 + 业务逻辑（场景无关）
 *
 * 阶段：idle -> leaking -> sparking -> ignited
 *
 * 职责划分：
 * 1. 泄漏积聚（_updateAccumulation）
 * 2. 点火源评估（_evaluateIgnition / _updateManualIgnitionWindow）
 * 3. 爆炸与次生灾害（_updatePostExplosion / _updateSecondaryBlastConditions）
 * 4. 安全联锁（_updateSafetyInterlock）
 */

// ==================== 物理/经验系数常量 ====================

const STAGE_SEQUENCE = ['idle', 'leaking', 'sparking', 'ignited']

/** 甲烷积聚上限缓冲（在爆炸上限基础上增加的百分点） */
const METHANE_UPPER_BUFFER = 8
/** 甲烷绝对上限（%） */
const METHANE_ABSOLUTE_UPPER = 25
/** 通风损失系数 */
const VENT_LOSS_BASE = 0.035
const VENT_LOSS_VISUAL = 0.018
/** 源间混合系数 */
const MIXING_COEFFICIENT = 0.012
/** 点燃后甲烷衰减系数 */
const IGNITED_DECAY_FACTOR = 7.5
/** 视觉浓度下限 */
const VISUAL_CONCENTRATION_MIN = 0.18
/** 源高度对顶棚积聚影响的基准高度（m） */
const CEILING_BASE_HEIGHT = 4.5
/** 源高度影响系数 */
const CEILING_HEIGHT_COEFFICIENT = 0.18
/** 顶棚因子上下限 */
const CEILING_FACTOR_MIN = 0.75
const CEILING_FACTOR_MAX = 1.65
/** 位置风险计算中上层偏置系数 */
const RISK_STRATIFICATION_COEFFICIENT = 0.22
const RISK_CEILING_COEFFICIENT = 0.015
const RISK_UPPER_BIAS_MIN = 0.45
const RISK_UPPER_BIAS_MAX = 1.8
/** 火花粒子数量基准 */
const SPARK_COUNT_BASE = 180
/** 火花范围基准 */
const SPARK_RANGE_BASE = 1.2
const SPARK_RANGE_SCALE = 0.8
/** 火花发射点相对于点火源的高度偏移（m） */
const SPARK_HEIGHT_OFFSET = 1.2
/** CO 产生窗口占灾后时长的比例 */
const CO_GENERATION_WINDOW_RATIO = 0.12
/** CO 产生窗口上下限（s） */
const CO_GENERATION_WINDOW_MIN = 1
const CO_GENERATION_WINDOW_MAX = 18
/** CO 通风衰减系数 */
const CO_VENT_DECAY_VISUAL = 0.015
const CO_VENT_DECAY_STRENGTH = 0.01
/** CO 前沿输送系数 */
const CO_FRONT_CARRY_BASE = 0.55
const CO_FRONT_CARRY_VISUAL = 0.28
const CO_FRONT_CARRY_STRENGTH = 0.18
/** 冲击波伤害随时间衰减 */
const SHOCKWAVE_FALLOFF_MIN_DURATION = 0.1
/** 二爆视觉判定阈值 */
const SECONDARY_BLAST_VISUAL_RADIUS = 0.5

export class GasAccidentController {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.settings] 局部配置，会经 resolveSettings 合并
   * @param {Array} [options.sources=[]] 泄漏源数组
   * @param {GasVisualAdapter} [options.visualAdapter] 自定义视觉适配器
   * @param {Function} [options.ignitionSourceProvider] 返回点火源位置的函数
   * @param {Object} [options.on] 事件回调 { stageChange, safetyAlarm, ignition, explosion, secondaryBlast }
   * @param {number} [options.ceilingY=9.2] 巷道顶棚高度（m）
   */
  constructor(options = {}) {
    this.settings = resolveSettings(options.settings)
    this.sources = options.sources || []
    this.visualAdapter = options.visualAdapter || new GasVisualAdapter({ visuals: [], getSettings: () => this.settings })
    this.ignitionSourceProvider = options.ignitionSourceProvider || null

    this.on = {
      stageChange: () => {},
      safetyAlarm: () => {},
      ignition: () => {},
      explosion: () => {},
      secondaryBlast: () => {},
      ...(options.on || {}),
    }

    this._ceilingY = options.ceilingY ?? 9.2
    this._spark = null
    this._sparkScene = null
    this._sparkStart = 0

    this.reset()
  }

  // ==================== 公共 API ====================

  start() {
    if (this.stage === 'idle') this._setStage('leaking')
  }

  update(delta) {
    const dt = this._sanitizeDelta(delta)
    if (this.stage === 'idle') return
    this.elapsed += dt

    if (this.stage === 'ignited') {
      this._updateAccumulation(dt)
      this._updateFlamePropagation(dt)
      this._updatePostExplosion(dt)
      this._updateSecondaryBlastConditions()
      return
    }

    this._updateAccumulation(dt)
    this._updateManualIgnitionWindow(dt)
    this._evaluateIgnition(dt)
  }

  requestManualIgnition() {
    this.settings.manualIgnitionRequested = true
    this.manualIgnitionElapsed = 0
  }

  ignite() {
    if (!this.sources.length) return
    const targetIndex = this.primaryIgnitionIndex >= 0 ? this.primaryIgnitionIndex : 0
    this._igniteAtIndex(targetIndex, true)
  }

  reset() {
    this.elapsed = 0
    this.stage = 'idle'
    this.sparkElapsed = 0
    this.manualIgnitionElapsed = 0
    this.postExplosionSeconds = 0
    this.accumulationSeconds = 0
    this.explosiveWindowSeconds = 0
    this.methanePercent = 0
    this.peakMethanePercent = 0
    this.carbonMonoxidePpm = 0
    this.peakCarbonMonoxidePpm = 0
    this.carbonMonoxideFrontMeters = 0
    this.carbonMonoxideDangerRadius = 0
    this.shockwaveFrontMeters = 0
    this.shockwaveDamageRadius = 0
    this.secondaryResidualMethane = 0
    this.secondaryCoalDustReady = false
    this.secondaryBlastReady = false
    this.secondaryBlastReason = '条件不足'
    this.safetyAlarmLevel = 'normal'
    this.primaryIgnitionIndex = -1
    this.settings.manualIgnitionRequested = false
    this._destroySpark()
    this._rebuildSourceStates()
  }

  setVisualAdapter(adapter) {
    this.visualAdapter = adapter || this.visualAdapter
    this.visualAdapter.setVisuals(this._collectVisuals())
    this.visualAdapter.getSettings = this.visualAdapter.getSettings || (() => this.settings)
  }

  setIgnitionSourceProvider(fn) {
    this.ignitionSourceProvider = typeof fn === 'function' ? fn : null
  }

  get elapsedTime() { return this.elapsed }
  get currentStage() { return this.stage }

  setSources(sources) {
    this.sources = sources || []
    this._rebuildSourceStates()
  }

  applySettings(settingsOverride) {
    if (settingsOverride) {
      const merged = resolveSettings({ ...this.settings, ...settingsOverride })
      Object.assign(this.settings, merged)
      // 保留非枚举分组视图
      Object.defineProperty(this.settings, '$groups', {
        value: merged.$groups,
        enumerable: false,
        configurable: true,
        writable: true,
      })
    }
    this.visualAdapter.applyAllSettings(this.settings)
  }

  /**
   * 返回当前状态的深度安全快照，避免调用方直接修改内部状态。
   * @returns {Object}
   */
  getState() {
    return {
      stage: this.stage,
      elapsed: this._safeNumber(this.elapsed),
      methanePercent: this._safeNumber(this.methanePercent),
      peakMethanePercent: this._safeNumber(this.peakMethanePercent),
      carbonMonoxidePpm: this._safeNumber(this.carbonMonoxidePpm),
      peakCarbonMonoxidePpm: this._safeNumber(this.peakCarbonMonoxidePpm),
      carbonMonoxideFrontMeters: this._safeNumber(this.carbonMonoxideFrontMeters),
      carbonMonoxideDangerRadius: this._safeNumber(this.carbonMonoxideDangerRadius),
      shockwaveFrontMeters: this._safeNumber(this.shockwaveFrontMeters),
      shockwaveDamageRadius: this._safeNumber(this.shockwaveDamageRadius),
      secondaryResidualMethane: this._safeNumber(this.secondaryResidualMethane),
      secondaryCoalDustReady: !!this.secondaryCoalDustReady,
      secondaryBlastReady: !!this.secondaryBlastReady,
      secondaryBlastReason: String(this.secondaryBlastReason || ''),
      safetyAlarmLevel: this.safetyAlarmLevel,
      accumulationSeconds: this._safeNumber(this.accumulationSeconds),
      explosiveWindowSeconds: this._safeNumber(this.explosiveWindowSeconds),
      primaryIgnitionIndex: this.primaryIgnitionIndex,
      sourceStates: this.sourceStates.map((s) => ({ ...s })),
    }
  }

  // ==================== 一阶段：泄漏与积聚 ====================

  _updateAccumulation(delta) {
    this._ensureSourceStates()
    const activeSourceCount = Math.max(1, this.sources.length)
    const sourceFactor = Math.sqrt(activeSourceCount)
    const baseLeakRate = this.settings.leakRatePercent * sourceFactor * this.settings.upperAccumulation * this.settings.ventilationFailureFactor
    const upperLimit = Math.max(this.settings.methaneUpperExplosiveLimit + METHANE_UPPER_BUFFER, METHANE_ABSOLUTE_UPPER)
    this.accumulationSeconds += delta

    let weightedMethane = 0
    let peakMethane = 0
    let visibleMax = 0
    const sourceAverage = this.sourceStates.reduce((sum, st) => sum + (st?.methanePercent || 0), 0) / Math.max(1, this.sourceStates.length)

    this.sourceStates.forEach((state, index) => {
      if (state.ignited) {
        state.methanePercent = Math.max(0, state.methanePercent - this.settings.explosionIntensity * IGNITED_DECAY_FACTOR * delta)
        weightedMethane += state.methanePercent
        peakMethane = Math.max(peakMethane, state.peakMethanePercent)
        return
      }
      const source = this.sources[index] || {}
      const sourceHeight = source.height ?? source.position?.y ?? 5
      const ceilingFactor = Math.max(CEILING_FACTOR_MIN, Math.min(CEILING_FACTOR_MAX,
        1 + (sourceHeight - CEILING_BASE_HEIGHT) * this.settings.stratificationStrength * CEILING_HEIGHT_COEFFICIENT))
      const sourceTypeFactor = GAS_SOURCE_TYPE_FACTORS[source.type] || 1
      const sourceEmissionFactor = Math.max(0, source.emissionFactor || 1)
      const localLeakRate = baseLeakRate * ceilingFactor * sourceTypeFactor * sourceEmissionFactor
      const localVentLoss = state.methanePercent * (this.settings.ventilationStrength * VENT_LOSS_BASE + this.settings.ventilationVisualStrength * VENT_LOSS_VISUAL)
      const mixing = (sourceAverage - state.methanePercent) * this.settings.ventilationVisualStrength * MIXING_COEFFICIENT
      const nextValue = state.methanePercent + (localLeakRate - localVentLoss + mixing) * delta
      state.methanePercent = this._clampFinite(nextValue, 0, upperLimit)
      state.peakMethanePercent = Math.max(state.peakMethanePercent, state.methanePercent)
      state.accumulationSeconds += delta
      if (this._isMethaneInExplosiveRange(state.methanePercent)) state.explosiveWindowSeconds += delta
      weightedMethane += state.methanePercent
      peakMethane = Math.max(peakMethane, state.peakMethanePercent)
      visibleMax = Math.max(visibleMax, state.methanePercent)
    })

    this.methanePercent = this._safeNumber(weightedMethane / activeSourceCount)
    this.peakMethanePercent = Math.max(this.peakMethanePercent, peakMethane)
    this._updateSafetyInterlock(visibleMax)

    const visibleConcentration = Math.max(VISUAL_CONCENTRATION_MIN, Math.min(1, visibleMax / this.settings.methaneUpperExplosiveLimit))
    this.settings.concentration = visibleConcentration
    if (this._isMethaneInExplosiveRange(this.methanePercent)) this.explosiveWindowSeconds += delta

    this.visualAdapter.syncAccumulationVisuals(this.sourceStates)
    if (this.stage === 'ignited') this.visualAdapter.syncIgnitedVisuals(this.sourceStates)
  }

  // ==================== 二阶段：点火源评估 ====================

  _updateManualIgnitionWindow(delta) {
    if (!this.settings.manualIgnitionRequested) return
    this.manualIgnitionElapsed += delta
    if (this.manualIgnitionElapsed > this.settings.manualIgnitionWindow) {
      this.settings.manualIgnitionRequested = false
      this.manualIgnitionElapsed = 0
    }
  }

  _evaluateIgnition(delta) {
    const hasIgnitionSource = this._hasEffectiveIgnitionSource()
    const manualIgnitionIndex = this._getMostDangerousExplosiveIndex()
    const canIgniteByContact = this.elapsed > this.settings.minIgnitionDelay
      && hasIgnitionSource
      && this.settings.manualIgnitionRequested
      && manualIgnitionIndex >= 0
    const canIgniteByTime = this.settings.allowTimedIgnition
      && this.elapsed > this.settings.ignitionDelay
      && this._isMethaneInExplosiveRange(this.methanePercent)
      && this.explosiveWindowSeconds > this.settings.minExplosiveWindowSeconds
      && hasIgnitionSource

    if (this.stage === 'leaking' && (canIgniteByContact || canIgniteByTime)) {
      this.primaryIgnitionIndex = canIgniteByContact ? manualIgnitionIndex : this._getMostDangerousIndex()
      this._setStage('sparking')
      this.sparkElapsed = 0
      this.visualAdapter.setSparking(this.primaryIgnitionIndex)
      this._startSpark()
    }

    if (this.stage === 'sparking') {
      this.sparkElapsed += delta
      this._updateSpark(delta)
      if (this.sparkElapsed > this.settings.sparkDuration) {
        const stillExplosive = this._hasStableExplosiveGasAtIndex(this.primaryIgnitionIndex)
        const state = this.sourceStates[this.primaryIgnitionIndex]
        if (!state || !stillExplosive || !this._hasEffectiveIgnitionSource()) {
          this._abortSparking()
          return
        }
        this._igniteAtIndex(this.primaryIgnitionIndex >= 0 ? this.primaryIgnitionIndex : 0, true)
        this.visualAdapter.clearSparking()
        this._destroySpark()
        this.settings.manualIgnitionRequested = false
        this.manualIgnitionElapsed = 0
      }
    }
  }

  _abortSparking() {
    this._setStage('leaking')
    this.visualAdapter.clearSparking()
    this._destroySpark()
    this.settings.manualIgnitionRequested = false
    this.manualIgnitionElapsed = 0
  }

  _igniteAtIndex(index, primary = false) {
    if (index < 0 || index >= this.sources.length) return
    const state = this.sourceStates[index]
    if (state?.ignited) return
    if (state) { state.ignited = true; state.ignitionDelay = 0 }
    const source = this.sources[index]
    const visuals = this.visualAdapter.visuals
    if (visuals[index] && typeof visuals[index].setIgnited === 'function') {
      visuals[index].setIgnited(true)
    }

    if (primary || this.stage !== 'ignited') {
      this.primaryIgnitionIndex = index
      this._setStage('ignited')
      this.on.ignition({ index, position: source?.position?.clone?.() || null })
      this.on.explosion({ index, intensity: this.settings.explosionIntensity })
    }
    this._scheduleFlamePropagation(index)
  }

  _scheduleFlamePropagation(sourceIndex) {
    const source = this.sources[sourceIndex]
    if (!source) return
    const sourcePosition = source.position
    const speed = Math.max(1, this.settings.flamePropagationSpeed)
    this.sources.forEach((source2, index) => {
      if (index === sourceIndex) return
      const state = this.sourceStates[index]
      if (!state || state.ignited || Number.isFinite(state.ignitionDelay)) return
      if (!this._isMethaneInExplosiveRange(state.methanePercent)) return
      const distance = sourcePosition.distanceTo(source2.position)
      state.ignitionDelay = Math.max(this.settings.flamePropagationMinDelay,
        Math.min(this.settings.flamePropagationMaxDelay, distance / speed))
    })
  }

  _updateFlamePropagation(delta) {
    if (this.stage !== 'ignited') return
    this.sourceStates.forEach((state, index) => {
      if (!state || state.ignited || !Number.isFinite(state.ignitionDelay)) return
      state.ignitionDelay -= delta
      if (state.ignitionDelay <= 0) this._igniteAtIndex(index)
    })
  }

  // ==================== 三阶段：爆炸与灾害扩散 ====================

  _updatePostExplosion(delta) {
    if (this.stage !== 'ignited') return
    this.postExplosionSeconds += delta

    const shockwaveLimit = Math.max(this.settings.toxicSmokeFlowLength, this.settings.coalDustFlowLength, 40)
    if (this.postExplosionSeconds <= this.settings.shockwaveDuration) {
      this.shockwaveFrontMeters = Math.min(shockwaveLimit,
        this.shockwaveFrontMeters + this.settings.shockwaveSpeed * this.settings.explosionIntensity * delta)
    }
    const shockDamageFalloff = Math.max(0, 1 - this.postExplosionSeconds / Math.max(SHOCKWAVE_FALLOFF_MIN_DURATION, this.settings.shockwaveDuration))
    this.shockwaveDamageRadius = this.shockwaveFrontMeters * this.settings.shockwaveDamageFactor * shockDamageFalloff

    const generationWindow = Math.max(CO_GENERATION_WINDOW_MIN,
      Math.min(CO_GENERATION_WINDOW_MAX, this.settings.aftermathDuration * CO_GENERATION_WINDOW_RATIO))
    const generationFalloff = Math.max(0, 1 - this.postExplosionSeconds / generationWindow)
    const generated = this.settings.coGenerationRate * this.settings.explosionIntensity * generationFalloff * delta
    const ventilationDecay = this.carbonMonoxidePpm * (
      this.settings.coVentilationDecay
      + this.settings.ventilationStrength * CO_VENT_DECAY_STRENGTH
      + this.settings.ventilationVisualStrength * CO_VENT_DECAY_VISUAL
    ) * delta
    this.carbonMonoxidePpm = this._clampFinite(
      this.carbonMonoxidePpm + generated - ventilationDecay, 0, this.settings.coMaxPpm)

    const ventilationCarry = CO_FRONT_CARRY_BASE
      + this.settings.ventilationVisualStrength * CO_FRONT_CARRY_VISUAL
      + this.settings.ventilationStrength * CO_FRONT_CARRY_STRENGTH
    const frontSpeed = this.settings.coFrontSpeed * this.settings.explosionIntensity * ventilationCarry
    this.carbonMonoxideFrontMeters = Math.min(this.settings.toxicSmokeFlowLength,
      this.carbonMonoxideFrontMeters + frontSpeed * delta)

    const dangerRatioByPpm = Math.max(0, Math.min(1, this.carbonMonoxidePpm / this.settings.coDangerPpm))
    this.carbonMonoxideDangerRadius = this.carbonMonoxideFrontMeters * dangerRatioByPpm * this.settings.coDangerSpreadFactor
    this.peakCarbonMonoxidePpm = Math.max(this.peakCarbonMonoxidePpm, this.carbonMonoxidePpm)
    this.visualAdapter.syncAftermathToxicVisuals(dangerRatioByPpm)
  }

  _updateSecondaryBlastConditions() {
    if (!this.sources.length) return
    const residualMethane = this.sourceStates.reduce((max, state) => {
      if (!state || state.ignited) return max
      return Math.max(max, state.methanePercent || 0)
    }, 0)

    let anyCoalDustEnough = false
    this.visualAdapter.visuals.forEach((gasLeak) => {
      if (!gasLeak?.aftermath) return
      const coalDustEnough = gasLeak.aftermath.coalDustEnabled
        && gasLeak.aftermath.coalDust?.opacity >= this.settings.secondaryCoalDustOpacity
      anyCoalDustEnough = anyCoalDustEnough || coalDustEnough
      const residualGasEnough = residualMethane >= this.settings.secondaryResidualMethanePercent
      gasLeak.aftermath.secondaryConditionMet = !this.settings.secondaryRequiresConditions || coalDustEnough || residualGasEnough
    })

    const residualGasEnough = residualMethane >= this.settings.secondaryResidualMethanePercent
    const wasReady = this.secondaryBlastReady
    this.secondaryResidualMethane = residualMethane
    this.secondaryCoalDustReady = anyCoalDustEnough
    this.secondaryBlastReady = !this.settings.secondaryRequiresConditions || anyCoalDustEnough || residualGasEnough
    this.secondaryBlastReason = !this.settings.secondaryBlastEnabled ? '未启用'
      : !this.settings.secondaryRequiresConditions ? '强制允许'
      : residualGasEnough && anyCoalDustEnough ? '残余瓦斯+煤尘'
      : residualGasEnough ? '残余瓦斯'
      : anyCoalDustEnough ? '煤尘扬起'
      : '条件不足'

    if (wasReady !== this.secondaryBlastReady) {
      this.on.secondaryBlast({ ready: this.secondaryBlastReady, reason: this.secondaryBlastReason })
    }
  }

  // ==================== 安全联锁 ====================

  _updateSafetyInterlock(localPeak) {
    const alarm = this._getGasSafetyAlarm(localPeak)
    const prev = this.safetyAlarmLevel
    this.safetyAlarmLevel = alarm.level
    if (prev !== alarm.level) this.on.safetyAlarm(alarm.level, alarm)
    if (this.settings.methaneInterlockEnabled && alarm.level === 'powerCut' && this.stage !== 'ignited') {
      this.visualAdapter.clearSparking()
      this._destroySpark()
    }
  }

  // ==================== 火花特效 ====================

  _startSpark() {
    const pos = this._getIgnitionSparkPosition()
    if (!pos) return
    this._destroySpark()
    const nearest = this._getNearestLeakPosition(pos)
    const direction = nearest ? nearest.clone().sub(pos).normalize() : new THREE.Vector3(-1, 0.15, 0)
    this._spark = new SparkEffect({
      position: pos,
      direction,
      count: Math.round(SPARK_COUNT_BASE * this.settings.ignitionSparkStrength),
      range: SPARK_RANGE_BASE + this.settings.ignitionSparkStrength * SPARK_RANGE_SCALE,
      maxLifetime: 0.7,
    })
    this._sparkScene = this._sceneForSpark
    if (this._sparkScene && this._spark.addTo) this._spark.addTo(this._sparkScene)
    this._sparkStart = this.elapsed
  }

  _updateSpark(delta) {
    if (!this._spark) return
    const pos = this._getIgnitionSparkPosition()
    if (pos) this._spark.setPosition(pos.x, pos.y, pos.z)
    this._spark.update(delta, Math.max(0, this.elapsed - this._sparkStart))
  }

  _destroySpark() {
    if (!this._spark) return
    if (this._sparkScene && this._spark.removeFrom) this._spark.removeFrom(this._sparkScene)
    this._spark.dispose()
    this._spark = null
    this._sparkStart = 0
  }

  setSparkScene(scene) {
    this._sceneForSpark = scene || null
  }

  // ==================== 查询方法 ====================

  isMethaneInExplosiveRange(percent) { return this._isMethaneInExplosiveRange(percent) }
  getGasSafetyAlarm(localPeak = this.methanePercent) { return this._getGasSafetyAlarm(localPeak) }
  getCarbonMonoxideDanger(ppm = this.carbonMonoxidePpm) { return this._getCarbonMonoxideDanger(ppm) }

  getOxygenEstimate(methanePercent = this.methanePercent) {
    return this._clampFinite(20.9 * Math.max(0, 1 - methanePercent / 100), 0, 20.9)
  }

  getOxygenDanger(methanePercent = this.methanePercent) {
    const oxygen = this.getOxygenEstimate(methanePercent)
    if (oxygen < 12) return { level: 'fatal', text: '严重缺氧', oxygen }
    if (oxygen < 18) return { level: 'danger', text: '缺氧危险', oxygen }
    if (oxygen < 19.5) return { level: 'warn', text: '氧气偏低', oxygen }
    return { level: 'normal', text: '氧气正常', oxygen }
  }

  getRoofMethaneEstimate(localPeak = this.methanePercent) {
    return this._clampFinite(localPeak * this.settings.upperAccumulation * (1 + this.settings.stratificationStrength), 0, 99)
  }

  getRiskDetailAtPosition(position) { return this._getRiskDetailAtPosition(position) }
  getRiskAtPosition(position) { return this._getRiskDetailAtPosition(position).risk }
  getNearestLeakPosition(position) { return this._getNearestLeakPosition(position) }

  getNearestLeakDistance(position) {
    if (!position || !this.sources.length) return Infinity
    return this.sources.reduce((nearest, source) => {
      if (!source.position) return nearest
      return Math.min(nearest, position.distanceTo(source.position))
    }, Infinity)
  }

  getProcessStageText(localPeak = this.methanePercent) {
    const coDanger = this._getCarbonMonoxideDanger()
    const oxygenDanger = this.getOxygenDanger(localPeak)
    if (this.stage === 'sparking') return '点火源触发'
    if (this.stage === 'ignited') {
      if (this.shockwaveDamageRadius > SECONDARY_BLAST_VISUAL_RADIUS) return '冲击波破坏'
      if (this.secondaryBlastReady) return `二爆风险-${this.secondaryBlastReason}`
      if (coDanger.level === 'fatal') return 'CO致命蔓延'
      if (coDanger.level === 'danger') return 'CO危险蔓延'
      if (this.carbonMonoxideFrontMeters > 1) return '有毒气体蔓延'
      return '爆后烟尘扩散'
    }
    if (this.safetyAlarmLevel === 'powerCut') return '超限断电'
    if (this.safetyAlarmLevel === 'alarm') return '瓦斯报警撤离'
    if (oxygenDanger.level === 'fatal') return '严重缺氧'
    if (oxygenDanger.level === 'danger') return '缺氧危险'
    if (this._isMethaneInExplosiveRange(localPeak)) return '进入爆炸范围'
    if (this.safetyAlarmLevel === 'warn') return '瓦斯预警'
    if (this.stage === 'leaking') return '泄漏积聚'
    return '未泄漏'
  }

  // ==================== 内部工具 ====================

  _setStage(stage) {
    if (!STAGE_SEQUENCE.includes(stage)) return
    const prev = this.stage
    this.stage = stage
    if (prev !== stage) this.on.stageChange(stage, prev)
  }

  _rebuildSourceStates() {
    this.sourceStates = this.sources.map(() => ({
      methanePercent: 0,
      peakMethanePercent: 0,
      accumulationSeconds: 0,
      explosiveWindowSeconds: 0,
      ignited: false,
      ignitionDelay: Infinity,
    }))
    this.visualAdapter.setVisuals(this._collectVisuals())
  }

  _ensureSourceStates() {
    if (this.sourceStates.length !== this.sources.length) this._rebuildSourceStates()
  }

  _collectVisuals() { return this.visualAdapter?.visuals || [] }

  attachVisuals(visuals) { this.visualAdapter.setVisuals(visuals) }

  _isMethaneInExplosiveRange(percent) {
    return percent >= this.settings.methaneLowerExplosiveLimit && percent <= this.settings.methaneUpperExplosiveLimit
  }

  _hasStableExplosiveGasAtIndex(index) {
    const state = this.sourceStates[index]
    return state && this._isMethaneInExplosiveRange(state.methanePercent) && state.explosiveWindowSeconds >= this.settings.minExplosiveWindowSeconds
  }

  _getGasSafetyAlarm(localPeak = this.methanePercent) {
    if (localPeak >= this.settings.methanePowerCutPercent) return { level: 'powerCut', text: '超限断电' }
    if (localPeak >= this.settings.methaneAlarmPercent) return { level: 'alarm', text: '瓦斯报警' }
    if (localPeak >= this.settings.methaneWarnPercent) return { level: 'warn', text: '瓦斯预警' }
    return { level: 'normal', text: '监测正常' }
  }

  _getCarbonMonoxideDanger(ppm = this.carbonMonoxidePpm) {
    if (ppm >= this.settings.coFatalPpm) return { level: 'fatal', text: 'CO致命' }
    if (ppm >= this.settings.coDangerPpm) return { level: 'danger', text: 'CO危险' }
    if (ppm >= this.settings.coWarnPpm) return { level: 'warn', text: 'CO预警' }
    return { level: 'normal', text: 'CO正常' }
  }

  _isIgnitionPowerCut() {
    return this.settings.methaneInterlockEnabled
      && !this.settings.ignitionProtectionFailed
      && this.safetyAlarmLevel === 'powerCut'
      && this.stage !== 'ignited'
  }

  _hasEffectiveIgnitionSource() {
    return !this._isIgnitionPowerCut()
      && this.settings.ignitionSparkStrength > 0.05
      && this.settings.ignitionTemperatureC >= this.settings.ignitionMinTemperatureC
      && this.settings.ignitionEnergyMj >= this.settings.ignitionMinEnergyMj
  }

  _getMostDangerousIndex() {
    let bestIndex = 0
    let bestMethane = -1
    this.sourceStates.forEach((state, index) => {
      if (state.methanePercent > bestMethane) { bestMethane = state.methanePercent; bestIndex = index }
    })
    return bestIndex
  }

  _getMostDangerousExplosiveIndex() {
    let bestIndex = -1
    let bestMethane = -1
    this.sourceStates.forEach((state, index) => {
      if (state && !state.ignited && this._hasStableExplosiveGasAtIndex(index) && state.methanePercent > bestMethane) {
        bestMethane = state.methanePercent
        bestIndex = index
      }
    })
    return bestIndex
  }

  _getRiskDetailAtPosition(position) {
    if (!position || !this.sources.length) return { risk: 0, index: -1, distance: Infinity }
    const ignitionDistance = this.settings.ignitionDistance ?? 18
    const mixRadius = Math.max(ignitionDistance, this.settings.gasLocalMixingRadius, this.settings.gasDiffuseCrossSection * 2)
    let best = { risk: 0, index: -1, distance: Infinity }
    this.sources.forEach((source, index) => {
      const leakPosition = source.position
      if (!leakPosition) return
      const distance = position.distanceTo(leakPosition)
      const distanceFactor = Math.max(0, 1 - distance / mixRadius)
      const sourceY = leakPosition.y || 5
      const upperBias = Math.max(RISK_UPPER_BIAS_MIN,
        Math.min(RISK_UPPER_BIAS_MAX,
          1
          + (position.y - sourceY) * this.settings.stratificationStrength * RISK_STRATIFICATION_COEFFICIENT
          + (this._ceilingY - Math.max(position.y, sourceY)) * RISK_CEILING_COEFFICIENT))
      const localMethane = this.sourceStates[index]?.methanePercent || this.methanePercent
      const risk = localMethane * distanceFactor * upperBias
      if (risk > best.risk) best = { risk, index, distance }
    })
    return best
  }

  _getNearestLeakPosition(position) {
    if (!position || !this.sources.length) return null
    let nearest = null
    let nearestDistance = Infinity
    this.sources.forEach((source) => {
      if (!source.position) return
      const distance = position.distanceTo(source.position)
      if (distance < nearestDistance) { nearestDistance = distance; nearest = source.position }
    })
    return nearest
  }

  _getIgnitionSourcePosition() {
    if (typeof this.ignitionSourceProvider === 'function') {
      try { return this.ignitionSourceProvider() } catch { return null }
    }
    return null
  }

  _getIgnitionSparkPosition() {
    const base = this._getIgnitionSourcePosition()
    if (!base) return null
    return base.clone().add(new THREE.Vector3(0, SPARK_HEIGHT_OFFSET, 0))
  }

  // ==================== 数值安全工具 ====================

  /**
   * 清理时间步长，避免 NaN / Infinity / 过大值导致模拟异常。
   * @param {number} delta
   * @returns {number}
   */
  _sanitizeDelta(delta) {
    const n = Number(delta)
    if (!Number.isFinite(n) || n < 0) return 0
    return Math.min(n, 1) // 限制最大 1 秒，避免长时间卡顿后跳变
  }

  /**
   * 将数值规范化为有限数，无效时返回 0。
   * @param {number} value
   * @returns {number}
   */
  _safeNumber(value) {
    return Number.isFinite(value) ? value : 0
  }

  /**
   * 将数值限制在 [min, max] 范围内，同时兜底 NaN/Infinity。
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  _clampFinite(value, min, max) {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
  }
}

export default GasAccidentController
