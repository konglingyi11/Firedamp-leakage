/**
 * 首页平面雷达云图占位：半圆 PPI；叠加层云弱回波、融化层亮带、飑线窄带、对流核+砧云拖尾，
 * 以及略不规则的径向传播波纹；无底图文字；色谱见 radarPolarLuminanceMock 的 PPI 反射率色标。
 */

import { DEFAULT_RADAR_FREQUENCY } from '@/constants/radarFrequencies.js'
import {
  RADAR_POLAR_LU_MAX,
  RADAR_POLAR_LU_MIN,
  bandRadialScale,
  ppiReflectivityRgbFromLu,
  radarMockCanvasCssSizeFromPhysicalCm,
} from '@/utils/radarPolarLuminanceMock.js'

export const RADAR_MOCK_LU_MIN = RADAR_POLAR_LU_MIN

export const RADAR_MOCK_LU_MAX = RADAR_POLAR_LU_MAX

export const RADAR_MOCK_DATA_REVISION = 16

const BG_RGB = [0, 0, 0]

const clamp01 = (t) => Math.max(0, Math.min(1, t))

const smoothstep = (e0, e1, x) => {
  const u = clamp01((x - e0) / Math.max(1e-6, e1 - e0))
  return u * u * (3 - 2 * u)
}

function pseudo(seed, salt) {
  let n = ((seed >>> 0) ^ (Math.imul(salt | 0, 2654435761))) >>> 0
  n ^= n << 13
  n ^= n >>> 17
  n ^= n << 5
  return (n >>> 0) / 4294967296
}

function hash01(ix, iy, seed) {
  let n =
    Math.imul(ix, 374761393) ^
    Math.imul(iy, 668265263) ^
    Math.imul(seed | 0, 1274126177)
  n ^= n << 13
  n ^= n >>> 17
  n ^= n << 5
  return (n >>> 0) / 4294967296
}

function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const n00 = hash01(x0, y0, seed)
  const n10 = hash01(x0 + 1, y0, seed)
  const n01 = hash01(x0, y0 + 1, seed)
  const n11 = hash01(x0 + 1, y0 + 1, seed)
  return (
    n00 * (1 - ux) * (1 - uy) +
    n10 * ux * (1 - uy) +
    n01 * (1 - ux) * uy +
    n11 * ux * uy
  )
}

function fbm2D(x, y, seed, octaves = 4) {
  let sum = 0
  let amp = 0.5
  let xf = x
  let yf = y
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(xf, yf, seed + i * 131072)
    xf *= 2.05
    yf *= 2.05
    amp *= 0.485
  }
  return clamp01(sum)
}

function resolveBandId(bandIds) {
  const ids = Array.isArray(bandIds) ? bandIds.filter(Boolean) : []
  return ids.length ? String(ids[0]) : DEFAULT_RADAR_FREQUENCY
}

function ellipticalBump(east, north, cx, cz, sx, sz, cosR, sinR, peak) {
  const dx = east - cx
  const dz = north - cz
  const lx = dx * cosR + dz * sinR
  const lz = -dx * sinR + dz * cosR
  const n = (lx / sx) ** 2 + (lz / sz) ** 2
  return peak * Math.exp(-0.5 * n)
}

