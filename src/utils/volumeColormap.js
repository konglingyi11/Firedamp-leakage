/** 内置体渲染色带（与 UE / matplotlib 名映射在 use3DVisualization） */

export const BUILTIN_VOLUME_COLORMAPS = []
export const BUILTIN_VOLUME_GRADIENT_MAP = {
  default:
    'linear-gradient(90deg, #3b4cc0 0%, #7396f5 25%, #b4d7f5 45%, #f4d9d0 65%, #dd7373 82%, #b40426 100%)',
  thermal:
    'linear-gradient(90deg, #000000 0%, #7f0000 28%, #ff0000 52%, #ff8c00 72%, #ffff00 88%, #ffffff 100%)',
  speed:
    'linear-gradient(90deg, #440154 0%, #31688e 30%, #35b779 63%, #fde724 100%)',
  multicolor:
    'linear-gradient(90deg, #000080 0%, #0000ff 18%, #00ffff 36%, #00ff00 54%, #ffff00 72%, #ff0000 88%, #800000 100%)',
  grayscale: 'linear-gradient(90deg, #000000 0%, #ffffff 100%)',
  custom: 'linear-gradient(90deg, #3b82f6 0%, #22d3ee 50%, #f43f5e 100%)',
}

/** 内置色带对应的颜色数组（用于传给后端 custom_colors） */
export const BUILTIN_COLORMAP_COLORS = {
  default: ['#3b4cc0', '#7894f2', '#a9c4f6', '#b4d7f5', '#f4d9d0', '#dd7373', '#b40426'],
  thermal: ['#000000', '#4a0000', '#7f0000', '#cc2200', '#ff0000', '#ff8c00', '#ffff00', '#ffffff'],
  speed: ['#440154', '#31688e', '#35b779', '#fde724'],
  multicolor: ['#000080', '#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000', '#800000'],
  grayscale: ['#000000', '#444444', '#888888', '#cccccc', '#ffffff'],
  custom: null, // custom 色带由用户手动配置，走 visualization.manualColors
}

/**
 * @param {string[]} colors
 * @param {'horizontal' | 'vertical'} direction
 * @returns {string}
 */
export function colorsToLinearGradient(colors, direction = 'horizontal') {
  if (!Array.isArray(colors) || colors.length === 0) {
    return BUILTIN_VOLUME_GRADIENT_MAP.default
  }
  const deg = direction === 'vertical' ? '180deg' : '90deg'
  if (colors.length === 1) {
    const c = colors[0]
    return `linear-gradient(${deg}, ${c} 0%, ${c} 100%)`
  }
  const parts = colors.map((c, i) => {
    const pct = (i / (colors.length - 1)) * 100
    return `${c} ${pct}%`
  })
  return `linear-gradient(${deg}, ${parts.join(', ')})`
}

/**
 * @param {{ value?: string, colors?: string[], color_map_url?: string } | null | undefined} opt
 * @returns {string} CSS background / backgroundImage 可用
 */
export function gradientForColormapOption(opt) {
  if (!opt) return BUILTIN_VOLUME_GRADIENT_MAP.default
  if (Array.isArray(opt.colors) && opt.colors.length > 0) {
    return colorsToLinearGradient(opt.colors)
  }
  if (opt.color_map_url) {
    return `url(${opt.color_map_url}) center / cover no-repeat`
  }
  return (
    BUILTIN_VOLUME_GRADIENT_MAP[opt.value] ||
    BUILTIN_VOLUME_GRADIENT_MAP.default
  )
}

/**
 * 合并内置项与接口色带列表（items: id, name, colors, color_map_url）
 * @param {Array<{ id: string, name?: string, colors?: string[], color_map_url?: string }>} catalogItems
 */
export function mergeVolumeColormapOptions(catalogItems) {
  const api = (Array.isArray(catalogItems) ? catalogItems : [])
    .filter((it) => it && it.id)
    .map((it) => ({
      label: it.name || it.id,
      value: it.id,
      colors: it.colors,
      color_map_url: it.color_map_url,
      fromApi: true,
    }))
  return api
}

/**
 * @param {ReturnType<typeof mergeVolumeColormapOptions>} options
 * @param {string} value
 */
export function findColormapOptionByValue(options, value) {
  if (value == null || value === '') return null
  return options.find((o) => o.value === value) ?? null
}

