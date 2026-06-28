export const COLORMAP_PREVIEW = {
  coolwarm: ['#3b4cc0', '#9ebeff', '#f0f0f0', '#ff9b87', '#b40426'],
  bwr: ['#0000ff', '#ffffff', '#ff0000'],
  seismic: ['#0000aa', '#ffffff', '#aa0000'],
  RdBu: ['#2166ac', '#f7f7f7', '#b2182b'],
  RdYlBu: ['#3288bd', '#ffffbf', '#d53e4f'],
  RdYlGn: ['#1a9850', '#ffffbf', '#d73027'],
  Spectral: ['#9e0142', '#ffffbf', '#5e4fa2'],
  PiYG: ['#c51b7d', '#f7f7f7', '#4d9221'],
  BrBG: ['#543005', '#f5f5f5', '#003c30'],
  viridis: ['#440154', '#31688e', '#35b779', '#fde725'],
  plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
  inferno: ['#000004', '#56106e', '#bb3754', '#f98e09', '#fcffa4'],
  magma: ['#000004', '#4b0c6b', '#932667', '#dd5182', '#fcfdbf'],
  cividis: ['#00224e', '#575d6d', '#89a1b2', '#c3e0f4', '#deebf7'],
  turbo: ['#30123b', '#4684f9', '#1ae4b6', '#a2fc3c', '#7a0403'],
  jet: ['#00007f', '#0000ff', '#00ffff', '#ffff00', '#ff0000'],
  hot: ['#0b0b0b', '#ff0000', '#ffff00', '#ffffff'],
  Blues: ['#f7fbff', '#c6dbef', '#2171b5', '#08306b'],
  Greens: ['#f7fcf5', '#74c476', '#238b45', '#00441b'],
  Oranges: ['#fff5eb', '#fd8d3c', '#e6550d', '#a63603'],
  Reds: ['#fff5f0', '#fb6a4a', '#cb181d', '#67000d'],
  gray: ['#000000', '#888888', '#ffffff'],
  cool: ['#00ffff', '#ff00ff'],
  spring: ['#ff00ff', '#ffff00'],
  autumn: ['#ff0000', '#ffff00'],
  winter: ['#0000ff', '#00ff00'],
  rainbow: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#9400d3'],
}

export const ensureHex = (c) => {
  if (!c) return '#888888'
  const s = String(c).trim()
  if (/^#[0-9A-Fa-f]{3,8}$/.test(s)) return s
  if (/^[0-9A-Fa-f]{3,8}$/.test(s)) return '#' + s
  return '#888888'
}

export const getCmapGradient = (name, customColors = []) => {
  if (name === 'custom') {
    if (Array.isArray(customColors) && customColors.length > 0) {
      const valid = customColors.filter((c) => c && String(c).trim())
      if (valid.length) {
        return `linear-gradient(to right, ${valid.map((c) => (c.startsWith('#') || c.startsWith('rgb') ? c : `#${c}`).trim()).join(', ')})`
      }
    }
    return 'linear-gradient(to right, #888, #ccc)'
  }
  const colors = COLORMAP_PREVIEW[name]
  if (!colors) return 'linear-gradient(to right, #444, #888)'
  return `linear-gradient(to right, ${colors.join(', ')})`
}
