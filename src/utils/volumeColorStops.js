const DEFAULT_STOP_COLORS = ['#1f8cff', '#f43f5e', '#39e600']

const clamp01 = (value) => Math.max(0, Math.min(1, value))

const toFiniteNumber = (value) => {
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

const normalizeHexColor = (value, fallback = '#ffffff') => {
  const text = String(value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase()
  }
  return fallback
}

export function createDefaultColorStops(range) {
  const vmin = toFiniteNumber(range?.vmin) ?? 0
  const vmax = toFiniteNumber(range?.vmax) ?? vmin + 1
  const safeMax = vmax > vmin ? vmax : vmin + 1
  const mid = vmin + (safeMax - vmin) / 2
  return [
    { value: vmin, color: DEFAULT_STOP_COLORS[0] },
    { value: mid, color: DEFAULT_STOP_COLORS[1] },
    { value: safeMax, color: DEFAULT_STOP_COLORS[2] },
  ]
}

export function normalizeColorStops(stops, range) {
  const vmin = toFiniteNumber(range?.vmin)
  const vmax = toFiniteNumber(range?.vmax)
  if (vmin == null || vmax == null || vmax <= vmin) return []

  return (Array.isArray(stops) ? stops : [])
    .map((stop, index) => {
      const rawValue = toFiniteNumber(stop?.value)
      if (rawValue == null) return null
      const value = Math.max(vmin, Math.min(vmax, rawValue))
      return {
        value,
        color: normalizeHexColor(stop?.color, DEFAULT_STOP_COLORS[index % DEFAULT_STOP_COLORS.length]),
        position: clamp01((value - vmin) / (vmax - vmin)),
        ...(toFiniteNumber(stop?.bandPosition) == null
          ? {}
          : { bandPosition: clamp01(toFiniteNumber(stop.bandPosition)) }),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.value - b.value)
}

export function colorStopsToGradient(stops, range, direction = 'horizontal') {
  const normalized = normalizeColorStops(stops, range)
  if (normalized.length < 2) return ''
  const deg = direction === 'vertical' ? '0deg' : '90deg'
  const parts = normalized.map(
    (stop) => `${stop.color} ${Number((stop.position * 100).toFixed(2))}%`,
  )
  return `linear-gradient(${deg}, ${parts.join(', ')})`
}

const hexToRgb = (hex) => {
  const normalized = normalizeHexColor(hex)
  const value = Number.parseInt(normalized.slice(1), 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b]
    .map((part) => Math.round(part + 1e-9).toString(16).padStart(2, '0'))
    .join('')}`

const sampleColorArray = (colors, position) => {
  const normalizedColors = (Array.isArray(colors) ? colors : [])
    .map((color) => normalizeHexColor(color, ''))
    .filter(Boolean)
  if (normalizedColors.length === 0) return '#ffffff'
  if (normalizedColors.length === 1) return normalizedColors[0]

  const safePosition = clamp01(position)
  const scaled = safePosition * (normalizedColors.length - 1)
  const low = Math.floor(scaled)
  const high = Math.min(low + 1, normalizedColors.length - 1)
  const localT = clamp01(scaled - low)
  const c0 = hexToRgb(normalizedColors[low])
  const c1 = hexToRgb(normalizedColors[high])
  return rgbToHex({
    r: c0.r + (c1.r - c0.r) * localT,
    g: c0.g + (c1.g - c0.g) * localT,
    b: c0.b + (c1.b - c0.b) * localT,
  })
}

const mapValuePositionToColorbandPosition = (normalizedStops, position) => {
  if (normalizedStops.length < 2) return clamp01(position)
  const safePosition = clamp01(position)
  const lastIndex = normalizedStops.length - 1
  const upperIndex = normalizedStops.findIndex(
    (stop) => stop.position >= safePosition,
  )
  if (upperIndex <= 0) return 0
  if (upperIndex < 0) return 1

  const lower = normalizedStops[upperIndex - 1]
  const upper = normalizedStops[upperIndex]
  const width = Math.max(upper.position - lower.position, 1e-8)
  const localT = clamp01((safePosition - lower.position) / width)
  const lowerBandPosition = toFiniteNumber(lower.bandPosition) ?? (upperIndex - 1) / lastIndex
  const upperBandPosition = toFiniteNumber(upper.bandPosition) ?? upperIndex / lastIndex
  return lowerBandPosition + (upperBandPosition - lowerBandPosition) * localT
}

export function sampleColorStops(stops, range, sampleCount = 256) {
  const normalized = normalizeColorStops(stops, range)
  const count = Math.max(2, Math.round(Number(sampleCount) || 256))
  if (normalized.length < 2) return []

  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : index / (count - 1)
    const upperIndex = normalized.findIndex((stop) => stop.position >= position)
    if (upperIndex <= 0) return normalized[0].color
    if (upperIndex < 0) return normalized[normalized.length - 1].color

    const lower = normalized[upperIndex - 1]
    const upper = normalized[upperIndex]
    const width = Math.max(upper.position - lower.position, 1e-8)
    const localT = clamp01((position - lower.position) / width)
    const c0 = hexToRgb(lower.color)
    const c1 = hexToRgb(upper.color)
    return rgbToHex({
      r: c0.r + (c1.r - c0.r) * localT,
      g: c0.g + (c1.g - c0.g) * localT,
      b: c0.b + (c1.b - c0.b) * localT,
    })
  })
}

export function sampleMappedColorStops(
  stops,
  range,
  baseColors,
  sampleCount = 256,
) {
  const normalized = normalizeColorStops(stops, range)
  const count = Math.max(2, Math.round(Number(sampleCount) || 256))
  if (normalized.length < 2) return []

  return Array.from({ length: count }, (_, index) => {
    const position = index / (count - 1)
    const colorbandPosition = mapValuePositionToColorbandPosition(
      normalized,
      position,
    )
    return sampleColorArray(baseColors, colorbandPosition)
  })
}

export function mappedColorStopsToGradient(
  stops,
  range,
  baseColors,
  direction = 'horizontal',
  sampleCount = 64,
) {
  const sampled = sampleMappedColorStops(stops, range, baseColors, sampleCount)
  if (sampled.length < 2) return ''
  const deg = direction === 'vertical' ? '0deg' : '90deg'
  const parts = sampled.map((color, index) => {
    const position = index / (sampled.length - 1)
    return `${color} ${Number((position * 100).toFixed(2))}%`
  })
  return `linear-gradient(${deg}, ${parts.join(', ')})`
}

export function withMappedColorStopColors(stops, range, baseColors) {
  const normalized = normalizeColorStops(stops, range)
  if (normalized.length < 2) return normalized
  const lastIndex = normalized.length - 1
  return normalized.map((stop, index) => ({
    ...stop,
    color: sampleColorArray(baseColors, index / lastIndex),
  }))
}