/** 每场随机一批对流斑块与一条主飑带参数 */
function buildStormParams(seed) {
  const cells = []
  const nCells = 5 + Math.floor(pseudo(seed, 3) * 9)
  for (let i = 0; i < nCells; i++) {
    const ang = pseudo(seed, i * 131 + 7) * Math.PI * 2
    const rn = pseudo(seed, i * 131 + 8) ** 0.78 * (0.18 + pseudo(seed, i * 131 + 9) * 0.72)
    const sx = (0.04 + pseudo(seed, i * 131 + 10) ** 2 * 0.26) ** 0.5
    const sz = (sx * (0.35 + pseudo(seed, i * 131 + 11) * 1.95)) ** 0.5
    const rot = pseudo(seed, i * 131 + 12) * Math.PI * 2
    const amp = 0.18 + pseudo(seed, i * 131 + 13) ** 1.35 * 0.82
    cells.push({
      cx: rn * Math.sin(ang),
      cz: rn * Math.cos(ang),
      sx,
      sz,
      cosR: Math.cos(rot),
      sinR: Math.sin(rot),
      amp,
    })
  }

  const frontAngle = pseudo(seed, 707) * Math.PI
  const thickness = 0.055 + pseudo(seed, 708) ** 2 * 0.11
  const frontAmp = 0.28 + pseudo(seed, 709) ** 2 * 0.55

  /** 第二层弱弧带（层云雨带） */
  const arcAmp = 0.12 + pseudo(seed, 610) ** 2 * 0.22
  const arcPeakR = 0.32 + pseudo(seed, 611) ** 2 * 0.55
  const arcThick = 0.09 + pseudo(seed, 612) ** 2 * 0.16

  /** 融化层亮带（中等距离处略抬高的一层，方位上略有缺口） */
  const brightBandR = 0.36 + pseudo(seed, 720) ** 2 * 0.24
  const brightBandW = 0.038 + pseudo(seed, 721) ** 2 * 0.052
  const brightBandAmp = 0.07 + pseudo(seed, 722) ** 2 * 0.14
  const brightBandPhase = pseudo(seed, 723) * Math.PI * 2

  /** 环境风取向：砧云沿下风方向拖尾 */
  const anvilWindAngle = pseudo(seed, 501) * Math.PI * 2

  return {
    cells,
    frontAngle,
    thickness,
    frontAmp,
    arcAmp,
    arcPeakR,
    arcThick,
    brightBandR,
    brightBandW,
    brightBandAmp,
    brightBandPhase,
    anvilWindAngle,
  }
}

function buildRadarSamplingContext(W, H, bandIds, noiseSeed, frameIndex) {
  const bandId = resolveBandId(bandIds)
  const seed = (noiseSeed + (frameIndex | 0) * 1664525) >>> 0
  const bandScale = bandRadialScale(bandId)
  const storm = buildStormParams(seed)
  const ox = W * (0.5 + 0.02 * Math.sin(noiseSeed * 2e-4 + frameIndex * 0.06))
  const oy = H * (0.92 + 0.008 * Math.cos(noiseSeed * 1.7e-4))
  const sectorHalf = Math.PI / 2 - 0.04
  const rMax = Math.min(W, H) * (0.82 + 0.04 * Math.sin((seed ^ 404) * 1e-6))
  return {
    W,
    H,
    ox,
    oy,
    sectorHalf,
    rMax,
    seed,
    frameIndex,
    bandScale,
    storm,
    fullDisk: false,
  }
}

/** 主流程平面雷达：底部雷达站向上半空间扫描，避免全圆纹理在切片上形成横向色带 */
function buildDiffuseRadarSamplingContext(W, H, bandIds, noiseSeed, frameIndex) {
  const bandId = resolveBandId(bandIds)
  /** 与帧序解耦：动画仅改 frameIndex；避免 storm/纹理逐帧重抽样导致画面乱跳 */
  const seed = noiseSeed >>> 0
  const bandScale = bandRadialScale(bandId)
  const storm = buildStormParams(seed)
  const ox = W * 0.5
  const oy = H * (0.88 + 0.025 * pseudo(seed, 556))
  const sectorHalf = Math.PI / 2 - 0.035
  const rMax = Math.min(W * 0.56, H * 0.88) * (0.98 + 0.04 * pseudo(seed, 557))
  return {
    W,
    H,
    ox,
    oy,
    sectorHalf,
    rMax,
    seed,
    frameIndex,
    bandScale,
    storm,
    fullDisk: false,
  }
}

/**
 * 归一反射率占位场 0≈净空 ~1≈强对流；东向=east(+右)，北向=north(+上屏)
 */
