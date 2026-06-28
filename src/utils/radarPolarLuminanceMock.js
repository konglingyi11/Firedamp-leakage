/**
 * 与 `/test-leida` 二维极坐标 PPI 一致的「模拟 Luminance」场：同一套网格、同一采样公式；
 * `/test-leida` 热力图直接使用 computePolarHeatCells。
 * 首页平面雷达占位请使用 `mockRadarPpi.js` 的 `renderDiffuseRadarPpiToDataUrl`（圆心 PPI + 扩散波纹）。
 */

import {
  RADAR_FREQUENCY_OPTIONS,
  DEFAULT_RADAR_FREQUENCY,
  resolveRadarOptionId,
} from '@/constants/radarFrequencies.js'

export const POLAR_ANGLE_STEPS = 72
export const POLAR_RING_STEPS = 18
export const POLAR_ANGLE_STEP_DEG = 5
export const POLAR_RADIAL_STEP = 5

/** 与 TestLeidaView、useApply2D 雷达 mock 的 LU 范围一致 */
export const RADAR_POLAR_LU_MIN = 50
export const RADAR_POLAR_LU_MAX = 400

/** 业务 PPI 反射率色标对外显示范围（dBZ），与内部 LU 线性映射 */
export const RADAR_PPI_DBZ_MIN = 5
export const RADAR_PPI_DBZ_MAX = 65

const clamp01 = (t) => Math.max(0, Math.min(1, t))

/** 内部 LU → 对外 dBZ */
export function radarLuToDbz(lu) {
  const n = Number(lu)
  if (!Number.isFinite(n)) return null
  const t = clamp01(
    (n - RADAR_POLAR_LU_MIN) / (RADAR_POLAR_LU_MAX - RADAR_POLAR_LU_MIN),
  )
  return RADAR_PPI_DBZ_MIN + t * (RADAR_PPI_DBZ_MAX - RADAR_PPI_DBZ_MIN)
}

/** 对外 dBZ → 内部 LU */
export function radarDbzToLu(dbz) {
  const n = Number(dbz)
  if (!Number.isFinite(n)) return null
  const t = clamp01(
    (n - RADAR_PPI_DBZ_MIN) / (RADAR_PPI_DBZ_MAX - RADAR_PPI_DBZ_MIN),
  )
  return RADAR_POLAR_LU_MIN + t * (RADAR_POLAR_LU_MAX - RADAR_POLAR_LU_MIN)
}

export function radarDefaultPpiDbzRange() {
  return { vmin: RADAR_PPI_DBZ_MIN, vmax: RADAR_PPI_DBZ_MAX }
}

/** 图层仍存 LU 时（如 50–400）与 dBZ 区分 */
export function radarRangeLooksLikeLu(vmin, vmax) {
  const vmaxN = Number(vmax)
  const vminN = Number(vmin)
  return (
    (Number.isFinite(vmaxN) && vmaxN > 75) ||
    (Number.isFinite(vminN) && vminN >= 40)
  )
}

/** 统一为 dBZ 色标范围（供色带 overlay 显示） */
export function normalizeRadarColorbarRange(vmin, vmax) {
  const vminN = Number(vmin)
  const vmaxN = Number(vmax)
  if (!Number.isFinite(vminN) || !Number.isFinite(vmaxN)) return null
  if (radarRangeLooksLikeLu(vminN, vmaxN)) {
    const lo = radarLuToDbz(vminN)
    const hi = radarLuToDbz(vmaxN)
    if (lo == null || hi == null) return null
    return { vmin: lo, vmax: hi }
  }
  return { vmin: vminN, vmax: vmaxN }
}

export const PPI_PRODUCT_REFLECTIVITY_STOPS = [
  [0.0, [4, 12, 6]],
  [0.045, [0, 58, 30]],
  [0.1, [0, 118, 48]],
  [0.16, [76, 196, 70]],
  [0.24, [168, 228, 86]],
  [0.32, [246, 240, 70]],
  [0.41, [255, 200, 48]],
  [0.5, [255, 152, 40]],
  [0.58, [255, 100, 60]],
  [0.66, [246, 64, 70]],
  [0.74, [226, 36, 118]],
  [0.81, [200, 32, 200]],
  [0.88, [148, 60, 255]],
  [0.94, [240, 220, 255]],
  [1.0, [254, 250, 255]],
]

