export function cleanPreviewUrl(url) {
  return typeof url === 'string' ? url.replace(/[`\s]/g, '') : ''
}

export function pickPreviewLayer(layers, selectedLayerId, allowedKinds) {
  const list = Array.isArray(layers) ? layers : []
  const kinds = Array.isArray(allowedKinds) ? allowedKinds : []
  const previewLayers = list.filter((layer) => kinds.includes(layer?.kind))
  if (!previewLayers.length) return null

  if (selectedLayerId != null) {
    const selected = previewLayers.find(
      (layer) => String(layer.id) === String(selectedLayerId),
    )
    if (selected) return selected
  }

  return previewLayers.find((layer) => layer?.visible !== false) || previewLayers[0] || null
}

export function resolvePreviewFrameUrl({
  layer,
  currentStep,
  currentPhysicalTime,
  /** 与 layer.images[].time_step 对应的仿真时间步；优先于按滑块下标取帧 */
  simulationTimeStep,
}) {
  if (!layer?.images?.length) return ''

  if (simulationTimeStep != null && simulationTimeStep !== '') {
    const target = Number(simulationTimeStep)
    if (Number.isFinite(target)) {
      const hit = layer.images.find((img) => Number(img.time_step) === target)
      if (hit) {
        return cleanPreviewUrl(
          hit?.png_url || hit?.svg_url || hit?.url || '',
        )
      }
    }
  }

  if (currentPhysicalTime != null && Array.isArray(layer.physicalTimes) && layer.physicalTimes.length) {
    let bestIndex = 0
    let minDiff = Infinity

    layer.physicalTimes.forEach((time, index) => {
      const diff = Math.abs(Number(time) - Number(currentPhysicalTime))
      if (diff < minDiff && layer.images[index]) {
        minDiff = diff
        bestIndex = index
      }
    })

    const frame = layer.images[bestIndex]
    return cleanPreviewUrl(frame?.png_url || frame?.svg_url || frame?.url || '')
  }

  const index = Math.max(
    0,
    Math.min(Number(currentStep) || 0, layer.images.length - 1),
  )
  const frame = layer.images[index]
  return cleanPreviewUrl(frame?.png_url || frame?.svg_url || frame?.url || '')
}
