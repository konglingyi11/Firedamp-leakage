/** 把颜色转为 rgba，并提取 r/g/b/a 数值 */
export function parseColorToRgba(input) {
  const fallback = { r: 255, g: 255, b: 255, a: 1, rgba: 'rgba(255,255,255,1)' }
  if (!input || typeof input !== 'string') return fallback
  const c = input.trim()

  // #RGB / #RRGGBB / #RRGGBBAA
  if (c.startsWith('#')) {
    let hex = c.slice(1)
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('')
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length === 8 ? Number((parseInt(hex.slice(6, 8), 16) / 255).toFixed(4)) : 1
      return { r, g, b, a, rgba: `rgba(${r},${g},${b},${a})` }
    }
  }

  // rgba(...) / rgb(...)
  const m = c.match(/^rgba?\(([^)]+)\)$/i)
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim())
    const r = Math.max(0, Math.min(255, Number(parts[0] ?? 255)))
    const g = Math.max(0, Math.min(255, Number(parts[1] ?? 255)))
    const b = Math.max(0, Math.min(255, Number(parts[2] ?? 255)))
    const a = parts.length > 3 ? Math.max(0, Math.min(1, Number(parts[3] ?? 1))) : 1
    return { r, g, b, a, rgba: `rgba(${r},${g},${b},${a})` }
  }

  return fallback
}

/** UE 线性颜色：parseColorToRgba 的 r/g/b 为 0~255，转为 0~1 浮点 */
export function rgbByteToFloat01(channel) {
  return Math.min(1, Math.max(0, Number(channel) / 255))
}

export function alphaToFloat01(a) {
  return Math.min(1, Math.max(0, Number(a)))
}
