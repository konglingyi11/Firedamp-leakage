import * as THREE from 'three'

/**
 * 瓦斯灾害三阶段编排层 - 配置与预设
 * 集中所有场景共用的默认配置，按语义分组，同时保持扁平字段向后兼容。
 */

/** 配置分组定义（用于 resolveSettings 返回 $groups） */
export const SETTING_GROUPS = {
  source: [
    'sourceCount', 'gasColor', 'gasDensity', 'concentration', 'spread',
  ],
  smoke: [
    'gasJetSpeed', 'gasPointSize', 'gasTurbulence', 'gasParticleCount',
    'gasLifetime', 'gasFlowLength', 'gasCrossSection', 'gasVerticalSpread',
    'gasDiffusionStrength', 'gasBirthSpread', 'gasMaxParticleScale', 'gasVolumeFill',
    'gasOpacity',
  ],
  diffuse: [
    'gasDiffuseParticleCount', 'gasDiffuseOpacity', 'gasDiffuseFlowLength',
    'gasDiffuseCrossSection', 'gasDiffuseStrength', 'gasDiffusePointSize',
    'gasDiffuseVerticalSpread', 'gasDiffuseBirthSpread', 'gasDiffuseMaxParticleScale',
  ],
  marker: [
    'sourceMarkerVisible', 'sourceMarkerSize',
  ],
  flame: [
    'flameJetSpeed', 'flameDuration', 'flameIntensity', 'flamePropagationSpeed',
    'flamePropagationMinDelay', 'flamePropagationMaxDelay',
  ],
  ventilation: [
    'ventilationScenario', 'ventilationFailureFactor', 'ventilationStrength',
    'ventilationVisualStrength', 'ventilationDirX', 'ventilationDirY', 'ventilationDirZ',
    'upperAccumulation', 'stratificationStrength', 'gasLocalMixingRadius',
  ],
  chemistry: [
    'methaneLowerExplosiveLimit', 'methaneUpperExplosiveLimit',
    'minExplosiveWindowSeconds', 'leakRatePercent',
  ],
  safety: [
    'methaneWarnPercent', 'methaneAlarmPercent', 'methanePowerCutPercent',
    'methaneInterlockEnabled',
  ],
  ignition: [
    'ignitionProtectionFailed', 'ignitionSparkStrength', 'ignitionTemperatureC',
    'ignitionEnergyMj', 'ignitionMinTemperatureC', 'ignitionMinEnergyMj',
    'sparkDuration', 'manualIgnitionWindow', 'manualIgnitionRequested',
    'allowTimedIgnition', 'minIgnitionDelay', 'ignitionDelay',
  ],
  explosion: [
    'explosionIntensity',
  ],
  shockwave: [
    'aftermathDuration', 'shockwaveDuration', 'shockwaveSpeed', 'shockwaveDamageFactor',
  ],
  feedback: [
    'cameraShakeEnabled', 'cameraShakeIntensity', 'cameraShakeDuration',
    'lightingDamageEnabled', 'lightingFlashIntensity', 'lightingDamageIntensity',
    'lightingFlickerDuration',
  ],
  toxic: [
    'toxicSmokeOpacity', 'toxicSmokeFlowLength', 'toxicSmokeCrossSection',
    'toxicSmokeVerticalSpread', 'toxicSmokeDiffusionStrength', 'toxicSmokeParticleCount',
    'coGenerationRate', 'coVentilationDecay', 'coFrontSpeed', 'coDangerSpreadFactor',
    'coWarnPpm', 'coDangerPpm', 'coFatalPpm', 'coMaxPpm',
  ],
  coalDust: [
    'coalDustEnabled', 'coalDustOpacity', 'coalDustFlowLength',
    'coalDustCrossSection', 'coalDustVerticalSpread', 'coalDustParticleCount',
  ],
  debris: [
    'rockDebrisEnabled', 'rockDebrisCount', 'rockDebrisSize', 'rockDebrisOpacity',
    'roofCollapseEnabled', 'roofCollapseCount', 'roofCollapseSize', 'roofCollapseOpacity',
  ],
  secondary: [
    'secondaryBlastEnabled', 'secondaryBlastDelay', 'secondaryRequiresConditions',
    'secondaryResidualMethanePercent', 'secondaryCoalDustOpacity',
  ],
}

