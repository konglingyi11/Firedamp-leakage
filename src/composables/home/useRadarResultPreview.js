import { ElMessage } from 'element-plus'

function encodeSvgDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function buildRadarResultPreviewSvg(mode) {
  if (mode === 'wavefront') {
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
        <defs>
          <linearGradient id="field" x1="0" x2="1">
            <stop offset="0" stop-color="#071521"/>
            <stop offset=".26" stop-color="#12598a"/>
            <stop offset=".52" stop-color="#24d5e8"/>
            <stop offset=".72" stop-color="#ffd45a"/>
            <stop offset="1" stop-color="#44231c"/>
          </linearGradient>
          <radialGradient id="echo" cx="62%" cy="50%" r="42%">
            <stop offset="0" stop-color="#fff7ad"/>
            <stop offset=".28" stop-color="#ffd45a"/>
            <stop offset=".54" stop-color="#27d9ff" stop-opacity=".48"/>
            <stop offset="1" stop-color="#071521" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="640" height="360" fill="#071521"/>
        <rect x="24" y="32" width="592" height="296" fill="url(#field)" opacity=".72"/>
        <circle cx="398" cy="178" r="148" fill="url(#echo)"/>
        <g fill="none" stroke-linecap="round">
          <path d="M78 180 C154 86 250 72 330 136 S472 246 568 124" stroke="#eaffff" stroke-width="4" opacity=".68"/>
          <path d="M82 218 C178 138 262 120 352 174 S496 276 576 180" stroke="#9ef2ff" stroke-width="3" opacity=".42"/>
          <path d="M96 150 C172 112 252 112 338 158 S494 204 560 144" stroke="#ffe08a" stroke-width="3" opacity=".5" stroke-dasharray="14 12"/>
        </g>
        <g opacity=".22" stroke="#ffffff">
          <path d="M104 32V328"/><path d="M184 32V328"/><path d="M264 32V328"/><path d="M344 32V328"/><path d="M424 32V328"/><path d="M504 32V328"/>
          <path d="M24 91H616"/><path d="M24 150H616"/><path d="M24 209H616"/><path d="M24 268H616"/>
        </g>
      </svg>
    `)
  }

  if (mode === 'heatmap') {
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
        <defs>
          <linearGradient id="bg" x1="0" x2="1">
            <stop offset="0" stop-color="#14335f"/>
            <stop offset=".42" stop-color="#1aa7c0"/>
            <stop offset=".7" stop-color="#ffd34d"/>
            <stop offset="1" stop-color="#55261e"/>
          </linearGradient>
          <radialGradient id="hot" cx="68%" cy="46%" r="26%">
            <stop offset="0" stop-color="#ff2e24"/>
            <stop offset=".35" stop-color="#ffd24d"/>
            <stop offset=".75" stop-color="#36d7ff" stop-opacity=".35"/>
            <stop offset="1" stop-color="#071521" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="640" height="360" fill="#071521"/>
        <rect x="18" y="34" width="604" height="292" fill="url(#bg)" opacity=".78"/>
        <circle cx="430" cy="164" r="130" fill="url(#hot)"/>
        <ellipse cx="430" cy="164" rx="72" ry="42" fill="none" stroke="#fff2a8" stroke-width="4" opacity=".72"/>
        <ellipse cx="430" cy="164" rx="120" ry="74" fill="none" stroke="#fff2a8" stroke-width="2" opacity=".36"/>
        <path d="M64 245 C184 170 306 138 502 120" fill="none" stroke="#dffaff" stroke-width="3" opacity=".42"/>
        <path d="M42 208 H598" stroke="#ffffff" stroke-width="2" stroke-dasharray="9 9" opacity=".35"/>
        <g opacity=".18" stroke="#ffffff">
          <path d="M100 34V326"/><path d="M180 34V326"/><path d="M260 34V326"/><path d="M340 34V326"/><path d="M420 34V326"/><path d="M500 34V326"/>
          <path d="M18 92H622"/><path d="M18 150H622"/><path d="M18 208H622"/><path d="M18 266H622"/>
        </g>
      </svg>
    `)
  }

  if (mode === 'vector') {
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
        <rect width="640" height="360" fill="#071521"/>
        <g fill="none" stroke-linecap="round">
          <path d="M42 232 C142 112 256 96 340 176 S484 298 598 126" stroke="#70e8ff" stroke-width="8" opacity=".76"/>
          <path d="M64 278 C182 220 246 260 336 164 S490 54 584 94" stroke="#ffd65a" stroke-width="6" opacity=".82"/>
          <path d="M80 176 C184 146 264 166 350 214 S498 254 580 194" stroke="#89ffc7" stroke-width="4" opacity=".45"/>
        </g>
        <g fill="#eaffff">
          <circle cx="292" cy="152" r="11"/><circle cx="458" cy="259" r="9"/><circle cx="514" cy="84" r="7"/>
        </g>
        <g stroke="#ffffff" stroke-width="2" opacity=".2">
          <path d="M0 300H640"/><path d="M0 240H640"/><path d="M0 180H640"/><path d="M0 120H640"/>
          <path d="M100 0V360"/><path d="M220 0V360"/><path d="M340 0V360"/><path d="M460 0V360"/><path d="M580 0V360"/>
        </g>
      </svg>
    `)
  }

  return encodeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#071521"/>
      <rect x="180" y="62" width="284" height="236" fill="#9fa7a3" opacity=".22" stroke="#dffaff" stroke-width="3"/>
      <rect x="230" y="62" width="42" height="236" fill="#9ab6b4" opacity=".48"/>
      <rect x="292" y="62" width="42" height="236" fill="#4f9bad" opacity=".46"/>
      <rect x="354" y="62" width="42" height="236" fill="#d1b26d" opacity=".38"/>
      <g stroke="#1e2c31" stroke-width="8" opacity=".95">
        <path d="M206 112H438"/><path d="M206 166H438"/><path d="M206 220H438"/>
        <path d="M254 82V278"/><path d="M326 82V278"/><path d="M398 82V278"/>
      </g>
      <ellipse cx="410" cy="158" rx="48" ry="34" fill="#050b10" opacity=".72" stroke="#ffe18a" stroke-width="4"/>
      <path d="M54 196 C154 128 232 112 410 158 C302 200 202 224 88 238" fill="none" stroke="#7fe7ff" stroke-width="5" opacity=".54"/>
      <path d="M54 196 C154 128 232 112 410 158" fill="none" stroke="#ffd65a" stroke-width="4" opacity=".52" stroke-dasharray="12 10"/>
    </svg>
  `)
}

