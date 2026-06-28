/** 切面图层相机正视配置：视线沿平面法线方向看向切面中心 */
const PLANE_VIEW_AXES = {
  xy: { normal: [0, 0, 1] },
  xz: { normal: [0, 1, 0] },
  yz: { normal: [1, 0, 0] },
}

const PLANE_FOCUSABLE_KINDS = new Set([
  'cloud',
  'contour',
  'vector',
  'radar_cloud',
])

function normalizeBounds(rawBounds) {
  const bounds = rawBounds?.data || rawBounds
  if (!bounds || typeof bounds !== 'object') return null

  const minX = Number(bounds.xmin ?? bounds.x_min ?? bounds.min?.[0])
  const maxX = Number(bounds.xmax ?? bounds.x_max ?? bounds.max?.[0])
  const minY = Number(bounds.ymin ?? bounds.y_min ?? bounds.min?.[1])
  const maxY = Number(bounds.ymax ?? bounds.y_max ?? bounds.max?.[1])
  const minZ = Number(bounds.zmin ?? bounds.z_min ?? bounds.min?.[2])
  const maxZ = Number(bounds.zmax ?? bounds.z_max ?? bounds.max?.[2])

  if (
    [minX, maxX, minY, maxY, minZ, maxZ].every((value) => Number.isFinite(value))
  ) {
    return { minX, maxX, minY, maxY, minZ, maxZ }
  }
  return null
}

function resolveBoundsCenterMeters(bounds) {
  return {
    x: (bounds.minX + bounds.maxX) / 200,
    y: (bounds.minY + bounds.maxY) / 200,
    z: (bounds.minZ + bounds.maxZ) / 200,
  }
}

export function parseGeneratedLayerPlane(layer) {
  if (!layer) return null
  const id = String(layer.id || '')
  const parts = id.split(':')
  const kind = String(layer.kind || parts[0] || '').toLowerCase()
  if (!PLANE_FOCUSABLE_KINDS.has(kind) && !PLANE_FOCUSABLE_KINDS.has(parts[0])) {
    return null
  }
  const plane = String(layer.plane ?? parts[2] ?? 'xy').toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(PLANE_VIEW_AXES, plane)) {
    return null
  }
  const coordinate = Number(layer.coordinate ?? parts[3] ?? 0)
  return {
    plane,
    coordinateCm: Number.isFinite(coordinate) ? coordinate : 0,
  }
}

export function isPlaneFocusableLayer(layer) {
  return PLANE_FOCUSABLE_KINDS.has(String(layer?.kind || '').toLowerCase())
}

function resolvePlaneTargetMeters(plane, coordinateCm, bounds) {
  const center = bounds
    ? resolveBoundsCenterMeters(bounds)
    : { x: 0, y: 0, z: 0 }
  const coordM = (Number(coordinateCm) || 0) / 100
  if (plane === 'xz') return [center.x, coordM, center.z]
  if (plane === 'yz') return [coordM, center.y, center.z]
  return [center.x, center.y, coordM]
}

function resolvePlaneSpanMeters(plane, bounds) {
  if (!bounds) return 6
  if (plane === 'xz') {
    return (
      Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 100
    )
  }
  if (plane === 'yz') {
    return (
      Math.max(bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 100
    )
  }
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 100
}

/**
 * 计算切面图层的相机正视参数（与 planeMode.setPlaneTransform 对齐）
 * @returns {{ target:number[], position:number[], plane:string, coordinateCm:number, distance:number } | null}
 */
export function computePlaneLayerCameraFocus({
  layer,
  geometryBounds = null,
  distanceScale = 2.2,
  minDistance = 4,
} = {}) {
  const selection = parseGeneratedLayerPlane(layer)
  if (!selection) return null

  const { plane, coordinateCm } = selection
  const axes = PLANE_VIEW_AXES[plane]
  const bounds = normalizeBounds(geometryBounds)
  const target = resolvePlaneTargetMeters(plane, coordinateCm, bounds)
  const span = resolvePlaneSpanMeters(plane, bounds)
  const distance = Math.max(minDistance, span * distanceScale)
  const position = target.map(
    (value, index) => value + axes.normal[index] * distance,
  )

  return {
    target,
    position,
    plane,
    coordinateCm,
    distance,
  }
}