function echoFieldNormalized(samp, east, north, rNorm) {
  const {
    seed,
    frameIndex,
    bandScale,
    storm,
    sectorHalf,
    fullDisk,
  } = samp

  /** 层云/碎云纹理：大范围弱回波基底 */
  const drift = frameIndex * 0.041 + pseudo(seed, 801) * 8.12
  const azWarp =
    (fbm2D(east * 6 + drift * 0.07, north * 6, seed ^ 303031, 3) - 0.5) * 0.07
  const nx = east * (2.1 + bandScale * 0.08) + drift * 0.11 + seed * 2.9e-5
  const nz = north * (2.4 + bandScale * 0.08) + frameIndex * 0.036 + pseudo(seed, 802) * 4.37
  const strat = (fbm2D(nx, nz, seed ^ 88602651, 4) - 0.52) * 1.06 + 0.48
  let stratShaped = clamp01(strat ** 1.08) * (0.07 + bandScale * 0.058)

  /** 远距离取样体积增大 → 纹理略抹平（贴近业务 PPI 远距观感） */
  const farSoften = 1 - 0.42 * smoothstep(0.38, 0.97, rNorm)
  stratShaped *= 0.72 + 0.28 * farSoften

  /** 融化层亮带：固定距离上的薄片状增强，随方位略有强弱 */
  const thetaForBand = Math.atan2(east, north)
  const bandAz =
    0.62 +
    0.38 *
      fbm2D(
        Math.sin(thetaForBand * 1.9 + storm.brightBandPhase) * 2.2,
        rNorm * 5.5 + drift * 0.12,
        seed ^ 0x71b4c2,
        3,
      )
  let brightBand =
    storm.brightBandAmp *
    bandAz *
    Math.exp(-(((rNorm - storm.brightBandR) / Math.max(storm.brightBandW, 0.02)) ** 2))
  brightBand *= smoothstep(0.14, 0.32, rNorm) * (1 - smoothstep(0.92, 1.05, rNorm))
  if (!fullDisk) {
    const thetaAbsBb = Math.abs(thetaForBand)
    brightBand *= 1 - smoothstep(sectorHalf * 0.7, sectorHalf * 1.02, thetaAbsBb)
  }

  /** 圆弧层状雨带（中距离一条亮拱） */
  const distFromArc = Math.abs(rNorm - storm.arcPeakR)
  let arcBand =
    storm.arcAmp *
    Math.exp(-((distFromArc / Math.max(storm.arcThick, 0.04)) ** 2))
  if (fullDisk) {
    arcBand *= smoothstep(0.06, 0.38, rNorm) * (1 - smoothstep(0.82, 1.06, rNorm))
  } else {
    const thetaAbs = Math.abs(Math.atan2(east + azWarp * 0.06, north))
    arcBand *= 1 - smoothstep(sectorHalf * 0.72, sectorHalf * 1.05, thetaAbs)
    arcBand *= smoothstep(-0.04, 0.22, rNorm)
  }

  /** 飑线/锋面窄带（沿主轴折叠） */
  const cosF = Math.cos(storm.frontAngle)
  const sinF = Math.sin(storm.frontAngle)
  const along = east * sinF + north * cosF
  const cross = east * cosF - north * sinF
  const wig = storm.thickness * Math.sin(along * 9.8 + drift * 0.8 + seed * 1e-3)
  const front =
    storm.frontAmp *
    Math.exp(-(((cross + wig * 1.05) ** 2 * 4) / (storm.thickness * storm.thickness + 1e-6)))
  const thetaFront = Math.abs(Math.atan2(east, north))
  let frontEnvelope
  if (fullDisk) {
    frontEnvelope =
      smoothstep(0.1, 0.92, rNorm) * (1 - smoothstep(0.88, 1.08, rNorm))
  } else {
    frontEnvelope =
      smoothstep(0.12, 0.94, rNorm) *
      (1 - smoothstep(sectorHalf * 0.76, sectorHalf * 1.04, thetaFront))
  }
  let frontMasked = clamp01(front * frontEnvelope * 2.05)

  /** 对流核拼接 */
  let conv = 0
  const cellShift = pseudo(seed, 920) ** 3 * (4 * Math.PI) + frameIndex * 0.09
  const sinW = Math.sin(storm.anvilWindAngle)
  const cosW = Math.cos(storm.anvilWindAngle)
  for (let ci = 0; ci < storm.cells.length; ci++) {
    const cell = storm.cells[ci]
    const phase = pseudo(seed, 999) * 12.5 + frameIndex * 0.07
    const cx = cell.cx + Math.sin(phase + cell.cx * 17) * 0.014
    const cz = cell.cz + Math.cos(phase * 1.07 + cell.cz * 15) * 0.014
    const rot = cellShift * 0.4 + pseudo(seed, 100 + ci) * Math.PI * 2
    const cosR = Math.cos(rot)
    const sinR = Math.sin(rot)
    const bump = ellipticalBump(
      east,
      north,
      cx,
      cz,
      Math.max(cell.sx, 0.018),
      Math.max(cell.sz, 0.018),
      cosR,
      sinR,
      cell.amp,
    )
    conv += bump * (0.52 + smoothstep(0.25, 0.95, rNorm) * 0.75)

    /** 砧云：约一半对流核下风方向拖一条更扁、更弱的椭圆 */
    if (pseudo(seed, 600 + ci) > 0.38) {
      const downLen = 0.11 + pseudo(seed, 800 + ci) ** 2 * 0.26
      const acx = cx + sinW * downLen * 0.55
      const acz = cz + cosW * downLen * 0.55
      const anvilAmp = cell.amp * (0.22 + pseudo(seed, 850 + ci) ** 1.2 * 0.38)
      const anvilSx = Math.max(cell.sx * 1.35, 0.03)
      const anvilSz = downLen * (0.85 + pseudo(seed, 860 + ci) * 0.45)
      const anvilRot = Math.atan2(sinW, cosW)
      conv += ellipticalBump(
        east,
        north,
        acx,
        acz,
        anvilSx,
        anvilSz,
        Math.cos(anvilRot),
        Math.sin(anvilRot),
        anvilAmp,
      ) * (0.42 + smoothstep(0.2, 0.88, rNorm) * 0.5)
    }

    /** 最强核旁略尖的「悬垂回波」小块（仅占位，非严格气象分类） */
    if (ci === 0 && cell.amp > 0.42) {
      const hx = cx - sinW * cell.sx * 0.35
      const hz = cz - cosW * cell.sz * 0.35
      conv += ellipticalBump(
        east,
        north,
        hx,
        hz,
        cell.sx * 0.42,
        cell.sz * 0.38,
        cosR,
        sinR,
        cell.amp * 0.28,
      ) * smoothstep(0.12, 0.72, rNorm)
    }
  }

  /** 远距离波束抬高/取样体积 → 亮度渐弱（指数 + 可调软顶） */
  const rangeFade = clamp01(Math.exp(-0.92 * clamp01(rNorm) ** 1.35))

  /** 极弱近地层杂波（不写死白墙，仅占一点点底噪） */
  const gc = smoothstep(0.12, -0.01, rNorm - 0.08) * 0.038 * pseudo(seed ^ 919, 303)

  let baseEcho = stratShaped + arcBand + brightBand + frontMasked + conv + gc
  if (fullDisk) {
    /** 压低静止天气图案，突出「单脉冲向外扫」 */
    baseEcho *= 0.36
  } else {
    const theta = Math.atan2(east, north)
    const thetaAbs = Math.abs(theta)
    const fanMask = 1 - smoothstep(sectorHalf * 0.84, sectorHalf * 1.02, thetaAbs)
    const azBroken =
      0.68 +
      0.32 *
        fbm2D(
          Math.sin(theta * 2.2) * 2.6 + seed * 1.1e-5,
          rNorm * 6.8 + frameIndex * 0.028,
          seed ^ 0x53a4f1,
          3,
        )
    const beamLiftFade = Math.exp(-0.28 * Math.max(0, rNorm - 0.18) ** 1.6)
    baseEcho *= fanMask * azBroken * beamLiftFade
  }
  let z = baseEcho * rangeFade * (0.88 + pseudo(seed, 404) ** 3 * bandScale * 0.42)

  /**
   * 全向 PPI：离散波前 = 少量高斯亮环，半径随 frameIndex 线性外推（扫完再从中心重来），
   * 尾随较弱回波；不用高频 sin(kr−ωt)，避免出现整块干涉条纹不像雷达扫描。
   */
  const waveEnv =
    smoothstep(0.035, 0.12, rNorm) * (1 - smoothstep(0.94, 1.08, rNorm))
  const speed = 0.021 + pseudo(seed, 1199) * 0.008
  const phase0 = pseudo(seed, 1201)
  const sigma = 0.034 + bandScale * 0.012
  const nEcho = fullDisk ? 5 : 4
  const theta = Math.atan2(east, north)
  const azimuthTexture = fullDisk
    ? 1
    : 0.55 +
      0.45 *
        fbm2D(
          Math.sin(theta * 2.8) * 3.2,
          Math.cos(theta * 2.1) * 2.7 + rNorm * 2.4,
          seed ^ 0x29a71,
          3,
        )
  let radialWave = 0
  for (let k = 0; k < nEcho; k++) {
    const ringCenter = ((frameIndex * speed + phase0 + k / nEcho) % 1 + 1) % 1
    const dk = rNorm - ringCenter
    const amp = (0.78 / (1 + k * 0.42)) * Math.exp(-k * 0.13)
    radialWave += amp * Math.exp(-(dk * dk) / (2 * sigma * sigma))
  }
  /** 波阵面方位上撕裂、强弱相间，减弱「完美同心圆」观感 */
  const ringTatter =
    0.5 +
    0.5 *
      fbm2D(
        Math.sin(theta * 3.1) * 4.2 + rNorm * 1.8,
        Math.cos(theta * 2.6) * 3.5 + frameIndex * 0.035,
        seed ^ 0x051c23a,
        4,
      )
  /** 极细一圈「前沿」，增强波阵面可读性 */
  const lead = ((frameIndex * speed + phase0) % 1 + 1) % 1
  const leadSigma = sigma * 0.52
  const dLead = rNorm - lead
  const frontPeak =
    0.32 * Math.exp(-(dLead * dLead) / (2 * leadSigma * leadSigma)) * waveEnv
  z = clamp01(
    z +
      radialWave *
        (fullDisk ? 0.52 : 0.38) *
        waveEnv *
        azimuthTexture *
        ringTatter +
      frontPeak * ringTatter,
  )

  /** 微细斑点（实况栅格粒度；远距略减弱） */
  const grain =
    (valueNoise2D(east * 120 + east * seed * 1e-4, north * 120, seed ^ 404121) -
      0.5) *
    0.028 *
    (0.48 + 0.52 * farSoften)
  z = clamp01(z + grain)

  return z
}

