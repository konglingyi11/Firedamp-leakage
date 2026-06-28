function finiteNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function readVector3(value) {
  return [0, 1, 2].map((index) => finiteNumber(value?.[index]))
}

export function computeMonitoringCameraFocus({
  cameraPosition,
  controlsTarget,
  point,
  fallbackDirection = [1, 1, 0.7],
  fallbackDistance = 6,
}) {
  const target = readVector3(point)
  const camera = readVector3(cameraPosition)
  const currentTarget = readVector3(controlsTarget)
  let offset = camera.map((value, index) => value - currentTarget[index])
  let distance = Math.hypot(offset[0], offset[1], offset[2])

  if (!Number.isFinite(distance) || distance <= 1e-6) {
    const direction = readVector3(fallbackDirection)
    const directionLength = Math.hypot(direction[0], direction[1], direction[2]) || 1
    distance = Math.max(0.01, finiteNumber(fallbackDistance, 6))
    offset = direction.map((value) => (value / directionLength) * distance)
  }

  return {
    target,
    position: target.map((value, index) => value + offset[index]),
  }
}