/** 默认瓦斯灾害配置（扁平结构，向后兼容） */
export const DEFAULT_GAS_ACCIDENT_OPTIONS = {
  // ---------- source 泄漏源 ----------
  sourceCount: 1,
  gasColor: '#8a9295',
  gasDensity: 0.72,
  concentration: 0.62,
  spread: 1.35,
  // ---------- smoke 近场烟雾 ----------
  gasJetSpeed: 0.55,
  gasPointSize: 4.5,
  gasTurbulence: 1.9,
  gasParticleCount: 12000,
  gasLifetime: 45,
  gasFlowLength: 120,
  gasCrossSection: 9.0,
  gasVerticalSpread: 2.2,
  gasDiffusionStrength: 2.0,
  gasBirthSpread: 0.65,
  gasMaxParticleScale: 7.0,
  gasVolumeFill: 0.95,
  gasOpacity: 0.18,
  // ---------- diffuse 远场扩散烟雾 ----------
  gasDiffuseParticleCount: 6000,
  gasDiffuseOpacity: 0.12,
  gasDiffuseFlowLength: 80,
  gasDiffuseCrossSection: 36,
  gasDiffuseStrength: 1.8,
  gasDiffusePointSize: 3.4,
  gasDiffuseVerticalSpread: 10.0,
  gasDiffuseBirthSpread: 2.6,
  gasDiffuseMaxParticleScale: 9.0,
  // ---------- marker 泄漏源标记 ----------
  sourceMarkerVisible: true,
  sourceMarkerSize: 1.7,
  // ---------- flame 火焰（爆炸火球） ----------
  flameJetSpeed: 0.72,
  flameDuration: 3.2,
  flameIntensity: 2.0,
  flamePropagationSpeed: 48,
  flamePropagationMinDelay: 0.25,
  flamePropagationMaxDelay: 3.5,
  // ---------- ventilation 通风 ----------
  ventilationScenario: 'weak',
  ventilationFailureFactor: 1.35,
  ventilationStrength: 0.12,
  ventilationVisualStrength: 0.18,
  ventilationDirX: 0,
  ventilationDirY: 0.03,
  ventilationDirZ: -1,
  upperAccumulation: 1.65,
  stratificationStrength: 0.22,
  gasLocalMixingRadius: 34,
  // ---------- chemistry 甲烷化学 ----------
  methaneLowerExplosiveLimit: 5,
  methaneUpperExplosiveLimit: 16,
  minExplosiveWindowSeconds: 1.2,
  leakRatePercent: 0.22,
  // ---------- safety 安全阈值 ----------
  methaneWarnPercent: 1,
  methaneAlarmPercent: 1.5,
  methanePowerCutPercent: 2,
  methaneInterlockEnabled: true,
  // ---------- ignition 点火源 ----------
  ignitionProtectionFailed: false,
  ignitionSparkStrength: 1.0,
  ignitionTemperatureC: 720,
  ignitionEnergyMj: 0.35,
  ignitionMinTemperatureC: 650,
  ignitionMinEnergyMj: 0.28,
  sparkDuration: 1.1,
  manualIgnitionWindow: 12,
  manualIgnitionRequested: false,
  allowTimedIgnition: false,
  minIgnitionDelay: 30,
  ignitionDelay: 300,
  // ---------- explosion 爆炸 ----------
  explosionIntensity: 1.35,
  // ---------- shockwave 冲击波 ----------
  aftermathDuration: 180,
  shockwaveDuration: 2.8,
  shockwaveSpeed: 95,
  shockwaveDamageFactor: 0.36,
  // ---------- feedback 场景反馈参数 ----------
  cameraShakeEnabled: true,
  cameraShakeIntensity: 0.42,
  cameraShakeDuration: 1.6,
  lightingDamageEnabled: true,
  lightingFlashIntensity: 8,
  lightingDamageIntensity: 1.2,
  lightingFlickerDuration: 16,
  // ---------- toxic 爆后有毒气体（CO） ----------
  toxicSmokeOpacity: 0.06,
  toxicSmokeFlowLength: 70,
  toxicSmokeCrossSection: 22,
  toxicSmokeVerticalSpread: 7.5,
  toxicSmokeDiffusionStrength: 3.2,
  toxicSmokeParticleCount: 5200,
  coGenerationRate: 420,
  coVentilationDecay: 0.08,
  coFrontSpeed: 18,
  coDangerSpreadFactor: 0.62,
  coWarnPpm: 50,
  coDangerPpm: 200,
  coFatalPpm: 800,
  coMaxPpm: 2400,
  // ---------- coalDust 煤尘 ----------
  coalDustEnabled: true,
  coalDustOpacity: 0.075,
  coalDustFlowLength: 42,
  coalDustCrossSection: 20,
  coalDustVerticalSpread: 4.2,
  coalDustParticleCount: 3600,
  // ---------- debris 飞石/顶板 ----------
  rockDebrisEnabled: true,
  rockDebrisCount: 180,
  rockDebrisSize: 0.42,
  rockDebrisOpacity: 0.85,
  roofCollapseEnabled: true,
  roofCollapseCount: 90,
  roofCollapseSize: 0.85,
  roofCollapseOpacity: 0.9,
  // ---------- secondary 二次爆炸 ----------
  secondaryBlastEnabled: true,
  secondaryBlastDelay: 2.6,
  secondaryRequiresConditions: true,
  secondaryResidualMethanePercent: 4,
  secondaryCoalDustOpacity: 0.04,
}