/** PPI 反射率色带 CSS 渐变色（低→高 dBZ） */
export function ppiReflectivityColorbarCssColors() {
  return PPI_PRODUCT_REFLECTIVITY_STOPS.map(
    ([, rgb]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
  )
}

/** Jet / rainbow 近似（低→高亮度），与 TestLeidaView 相同 */
export const JET_LIKE_COLORS = [
  '#080846',
  '#0000a8',
  '#0014ff',
  '#006cff',
  '#00b4ff',
  '#24ffc9',
  '#64ff24',
  '#d4ff00',
  '#ffc800',
  '#ff6400',
  '#ff0000',
  '#800000',
]

export function mulberry32(seed) {
  return function rnd() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function bandRadialScale(bandId) {
  const resolved =
    resolveRadarOptionId(bandId) ??
    resolveRadarOptionId(DEFAULT_RADAR_FREQUENCY) ??
    RADAR_FREQUENCY_OPTIONS[0]?.id
  const idx = RADAR_FREQUENCY_OPTIONS.findIndex((o) => o.id === resolved)
  if (idx < 0) return 1
  return 0.88 + idx * 0.028
}

/**
 * θ：0° 在正上方（北），顺时针递增；r：到圆心距离（与参考图一致取 0–90 标度）
 */
export function sampleLuminance(thetaDeg, r, bandScale, rnd) {
  let v = 48 + rnd() * 22

  const centerSigma = 14 * bandScale
  v += 335 * Math.exp(-(r * r) / (2 * centerSigma * centerSigma))

  if (thetaDeg >= 0 && thetaDeg <= 92 && r >= 46 && r <= 74) {
    const dr = r - 61
    const spread = 65 + rnd() * 25
    const angular = Math.max(0, 1 - Math.abs(thetaDeg - 46) / 62)
    v += 285 * Math.exp(-(dr * dr) / spread) * angular
  }

  if (thetaDeg >= 43 && thetaDeg <= 138 && r >= 74 && r <= 91) {
    const dr = r - 82.5
    v += 118 * Math.exp(-(dr * dr) / 55) * (0.55 + rnd() * 0.2)
  }

  return Math.min(430, Math.max(42, v))
}

export function computePolarHeatCells(seed, bandId) {
  const id = bandId != null ? String(bandId) : DEFAULT_RADAR_FREQUENCY
  const rnd = mulberry32(seed >>> 0)
  const bs = bandRadialScale(id)
  const data = []
  for (let ri = 0; ri < POLAR_RING_STEPS; ri++) {
    const rMid = ri * POLAR_RADIAL_STEP + POLAR_RADIAL_STEP / 2
    for (let ai = 0; ai < POLAR_ANGLE_STEPS; ai++) {
      const theta = ai * POLAR_ANGLE_STEP_DEG
      const val = sampleLuminance(theta, rMid, bs, rnd)
      data.push([ri, ai, Math.round(val)])
    }
  }
  return data
}

/**
 * 与 computePolarHeatCells 完全相同的遍历与 rnd 消耗顺序，输出浮点亮度（便于双线性插值）
 */
export function buildPolarLuminanceGridFloat32(seed, bandId) {
  const id = bandId != null ? String(bandId) : DEFAULT_RADAR_FREQUENCY
  const rnd = mulberry32(seed >>> 0)
  const bs = bandRadialScale(id)
  const out = new Float32Array(POLAR_RING_STEPS * POLAR_ANGLE_STEPS)
  let k = 0
  for (let ri = 0; ri < POLAR_RING_STEPS; ri++) {
    const rMid = ri * POLAR_RADIAL_STEP + POLAR_RADIAL_STEP / 2
    for (let ai = 0; ai < POLAR_ANGLE_STEPS; ai++) {
      const theta = ai * POLAR_ANGLE_STEP_DEG
      out[k++] = sampleLuminance(theta, rMid, bs, rnd)
    }
  }
  return out
}

function hexToRgb(hex) {
  const h = hex.replace('#', '').slice(0, 6)
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/**
 * t ∈ [0,1]：对应 (LU - LU_MIN) / (LU_MAX - LU_MIN)
 */
export function jetColorT(t) {
  const stops = JET_LIKE_COLORS
  const n = stops.length - 1
  const x = clamp01(t) * n
  const i = Math.min(Math.floor(x), n - 1)
  const f = x - i
  const a = hexToRgb(stops[i])
  const b = hexToRgb(stops[i + 1])
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const bl = Math.round(a[2] + (b[2] - a[2]) * f)
  return `rgb(${r},${g},${bl})`
}

export function jetRgbFromLuminance(val) {
  const u =
    (val - RADAR_POLAR_LU_MIN) / (RADAR_POLAR_LU_MAX - RADAR_POLAR_LU_MIN)
  const stops = JET_LIKE_COLORS
  const n = stops.length - 1
  const x = clamp01(u) * n
  const i = Math.min(Math.floor(x), n - 1)
  const f = x - i
  const a = hexToRgb(stops[i])
  const b = hexToRgb(stops[i + 1])
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

function rgbLerpStopsPairwise(stops, tRaw) {
  const t = clamp01(tRaw)
  if (t <= stops[0][0]) return [...stops[0][1]]
  const last = stops[stops.length - 1]
  if (t >= last[0]) return [...last[1]]
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]
    const [b, cb] = stops[i + 1]
    if (t <= b) {
      const span = Math.max(1e-6, b - a)
      const f = clamp01((t - a) / span)
      const s = f * f * (3 - 2 * f)
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * s),
        Math.round(ca[1] + (cb[1] - ca[1]) * s),
        Math.round(ca[2] + (cb[2] - ca[2]) * s),
      ]
    }
  }
  return [...last[1]]
}

