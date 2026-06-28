import {
  extractRadarMockVolumeBandId,
  isRadarMockVolumeVariableId,
} from '@/utils/mockRadarVolume3d.js'
import { radarFrequencyLabel } from '@/constants/radarFrequencies.js'

// 气体名称映射表 (统一使用小写key以支持不区分大小写匹配)
export const GAS_NAME_MAP = {
  mass_fraction_of_c7h8: { zh: '甲苯', en: 'C₇H₈', color: '#ec4899' },
  mass_fraction_of_c3h5oh: { zh: '丙烯醇', en: 'C₃H₅OH', color: '#14b8a6' },
  mass_fraction_of_c6h5oh: { zh: '苯酚', en: 'C₆H₅OH', color: '#f59e0b' },
  mass_fraction_of_ch3oh: { zh: '甲醇', en: 'CH₃OH', color: '#3b82f6' },
  mass_fraction_of_ch4: { zh: '甲烷', en: 'CH₄', color: '#10b981' },
  mass_fraction_of_h2s: { zh: '硫化氢', en: 'H₂S', color: '#ef4444' },
  mass_fraction_of_c2h5oh: { zh: '乙醇', en: 'C₂H₅OH', color: '#8b5cf6' },
  mass_fraction_of_ch4s: { zh: '甲硫醇', en: 'CH₃SH', color: '#f97316' },
  mass_fraction_of_co: { zh: '一氧化碳', en: 'CO', color: '#6366f1' },
  mass_fraction_of_c8h10: { zh: '二甲苯', en: 'C₈H₁₀', color: '#d946ef' },
  mass_fraction_of_c5h8: { zh: '异戊二烯', en: 'C₅H₈', color: '#06b6d4' },
  mass_fraction_of_c3h9n: { zh: '三甲胺', en: '(CH₃)₃N', color: '#a855f7' },
  mass_fraction_of_c6h6: { zh: '苯', en: 'C₆H₆', color: '#f43f5e' },
  mass_fraction_of_nh3: { zh: '氨气', en: 'NH₃', color: '#22c55e' },
  mass_fraction_of_c3h6o: { zh: '丙酮', en: 'C₃H₆O', color: '#eab308' },
  mass_fraction_of_co2: { zh: '二氧化碳', en: 'CO₂', color: '#64748b' },
  mass_fraction_of_h2o: { zh: '水', en: 'H₂O', color: '#93c5fd' },
}

export const COLOR_PALETTE = [
  '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#ec4899',
  '#6366f1', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#d946ef',
]

export const ENV_VAR_KEYS = {
  temperature: 'Temperature',
  pressure: 'Pressure',
  windSpeed: 'VelocityMagnitude',
  humidity: 'Mass_fraction_of_h2o',
}

export function getGasInfoById(id) {
  if (!id) return null
  const normalizedId = String(id).trim().toLowerCase()

  if (GAS_NAME_MAP[normalizedId]) return GAS_NAME_MAP[normalizedId]

  const possibleVariations = [
    normalizedId,
    normalizedId.replace('_', ''),
    normalizedId.replace(/\s+/g, '_'),
  ]

  for (const [key, info] of Object.entries(GAS_NAME_MAP)) {
    const keyLower = key.toLowerCase()
    for (const variation of possibleVariations) {
      if (keyLower === variation || keyLower.includes(variation) || variation.includes(keyLower)) {
        return info
      }
    }
  }
  if (normalizedId.includes('h2o')) return GAS_NAME_MAP['mass_fraction_of_h2o']
  return null
}

export function isGasVariable(variableId) {
  const id = String(variableId).toLowerCase()
  if (id === 'mass_fraction_of_air') return false
  return id.startsWith('mass_fraction_of_')
}

export const VARIABLE_ZH_NAME_MAP = {
  Pressure: '压力',
  Temperature: '温度',
  VelocityMagnitude: '速度大小',
  'Velocity:0': '速度X分量',
  'Velocity:1': '速度Y分量',
  'Velocity:2': '速度Z分量',
  VelocityX: '速度X分量',
  VelocityY: '速度Y分量',
  VelocityZ: '速度Z分量',
  RadarMockVolume3D: '三维雷达',
  RadarMockPPI: '平面雷达',
  Mass_fraction_of_air: '空气质量分数',
  Mass_fraction_of_c7h8: '甲苯',
  Mass_fraction_of_c3h5oh: '丙烯醇',
  Mass_fraction_of_c6h5oh: '苯酚',
  Mass_fraction_of_ch3oh: '甲醇',
  Mass_fraction_of_ch4: '甲烷',
  Mass_fraction_of_h2s: '硫化氢',
  Mass_fraction_of_c2h5oh: '乙醇',
  Mass_fraction_of_ch4s: '甲硫醇',
  Mass_fraction_of_co: '一氧化碳',
  Mass_fraction_of_c8h10: '二甲苯',
  Mass_fraction_of_c5h8: '异戊二烯',
  Mass_fraction_of_c3h9n: '三甲胺',
  Mass_fraction_of_c6h6: '苯',
  Mass_fraction_of_nh3: '氨气',
  Mass_fraction_of_c3h6o: '丙酮',
  Mass_fraction_of_co2: '二氧化碳',
  Mass_fraction_of_h2o: '水',
}

const VARIABLE_ZH_NAME_MAP_LOWER = Object.fromEntries(
  Object.entries(VARIABLE_ZH_NAME_MAP).map(([k, v]) => [k.toLowerCase(), v]),
)

export const getVariableDisplayName = (raw) => {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (!key) return '请选择变量'
  if (isRadarMockVolumeVariableId(key)) {
    const bandId = extractRadarMockVolumeBandId(key)
    return bandId ? `雷达 ${radarFrequencyLabel(bandId)}` : '三维雷达'
  }
  const byMap = VARIABLE_ZH_NAME_MAP[key] || VARIABLE_ZH_NAME_MAP_LOWER[key.toLowerCase()]
  if (byMap) return byMap
  if (key.toLowerCase().startsWith('mass_fraction_of_')) {
    const formula = key.slice('mass_fraction_of_'.length).toUpperCase()
    return `气体质量分数 (${formula})`
  }
  return key
}