/** 通风场景预设 */
export const VENTILATION_SCENARIOS = {
  normal: { dilution: 1.65, accumulation: 0.72, visual: 1.2, upper: 0.85 },
  weak: { dilution: 0.65, accumulation: 1.35, visual: 0.45, upper: 1.25 },
  shortCircuit: { dilution: 0.38, accumulation: 1.65, visual: 0.9, upper: 1.45 },
  sealed: { dilution: 0.08, accumulation: 2.15, visual: 0.08, upper: 1.75 },
}

/** 泄漏源类型 -> 涌出系数 */
export const GAS_SOURCE_TYPE_FACTORS = {
  coalSeamCrack: 1.0,
  goaf: 1.35,
  sealedArea: 1.6,
  ventilationDisorder: 1.2,
}

/** 安全场景预设 */
export const SAFE_SCENARIO_PRESET = {
  ventilationScenario: 'normal',
  methaneInterlockEnabled: true,
  ignitionProtectionFailed: false,
  ignitionSparkStrength: 0.35,
  ignitionTemperatureC: 420,
  ignitionEnergyMj: 0.08,
  leakRatePercent: 0.18,
  allowTimedIgnition: false,
  manualIgnitionRequested: false,
}

/** 事故场景预设 */
export const ACCIDENT_SCENARIO_PRESET = {
  ventilationScenario: 'weak',
  methaneInterlockEnabled: true,
  ignitionProtectionFailed: true,
  ignitionSparkStrength: 1.0,
  ignitionTemperatureC: 720,
  ignitionEnergyMj: 0.35,
  leakRatePercent: 0.42,
  allowTimedIgnition: false,
  manualIgnitionRequested: false,
}

/**
 * 把通风场景应用到配置对象
 * @param {Object} settings
 * @param {string} scenarioName
 */
export function applyVentilationScenario(settings, scenarioName) {
  const scenario = VENTILATION_SCENARIOS[scenarioName] || VENTILATION_SCENARIOS.weak
  settings.ventilationStrength = Number((0.18 * scenario.dilution).toFixed(2))
  settings.ventilationVisualStrength = Number((0.2 * scenario.visual).toFixed(2))
  settings.ventilationFailureFactor = scenario.accumulation
  settings.upperAccumulation = Number((1.35 * scenario.upper).toFixed(2))
}

/**
 * 取归一化通风向量
 * @param {Object} settings
 * @returns {THREE.Vector3}
 */
export function getVentilationVector(settings) {
  const wind = new THREE.Vector3(
    settings.ventilationDirX,
    settings.ventilationDirY,
    settings.ventilationDirZ,
  )
  if (wind.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, 0)
  return wind.normalize().multiplyScalar(settings.ventilationVisualStrength)
}

/**
 * 校验并规范单个数值，避免 NaN / Infinity 进入配置。
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function _normalizeNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 把任意局部配置合并成完整配置（补全缺失字段）。
 * 返回的对象仍为扁平结构以保证向后兼容，同时提供非枚举属性 `$groups`，
 * 可通过 `settings.$groups.source` 等方式按语义分组访问。
 *
 * @param {Object} [partial={}]
 * @returns {Object} 完整配置对象（扁平 + 分组访问）
 */
export function resolveSettings(partial = {}) {
  const flat = { ...DEFAULT_GAS_ACCIDENT_OPTIONS }

  // 先合并用户提供值，并做数值兜底
  for (const key of Object.keys(partial)) {
    if (key in flat) {
      const defaultValue = flat[key]
      const userValue = partial[key]
      flat[key] = typeof defaultValue === 'number'
        ? _normalizeNumber(userValue, defaultValue)
        : (userValue ?? defaultValue)
    } else {
      // 允许保留未在默认配置中定义的扩展字段
      flat[key] = partial[key]
    }
  }

  // 构建分组视图（非枚举，避免污染 Object.keys / JSON.stringify）
  const groups = {}
  for (const [group, keys] of Object.entries(SETTING_GROUPS)) {
    groups[group] = Object.fromEntries(keys.map((key) => [key, flat[key]]))
  }

  Object.defineProperty(flat, '$groups', {
    value: groups,
    enumerable: false,
    configurable: true,
    writable: true,
  })

  return flat
}

export default resolveSettings
