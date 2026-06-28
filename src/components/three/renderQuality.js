export function resolveRenderPixelRatio({
  devicePixelRatio,
  isVolumeActive = false,
  lowQuality = false,
} = {}) {
  const raw = Number(devicePixelRatio)
  const dpr = Number.isFinite(raw) && raw > 0 ? raw : 1
  const maxRatio = isVolumeActive ? (lowQuality ? 1 : 1.5) : 2
  return Math.max(0.75, Math.min(dpr, maxRatio))
}
