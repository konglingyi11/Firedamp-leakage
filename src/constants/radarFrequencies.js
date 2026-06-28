/**
 * 雷达信号类型选项（仿真用，`id` 可与 UE 约定）。
 *
 * 变量名沿用 frequency，是为了兼容既有 visualization 字段与图层 id。
 */

export const DEFAULT_RADAR_FREQUENCY = 'gaussian_pulse'

export const RADAR_FREQUENCY_OPTIONS = [
  {
    id: 'gaussian_pulse',
    label: '高斯脉冲',
  },
  {
    id: 'sine_wave',
    label: '正弦波',
  },
  {
    id: 'chirp_signal',
    label: '扫频信号',
  },
]

/**
 * 旧版 id → 现行类型（已存 visualization、图层 variable 后缀等兼容）
 */
const LEGACY_RADAR_FREQUENCY_IDS = Object.freeze({
  usar_900m: 'gaussian_pulse',
  usar_core_1_3: 'sine_wave',
  usar_wide_1_10: 'chirp_signal',
  uwb_usar: 'sine_wave',
  l_usar: 'gaussian_pulse',
  s_usar: 'sine_wave',
  c_usar: 'chirp_signal',
  x_usar: 'chirp_signal',
  '433mhz': 'gaussian_pulse',
  '915mhz': 'gaussian_pulse',
  '2_45ghz': 'sine_wave',
  '5_8ghz': 'chirp_signal',
  '10ghz': 'chirp_signal',
  l_band: 'gaussian_pulse',
  s_band: 'sine_wave',
  c_band: 'chirp_signal',
  x_band: 'chirp_signal',
  ku_band: 'chirp_signal',
  usar_sub2ghz: 'sine_wave',
  usar_prf_uav: 'sine_wave',
})

const RADAR_ID_SET = new Set(RADAR_FREQUENCY_OPTIONS.map((o) => o.id))

/** @param {unknown} id */
function canonicalizeRadarFrequencyId(id) {
  const s = String(id ?? '').trim()
  if (!s) return s
  return LEGACY_RADAR_FREQUENCY_IDS[s] ?? s
}

/**
 * 将遗留或任意别名 id 解析为当前选项 id（无法识别则返回 null）
 * @param {unknown} id
 * @returns {string | null}
 */
export function resolveRadarOptionId(id) {
  const c = canonicalizeRadarFrequencyId(id)
  return RADAR_ID_SET.has(c) ? c : null
}

/**
 * 仅过滤非法 id、去重；允许空数组（表示用户未勾选任何雷达类型）。
 * @param {unknown} raw
 * @returns {string[]}
 */
export function sanitizeRadarFrequencies(raw) {
  let list = []
  if (Array.isArray(raw)) {
    list = raw
      .map((x) => canonicalizeRadarFrequencyId(x))
      .filter((id) => RADAR_ID_SET.has(id))
  } else if (typeof raw === 'string' && raw !== '') {
    const c = canonicalizeRadarFrequencyId(raw)
    if (RADAR_ID_SET.has(c)) list = [c]
  }
  return [...new Set(list)]
}

/**
 * @param {unknown} raw - 单个 id、或 id 数组、或遗留字段形态
 * @returns {string[]} 至少包含一个合法类型的去重数组（供请求/模拟渲染等需要默认类型的路径）
 */
export function normalizeRadarFrequencies(raw) {
  const uniq = sanitizeRadarFrequencies(raw)
  return uniq.length > 0 ? uniq : [DEFAULT_RADAR_FREQUENCY]
}

/** @param {string} id */
export function radarFrequencyLabel(id) {
  const c = canonicalizeRadarFrequencyId(id)
  const o = RADAR_FREQUENCY_OPTIONS.find((x) => x.id === c)
  return o?.label ?? String(id)
}