/** 用于色带条 DOM：url() 用 backgroundImage，渐变色用 background */
export function colormapBarStyleFromOption(opt) {
  const g = gradientForColormapOption(opt)
  if (typeof g === 'string' && g.trimStart().startsWith('url(')) {
    return {
      backgroundImage: g,
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
    }
  }
  return { background: g }
}

/**
 * 根据色带值返回颜色数组，供云图/体渲染传给后端 custom_colors
 * @param {string|null|undefined} scheme - 色带 id 或内置名（default / thermal / speed / multicolor / grayscale / custom）
 * @param {string[]} [manualColors] - custom 色带时的用户自定义颜色
 * @param {Array<{ id: string, colors?: string[] }>} [catalog] - 接口色带列表
 * @returns {string[]|null} 颜色数组；无法解析时返回 null
 */
export function resolveColormapColors(scheme, manualColors, catalog) {
  // 接口色带 id → colors 数组
  const entry = findCatalogColormapEntry(catalog, scheme)
  const entryColors = extractCatalogColormapColors(entry)
  if (entryColors) {
    return entryColors
  }
  // 内置色带
  if (scheme && BUILTIN_COLORMAP_COLORS[scheme] !== undefined) {
    const arr = BUILTIN_COLORMAP_COLORS[scheme]
    return arr !== null ? [...arr] : null
  }
  // custom：用户手动配置的颜色
  if (scheme === 'custom' && Array.isArray(manualColors) && manualColors.length > 0) {
    return manualColors
  }
  return null
}

export function findCatalogColormapEntry(catalog, scheme) {
  if (!scheme || !Array.isArray(catalog)) return null
  const target = String(scheme).trim()
  if (!target) return null
  const exact = catalog.find((x) => x && String(x.id) === target)
  if (exact) return exact
  const lower = target.toLowerCase()
  return (
    catalog.find((x) => x?.id && String(x.id).toLowerCase() === lower) ||
    null
  )
}

export function extractCatalogColormapColors(entry) {
  if (!entry || typeof entry !== 'object') return null
  const candidates = [
    entry.colors,
    entry.color_map,
    entry.colorMap,
    entry.colors_hex,
    entry.colorsHex,
    entry.stops,
  ]
  for (const candidate of candidates) {
    const colors = normalizeColorArray(candidate)
    if (colors?.length >= 2) return colors
  }
  return null
}

function normalizeColorArray(value) {
  if (!Array.isArray(value)) return null
  const colors = value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      return String(
        item.color ??
          item.color_hex ??
          item.colorHex ??
          item.hex ??
          item.value ??
          '',
      ).trim()
    })
    .filter((item) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(item))
  return colors.length >= 2 ? colors : null
}

/** 与体渲染 UI colorScheme 对应的 matplotlib 名，用于在色带目录里按名匹配 */
const VOLUME_UI_SCHEME_TO_BUILTIN_NAME = {
  default: 'coolwarm',
  thermal: 'hot',
  speed: 'viridis',
  multicolor: 'jet',
  grayscale: 'gray',
}

/**
 * 雷达模拟体变量未在 gasCmaps 中指定时，从本地色带目录（catalog）选一项；
 * 优先对齐全局 colorScheme / customColormap，否则 jet，再否则目录首项。
 *
 * @param {{ colorScheme?: string, customColormap?: string }} visualization
 * @param {Array<{ id: string, colors?: string[] }>} catalog
 * @returns {string|null} 目录中的色带 id
 */
export function pickLocalCatalogColormapForRadarVolume(visualization, catalog) {
  const cat = Array.isArray(catalog) ? catalog.filter((x) => x && x.id) : []
  if (cat.length === 0) return null
  const viz = visualization || {}
  if (viz.colorScheme === 'custom') {
    const cc = viz.customColormap
    if (cc != null && String(cc).trim() !== '') {
      const hit = cat.find((x) => String(x.id) === String(cc))
      if (hit) return String(hit.id)
    }
    return String(cat[0].id)
  }
  const builtin =
    VOLUME_UI_SCHEME_TO_BUILTIN_NAME[viz.colorScheme] ||
    VOLUME_UI_SCHEME_TO_BUILTIN_NAME.default
  const byName = cat.find(
    (x) => String(x.id).toLowerCase() === String(builtin).toLowerCase(),
  )
  if (byName) return String(byName.id)
  const jet = cat.find((x) => String(x.id).toLowerCase() === 'jet')
  if (jet) return String(jet.id)
  return String(cat[0].id)
}
