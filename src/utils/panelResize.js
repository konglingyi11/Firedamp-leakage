const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function resizePanelSize(size, delta, bounds) {
  const width = Number(size?.width)
  const height = Number(size?.height)
  const dx = Number(delta?.dx)
  const dy = Number(delta?.dy)

  return {
    width: clamp(
      (Number.isFinite(width) ? width : bounds.minWidth) +
        (Number.isFinite(dx) ? dx : 0),
      bounds.minWidth,
      bounds.maxWidth,
    ),
    height: clamp(
      (Number.isFinite(height) ? height : bounds.minHeight) +
        (Number.isFinite(dy) ? dy : 0),
      bounds.minHeight,
      bounds.maxHeight,
    ),
  }
}
