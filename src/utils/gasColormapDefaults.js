export function assignDistinctGasColormaps(gases, colorMapOptions, current = {}) {
  const options = Array.isArray(colorMapOptions) ? colorMapOptions : []
  const validValues = options
    .map((opt) => opt?.value)
    .filter((value) => value != null && value !== '')
  if (!validValues.length) return {}

  const validSet = new Set(validValues.map(String))
  const next = {}
  const used = new Set()
  ;(Array.isArray(gases) ? gases : []).forEach((gas, index) => {
    const id = gas?.id != null ? String(gas.id) : ''
    if (!id) return
    const existing = current?.[id]
    if (
      existing != null &&
      existing !== '' &&
      validSet.has(String(existing)) &&
      !used.has(String(existing))
    ) {
      next[id] = existing
      used.add(String(existing))
      return
    }
    const preferred =
      validValues.find((value) => !used.has(String(value))) ??
      (existing != null && existing !== '' && validSet.has(String(existing))
        ? existing
        : null) ??
      validValues[index % validValues.length]
    next[id] = preferred
    used.add(String(preferred))
  })
  return next
}
