import { getVariableDisplayName } from '@/utils/gas'
import {
  buildAutoPlaneCoords,
  clampAutoPlaneOffset,
} from './coordinates.js'

export function isTaskCompleted(task) {
  return String(task?.status || '').trim().toLowerCase() === 'completed'
}

export function toArrayValue(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.value)) return value.value
  return []
}

export function formatAutoLoadText(stageLabel, detail) {
  if (!stageLabel) return detail
  if (!detail) return stageLabel
  return `${stageLabel} · ${detail}`
}

export function formatContourProgressText(stageLabel, variable, plane) {
  const variableText = getVariableDisplayName(variable)
  const planeText =
    String(plane ?? '')
      .trim()
      .toUpperCase() || 'XY'
  return formatAutoLoadText(stageLabel, `${variableText} · 云图 · ${planeText}`)
}

export function parseValidTimeSteps(raw) {
  return raw
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => Number.isFinite(Number(t)) && Number(t) !== 0)
    .map(({ i }) => raw[i])
}

export function buildCoords(from, to, spacing) {
  return buildAutoPlaneCoords(from, to, spacing)
}

export function clampOffset(value, minVal, maxVal) {
  return clampAutoPlaneOffset(value, minVal, maxVal)
}

export function getContourEntryMap(contourConfig) {
  if (!Array.isArray(contourConfig)) return {}
  return contourConfig.reduce((acc, item) => {
    const variable = String(item?.variable || '').trim()
    if (!variable) return acc
    acc[variable] = item
    return acc
  }, {})
}

export function extractNumericBounds(bounds) {
  const rawXMin = bounds?.xmin ?? bounds?.x_min ?? 0
  const rawXMax = bounds?.xmax ?? bounds?.x_max ?? 0
  const rawYMin = bounds?.ymin ?? bounds?.y_min ?? 0
  const rawYMax = bounds?.ymax ?? bounds?.y_max ?? 0
  const rawZMin = bounds?.zmin ?? bounds?.z_min ?? 0
  const rawZMax = bounds?.zmax ?? bounds?.z_max ?? 0
  const parsed = {
    xmin: Number(rawXMin),
    xmax: Number(rawXMax),
    ymin: Number(rawYMin),
    ymax: Number(rawYMax),
    zmin: Number(rawZMin),
    zmax: Number(rawZMax),
  }
  return Object.values(parsed).every((value) => Number.isFinite(value))
    ? parsed
    : null
}

export function getPlaneOffsetRange(plane, bounds) {
  if (plane === 'xy') return { min: bounds.zmin, max: bounds.zmax }
  if (plane === 'yz') return { min: bounds.xmin, max: bounds.xmax }
  if (plane === 'xz') return { min: bounds.ymin, max: bounds.ymax }
  return { min: null, max: null }
}

export function buildPlaneCoordinateSets(bounds, spacing) {
  return [
    { plane: 'xy', coords: buildCoords(bounds.zmin, bounds.zmax, spacing) },
    { plane: 'yz', coords: buildCoords(bounds.xmin, bounds.xmax, spacing) },
    { plane: 'xz', coords: buildCoords(bounds.ymin, bounds.ymax, spacing) },
  ]
}