export function useRadarResultPreview(options = {}) {
  const {
    visualization,
    selectedPlane,
    planeCoordinate,
    generatedVizLayers,
    selectedLayerId,
    hasAppliedSettings,
    isTimelineCollapsed,
    buildSimRadarFrameImages,
    buildGeneratedLayerId,
    buildRadarMockVolumeVariableId,
    upsertGeneratedVizLayer,
  } = options

  function currentRadarResultPreviewMode() {
    const mode = String(visualization.value?.radar_result_mode || 'wavefront')
    if (mode === 'cloud' || mode === 'wavefront') return 'wavefront'
    if (mode === 'vector' || mode === 'heatmap') return 'heatmap'
    if (mode === 'streamline' || mode === 'trails') return 'trails'
    if (mode === 'volume' || mode === 'structure') return 'structure'
    return 'wavefront'
  }

  function selectedRadarWavefrontDimensions() {
    const dims = Array.isArray(visualization.value?.radar_wavefront_dimensions)
      ? visualization.value.radar_wavefront_dimensions
      : []
    const next = ['2d', '3d'].filter((dim) => dims.includes(dim))
    if (next.length) return next
    visualization.value.radar_wavefront_dimensions = ['3d']
    return ['3d']
  }

  function ensureRadarTrailsDefaults() {
    if (!visualization.value.radar_trails || typeof visualization.value.radar_trails !== 'object') {
      visualization.value.radar_trails = {}
    }
    const rt = visualization.value.radar_trails
    const legacy =
      visualization.value.streamline && typeof visualization.value.streamline === 'object'
        ? visualization.value.streamline
        : {}
    if (rt.seed_count == null) rt.seed_count = legacy.seed_count ?? 28
    if (rt.points_per_streamline == null) {
      rt.points_per_streamline = legacy.points_per_streamline ?? 36
    }
    if (rt.line_width == null) rt.line_width = legacy.line_width ?? 0.38
    if (rt.display_time == null) rt.display_time = legacy.display_time ?? 5
    if (rt.color == null) rt.color = legacy.color ?? '#ff3b30'
  }

  function applyRadarResultPreviewSettings() {
    const mode = currentRadarResultPreviewMode()
    if (mode === 'trails') {
      ensureRadarTrailsDefaults()
    }
    const plane = selectedPlane.value || 'xy'
    const coord = planeCoordinate.value ?? plane
    const primaryBand = Array.isArray(visualization.value?.radar_frequencies)
      ? visualization.value.radar_frequencies[0]
      : null
    const bandId = primaryBand || 's_band'

    generatedVizLayers.value.forEach((layer) => {
      if (layer?.isRadarResultPreview) layer.visible = false
    })

    const layers = []
    if (mode === 'wavefront') {
      const dimensions = selectedRadarWavefrontDimensions()
      if (dimensions.includes('2d')) {
        const wavefrontImages = buildSimRadarFrameImages(plane)
        layers.push({
          id: buildGeneratedLayerId('radar_wavefront_cloud', {
            plane,
            coordinate: coord,
            variable: bandId,
          }),
          kind: 'radar_wavefront_cloud',
          previewMode: 'wavefront_cloud',
          label: '波前云图',
          variable: bandId,
          images: wavefrontImages.length
            ? wavefrontImages
            : [{ time_step: 1, svg_url: buildRadarResultPreviewSvg('wavefront') }],
          physicalTimes: [],
          physicalWidth: 2,
          physicalHeight: 2,
        })
      }
      if (dimensions.includes('3d')) {
        layers.push({
          id: buildGeneratedLayerId('radar_wavefront', {
            plane,
            coordinate: coord,
            variable: bandId,
          }),
          kind: 'radar_wavefront',
          previewMode: 'wavefront',
          label: '波前传播动画',
          variable: bandId,
          images: [{ time_step: 0, svg_url: buildRadarResultPreviewSvg('wavefront') }],
          physicalTimes: [0],
          physicalWidth: 2,
          physicalHeight: 2,
        })
      }
    } else if (mode === 'heatmap') {
      layers.push({
        id: buildGeneratedLayerId('radar_heatmap', {
          plane,
          coordinate: coord,
          variable: bandId,
        }),
        kind: 'radar_heatmap',
        previewMode: 'heatmap',
        label: '场强热力图',
        variable: bandId,
        images: [{ time_step: 0, svg_url: buildRadarResultPreviewSvg('heatmap') }],
        physicalTimes: [0],
        physicalWidth: 2,
        physicalHeight: 2,
      })
    } else if (mode === 'trails') {
      layers.push({
        id: buildGeneratedLayerId('radar_trails'),
        kind: 'radar_trails',
        previewMode: 'trails',
        label: '能量轨迹线',
      })
    } else {
      const volumeVariable = buildRadarMockVolumeVariableId(bandId)
      layers.push({
        id: buildGeneratedLayerId('radar_structure'),
        kind: 'radar_structure',
        previewMode: 'structure',
        label: '介质结构叠加',
        variable: volumeVariable,
        volumeVariable,
      })
    }

    layers.forEach((layer) => {
      upsertGeneratedVizLayer({
        ...layer,
        visible: true,
        ready: true,
        loaded: true,
        isMock: true,
        isRadarResultPreview: true,
      })
    })
    selectedLayerId.value = layers[layers.length - 1]?.id ?? null
    hasAppliedSettings.value = true
    isTimelineCollapsed.value = false

    ElMessage.success('已应用雷达可视化设置')
  }

  return {
    encodeSvgDataUrl,
    buildRadarResultPreviewSvg,
    currentRadarResultPreviewMode,
    selectedRadarWavefrontDimensions,
    ensureRadarTrailsDefaults,
    applyRadarResultPreviewSettings,
  }
}
