/** 矢量图 quality_preset 兜底校验 */
export function sanitizeVectorQualityPreset(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s === '1k' || s === '2k' || s === '4k') return s
  return '1k'
}

/** 矢量图 transparent_background 兜底校验 */
export function sanitizeVectorTransparentBackground(v) {
  return typeof v === 'boolean' ? v : true
}

/** glyph_density 兜底校验（>=4 && <=256） */
export function sanitizeGlyphDensity(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 4
  return Math.min(256, Math.max(4, Math.trunc(n)))
}

/** line_width 兜底校验（>0 && <=20） */
export function sanitizeVectorLineWidth(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.min(20, Math.max(0.01, n))
}

/** 动画速度统一为 FPS；兼容旧配置（>60 视为百分比，如 100 -> 1fps） */
export function resolveAnimationSpeedMultiplier(rawSpeed) {
  const n = Number(rawSpeed)
  if (!Number.isFinite(n) || n <= 0) return 1
  return n > 60 ? n / 100 : n
}
