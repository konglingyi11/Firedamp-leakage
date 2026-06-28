function pickColorField(config, key, fallback = null) {
  const value = config?.[key]
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  return fallback
}

export function resolvePregenVectorColorPayload(
  vectorConfig = {},
  fallbackColor = '#ffffff',
) {
  const payload = {
    color: pickColorField(vectorConfig, 'color', fallbackColor),
  }

  const streamlineColor = pickColorField(vectorConfig, 'streamline_color')
  const arrowColor = pickColorField(vectorConfig, 'arrow_color')
  const seedColor = pickColorField(vectorConfig, 'seed_color')

  if (streamlineColor) payload.streamline_color = streamlineColor
  if (arrowColor) payload.arrow_color = arrowColor
  if (seedColor) payload.seed_color = seedColor

  return payload
}
