import { ref, computed } from 'vue'
import { readSavedGasColormaps } from '@/utils/gasColormapStorage'

export const VISUALIZATION_DOMAINS = {
  GAS: 'gas',
  RADAR: 'radar',
}

export const GENERATED_LAYER_PAGES = {
  CONTOUR: 'contour',
  CLOUD: 'cloud',
  VECTOR: 'vector',
  VOLUME: 'volume',
}

export function useHomeVisualizationState(options = {}) {
  const {
    getActiveModule = () => 'home',
    getVisualization = () => ({}),
    getVisualizationDimension = () => '2d',
    getVisualization2DType = () => 'cloud',
  } = options

  const visualizationSettingsKey = ref(0)
  const visualizationOptionsDomain = ref(VISUALIZATION_DOMAINS.GAS)
  const generatedLayerPage = ref(GENERATED_LAYER_PAGES.VECTOR)
  const streamlineSettingsVisible = ref(false)
  const streamlineSettingsLayer = ref(null)
  const particleSettingsVisible = ref(false)
  const particleSettingsLayer = ref(null)
  const gasVariableConfigVisible = ref(false)
  const gasVariableConfigTargetId = ref('')

  const savedGasColormaps = readSavedGasColormaps()

  const isGasDomain = computed(() => visualizationOptionsDomain.value === VISUALIZATION_DOMAINS.GAS)
  const isRadarDomain = computed(() => visualizationOptionsDomain.value === VISUALIZATION_DOMAINS.RADAR)

  function refreshVisualizationSettings() {
    visualizationSettingsKey.value += 1
  }

  function setVisualizationDomain(domain) {
    visualizationOptionsDomain.value = domain
  }

  function toggleGasDomain() {
    visualizationOptionsDomain.value = VISUALIZATION_DOMAINS.GAS
  }

  function toggleRadarDomain() {
    visualizationOptionsDomain.value = VISUALIZATION_DOMAINS.RADAR
  }

  function openStreamlineSettings(layer) {
    streamlineSettingsLayer.value = layer
    streamlineSettingsVisible.value = true
  }

  function closeStreamlineSettings() {
    streamlineSettingsVisible.value = false
    streamlineSettingsLayer.value = null
  }

  function openParticleSettings(layer) {
    particleSettingsLayer.value = layer
    particleSettingsVisible.value = true
  }

  function closeParticleSettings() {
    particleSettingsVisible.value = false
    particleSettingsLayer.value = null
  }

  function initGasColormaps() {
    const viz = getVisualization()
    if (Object.keys(savedGasColormaps).length > 0) {
      viz.gasCmaps = {
        ...(viz.gasCmaps || {}),
        ...savedGasColormaps,
      }
    }
  }

  function syncLocalGasColormaps() {
    const viz = getVisualization()
    const localGasColormaps = readSavedGasColormaps()
    if (Object.keys(localGasColormaps).length <= 0) return
    viz.gasCmaps = {
      ...(viz.gasCmaps || {}),
      ...localGasColormaps,
    }
  }

  function resolveVolumeLayerVariableId(layer) {
    if (layer?.variable != null && String(layer.variable).trim() !== '') {
      return String(layer.variable).trim()
    }
    const id = String(layer?.id || '')
    const parts = id.split(':')
    if (String(parts[0] || '').toLowerCase() === 'volume' && parts.length >= 3) {
      return parts.slice(2).join(':').trim()
    }
    return ''
  }

  function openGasVariableConfig(layer = null) {
    gasVariableConfigTargetId.value = layer
      ? resolveVolumeLayerVariableId(layer)
      : ''
    gasVariableConfigVisible.value = true
  }

  function closeGasVariableConfig() {
    gasVariableConfigVisible.value = false
  }

  function handleGasChange(payload) {
    const viz = getVisualization()
    const dim = getVisualizationDimension()
    const type2d = getVisualization2DType()

    if (
      payload &&
      typeof payload === 'object' &&
      Array.isArray(payload.ids)
    ) {
      if (payload.ids.length === 0) {
        viz.volume_variables = []
        viz.cloud_variables = []
        viz.variable = ''
        return
      }
      if (dim === '3d') {
        viz.volume_variables = [...payload.ids]
        viz.cloud_variables = []
        viz.variable = payload.ids[0] != null ? payload.ids[0] : ''
      } else if (dim === '2d' && type2d === 'cloud') {
        viz.cloud_variables = [...payload.ids]
        viz.volume_variables = []
        viz.variable = payload.ids[0] != null ? payload.ids[0] : ''
      } else {
        viz.volume_variables = []
        viz.cloud_variables = []
        viz.variable = payload.ids[0] != null ? payload.ids[0] : ''
      }
      if (Array.isArray(payload.colors)) {
        if (!viz.gasColors) viz.gasColors = {}
        if (!viz.gasCmaps) viz.gasCmaps = {}
        for (const item of payload.colors) {
          if (item?.id && item.color) {
            viz.gasColors[item.id] = item.color
          }
          if (item?.id && item.cmap != null && item.cmap !== '') {
            viz.gasCmaps[item.id] = item.cmap
          }
        }
      }
      return
    }
    const id = typeof payload === 'string' ? payload : payload?.id
    const color =
      typeof payload === 'object' && payload != null ? payload.color : null
    viz.volume_variables = []
    viz.cloud_variables = []
    if (!id) return
    viz.variable = id
    if (color && typeof color === 'string') {
      if (!viz.gasColors) viz.gasColors = {}
      viz.gasColors[id] = color
    }
  }

  function handleGasColorUpdate(data) {
    const viz = getVisualization()
    const { id, color } = data
    if (!id || !color) return
    if (!viz.gasColors) viz.gasColors = {}
    viz.gasColors[id] = color
  }

  function handleGasCmapUpdate(data) {
    const viz = getVisualization()
    const { id, cmap } = data
    if (!id || cmap == null || cmap === '') return
    if (!viz.gasCmaps) viz.gasCmaps = {}
    viz.gasCmaps[id] = cmap
  }

  return {
    visualizationSettingsKey,
    visualizationOptionsDomain,
    generatedLayerPage,
    streamlineSettingsVisible,
    streamlineSettingsLayer,
    particleSettingsVisible,
    particleSettingsLayer,
    gasVariableConfigVisible,
    gasVariableConfigTargetId,
    savedGasColormaps,
    isGasDomain,
    isRadarDomain,
    refreshVisualizationSettings,
    setVisualizationDomain,
    toggleGasDomain,
    toggleRadarDomain,
    openStreamlineSettings,
    closeStreamlineSettings,
    openParticleSettings,
    closeParticleSettings,
    initGasColormaps,
    syncLocalGasColormaps,
    resolveVolumeLayerVariableId,
    openGasVariableConfig,
    closeGasVariableConfig,
    handleGasChange,
    handleGasColorUpdate,
    handleGasCmapUpdate,
    VISUALIZATION_DOMAINS,
    GENERATED_LAYER_PAGES,
  }
}
