const KELVIN_OFFSET = 273.15

export function isUnsetBoundaryTemperature(value) {
  return value == null || value === '' || Number.isNaN(Number(value))
}

/** 后端 Kelvin → 表单摄氏度；未设置或无效值（含 0K）保持 null */
export function boundaryTemperatureFromBackend(kelvin) {
  if (isUnsetBoundaryTemperature(kelvin)) return null
  const k = Number(kelvin)
  if (!Number.isFinite(k) || k <= 0) return null
  return Number((k - KELVIN_OFFSET).toFixed(2))
}

/** 表单摄氏度 → 后端 Kelvin；未设置返回 null（提交时省略字段） */
export function boundaryTemperatureToBackend(celsius) {
  if (isUnsetBoundaryTemperature(celsius)) return null
  const c = Number(celsius)
  if (!Number.isFinite(c)) return null
  return Number((c + KELVIN_OFFSET).toFixed(2))
}

/** 表单/只读区：摄氏度显示 */
export function formatBoundaryTemperatureDisplay(
  celsius,
  { unsetLabel = '未设置' } = {},
) {
  if (isUnsetBoundaryTemperature(celsius)) return unsetLabel
  const c = Number(celsius)
  if (!Number.isFinite(c)) return unsetLabel
  return `${c.toFixed(2)} °C`
}

/** 原始 API 数据（Kelvin）→ 展示用摄氏度文案 */
export function formatBoundaryTemperatureKelvinDisplay(
  kelvin,
  { unsetLabel = '未设置' } = {},
) {
  if (isUnsetBoundaryTemperature(kelvin)) return unsetLabel
  return formatBoundaryTemperatureDisplay(
    boundaryTemperatureFromBackend(kelvin),
    { unsetLabel },
  )
}