function samplePlanarRadarPixel(px, py, c) {
  const { W, H, ox, oy, sectorHalf, rMax, seed } = c

  const vx = px - ox
  const vy = oy - py
  const dist = Math.hypot(vx, vy)
  const ang = Math.atan2(vx, vy)

  const inSector = vy > -H * 0.12 && Math.abs(ang) < sectorHalf * 1.002
  if (!inSector) {
    return [...BG_RGB]
  }

  const rFrac = dist / Math.max(rMax, 1e-3)
  const edgeMix = clamp01(1 - smoothstep(1.15, 1.52, rFrac))

  const east = vx / Math.max(rMax, 1e-3)
  const north = vy / Math.max(rMax, 1e-3)
  const z = echoFieldNormalized(c, east, north, clamp01(rFrac))

  /** 净空：弱回波整块压黑（软边） */
  const echoGate = clamp01(smoothstep(0.05, 0.14, z))
  if (echoGate < 0.02) {
    return [...BG_RGB]
  }

  const lu =
    RADAR_POLAR_LU_MIN +
    (RADAR_POLAR_LU_MAX - RADAR_POLAR_LU_MIN) *
      (0.1 + Math.pow(z, 0.88) * 0.94 * echoGate ** 0.08)

  const rgb = ppiReflectivityRgbFromLu(lu)
  const k = edgeMix * echoGate
  return [
    Math.round(rgb[0] * k + BG_RGB[0] * (1 - k)),
    Math.round(rgb[1] * k + BG_RGB[1] * (1 - k)),
    Math.round(rgb[2] * k + BG_RGB[2] * (1 - k)),
  ]
}