/**
 * 平面雷达 mock（非 test-leida）：拉高 mid 段对比度再套 PPI 色谱，易出现黄/橙/红/紫斑块
 */
export function ppiReflectivityRgbFromLu(val) {
  const u =
    (val - RADAR_POLAR_LU_MIN) / (RADAR_POLAR_LU_MAX - RADAR_POLAR_LU_MIN)
  const boosted = clamp01(Math.pow(clamp01(u), 0.52))
  return rgbLerpStopsPairwise(PPI_PRODUCT_REFLECTIVITY_STOPS, boosted)
}

/** 微调格点亮度散布，使叠色后不糊成单色 */
export function jitterPolarGridForPpi(grid, seed) {
  const out = new Float32Array(grid.length)
  const s = seed >>> 0
  for (let i = 0; i < grid.length; i++) {
    let x = Math.imul(i + 374761393, s | 1) >>> 0
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    const h = x / 4294967296
    const dv = (h - 0.45) * 38
    out[i] = Math.min(432, Math.max(40, grid[i] + dv))
  }
  return out
}

/**
 * 在极坐标规则网格上对亮度双线性插值；θ 单位度，r 为 0–90 物理标度
 */
export function sampleLuminanceBilinear(grid, thetaDeg, rPhys) {
  const A = POLAR_ANGLE_STEPS
  const R = POLAR_RING_STEPS
  const r = Math.max(0, Math.min(90, rPhys))
  let t = thetaDeg % 360
  if (t < 0) t += 360

  let af = t / POLAR_ANGLE_STEP_DEG
  if (af >= A) af -= A * Math.floor(af / A)
  const ai0 = Math.floor(af) % A
  const ai1 = (ai0 + 1) % A
  const ta = af - Math.floor(af)

  const riFloat = r / POLAR_RADIAL_STEP - 0.5
  let riLo = Math.floor(riFloat)
  let riHi = riLo + 1
  let tr
  if (riLo < 0) {
    riLo = 0
    riHi = 0
    tr = 0
  } else if (riHi >= R) {
    riHi = R - 1
    riLo = R - 1
    tr = 0
  } else {
    tr = clamp01(riFloat - riLo)
  }

  const at = (ri, ai) => grid[ri * A + ai]
  const v0 = at(riLo, ai0) * (1 - ta) + at(riLo, ai1) * ta
  const v1 = at(riHi, ai0) * (1 - ta) + at(riHi, ai1) * ta
  return v0 * (1 - tr) + v1 * tr
}

/**
 * 最近邻取样：与实况雷达栅格格点块状拼接一致（无双向平滑）
 */
export function sampleLuminanceNearest(grid, thetaDeg, rPhys) {
  const A = POLAR_ANGLE_STEPS
  const R = POLAR_RING_STEPS
  const r = Math.max(0, Math.min(90, rPhys))
  let t = thetaDeg % 360
  if (t < 0) t += 360
  let ai = Math.floor((t + POLAR_ANGLE_STEP_DEG / 2) / POLAR_ANGLE_STEP_DEG) % A
  if (ai < 0) ai += A
  let ri = Math.round(r / POLAR_RADIAL_STEP - 0.5)
  ri = Math.max(0, Math.min(R - 1, ri))
  return grid[ri * A + ai]
}

/**
 * 按切片物理宽高（cm）推导占位雷达图的 CSS 像素尺寸，使纹理长宽比与切割面一致。
 */
export function radarMockCanvasCssSizeFromPhysicalCm(physicalWidthCm, physicalHeightCm) {
  const pw = Number(physicalWidthCm)
  const ph = Number(physicalHeightCm)
  const fallback = { cssW: 720, cssH: 1040 }
  if (!(pw > 0 && ph > 0)) return fallback
  const aspect = pw / ph
  const maxLong = 1500
  const maxTall = 1680
  const minW = 320
  const minH = 340
  let cssW
  let cssH
  if (aspect >= 1) {
    cssW = Math.min(maxLong, Math.max(minW, Math.round(920 * Math.sqrt(aspect))))
    cssH = Math.max(minH, cssW / aspect)
    if (cssH > maxTall) {
      cssH = maxTall
      cssW = Math.max(minW, cssH * aspect)
    }
  } else {
    cssH = Math.min(maxTall, Math.max(minH, Math.round(920 / Math.sqrt(aspect))))
    cssW = Math.max(minW, cssH * aspect)
    if (cssW > maxLong) {
      cssW = maxLong
      cssH = Math.max(minH, cssW / aspect)
    }
  }
  return {
    cssW: Math.floor(Math.max(minW, Math.min(cssW, maxLong))),
    cssH: Math.floor(Math.max(minH, Math.min(cssH, maxTall))),
  }
}
