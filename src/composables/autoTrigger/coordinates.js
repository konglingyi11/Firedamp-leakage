const OPEN_INTERVAL_INSET = 0.01
const OPEN_INTERVAL_EDGE_EPSILON = 1e-6

export function truncateAutoPlaneCoordinate(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return value
  const truncated = Math.trunc(numeric)
  return Object.is(truncated, -0) ? 0 : truncated
}

/** 切面坐标须落在开区间 (min, max)，不能取边界值 */
export function isInsideOpenPlaneInterval(coord, minVal, maxVal) {
  const value = Number(coord)
  const min = Number(minVal)
  const max = Number(maxVal)
  if (!Number.isFinite(value)) return false
  if (
    Number.isFinite(min) &&
    (value <= min || Math.abs(value - min) <= OPEN_INTERVAL_EDGE_EPSILON)
  ) {
    return false
  }
  if (
    Number.isFinite(max) &&
    (value >= max || Math.abs(value - max) <= OPEN_INTERVAL_EDGE_EPSILON)
  ) {
    return false
  }
  return true
}

function isRawInsideOpenPlaneInterval(raw, minVal, maxVal) {
  const value = Number(raw)
  const min = Number(minVal)
  const max = Number(maxVal)
  if (!Number.isFinite(value)) return false
  if (
    Number.isFinite(min) &&
    (value <= min || Math.abs(value - min) <= OPEN_INTERVAL_EDGE_EPSILON)
  ) {
    return false
  }
  if (
    Number.isFinite(max) &&
    (value >= max || Math.abs(value - max) <= OPEN_INTERVAL_INSET)
  ) {
    return false
  }
  return true
}

function nudgeIntoOpenPlaneInterval(value, minVal, maxVal) {
  const min = Number(minVal)
  const max = Number(maxVal)
  let next = Number(value)
  if (!Number.isFinite(next)) return value

  if (
    Number.isFinite(min) &&
    (next <= min || Math.abs(next - min) <= OPEN_INTERVAL_EDGE_EPSILON)
  ) {
    next = min + OPEN_INTERVAL_INSET
  }
  if (
    Number.isFinite(max) &&
    (next >= max || Math.abs(next - max) <= OPEN_INTERVAL_EDGE_EPSILON)
  ) {
    next = max - OPEN_INTERVAL_INSET
  }

  let coord = truncateAutoPlaneCoordinate(next)
  if (Number.isFinite(min) && coord <= min) {
    coord = truncateAutoPlaneCoordinate(min + 1)
  }
  if (Number.isFinite(max) && coord >= max) {
    coord = truncateAutoPlaneCoordinate(max - 1)
  }
  return coord
}

export function buildAutoPlaneCoords(from, to, spacing) {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    !Number.isFinite(spacing) ||
    spacing <= 0
  ) {
    return []
  }

  const rawCoords = []
  for (let v = from + spacing; v <= to; v += spacing) {
    rawCoords.push(v)
  }

  const seen = new Set()
  const coords = []
  for (const raw of rawCoords) {
    const coord = truncateAutoPlaneCoordinate(raw)
    if (seen.has(coord)) continue
    if (!isRawInsideOpenPlaneInterval(raw, from, to)) continue
    if (!isInsideOpenPlaneInterval(coord, from, to)) continue
    seen.add(coord)
    coords.push(coord)
  }
  return coords
}

export function clampAutoPlaneOffset(value, minVal, maxVal) {
  const v = Number(value)
  const min = Number(minVal)
  const max = Number(maxVal)
  if (!Number.isFinite(v)) return value
  return nudgeIntoOpenPlaneInterval(v, min, max)
}