/** 主流程：底部雷达站半空间 PPI + 扩散波纹（无距离圈格网） */
function sampleDiffuseRadarPixel(px, py, c) {
  const { H, ox, oy, rMax, sectorHalf } = c
  const vx = px - ox
  const vy = oy - py
  const dist = Math.hypot(vx, vy)
  const ang = Math.atan2(vx, vy)
  if (vy < -H * 0.04 || Math.abs(ang) > sectorHalf * 1.01) {
    return [...BG_RGB]
  }
  const rFrac = dist / Math.max(rMax, 1e-3)
  if (rFrac > 1.06) {
    return [...BG_RGB]
  }

  const east = vx / Math.max(rMax, 1e-3)
  const north = vy / Math.max(rMax, 1e-3)
  const z = echoFieldNormalized(c, east, north, clamp01(rFrac))

  const echoGate = clamp01(smoothstep(0.032, 0.11, z))
  if (echoGate < 0.014) {
    return [...BG_RGB]
  }

  const edgeMix = clamp01(1 - smoothstep(1.0, 1.15, rFrac))

  const lu =
    RADAR_POLAR_LU_MIN +
    (RADAR_POLAR_LU_MAX - RADAR_POLAR_LU_MIN) *
      (0.08 + Math.pow(z, 0.86) * 0.95 * echoGate ** 0.06)

  const rgb = ppiReflectivityRgbFromLu(lu)
  const k = edgeMix * echoGate
  return [
    Math.round(rgb[0] * k + BG_RGB[0] * (1 - k)),
    Math.round(rgb[1] * k + BG_RGB[1] * (1 - k)),
    Math.round(rgb[2] * k + BG_RGB[2] * (1 - k)),
  ]
}

