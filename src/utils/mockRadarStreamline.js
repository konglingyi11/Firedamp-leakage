/**
 * 雷达「能量轨迹线」本地模拟数据：从统一发射点向包围盒内辐射，遇介质结构区偏折/散射。
 * 坐标单位：cm（与监测点、流线 CSV 一致）。
 */

import { normalizeMonitoringPointBounds } from './monitoringPointDrag.js'

/** 与 mockRadarVolume3d 默认体域一致：9m 立方，原点居中 */
export const DEFAULT_RADAR_STREAMLINE_BOUNDS = {
  xmin: -4500,
  xmax: 4500,
  ymin: -4500,
  ymax: 4500,
  zmin: -4500,
  zmax: 4500,
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function finiteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function vec3(x, y, z) {
  return { x, y, z }
}

function add(a, b) {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z)
}

function sub(a, b) {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z)
}

function scale(v, s) {
  return vec3(v.x * s, v.y * s, v.z * s)
}

function length(v) {
  return Math.hypot(v.x, v.y, v.z)
}

function normalize(v) {
  const len = length(v)
  if (len < 1e-8) return vec3(1, 0, 0)
  return scale(v, 1 / len)
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function normalizeRadarEmitter(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    x: finiteNumber(source.x),
    y: finiteNumber(source.y),
    z: finiteNumber(source.z),
  }
}

export function resolveRadarStreamlineBounds(rawBounds) {
  const normalized = normalizeMonitoringPointBounds(rawBounds)
  if (normalized) {
    return {
      xmin: normalized.min[0],
      xmax: normalized.max[0],
      ymin: normalized.min[1],
      ymax: normalized.max[1],
      zmin: normalized.min[2],
      zmax: normalized.max[2],
    }
  }
  return { ...DEFAULT_RADAR_STREAMLINE_BOUNDS }
}

export function clampPointToRadarBounds(point, bounds) {
  const b = resolveRadarStreamlineBounds(bounds)
  return {
    x: clamp(finiteNumber(point?.x), b.xmin, b.xmax),
    y: clamp(finiteNumber(point?.y), b.ymin, b.ymax),
    z: clamp(finiteNumber(point?.z), b.zmin, b.zmax),
  }
}

function boundsCenter(bounds) {
  return vec3(
    (bounds.xmin + bounds.xmax) / 2,
    (bounds.ymin + bounds.ymax) / 2,
    (bounds.zmin + bounds.zmax) / 2,
  )
}

function boundsSpan(bounds) {
  return Math.min(
    bounds.xmax - bounds.xmin,
    bounds.ymax - bounds.ymin,
    bounds.zmax - bounds.zmin,
  )
}

function fibonacciDirection(seedIndex, total) {
  const y = 1 - (2 * seedIndex) / Math.max(total - 1, 1)
  const radius = Math.sqrt(Math.max(0, 1 - y * y))
  const phi = GOLDEN_ANGLE * seedIndex
  return normalize(vec3(Math.cos(phi) * radius, y, Math.sin(phi) * radius))
}

function seedDirection(seedIndex, total, emitter, bounds, transmitMode = '单向') {
  const center = boundsCenter(bounds)
  const towardCenter = normalize(sub(center, emitter))
  const sphereDir = fibonacciDirection(seedIndex, total)
  const fanWeight = transmitMode === '扇形' ? 0.42 : 0.22
  return normalize(add(scale(towardCenter, 1 - fanWeight), scale(sphereDir, fanWeight)))
}

function structureDeflection(pos, bounds) {
  const center = boundsCenter(bounds)
  const span = boundsSpan(bounds)
  const rel = sub(pos, center)
  const inStructure =
    Math.abs(rel.x) < span * 0.12 &&
    Math.abs(rel.y) < span * 0.22 &&
    Math.abs(rel.z) < span * 0.18
  if (!inStructure) return vec3(0, 0, 0)
  return scale(normalize(rel), 0.38)
}

function advancePoint(pos, dir, step, bounds) {
  let next = add(pos, scale(dir, step))
  let newDir = { ...dir }
  const axes = [
    ['x', 'xmin', 'xmax'],
    ['y', 'ymin', 'ymax'],
    ['z', 'zmin', 'zmax'],
  ]
  for (const [axis, minKey, maxKey] of axes) {
    if (next[axis] <= bounds[minKey]) {
      next[axis] = bounds[minKey]
      newDir[axis] = Math.abs(newDir[axis])
    } else if (next[axis] >= bounds[maxKey]) {
      next[axis] = bounds[maxKey]
      newDir[axis] = -Math.abs(newDir[axis])
    }
  }
  return { pos: next, dir: normalize(newDir) }
}

function traceStreamline({
  emitter,
  bounds,
  seedIndex,
  seedCount,
  pointsPerStreamline,
  maximumStreamlineLength,
  transmitMode,
}) {
  const points = [[emitter.x, emitter.y, emitter.z]]
  let pos = { ...emitter }
  let dir = seedDirection(seedIndex, seedCount, emitter, bounds, transmitMode)
  const span = boundsSpan(bounds)
  const step = span / Math.max(pointsPerStreamline * 1.15, 8)
  const maxLen = finiteNumber(maximumStreamlineLength, span * 0.82)

  for (let i = 1; i < pointsPerStreamline; i += 1) {
    const deflect = structureDeflection(pos, bounds)
    const curl = scale(fibonacciDirection(i + seedIndex * 3, 12), 0.06)
    dir = normalize(add(add(scale(dir, 0.9), deflect), curl))
    const advanced = advancePoint(pos, dir, step, bounds)
    pos = advanced.pos
    dir = advanced.dir
    points.push([pos.x, pos.y, pos.z])
    if (length(sub(pos, emitter)) >= maxLen) break
  }
  return points
}

/**
 * @returns {{ streamlines: number[][][], emitter: object, bounds: object, seed_count: number, points_per_streamline: number }}
 */
export function buildRadarStreamlineMock(options = {}) {
  const bounds = resolveRadarStreamlineBounds(options.bounds)
  const emitter = clampPointToRadarBounds(
    normalizeRadarEmitter(options.emitter),
    bounds,
  )
  const seedCount = Math.max(
    4,
    Math.min(120, Math.round(finiteNumber(options.seedCount, 28))),
  )
  const pointsPerStreamline = Math.max(
    8,
    Math.min(96, Math.round(finiteNumber(options.pointsPerStreamline, 36))),
  )
  const maximumStreamlineLength = options.maximumStreamlineLength
  const transmitMode = options.transmitMode || '单向'

  const streamlines = Array.from({ length: seedCount }, (_, seedIndex) =>
    traceStreamline({
      emitter,
      bounds,
      seedIndex,
      seedCount,
      pointsPerStreamline,
      maximumStreamlineLength,
      transmitMode,
    }).filter((point) => point.every((value) => Number.isFinite(value))),
  ).filter((line) => line.length >= 2)

  return {
    streamlines,
    emitter,
    bounds,
    seed_count: seedCount,
    points_per_streamline: pointsPerStreamline,
  }
}

/** 供 Three.js 流线模块直接 consume 的 payload（无 URL，内联 streamlines） */
export function buildRadarStreamlineMockPayload(options = {}) {
  const mock = buildRadarStreamlineMock(options)
  return {
    task_id: options.taskId ?? 'radar-mock',
    time_step: 0,
    use_pregen: true,
    is_mock: true,
    streamlines: mock.streamlines,
    emitter: mock.emitter,
    bounds: mock.bounds,
    seed_count: mock.seed_count,
    points_per_streamline: mock.points_per_streamline,
  }
}
