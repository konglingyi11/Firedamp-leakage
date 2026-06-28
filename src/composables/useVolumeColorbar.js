import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { readSavedGasColormaps } from '@/utils/gasColormapStorage'
import { resolveColormapColors } from '@/utils/volumeColormap'
import { normalizeColorStops } from '@/utils/volumeColorStops'
import { getVariableDisplayName } from '@/utils/gas'
import {
  gasNameMap,
  cloudContourOtherVariableLabels,
} from '@/constants/gasVariables'
import { radarFrequencyLabel } from '@/constants/radarFrequencies.js'
import {
  normalizeRadarColorbarRange,
  ppiReflectivityColorbarCssColors,
  radarDefaultPpiDbzRange,
} from '@/utils/radarPolarLuminanceMock.js'

const VOLUME_COLORBAR_CMAP_ALIASES = {
  coolwarm: 'default',
  hot: 'thermal',
  viridis: 'speed',
  jet: 'multicolor',
  gray: 'grayscale',
  grey: 'grayscale',
}

const normalizeVolumeLookupKey = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:()（）]/g, '')

const isRadarCloudLayer = (layer) =>
  String(layer?.kind || '').toLowerCase() === 'radar_cloud'

const isValidColorbarRange = (vmin, vmax) =>
  Number.isFinite(vmin) && Number.isFinite(vmax) && vmax > vmin

const isValidRadarDbzRange = (vmin, vmax) =>
  isValidColorbarRange(vmin, vmax) && vmin >= -15 && vmax <= 75

const resolveRadarCloudDefaultRange = () => radarDefaultPpiDbzRange()

const resolveRadarCloudDisplayTitle = (layer) => {
  const raw = String(layer?.variable ?? '').trim()
  if (raw) {
    const labels = raw
      .split('+')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => radarFrequencyLabel(id))
    if (labels.length) {
      return `${labels.join('·')} · PPI反射率 (dBZ)`
    }
  }
  const fromLabel = String(layer?.label ?? layer?.name ?? '').trim()
  const match = fromLabel.match(/^雷达云图[-—]([^-—]+)/)
  if (match?.[1]) return `${match[1].trim()} · PPI反射率 (dBZ)`
  return 'PPI反射率 (dBZ)'
}

const coerceRadarDisplayRange = (range) => {
  if (!range) return null
  const normalized = normalizeRadarColorbarRange(range.vmin, range.vmax)
  if (
    !normalized ||
    !isValidRadarDbzRange(normalized.vmin, normalized.vmax)
  ) {
    return null
  }
  return normalized
}

