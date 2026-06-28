/**
 * 瓦斯泄漏 / 爆炸事故模拟工具集合
 * 从 F:\code\ue\wasi\wasi 迁移过来的封装方法。
 */

export { GasAccidentController } from './GasAccidentController'
export { GasFieldPredictor, PREDICTION_METHODS } from './GasFieldPredictor'
export { GasVisualAdapter } from './GasVisualAdapter'
export { SparkEffect } from './GasLeakEffects'
export {
  resolveSettings,
  applyVentilationScenario,
  getVentilationVector,
  DEFAULT_GAS_ACCIDENT_OPTIONS,
  SETTING_GROUPS,
  VENTILATION_SCENARIOS,
  GAS_SOURCE_TYPE_FACTORS,
  SAFE_SCENARIO_PRESET,
  ACCIDENT_SCENARIO_PRESET,
} from './GasAccidentPresets'
export { triggerScreenFlash, disposeScreenFlash } from './screenFlash'