function strokePpiRangeRings(ctx, ox, oy, rMax, sectorHalf) {
  const base = -Math.PI / 2
  const startAng = base - sectorHalf - 0.02
  const endAng = base + sectorHalf + 0.02
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)'
  ctx.lineWidth = 1
  for (let ru = 10; ru <= 90; ru += 10) {
    const rr = (ru / 90) * rMax
    const frac = ru / 90
    ctx.globalAlpha = 0.07 + frac * 0.1
    ctx.beginPath()
    ctx.arc(ox, oy, rr, startAng, endAng)
    ctx.stroke()
  }
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = 'rgba(240, 245, 255, 0.28)'
  for (let k = -4; k <= 4; k++) {
    const a = base + k * (sectorHalf / 5)
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(ox + Math.sin(a) * rMax * 1.02, oy - Math.cos(a) * rMax * 1.02)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 首页平面雷达占位：底部雷达站半空间 PPI + 随时间向外扩散的波纹（无底图、无距离圈线）。
 * `sizeOpts` 可与切面物理宽高对齐。
 */
export function renderDiffuseRadarPpiToDataUrl(bandIds, noiseSeed, sizeOpts = {}) {
  const fromPhys =
    Number(sizeOpts.physicalWidthCm) > 0 && Number(sizeOpts.physicalHeightCm) > 0
      ? radarMockCanvasCssSizeFromPhysicalCm(
          sizeOpts.physicalWidthCm,
          sizeOpts.physicalHeightCm,
        )
      : null
  const cssW = Math.floor(
    Math.max(320, Math.min(fromPhys?.cssW ?? sizeOpts.cssW ?? 720, 1500)),
  )
  const cssH = Math.floor(
    Math.max(340, Math.min(fromPhys?.cssH ?? sizeOpts.cssH ?? 1040, 1680)),
  )
  const frameIdx = Number(sizeOpts.frameIndex) || 0

  try {
    if (typeof document === 'undefined') return ''
    const canvas = document.createElement('canvas')
    const dpr =
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const samp = buildDiffuseRadarSamplingContext(cssW, cssH, bandIds, noiseSeed, frameIdx)
    const imageData = ctx.createImageData(cssW, cssH)
    const buf = imageData.data

    for (let py = 0; py < cssH; py++) {
      for (let px = 0; px < cssW; px++) {
        const rgb = sampleDiffuseRadarPixel(px + 0.5, py + 0.5, samp)
        const o = (py * cssW + px) * 4
        buf[o] = rgb[0]
        buf[o + 1] = rgb[1]
        buf[o + 2] = rgb[2]
        buf[o + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL('image/png')
  } catch (_) {
    return ''
  }
}

export function radarMockFrameSeed(taskId, timeStep, frameIndex = 0) {
  let h = (2166136261 ^ (RADAR_MOCK_DATA_REVISION * 100003)) >>> 0
  const mix = `${String(taskId)}|${String(timeStep)}|${String(frameIndex)}`
  for (let i = 0; i < mix.length; i++) {
    h ^= mix.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/**
 * @param {{ cssW?: number, cssH?: number, frameIndex?: number }} [sizeOpts]
 */
export function renderMockRadarPpiToDataUrl(bandIds, noiseSeed, sizeOpts = {}) {
  const W = Math.floor(Math.max(480, Math.min(sizeOpts.cssW ?? 720, 1500)))
  const H = Math.floor(Math.max(560, Math.min(sizeOpts.cssH ?? 1040, 1680)))
  const frameIdx = Number(sizeOpts.frameIndex) || 0

  try {
    if (typeof document === 'undefined') return ''
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    const samp = buildRadarSamplingContext(W, H, bandIds, noiseSeed, frameIdx)

    const imageData = ctx.createImageData(W, H)
    const buf = imageData.data

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const rgb = samplePlanarRadarPixel(px + 0.5, py + 0.5, samp)
        const o = (py * W + px) * 4
        buf[o] = rgb[0]
        buf[o + 1] = rgb[1]
        buf[o + 2] = rgb[2]
        buf[o + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)
    strokePpiRangeRings(ctx, samp.ox, samp.oy, samp.rMax, samp.sectorHalf)
    return canvas.toDataURL('image/png')
  } catch (_) {
    return ''
  }
}
