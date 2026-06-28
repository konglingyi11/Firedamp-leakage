/** 气体质量分数变量：与 VisualizationSettings / 统计等共用 */

export const gasNameMap = {
  Mass_fraction_of_c7h8: { zh: '甲苯', en: 'C₇H₈' },
  Mass_fraction_of_c3h5oh: { zh: '丙烯醇', en: 'C₃H₅OH' },
  Mass_fraction_of_c6h5oh: { zh: '苯酚', en: 'C₆H₅OH' },
  Mass_fraction_of_ch3oh: { zh: '甲醇', en: 'CH₃OH' },
  Mass_fraction_of_ch4: { zh: '甲烷', en: 'CH₄' },
  Mass_fraction_of_h2s: { zh: '硫化氢', en: 'H₂S' },
  Mass_fraction_of_c2h5oh: { zh: '乙醇', en: 'C₂H₅OH' },
  Mass_fraction_of_ch4s: { zh: '甲硫醇', en: 'CH₃SH' },
  Mass_fraction_of_co: { zh: '一氧化碳', en: 'CO' },
  Mass_fraction_of_c8h10: { zh: '二甲苯', en: 'C₈H₁₀' },
  Mass_fraction_of_c5h8: { zh: '异戊二烯', en: 'C₅H₈' },
  Mass_fraction_of_c3h9n: { zh: '三甲胺', en: '(CH₃)₃N' },
  Mass_fraction_of_c6h6: { zh: '苯', en: 'C₆H₆' },
  Mass_fraction_of_nh3: { zh: '氨气', en: 'NH₃' },
  Mass_fraction_of_c3h6o: { zh: '丙酮', en: 'C₃H₆O' },
  Mass_fraction_of_co2: { zh: '二氧化碳', en: 'CO₂' },
  Mass_fraction_of_h2o: { zh: '水', en: 'H₂O' },
}

export function isGasVariable(variableId) {
  const id = String(variableId || '').toLowerCase()
  if (id === 'mass_fraction_of_air') return false
  return id.startsWith('mass_fraction_of_')
}

/** 云图 contour 非气体变量（与 isGasVariable 互补）的展示名 */
export const cloudContourOtherVariableLabels = {
  Mass_fraction_of_air: '空气质量分数',
  Pressure: '压力',
  Temperature: '温度',
  VelocityMagnitude: '速度大小',
  'Velocity:0': '速度X分量',
  'Velocity:1': '速度Y分量',
  'Velocity:2': '速度Z分量',
}

export function formatCloudContourOtherVariableLabel(id) {
  if (!id) return ''
  return cloudContourOtherVariableLabels[id] || id
}
