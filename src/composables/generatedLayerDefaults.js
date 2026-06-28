export function resolveGeneratedLayerDefaultVisible(kind) {
  return !['streamline', 'volume', 'particle', 'smoke'].includes(kind)
}