export function useVolumeColorbar({
  colorMapCatalogItems,
  currentTask,
  ensureTaskMetadataCached,
  generatedVizLayers,
  onRangeUpdated,
  resolveVolumeLayerVariableId,
  selectedLayerId,
  taskStore,
  visualization,
}) {
  const colorbarOverlayVisible = ref(true)
  const selectedColorbarOverlayLayerId = ref('')
  const rangeInputDrafts = ref({})
  const colorStopInputDrafts = ref({})

  const resolveVolumeLayerVariableKey = (layer) => {
    const candidates = []
    const push = (value) => {
      const text = String(value ?? '').trim()
      if (text) candidates.push(text)
    }

    push(layer?.variable)
    const idParts = String(layer?.id || '').split(':')
    if (idParts[0] === 'volume') push(idParts.slice(2).join(':'))
    const labelParts = String(layer?.label || layer?.name || '').split('-')
    if (labelParts.length > 1) push(labelParts.slice(1).join('-').trim())

    const aliases = new Map()
    const addAlias = (alias, canonical) => {
      const key = normalizeVolumeLookupKey(alias)
      if (key && canonical && !aliases.has(key)) aliases.set(key, canonical)
    }
    for (const [canonical, meta] of Object.entries(gasNameMap)) {
      addAlias(canonical, canonical)
      addAlias(meta?.zh, canonical)
      addAlias(meta?.en, canonical)
    }
    for (const [canonical, label] of Object.entries(
      cloudContourOtherVariableLabels,
    )) {
      addAlias(canonical, canonical)
      addAlias(label, canonical)
    }

    for (const candidate of candidates) {
      const canonical = aliases.get(normalizeVolumeLookupKey(candidate))
      if (canonical) return canonical
    }
    return candidates[0] || ''
  }

  const lookupVolumeCmapScheme = (gasCmaps, variableId) => {
    if (!gasCmaps || !variableId) return undefined
    const targetKeys = new Set([normalizeVolumeLookupKey(variableId)])
    const gasMeta = gasNameMap[variableId]
    if (gasMeta) {
      targetKeys.add(normalizeVolumeLookupKey(gasMeta.zh))
      targetKeys.add(normalizeVolumeLookupKey(gasMeta.en))
    }
    const otherLabel = cloudContourOtherVariableLabels[variableId]
    if (otherLabel) targetKeys.add(normalizeVolumeLookupKey(otherLabel))

    if (
      gasCmaps[variableId] != null &&
      String(gasCmaps[variableId]).trim() !== ''
    ) {
      return gasCmaps[variableId]
    }
    for (const [key, value] of Object.entries(gasCmaps)) {
      if (
        targetKeys.has(normalizeVolumeLookupKey(key)) &&
        value != null &&
        String(value).trim() !== ''
      ) {
        return value
      }
    }
    return undefined
  }

  const findVolumeColorMapCatalogItem = (scheme) => {
    if (scheme == null || scheme === '') return null
    const catalog = colorMapCatalogItems.value
    if (!Array.isArray(catalog)) return null
    const target = String(scheme)
    return (
      catalog.find(
        (item) =>
          item &&
          (String(item.id) === target || String(item.name || '') === target),
      ) || null
    )
  }

  const resolveVolumeLayerDisplayName = (layer) => {
    if (isRadarCloudLayer(layer)) {
      return resolveRadarCloudDisplayTitle(layer)
    }
    const variable =
      resolveVolumeLayerVariableId(layer) || resolveVolumeLayerVariableKey(layer)
    const displayName = getVariableDisplayName(variable)
    if (
      displayName &&
      displayName !== '请选择变量' &&
      displayName !== String(variable || '').trim()
    ) {
      return displayName
    }
    const gasMeta = gasNameMap[variable]
    if (gasMeta?.zh) return gasMeta.zh
    const otherLabel = cloudContourOtherVariableLabels[variable]
    if (otherLabel) return otherLabel
    return String(layer?.variable || layer?.label || variable || '变量')
  }

  const toggleColorbarOverlay = (layer) => {
    const id = String(layer?.id)
    if (!id) return
    selectedLayerId.value = id
    // 如果当前已显示同图层的色带，则隐藏；否则显示
    if (
      colorbarOverlayVisible.value &&
      String(selectedColorbarOverlayLayerId.value) === id
    ) {
      colorbarOverlayVisible.value = false
    } else {
      selectedColorbarOverlayLayerId.value = id
      colorbarOverlayVisible.value = true
    }
  }

  const closeColorbarOverlay = () => {
    colorbarOverlayVisible.value = false
  }

  const handleColorbarLayerSelectChange = (id) => {
    const nextId = String(id || '')
    if (!nextId) return
    selectedLayerId.value = nextId
    selectedColorbarOverlayLayerId.value = nextId
    colorbarOverlayVisible.value = true
  }

  const colorbarOverlayLayers = computed(() => {
    return (generatedVizLayers.value || []).filter(
      (l) =>
        l.ready !== false &&
        (l.kind === 'volume' ||
          l.kind === 'cloud' ||
          l.kind === 'contour') &&
        l.visible !== false,
    )
  })

  const selectedColorbarOverlayLayer = computed(() => {
    if (!colorbarOverlayVisible.value) return null
    const layers = colorbarOverlayLayers.value
    if (!layers.length) return null
    const selectedId = String(selectedColorbarOverlayLayerId.value || '')
    return layers.find((layer) => String(layer.id) === selectedId) || layers[0]
  })

  const ensureColorbarMetadataLoaded = async () => {
    const taskId = currentTask.value?.id
    if (!taskId || !selectedColorbarOverlayLayer.value) return
    await ensureTaskMetadataCached(taskId, 'colorbar')
  }

  watch(
    [selectedLayerId, colorbarOverlayLayers],
    ([activeLayerId, layers]) => {
      if (!layers.length) {
        selectedColorbarOverlayLayerId.value = ''
        return
      }
      const activeId = String(activeLayerId ?? '')
      if (layers.some((layer) => String(layer.id) === activeId)) {
        selectedColorbarOverlayLayerId.value = activeId
        return
      }
      const selectedId = String(selectedColorbarOverlayLayerId.value || '')
      if (!layers.some((layer) => String(layer.id) === selectedId)) {
        selectedColorbarOverlayLayerId.value = String(layers[0].id)
      }
    },
    { immediate: true },
  )

  watch(
    () => [currentTask.value?.id, selectedColorbarOverlayLayer.value?.id],
    () => {
      ensureColorbarMetadataLoaded()
    },
    { immediate: true },
  )

  const resolveVolumeLayerCmapColors = (layer) => {
    if (!layer) return null
    if (isRadarCloudLayer(layer)) {
      return ppiReflectivityColorbarCssColors()
    }
    const variable =
      resolveVolumeLayerVariableId(layer) || resolveVolumeLayerVariableKey(layer)
    const localGasCmaps = readSavedGasColormaps()
    const gasCmaps = {
      ...(visualization.value?.gasCmaps || {}),
      ...localGasCmaps,
    }
    const scheme = lookupVolumeCmapScheme(gasCmaps, variable)
    let colors = null
    if (scheme) {
      const catalogItem = findVolumeColorMapCatalogItem(scheme)
      if (
        catalogItem &&
        Array.isArray(catalogItem.colors) &&
        catalogItem.colors.length >= 2
      ) {
        colors = catalogItem.colors
      } else if (catalogItem?.color_map_url) {
        return {
          backgroundImage: `url(${catalogItem.color_map_url})`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
        }
      } else {
        colors = resolveColormapColors(scheme, null, colorMapCatalogItems.value)
      }
    }
    if (
      (!colors || colors.length < 2) &&
      !scheme &&
      Array.isArray(layer.custom_colors) &&
      layer.custom_colors.length >= 2
    ) {
      colors = layer.custom_colors
    }
    if (!colors || colors.length < 2) {
      const cmapName = layer.cmap || 'coolwarm'
      const resolvedCmapName =
        VOLUME_COLORBAR_CMAP_ALIASES[cmapName] || cmapName
      colors = resolveColormapColors(
        resolvedCmapName === 'default' ? 'default' : resolvedCmapName,
        null,
        colorMapCatalogItems.value,
      )
    }
    return colors
  }

  const volumeLayerCmapStyle = (layer, direction = 'horizontal') => {
    if (!layer) return {}
    const colors = resolveVolumeLayerCmapColors(layer)
    if (colors && colors.length >= 2) {
      const deg = direction === 'vertical' ? '0deg' : '90deg'
      const parts = colors.map((color, index) => {
        const pct = (index / (colors.length - 1)) * 100
        return `${color} ${pct}%`
      })
      return { background: `linear-gradient(${deg}, ${parts.join(', ')})` }
    }
    const deg = direction === 'vertical' ? '0deg' : '90deg'
    return {
      background: `linear-gradient(${deg}, #3b4cc0 0%, #7396f5 25%, #b4d7f5 45%, #f4d9d0 65%, #dd7373 82%, #b40426 100%)`,
    }
  }

  const formatCmapRangeValue = (v, layer = null) => {
    if (v === null || v === undefined || v === '') return '—'
    if (!Number.isFinite(Number(v))) return '—'
    const n = Number(v)
    if (isRadarCloudLayer(layer)) {
      return `${Math.round(n)}`
    }
    if (n === 0) return '0.00e+0'
    return n.toExponential(2).replace(/e([+-])0+(\d+)/, 'e$1$2')
  }

  const coerceRange = (range) => {
    if (!range || typeof range !== 'object') return null
    const rangeArray = Array.isArray(range)
      ? range
      : Array.isArray(range.original_value_range)
        ? range.original_value_range
        : Array.isArray(range.originalValueRange)
          ? range.originalValueRange
        : Array.isArray(range.valueRange)
          ? range.valueRange
          : Array.isArray(range.value_range)
            ? range.value_range
            : null
    const vmin = Number(
      range.vmin ??
        range.val_min ??
        range.minValue ??
        range.min_value ??
        range.min ??
        range.minimum ??
        rangeArray?.[0],
    )
    const vmax = Number(
      range.vmax ??
        range.val_max ??
        range.maxValue ??
        range.max_value ??
        range.max ??
        range.maximum ??
        rangeArray?.[1],
    )
    if (Number.isFinite(vmin) && Number.isFinite(vmax)) {
      return { vmin, vmax }
    }
    return null
  }

  const lookupMetadataRange = (variable) => {
    const directRange = taskStore.getVariableRange(variable)
    if (directRange) return directRange
    const target = normalizeVolumeLookupKey(variable)
    if (!target) return null
    const ranges = taskStore.variableRanges || {}
    for (const [key, range] of Object.entries(ranges)) {
      if (normalizeVolumeLookupKey(key) === target) return range
    }
    return null
  }

  const resolveLayerOriginalRange = (layer) => {
    const directRange = coerceRange({
      original_value_range:
        layer?.original_value_range ?? layer?.originalValueRange,
      value_range: layer?.value_range,
      valueRange: layer?.valueRange,
    })
    if (directRange && isValidColorbarRange(directRange.vmin, directRange.vmax)) {
      return directRange
    }
    const layerRange = coerceRange(layer)
    if (layerRange && isValidColorbarRange(layerRange.vmin, layerRange.vmax)) {
      return layerRange
    }
    return null
  }

  const resolveVolumeLayerRange = (layer) => {
    const radarLayer = isRadarCloudLayer(layer)
    if (radarLayer) {
      const displayRange = coerceRadarDisplayRange(
        coerceRange({
          vmin: layer?.display_vmin ?? layer?.displayVMin,
          vmax: layer?.display_vmax ?? layer?.displayVMax,
        }),
      )
      if (displayRange) return displayRange
      const layerRange = coerceRadarDisplayRange(coerceRange(layer))
      if (layerRange) return layerRange
      return resolveRadarCloudDefaultRange()
    }
    const displayRange = coerceRange({
      vmin: layer?.display_vmin ?? layer?.displayVMin,
      vmax: layer?.display_vmax ?? layer?.displayVMax,
    })
    if (displayRange && isValidColorbarRange(displayRange.vmin, displayRange.vmax)) {
      return displayRange
    }
    const layerRange = resolveLayerOriginalRange(layer)
    if (layerRange && isValidColorbarRange(layerRange.vmin, layerRange.vmax)) {
      return layerRange
    }
    const variable =
      resolveVolumeLayerVariableId(layer) || resolveVolumeLayerVariableKey(layer)
    const metaRange = lookupMetadataRange(variable)
    const metadataRange = coerceRange(metaRange)
    if (metadataRange && isValidColorbarRange(metadataRange.vmin, metadataRange.vmax)) {
      return metadataRange
    }
    return { vmin: null, vmax: null }
  }

  const resolveVolumeLayerBaseRange = (layer) => {
    if (isRadarCloudLayer(layer)) {
      const layerRange = coerceRadarDisplayRange(coerceRange(layer))
      if (layerRange) return layerRange
      return resolveRadarCloudDefaultRange()
    }
    const layerRange = resolveLayerOriginalRange(layer)
    if (layerRange && isValidColorbarRange(layerRange.vmin, layerRange.vmax)) {
      return layerRange
    }
    const variable =
      resolveVolumeLayerVariableId(layer) || resolveVolumeLayerVariableKey(layer)
    const metaRange = lookupMetadataRange(variable)
    const metadataRange = coerceRange(metaRange)
    if (metadataRange && isValidColorbarRange(metadataRange.vmin, metadataRange.vmax)) {
      return metadataRange
    }
    return { vmin: null, vmax: null }
  }

  const colorbarRangeStep = (layer) => {
    const { vmin, vmax } = resolveVolumeLayerBaseRange(layer)
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin === vmax) {
      return 0.01
    }
    return Math.max(Math.abs(vmax - vmin) / 100, 1e-8)
  }

  const getVolumeColorbarRangeInputValue = (layer, key) => {
    const draftKey = getVolumeColorbarRangeDraftKey(layer, key)
    if (
      draftKey &&
      Object.prototype.hasOwnProperty.call(rangeInputDrafts.value, draftKey)
    ) {
      return rangeInputDrafts.value[draftKey]
    }
    const range = resolveVolumeLayerRange(layer)
    const value = range?.[key]
    return Number.isFinite(value) ? String(value) : ''
  }

  const getVolumeColorbarRangeDraftKey = (layer, key) => {
    const id = String(layer?.id ?? '')
    const rangeKey = String(key ?? '')
    return id && rangeKey ? `${id}:${rangeKey}` : ''
  }

  const getVolumeColorStopDraftKey = (layer, index) => {
    const id = String(layer?.id ?? '')
    return id ? `${id}:stop:${index}` : ''
  }

  const clearVolumeColorStopDraft = (layer, index = null) => {
    const nextDrafts = { ...colorStopInputDrafts.value }
    if (index == null) {
      const prefix = `${String(layer?.id ?? '')}:stop:`
      for (const key of Object.keys(nextDrafts)) {
        if (key.startsWith(prefix)) delete nextDrafts[key]
      }
    } else {
      delete nextDrafts[getVolumeColorStopDraftKey(layer, index)]
    }
    colorStopInputDrafts.value = nextDrafts
  }

  const setVolumeColorStopDraft = (layer, index, value) => {
    const draftKey = getVolumeColorStopDraftKey(layer, index)
    if (!draftKey) return
    colorStopInputDrafts.value = {
      ...colorStopInputDrafts.value,
      [draftKey]: String(value ?? ''),
    }
  }

  const createDefaultVolumeColorStops = (range) => {
    const vmin = Number(range?.vmin)
    const vmax = Number(range?.vmax)
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) {
      return []
    }
    return [
      { value: vmin, bandPosition: 0 },
      { value: vmax, bandPosition: 1 },
    ]
  }

  const findEndpointStop = (stops, value, fallbackPosition) => {
    const endpoint = (Array.isArray(stops) ? stops : []).find(
      (stop) => Number(stop?.value) === value,
    )
    const position = Number(endpoint?.bandPosition)
    return {
      value,
      bandPosition: Number.isFinite(position)
        ? Math.max(0, Math.min(1, position))
        : fallbackPosition,
    }
  }

  const normalizeVolumeColorStops = (layer, range = null) => {
    const activeRange = range || resolveVolumeLayerRange(layer)
    const source = Array.isArray(layer?.volume_color_stops)
      ? layer.volume_color_stops
      : createDefaultVolumeColorStops(activeRange)
    return normalizeColorStops(source, activeRange).map((stop) => ({
      ...stop,
      bandPosition: Number.isFinite(Number(stop.bandPosition))
        ? Number(stop.bandPosition)
        : stop.position,
    }))
  }

  const getVolumeColorbarStops = (layer) => {
    const range = resolveVolumeLayerRange(layer)
    const stops = normalizeVolumeColorStops(layer, range)
    return stops.map((stop) => ({
      ...stop,
      bandPosition: Number.isFinite(Number(stop.bandPosition))
        ? Number(stop.bandPosition)
        : stop.position,
    }))
  }

  const getVolumeColorStopInputValue = (layer, index) => {
    const draftKey = getVolumeColorStopDraftKey(layer, index)
    if (
      draftKey &&
      Object.prototype.hasOwnProperty.call(colorStopInputDrafts.value, draftKey)
    ) {
      return colorStopInputDrafts.value[draftKey]
    }
    const stop = getVolumeColorbarStops(layer)[index]
    return Number.isFinite(Number(stop?.value)) ? String(stop.value) : ''
  }

  const persistVolumeColorStops = (layer, stops) => {
    if (!layer) return false
    const range = resolveVolumeLayerRange(layer)
    if (!Number.isFinite(range.vmin) || !Number.isFinite(range.vmax)) {
      return false
    }
    const sourceStops = Array.isArray(stops) ? stops : []
    const minStop = findEndpointStop(sourceStops, range.vmin, 0)
    const maxStop = findEndpointStop(sourceStops, range.vmax, 1)
    const middleStops = sourceStops.filter((stop) => {
      const value = Number(stop?.value)
      return (
        Number.isFinite(value) &&
        value > range.vmin &&
        value < range.vmax
      )
    })
    const normalized = normalizeColorStops(
      [
        minStop,
        ...middleStops,
        maxStop,
      ],
      range,
    )
    if (normalized.length < 2) {
      ElMessage.warning('至少保留两个标记点')
      return false
    }
    for (let i = 1; i < normalized.length; i += 1) {
      if (normalized[i].value <= normalized[i - 1].value) {
        ElMessage.warning('标记点数值需要从小到大')
        return false
      }
      if (normalized[i].bandPosition <= normalized[i - 1].bandPosition) {
        ElMessage.warning('标记点在色带上的位置需要从下到上')
        return false
      }
    }
    layer.volume_color_stops = normalized.map((stop) => ({
      value: stop.value,
      bandPosition: stop.bandPosition,
    }))
    clearVolumeColorStopDraft(layer)
    onRangeUpdated?.(layer)
    return true
  }

  const updateVolumeColorStopValue = (layer, index, value) => {
    setVolumeColorStopDraft(layer, index, value)
  }

  const commitVolumeColorStopValue = (layer, index, value) => {
    const currentStops = getVolumeColorbarStops(layer)
    if (index === 0 || index === currentStops.length - 1) return
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue)) {
      clearVolumeColorStopDraft(layer, index)
      return
    }
    const stops = currentStops.map((stop) => ({ ...stop }))
    if (!stops[index]) return
    stops[index].value = nextValue
    persistVolumeColorStops(layer, stops)
  }

  const updateVolumeColorStopPosition = (layer, index, bandPosition) => {
    const stops = getVolumeColorbarStops(layer).map((stop) => ({ ...stop }))
    if (!stops[index]) return
    stops[index].bandPosition = Math.max(0, Math.min(1, Number(bandPosition)))
    persistVolumeColorStops(layer, stops)
  }

  const addVolumeColorStop = (layer, bandPosition = 0.5) => {
    const range = resolveVolumeLayerRange(layer)
    if (!Number.isFinite(range.vmin) || !Number.isFinite(range.vmax)) return
    const stops = getVolumeColorbarStops(layer).map((stop) => ({ ...stop }))
    const position = Math.max(0.05, Math.min(0.95, Number(bandPosition) || 0.5))
    const value = range.vmin + (range.vmax - range.vmin) * position
    stops.push({ value, bandPosition: position })
    persistVolumeColorStops(layer, stops)
  }

  const removeVolumeColorStop = (layer, index) => {
    const stops = getVolumeColorbarStops(layer).map((stop) => ({ ...stop }))
    if (index === 0 || index === stops.length - 1) return
    if (stops.length <= 2) {
      ElMessage.warning('至少保留两个标记点')
      return
    }
    stops.splice(index, 1)
    persistVolumeColorStops(layer, stops)
  }

  const resetVolumeColorStops = (layer) => {
    if (!layer) return
    delete layer.volume_color_stops
    clearVolumeColorStopDraft(layer)
    onRangeUpdated?.(layer)
  }

  const clearVolumeColorbarRangeDraft = (layer, key) => {
    const draftKey = getVolumeColorbarRangeDraftKey(layer, key)
    if (!draftKey) return
    const nextDrafts = { ...rangeInputDrafts.value }
    delete nextDrafts[draftKey]
    rangeInputDrafts.value = nextDrafts
  }

  const setVolumeColorbarRangeDraft = (layer, key, value) => {
    const draftKey = getVolumeColorbarRangeDraftKey(layer, key)
    if (!draftKey) return
    rangeInputDrafts.value = {
      ...rangeInputDrafts.value,
      [draftKey]: String(value ?? ''),
    }
  }

  const updateVolumeColorbarRange = (layer, key, value, options = {}) => {
    if (!layer) return false
    if (options.keepDraft) {
      setVolumeColorbarRangeDraft(layer, key, value)
    }
    const next = Number(value)
    if (!Number.isFinite(next)) return false
    const current = resolveVolumeLayerRange(layer)
    const nextVmin = key === 'vmin' ? next : current.vmin
    const nextVmax = key === 'vmax' ? next : current.vmax
    if (
      Number.isFinite(nextVmin) &&
      Number.isFinite(nextVmax) &&
      nextVmax <= nextVmin
    ) {
      if (!options.silentInvalid) {
        ElMessage.warning('最大值必须大于最小值')
      }
      return false
    }
    if (key === 'vmin') {
      layer.display_vmin = next
      if (!Number.isFinite(Number(layer.display_vmax))) {
        layer.display_vmax = current.vmax
      }
    } else {
      layer.display_vmax = next
      if (!Number.isFinite(Number(layer.display_vmin))) {
        layer.display_vmin = current.vmin
      }
    }
    onRangeUpdated?.(layer)
    return true
  }

  const handleVolumeColorbarRangeInput = (layer, key, value) => {
    setVolumeColorbarRangeDraft(layer, key, value)
  }

  const commitVolumeColorbarRangeInput = (layer, key, value) => {
    const updated = updateVolumeColorbarRange(layer, key, value)
    if (updated) {
      clearVolumeColorbarRangeDraft(layer, key)
      return
    }
    const next = Number(value)
    if (!Number.isFinite(next)) {
      clearVolumeColorbarRangeDraft(layer, key)
    }
  }

  const applyVolumeColorbarRange = (layer) => {
    if (!layer) return
    const range = resolveVolumeLayerRange(layer)
    const nextVmin = Number(getVolumeColorbarRangeInputValue(layer, 'vmin'))
    const nextVmax = Number(getVolumeColorbarRangeInputValue(layer, 'vmax'))
    const vmin = Number.isFinite(nextVmin) ? nextVmin : range.vmin
    const vmax = Number.isFinite(nextVmax) ? nextVmax : range.vmax
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) {
      ElMessage.warning('请输入有效的最大值和最小值')
      return
    }
    if (vmax <= vmin) {
      ElMessage.warning('最大值必须大于最小值')
      return
    }
    layer.display_vmin = vmin
    layer.display_vmax = vmax
    clearVolumeColorbarRangeDraft(layer, 'vmin')
    clearVolumeColorbarRangeDraft(layer, 'vmax')
    onRangeUpdated?.(layer)
  }

  const resetVolumeColorbarRange = (layer) => {
    if (!layer) return
    delete layer.display_vmin
    delete layer.display_vmax
    delete layer.volume_color_stops
    clearVolumeColorbarRangeDraft(layer, 'vmin')
    clearVolumeColorbarRangeDraft(layer, 'vmax')
    onRangeUpdated?.(layer)
  }

  const volumeColorbarTicks = (layer) => {
    const { vmin, vmax } = resolveVolumeLayerRange(layer)
    const base = resolveVolumeLayerBaseRange(layer)
    const baseMin = Number(base?.vmin)
    const baseMax = Number(base?.vmax)
    const baseSpan = baseMax - baseMin
    if (
      !Number.isFinite(vmin) ||
      !Number.isFinite(vmax) ||
      !Number.isFinite(baseMin) ||
      !Number.isFinite(baseMax) ||
      baseSpan <= 0
    ) {
      return [
        { key: 0, top: '0%', label: '—' },
        { key: 1, top: '100%', label: '—' },
      ]
    }
    const positionForValue = (value) => {
      const clamped = Math.max(baseMin, Math.min(baseMax, Number(value)))
      return ((baseMax - clamped) / baseSpan) * 100
    }
    return [
      {
        key: 0,
        top: `${positionForValue(vmax)}%`,
        label: formatCmapRangeValue(vmax, layer),
      },
      {
        key: 1,
        top: `${positionForValue(vmin)}%`,
        label: formatCmapRangeValue(vmin, layer),
      },
    ]
  }

  const getVolumeColorbarBaseRange = (layer) => {
    if (!layer) return null
    return resolveVolumeLayerBaseRange(layer)
  }

  const beginVolumeColorbarRangeDrag = (layer, key, event) => {
    if (!layer || (key !== "vmin" && key !== "vmax")) return
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const scale = event?.currentTarget?.closest?.(".vcbar-scale")
    const gradient = scale?.querySelector?.(".vcbar-gradient")
    const rect = gradient?.getBoundingClientRect?.()
    if (!rect || rect.height <= 0) return
    const base = resolveVolumeLayerBaseRange(layer)
    if (!isValidColorbarRange(base?.vmin, base?.vmax)) return
    const baseMin = base.vmin
    const baseMax = base.vmax
    const baseSpan = baseMax - baseMin
    const minGap = Math.max(colorbarRangeStep(layer) * 4, baseSpan / 200)

    const clamp = (value) => {
      if (!Number.isFinite(value)) return null
      return Math.max(baseMin, Math.min(baseMax, value))
    }

    const computeFromPointer = (pointerEvent) => {
      const ratio = Math.max(
        0,
        Math.min(1, 1 - (pointerEvent.clientY - rect.top) / rect.height),
      )
      return clamp(baseMin + ratio * baseSpan)
    }

    const apply = (next) => {
      if (!Number.isFinite(next)) return
      const current = resolveVolumeLayerRange(layer)
      if (key === "vmin") {
        const upperBound = Number.isFinite(current.vmax) ? current.vmax : baseMax
        const upper = Math.min(upperBound - minGap, baseMax)
        const clamped = Math.max(baseMin, Math.min(upper, next))
        updateVolumeColorbarRange(layer, "vmin", clamped, { silentInvalid: true })
      } else {
        const lowerBound = Number.isFinite(current.vmin) ? current.vmin : baseMin
        const lower = Math.max(lowerBound + minGap, baseMin)
        const clamped = Math.max(lower, Math.min(baseMax, next))
        updateVolumeColorbarRange(layer, "vmax", clamped, { silentInvalid: true })
      }
    }

    const stopDrag = () => {
      window.removeEventListener("pointermove", updateFromPointer)
      window.removeEventListener("pointerup", stopDrag)
      window.removeEventListener("pointercancel", stopDrag)
    }
    const updateFromPointer = (pointerEvent) => {
      apply(computeFromPointer(pointerEvent))
    }

    apply(computeFromPointer(event))
    window.addEventListener("pointermove", updateFromPointer)
    window.addEventListener("pointerup", stopDrag)
    window.addEventListener("pointercancel", stopDrag)
  }

  return {
    colorbarOverlayVisible,
    selectedColorbarOverlayLayerId,
    toggleColorbarOverlay,
    closeColorbarOverlay,
    handleColorbarLayerSelectChange,
    colorbarOverlayLayers,
    selectedColorbarOverlayLayer,
    resolveVolumeLayerDisplayName,
    volumeLayerCmapStyle,
    colorbarRangeStep,
    getVolumeColorbarRangeInputValue,
    handleVolumeColorbarRangeInput,
    commitVolumeColorbarRangeInput,
    applyVolumeColorbarRange,
    updateVolumeColorbarRange,
    resetVolumeColorbarRange,
    getVolumeColorbarStops,
    getVolumeColorStopInputValue,
    updateVolumeColorStopValue,
    commitVolumeColorStopValue,
    updateVolumeColorStopPosition,
    addVolumeColorStop,
    removeVolumeColorStop,
    resetVolumeColorStops,
    volumeColorbarTicks,
    getVolumeColorbarBaseRange,
    beginVolumeColorbarRangeDrag,
  }
}
