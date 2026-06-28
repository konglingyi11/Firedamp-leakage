export const formatDuration = (seconds) => {
  if (seconds == null || seconds < 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export const getBoundarySummary = (bcs) => {
  if (!Array.isArray(bcs) || bcs.length === 0) return '无边界条件'
  const parts = bcs.map(bc => {
    if (bc.name === 'inlet' && Array.isArray(bc.velocity)) {
      return `风速:(${bc.velocity[0]}, ${bc.velocity[1]}, ${bc.velocity[2]}) m/s`
    }
    return bc.name || bc.type
  })
  return parts.join(', ')
}

export const getParamsDisplay = (params) => {
  if (!params) return '无参数'
  const display = []
  if (params.operating_temperature != null) {
    const t = Number(params.operating_temperature)
    display.push(`温度: ${t > 200 ? (t - 273.15).toFixed(1) : t.toFixed(1)}°C`)
  }
  if (params.operating_pressure != null) {
    const p = Number(params.operating_pressure)
    display.push(`气压: ${p > 2000 ? (p / 1000).toFixed(2) : p.toFixed(2)}kPa`)
  }
  if (params.boundary_conditions) display.push(getBoundarySummary(params.boundary_conditions))
  return display.join(' | ')
}
