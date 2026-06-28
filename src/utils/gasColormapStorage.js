const GAS_COLORMAP_STORAGE_KEY = 'pixel_test.gas_colormaps'

function canUseStorage() {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function readSavedGasColormaps() {
  if (!canUseStorage()) return {}
  try {
    const raw = window.localStorage.getItem(GAS_COLORMAP_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          String(key || '').trim() !== '' &&
          typeof value === 'string' &&
          value.trim() !== '',
      ),
    )
  } catch (error) {
    console.warn('[GasColormapStorage] failed to read localStorage', error)
    return {}
  }
}

export function writeSavedGasColormaps(colormaps) {
  if (!canUseStorage()) return false
  try {
    window.localStorage.setItem(
      GAS_COLORMAP_STORAGE_KEY,
      JSON.stringify(readSavedGasColormapsMerged(colormaps)),
    )
    return true
  } catch (error) {
    console.warn('[GasColormapStorage] failed to write localStorage', error)
    return false
  }
}

export function mergeSavedGasColormaps(colormaps) {
  return readSavedGasColormapsMerged(colormaps)
}

function readSavedGasColormapsMerged(colormaps) {
  const current = readSavedGasColormaps()
  const incoming =
    colormaps && typeof colormaps === 'object' && !Array.isArray(colormaps)
      ? Object.fromEntries(
          Object.entries(colormaps).filter(
            ([key, value]) =>
              String(key || '').trim() !== '' &&
              typeof value === 'string' &&
              value.trim() !== '',
          ),
        )
      : {}
  return {
    ...current,
    ...incoming,
  }
}

