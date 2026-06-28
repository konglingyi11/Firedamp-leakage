function finiteNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function clamp(value, min, max) {
  const low = finiteNumber(min, -Infinity)
  const high = finiteNumber(max, Infinity)
  return Math.min(Math.max(value, low), high)
}

function clampAxis(value, bounds, axisIndex) {
  const normalized = normalizeMonitoringPointBounds(bounds)
  if (!normalized) return value
  return clamp(value, normalized.min[axisIndex], normalized.max[axisIndex])
}

function finiteBoundsPair(min, max) {
  const low = Number(min)
  const high = Number(max)
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  return low <= high ? [low, high] : [high, low]
}

export function normalizeMonitoringPointBounds(rawBounds) {
  const bounds = rawBounds?.data || rawBounds
  if (!bounds || typeof bounds !== 'object') return null

  const xPair = Array.isArray(bounds.min)
    ? finiteBoundsPair(bounds.min[0], bounds.max?.[0])
    : finiteBoundsPair(bounds.xmin ?? bounds.x_min, bounds.xmax ?? bounds.x_max)
  const yPair = Array.isArray(bounds.min)
    ? finiteBoundsPair(bounds.min[1], bounds.max?.[1])
    : finiteBoundsPair(bounds.ymin ?? bounds.y_min, bounds.ymax ?? bounds.y_max)
  const zPair = Array.isArray(bounds.min)
    ? finiteBoundsPair(bounds.min[2], bounds.max?.[2])
    : finiteBoundsPair(bounds.zmin ?? bounds.z_min, bounds.zmax ?? bounds.z_max)

  if (!xPair || !yPair || !zPair) return null
  return {
    min: [xPair[0], yPair[0], zPair[0]],
    max: [xPair[1], yPair[1], zPair[1]],
  }
}

export function clampMonitoringPointToBounds(point, bounds) {
  const normalized = normalizeMonitoringPointBounds(bounds)
  if (!normalized || !point) return point
  return {
    ...point,
    x: clamp(finiteNumber(point.x), normalized.min[0], normalized.max[0]),
    y: clamp(finiteNumber(point.y), normalized.min[1], normalized.max[1]),
    z: clamp(finiteNumber(point.z), normalized.min[2], normalized.max[2]),
  }
}

export function scenePointMetersToMonitoringPoint(
  point,
  scenePointMeters,
  bounds = null,
) {
  const x = finiteNumber(scenePointMeters?.x) * 100
  const y = finiteNumber(scenePointMeters?.y) * 100
  const z = finiteNumber(scenePointMeters?.z) * 100

  return {
    ...point,
    x: clampAxis(x, bounds, 0),
    y: clampAxis(y, bounds, 1),
    z: clampAxis(z, bounds, 2),
  }
}
