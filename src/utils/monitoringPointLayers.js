const DEFAULT_TASK_KEY = 'default'

export function normalizeMonitoringPoints(points) {
  if (!Array.isArray(points)) return []
  return points
    .filter((point) => point?.id != null && String(point.id).trim() !== '')
    .map((point) => ({
      ...point,
      id: String(point.id),
      name: point.name || `监测点 ${String(point.id)}`,
      x: Number.isFinite(Number(point.x)) ? Number(point.x) : 0,
      y: Number.isFinite(Number(point.y)) ? Number(point.y) : 0,
      z: Number.isFinite(Number(point.z)) ? Number(point.z) : 0,
      visible: point.visible !== false,
    }))
}

export function buildMonitoringPointLayers(points, taskId) {
  const taskKey =
    taskId != null && String(taskId).trim() !== ''
      ? String(taskId).trim()
      : DEFAULT_TASK_KEY
  return normalizeMonitoringPoints(points).map((point) => ({
    id: `monitor:${taskKey}:${encodeURIComponent(point.id)}`,
    kind: 'monitor',
    label: point.name,
    visible: point.visible !== false,
    ready: true,
    loaded: true,
    pointId: point.id,
    point: { ...point },
  }))
}

export function resolveMonitoringLayerPointId(layer) {
  if (layer?.pointId != null) return String(layer.pointId)
  const rawId = String(layer?.id ?? '')
  const encodedPointId = rawId.split(':').at(-1)
  return encodedPointId ? decodeURIComponent(encodedPointId) : ''
}

export function applyMonitoringLayerVisibility(points, layer, visible) {
  const pointId = resolveMonitoringLayerPointId(layer)
  if (!pointId) return normalizeMonitoringPoints(points)
  return normalizeMonitoringPoints(points).map((point) =>
    String(point.id) === pointId ? { ...point, visible: Boolean(visible) } : point,
  )
}
