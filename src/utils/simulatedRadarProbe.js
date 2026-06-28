/**
 * 监测点附近电磁波表征量的确定性模拟序列（与时间轴同步，随探头位置变化）。
 * 不参与真实物理求解，仅供界面联动演示。
 */

function hashUint32(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** [0,1) */
export function seededUnit(seedStr, salt = '') {
  const h = hashUint32(`${seedStr}\0${salt}`)
  return (h % 987654321) / 987654321
}

function probeSeed(point) {
  const id = String(point?.id ?? 'demo')
  const x = Number(point?.x)
  const y = Number(point?.y)
  const z = Number(point?.z)
  const nx = Number.isFinite(x) ? x.toFixed(2) : '0'
  const ny = Number.isFinite(y) ? y.toFixed(2) : '0'
  const nz = Number.isFinite(z) ? z.toFixed(2) : '0'
  return `${id}:${nx}:${ny}:${nz}`
}

function normalizeAlongAxis(xs, index) {
  if (!xs.length) return index > 0 ? 1 : 0
  if (xs.length === 1) return 0
  const lo = Number(xs[0])
  const hi = Number(xs[xs.length - 1])
  const denom = hi - lo
  const tNum = denom !== 0 ? (Number(xs[index]) - lo) / denom : index / (xs.length - 1)
  return Number.isFinite(tNum) ? Math.min(1, Math.max(0, tNum)) : 0
}

function sampleWaveAtProbe(point, tNorm /* 0..1 */, indexSalt) {
  const base = probeSeed(point)
  const nA = seededUnit(base, `a:${indexSalt}`)
  const nB = seededUnit(base, `b:${indexSalt}`)

  const bump = Math.exp(-((tNorm - 0.62) ** 2) / 0.012) * 185
    + ((tNorm - 0.7) > 0 ? (tNorm - 0.7) * 420 : 0)
    + seededUnit(base, `sp:${indexSalt}`) * 55

  let attn =
    72
    + 48 * Math.sin(tNorm * Math.PI * 2.4 + nA * 1.9)
    + bump
    + nB * 22
    + seededUnit(base, `z:${indexSalt}`) * (Math.abs(Number(point?.z) || 0) * 0.08)

  attn = Math.min(310, Math.max(38, attn))

  const trough = ((tNorm - 0.36) ** 2) * 880
  let inten =
    43
    + 12 * Math.sin(tNorm * Math.PI * 3.1 + nB * 2.2)
    - trough * 0.18
    + (tNorm > 0.76 ? (tNorm - 0.76) * 90 : 0)
    + (seededUnit(base, `dx:${indexSalt}`) - 0.5) * 28

  inten = Math.min(62, Math.max(-41, inten))

  return { attenuation: Number(attn.toFixed(3)), intensity: Number(inten.toFixed(3)) }
}

/**
 * @param {Record<string, unknown>|null} point 监测点
 * @param {number[]} xAxisData 与时间区间筛选后的物理时间横轴数组
 */
export function simulatedRadarWaveSeries(point, xAxisData) {
  const px = Array.isArray(xAxisData) ? xAxisData.map((x) => Number(x)) : []
  if (!point || !px.length) {
    return { attenuation: [], intensity: [] }
  }
  const attenuation = []
  const intensity = []
  px.forEach((_, i) => {
    const tNorm = normalizeAlongAxis(px, i)
    const s = sampleWaveAtProbe(point, tNorm, i)
    attenuation.push(s.attenuation)
    intensity.push(s.intensity)
  })
  return { attenuation, intensity }
}

/**
 * 快照时刻：与时间步索引对齐的单点值。
 */
export function simulatedRadarWaveSnapshot(point, timeIndex, timeCount = 1) {
  if (!point || timeCount <= 0) {
    return { attenuation: '—', intensity: '—' }
  }
  const idx = Math.min(Math.max(0, Number(timeIndex) || 0), Math.max(timeCount - 1, 0))
  const tNorm = timeCount <= 1 ? 0 : idx / (timeCount - 1)
  const s = sampleWaveAtProbe(point, tNorm, `${idx}:${timeCount}`)
  return {
    attenuation: s.attenuation.toFixed(3),
    intensity: s.intensity.toFixed(3),
  }
}

export function averageOrNull(nums) {
  const list = nums
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
  if (!list.length) return null
  return list.reduce((a, b) => a + b, 0) / list.length
}
