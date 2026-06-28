export function decodeNormalizedUint16(raw, valueRange, expectedLength = raw.length) {
  const min = Number(valueRange?.[0])
  const max = Number(valueRange?.[1])
  const rangeMin = Number.isFinite(min) ? min : 0
  const rangeMax = Number.isFinite(max) ? max : 1
  const valueSpan = rangeMax - rangeMin
  const length = Math.max(0, Math.round(Number(expectedLength) || 0))
  const decoded = new Float32Array(length)

  for (let i = 0; i < length; i++) {
    const normalized = (raw[i] || 0) / 65535
    decoded[i] = rangeMin + normalized * valueSpan
  }

  return decoded
}
