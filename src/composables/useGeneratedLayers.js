import { ref } from 'vue'
import { getVariableDisplayName } from '@/utils/gas'
import { radarFrequencyLabel } from '@/constants/radarFrequencies.js'
import { resolveGeneratedLayerDefaultVisible } from './generatedLayerDefaults'
import {
  extractRadarMockVolumeBandId,
  isRadarMockVolumeVariableId,
} from '@/utils/mockRadarVolume3d.js'

const KIND_LABELS = {
  contour: '云图',
  cloud: '云图',
  radar_cloud: '雷达云图',
  radar_wave: '雷达波',
  radar_wavefront_cloud: '波前云图',
  radar_wavefront: '波前传播',
  radar_heatmap: '场强热力',
  radar_trails: '能量轨迹',
  radar_structure: '介质结构',
  vector: '矢量图',
  volume: '体渲染',
  smoke: '烟雾层',
  streamline: '流线图',
  particle: '粒子图层',
  model: '几何模型',
  realModel: '真实模型',
  bounds: '计算包围盒',
  monitor: '监测点',
  video: '视频',
}

/**
 * 图层列表管理 + UE 显隐协议
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.playerRef
 * @param {import('vue').Ref} deps.currentTask
 * @param {import('vue').Ref} deps.visualization
 * @param {import('vue').Ref} deps.selectedPlane
 * @param {import('vue').Ref} deps.planeCoordinate
 */
export function useGeneratedLayers({ playerRef, currentTask, visualization, selectedPlane, planeCoordinate }) {
  const generatedVizLayers = ref([])
  const vizLayersListCollapsed = ref(false)

  function formatPlaneDisplayName(plane) {
    const key = String(plane ?? '').toLowerCase()
    if (key === 'xy') return 'xy'
    if (key === 'yz') return 'yz'
    if (key === 'xz') return 'xz'
    return key || '切片'
  }

  function formatCoordinateDisplay(coord) {
    const n = Number(coord)
    if (!Number.isFinite(n)) return String(coord ?? '')
    if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n))
    return String(Math.round(n * 100) / 100)
  }

  function formatLayerVariableName(variable) {
    const raw = variable != null && String(variable).trim() !== ''
      ? String(variable).trim()
      : 'VelocityMagnitude'
    const display = getVariableDisplayName(raw)
    if (raw === 'VelocityMagnitude') return '速度'
    return display
  }

  function buildGeneratedLayerId(kind, opts = {}) {
    const tid = currentTask.value?.id ?? ''
    const plane = opts.plane ?? selectedPlane.value
    const coord = opts.coordinate ?? planeCoordinate.value
    if (kind === 'radar_cloud') {
      const bandKey =
        opts.variable != null && String(opts.variable).trim() !== ''
          ? String(opts.variable).trim()
          : 'default'
      return `radar_cloud:${tid}:${plane}:${coord}:${bandKey}`
    }
    if (kind === 'radar_wave') {
      return `radar_wave:${tid}:${plane}:${coord}`
    }
    if (
      kind === 'radar_wavefront' ||
      kind === 'radar_wavefront_cloud' ||
      kind === 'radar_heatmap'
    ) {
      const bandKey =
        opts.variable != null && String(opts.variable).trim() !== ''
          ? String(opts.variable).trim()
          : 'default'
      return `${kind}:${tid || 'default'}:${plane}:${coord}:${bandKey}`
    }
    if (kind === 'radar_trails' || kind === 'radar_structure') {
      return `${kind}:${tid || 'default'}`
    }
    if (kind === 'cloud' || kind === 'contour') {
      const v = opts.variable != null && String(opts.variable).trim() !== ''
        ? String(opts.variable).trim()
        : visualization.value.variable || 'VelocityMagnitude'
      return `cloud:${tid}:${plane}:${coord}:${v}`
    }
    if (kind === 'vector') {
      return `vector:${tid}:${plane}:${coord}`
    }
    if (kind === 'volume') {
      const v =
        opts.volumeVariable != null && String(opts.volumeVariable).trim() !== ''
          ? String(opts.volumeVariable).trim()
          : visualization.value.variable || 'VelocityMagnitude'
      return `volume:${tid}:${v}`
    }
    if (kind === 'smoke') {
      if (opts.smokePersonLayer || opts.personSmoke) {
        const zone = String(opts.smokeReleaseZoneName || 'head-release-zone')
        return `smoke:${tid || 'default'}:person:${zone}`
      }
      if (opts.smokeTotal) {
        return `smoke:${tid || 'default'}:velocity-total`
      }
      const v =
        opts.smokeVariable != null && String(opts.smokeVariable).trim() !== ''
          ? String(opts.smokeVariable).trim()
          : visualization.value.smoke_variable || 'mass_fraction_of_ch4'
      return `smoke:${tid || 'default'}:${v}`
    }
    if (kind === 'streamline') {
      return tid ? `streamline:${tid}` : `streamline:unknown`
    }
    if (kind === 'particle') {
      return tid ? `particle:${tid}` : `particle:unknown`
    }
    if (kind === 'model') {
      return `model:${tid || 'default'}`
    }
    if (kind === 'realModel') {
      return `realModel:${tid || 'default'}`
    }
    if (kind === 'bounds') {
      return `bounds:${tid || 'default'}`
    }
    if (kind === 'monitor') {
      return `monitor:${tid || 'default'}`
    }
    if (kind === 'video') {
      return `video:${tid || 'default'}`
    }
    return `${kind}:${tid}:${Date.now()}`
  }

  function buildGeneratedLayerLabel(kind, opts = {}) {
    const prefix = KIND_LABELS[kind] || kind
    if (kind === 'radar_cloud') {
      const plane = opts.plane ?? selectedPlane.value
      const coord = opts.coordinate ?? planeCoordinate.value
      let names =
        typeof opts.radarBandLabels === 'string' ? opts.radarBandLabels.trim() : ''
      if (!names && opts.variable != null && String(opts.variable).trim() !== '') {
        const ids = String(opts.variable)
          .split('+')
          .map((x) => x.trim())
          .filter(Boolean)
        names =
          ids.length > 0
            ? ids.map((id) => radarFrequencyLabel(id)).join('·')
            : '频段'
      }
      if (!names) names = '频段'
      return `${prefix}-${names}-${formatPlaneDisplayName(plane)} ${formatCoordinateDisplay(coord)}`
    }
    if (kind === 'radar_wave') {
      const plane = opts.plane ?? selectedPlane.value
      const coord = opts.coordinate ?? planeCoordinate.value
      return `雷达波-${formatPlaneDisplayName(plane)} ${formatCoordinateDisplay(coord)}`
    }
    if (kind === 'radar_wavefront_cloud') return opts.label || '波前云图'
    if (kind === 'radar_wavefront') return opts.label || '波前传播动画'
    if (kind === 'radar_heatmap') return opts.label || '场强热力图'
    if (kind === 'radar_trails') return opts.label || '能量轨迹线'
    if (kind === 'radar_structure') return opts.label || '介质结构叠加'
    if (kind === 'cloud' || kind === 'contour') {
      const v =
        opts.variable != null && String(opts.variable).trim() !== ''
          ? String(opts.variable).trim()
          : visualization.value.variable || 'VelocityMagnitude'
      const plane = opts.plane ?? selectedPlane.value
      const coord = opts.coordinate ?? planeCoordinate.value
      return `${prefix}-${formatLayerVariableName(v)}-${formatPlaneDisplayName(plane)} ${formatCoordinateDisplay(coord)}`
    }
    if (kind === 'volume') {
      const v =
        opts.volumeVariable != null && String(opts.volumeVariable).trim() !== ''
          ? String(opts.volumeVariable).trim()
          : visualization.value.variable || 'VelocityMagnitude'
      if (isRadarMockVolumeVariableId(v)) {
        const bandId = extractRadarMockVolumeBandId(v)
        const bandLabel = bandId ? radarFrequencyLabel(bandId) : '雷达'
        return `${prefix}-雷达-${bandLabel}`
      }
      return `${prefix}-${formatLayerVariableName(v)}`
    }
    if (kind === 'smoke') {
      if (opts.smokePersonLayer || opts.personSmoke) {
        return opts.label || `${prefix}-人体层`
      }
      if (opts.smokeTotal) {
        return `${prefix}-速度总览`
      }
      const v =
        opts.smokeVariable != null && String(opts.smokeVariable).trim() !== ''
          ? String(opts.smokeVariable).trim()
          : visualization.value.smoke_variable || 'mass_fraction_of_ch4'
      return `${prefix}-${formatLayerVariableName(v)}`
    }
    if (kind === 'vector') {
      const v =
        opts.vectorVariable != null && String(opts.vectorVariable).trim() !== ''
          ? String(opts.vectorVariable).trim()
          : 'VelocityMagnitude'
      const plane = opts.plane ?? selectedPlane.value
      const coord = opts.coordinate ?? planeCoordinate.value
      const variableLabel = formatLayerVariableName(v)
      const planeLabel = formatPlaneDisplayName(plane)
      if (coord === plane) {
        return `${prefix}-${variableLabel}-${planeLabel}`
      }
      return `${prefix}-${variableLabel}-${planeLabel} ${formatCoordinateDisplay(coord)}`
    }
    if (kind === 'streamline') {
      const sc = visualization.value?.streamline
      const seed = sc?.seed_count
      const seedTag = Number.isFinite(Number(seed)) ? `-${Number(seed)}个起点` : ''
      return `${prefix}${seedTag}`
    }
    if (kind === 'particle') {
      const p = visualization.value?.particle
      const count = p?.maxParticles ?? p?.max_particles
      const countTag = Number.isFinite(Number(count)) ? `-${Number(count)}个` : ''
      return `${prefix}${countTag}`
    }
    if (kind === 'model') {
      return opts.label || prefix
    }
    if (kind === 'realModel') {
      return opts.label || prefix
    }
    if (kind === 'bounds') {
      return opts.label || '几何包围盒'
    }
    if (kind === 'monitor') {
      return opts.label || prefix
    }
    return prefix
  }

  function purgeExcludedGeneratedLayers() {
    const filtered = generatedVizLayers.value.filter(
      (layer) =>
        !String(layer?.id ?? '')
          .toLowerCase()
          .includes('mass_fraction_of_air'),
    )
    if (filtered.length !== generatedVizLayers.value.length) {
      generatedVizLayers.value = filtered
    }
  }

  function registerGeneratedLayer(kind, opts = {}) {
    if (
      ![
        'contour',
        'vector',
        'volume',
        'smoke',
        'streamline',
        'particle',
        'model',
        'realModel',
        'bounds',
        'monitor',
        'video',
        'radar_wavefront_cloud',
        'radar_wavefront',
        'radar_heatmap',
        'radar_trails',
        'radar_structure',
      ].includes(kind)
    ) { return }
    const layerVariable =
      kind === 'volume'
        ? opts.volumeVariable
        : kind === 'smoke'
          ? opts.smokeVariable
        : kind === 'contour' || kind === 'cloud'
          ? opts.variable
          : null
    if (String(layerVariable || '').toLowerCase() === 'mass_fraction_of_air') return
    const id = buildGeneratedLayerId(kind, opts)
    const label = buildGeneratedLayerLabel(kind, opts)
    const list = generatedVizLayers.value
    const idx = list.findIndex((l) => l.id === id)
    const entry = {
      id,
      kind,
      label,
      visible:
        opts.visible !== undefined
          ? Boolean(opts.visible)
          : resolveGeneratedLayerDefaultVisible(kind),
      ready: Boolean(opts.ready),
      loaded: opts.loaded !== undefined ? Boolean(opts.loaded) : false,
      images: [],        // 该图层的帧列表，每项 { time_step, svg_url, png_url, url, data }
      physicalTimes: [], // 与 images 对应的物理时间数组
      physicalWidth: null,
      physicalHeight: null,
      vmin: null,
      vmax: null,
      cmap: 'coolwarm',
      opacity: 1,
      blendMode: 'normal',
      currentFrameIndex: 0,
      isMock: opts.isMock === true, // 标记是否为模拟图层
      usePregen: opts.usePregen,
      loadSource: opts.loadSource,
      smokeManifestUrl: opts.smokeManifestUrl,
      smokeScalar: opts.smokeScalar,
      smokeTotal: opts.smokeTotal === true,
      smokePersonLayer: opts.smokePersonLayer === true || opts.personSmoke === true,
      smokeReleaseZoneName: opts.smokeReleaseZoneName,
      smokeFrameIndex: opts.smokeFrameIndex,
      streamlineSmokeEnabled:
        kind === 'streamline'
          ? Boolean(opts.streamlineSmokeEnabled)
          : undefined,
      streamlineLineVisible:
        kind === 'streamline'
          ? opts.streamlineLineVisible !== false
          : undefined,
      seeThrough: kind === 'volume' ? false : undefined,
    }
    
    if (kind === 'streamline' || kind === 'particle') {
      // 单次赋值：先过滤旧的单例图层，再添加新的，避免两次数组引用变更触发递归更新
      const filtered = list.filter((l) => l.kind !== kind)
      if (idx >= 0) {
        filtered.push({
          ...list.find((l) => l.id === id),
          kind,
          label,
          visible:
            opts.visible !== undefined
              ? Boolean(opts.visible)
              : list.find((l) => l.id === id)?.visible ??
                resolveGeneratedLayerDefaultVisible(kind),
          ready: opts.ready !== undefined ? Boolean(opts.ready) : false,
          loaded: opts.loaded !== undefined ? Boolean(opts.loaded) : false,
          isMock: opts.isMock !== undefined ? Boolean(opts.isMock) : Boolean(list.find((l) => l.id === id)?.isMock),
          streamlineSmokeEnabled:
            kind === 'streamline'
              ? Boolean(
                opts.streamlineSmokeEnabled ??
                    list.find((l) => l.id === id)?.streamlineSmokeEnabled,
              )
              : undefined,
          streamlineLineVisible:
            kind === 'streamline'
              ? opts.streamlineLineVisible !== undefined
                ? opts.streamlineLineVisible !== false
                : list.find((l) => l.id === id)?.streamlineLineVisible !== false
              : undefined,
          seeThrough: list.find((l) => l.id === id)?.seeThrough ?? entry.seeThrough,
        })
      } else {
        filtered.push(entry)
      }
      generatedVizLayers.value = filtered
      return
    }
    
    if (kind === 'monitor') {
      // 单次赋值：先过滤旧的 monitor，再添加新的，避免两次数组引用变更触发递归更新
      const filtered = list.filter((l) => l.kind !== 'monitor')
      if (idx >= 0) {
        filtered.push({
          ...list.find((l) => l.id === id),
          kind,
          label,
          visible:
            opts.visible !== undefined
              ? Boolean(opts.visible)
              : list.find((l) => l.id === id)?.visible ??
                resolveGeneratedLayerDefaultVisible(kind),
          ready: opts.ready !== undefined ? Boolean(opts.ready) : false,
          loaded: opts.loaded !== undefined ? Boolean(opts.loaded) : false,
        })
      } else {
        filtered.push(entry)
      }
      generatedVizLayers.value = filtered
      return
    }
    
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        kind,
        label,
        visible:
          opts.visible !== undefined ? Boolean(opts.visible) : Boolean(list[idx].visible ?? true),
        ready: opts.ready !== undefined ? Boolean(opts.ready) : Boolean(list[idx].ready),
        loaded:
          opts.loaded !== undefined ? Boolean(opts.loaded) : Boolean(list[idx].loaded),
        usePregen:
          opts.usePregen !== undefined ? opts.usePregen : list[idx].usePregen,
        loadSource:
          opts.loadSource !== undefined ? opts.loadSource : list[idx].loadSource,
        smokeManifestUrl:
          opts.smokeManifestUrl !== undefined
            ? opts.smokeManifestUrl
            : list[idx].smokeManifestUrl,
        smokeScalar:
          opts.smokeScalar !== undefined ? opts.smokeScalar : list[idx].smokeScalar,
        smokeTotal:
          opts.smokeTotal !== undefined ? Boolean(opts.smokeTotal) : Boolean(list[idx].smokeTotal),
        smokePersonLayer:
          opts.smokePersonLayer !== undefined || opts.personSmoke !== undefined
            ? Boolean(opts.smokePersonLayer || opts.personSmoke)
            : Boolean(list[idx].smokePersonLayer),
        smokeReleaseZoneName:
          opts.smokeReleaseZoneName !== undefined
            ? opts.smokeReleaseZoneName
            : list[idx].smokeReleaseZoneName,
        smokeFrameIndex:
          opts.smokeFrameIndex !== undefined
            ? opts.smokeFrameIndex
            : list[idx].smokeFrameIndex,
      }
    } else {
      list.push(entry)
    }
    
  }

  function upsertGeneratedVizLayer({
    id,
    kind,
    label,
    visible,
    ready = true,
    loaded,
    images,
    physicalTimes,
    physicalWidth,
    physicalHeight,
    vmin,
    vmax,
    original_value_range,
    value_range,
    cmap,
    custom_colors,
    opacity,
    blendMode,
    plane,
    coordinate,
    variable,
    volumeVariable,
    isMock,
    usePregen,
    loadSource,
    smokeManifestUrl,
    smokeScalar,
    smokePersonLayer,
    smokeReleaseZoneName,
    smokeFrameIndex,
    isRadarResultPreview,
    previewMode,
  }) {
    if (id == null || id === '') return
    const sid = String(id)
    if (sid.toLowerCase().includes('mass_fraction_of_air')) return
    const list = generatedVizLayers.value
    const idx = list.findIndex((l) => String(l.id) === sid)
    const existing = idx >= 0 ? list[idx] : null
    // 解析 id 中嵌入的 plane/coordinate/variable（格式: cloud:<tid>:<plane>:<coord>:<var> 或 vector:<tid>:<plane>:<coord>）
    const parsed = (() => {
      const parts = sid.split(':')
      if (parts[0] === 'radar_cloud') {
        return {
          plane: parts[2] || 'xy',
          coordinate: parts[3] || '0',
          variable: parts.slice(4).join(':') || null,
        }
      }
      if (parts[0] === 'radar_wave') {
        return {
          plane: parts[2] || 'xy',
          coordinate: parts[3] || '0',
          variable: null,
        }
      }
      if (
        parts[0] === 'radar_wavefront' ||
        parts[0] === 'radar_wavefront_cloud' ||
        parts[0] === 'radar_heatmap' ||
        parts[0] === 'radar_trails' ||
        parts[0] === 'radar_structure'
      ) {
        return { variable: null }
      }
      if (parts[0] === 'cloud' || parts[0] === 'contour') {
        return {
          plane: parts[2] || 'xy',
          coordinate: parts[3] || '0',
          variable: parts[4] || null,
        }
      }
      if (parts[0] === 'vector') {
        return {
          plane: parts[2] || 'xy',
          coordinate: parts[3] || '0',
          variable: null,
        }
      }
      if (parts[0] === 'volume') {
        return {
          variable: parts.slice(2).join(':') || null,
        }
      }
      return {}
    })()
    const resolvedLabel =
      label ?? existing?.label ?? buildGeneratedLayerLabel(kind, {
        plane: plane ?? parsed.plane,
        coordinate: coordinate ?? parsed.coordinate,
        variable: variable ?? parsed.variable,
      })
    const entry = {
      id: sid,
      kind,
      label: resolvedLabel,
      visible:
        visible !== undefined
          ? Boolean(visible)
          : existing?.visible ?? resolveGeneratedLayerDefaultVisible(kind),
      ready,
      loaded: loaded !== undefined ? loaded : existing?.loaded ?? false,
      images: images ?? existing?.images ?? [],
      physicalTimes: physicalTimes ?? existing?.physicalTimes ?? [],
      physicalWidth: physicalWidth ?? existing?.physicalWidth ?? null,
      physicalHeight: physicalHeight ?? existing?.physicalHeight ?? null,
      vmin: vmin ?? existing?.vmin ?? null,
      vmax: vmax ?? existing?.vmax ?? null,
      original_value_range:
        original_value_range ??
        value_range ??
        existing?.original_value_range ??
        existing?.value_range ??
        null,
      cmap: cmap ?? existing?.cmap ?? 'coolwarm',
      custom_colors:
        custom_colors !== undefined
          ? custom_colors
          : existing?.custom_colors ?? null,
      opacity: opacity ?? existing?.opacity ?? 1,
      blendMode: blendMode ?? existing?.blendMode ?? 'normal',
      currentFrameIndex: existing?.currentFrameIndex ?? 0,
      variable:
        variable ??
        volumeVariable ??
        parsed.variable ??
        existing?.variable ??
        null,
      volumeVariable:
        volumeVariable ??
        variable ??
        existing?.volumeVariable ??
        parsed.variable ??
        null,
      isMock: isMock !== undefined ? Boolean(isMock) : existing?.isMock ?? false, // 保留原有的模拟标记
      isRadarResultPreview:
        isRadarResultPreview !== undefined
          ? Boolean(isRadarResultPreview)
          : existing?.isRadarResultPreview ?? false,
      previewMode: previewMode ?? existing?.previewMode ?? null,
      usePregen: usePregen !== undefined ? usePregen : existing?.usePregen,
      loadSource: loadSource !== undefined ? loadSource : existing?.loadSource,
      smokeManifestUrl:
        smokeManifestUrl !== undefined ? smokeManifestUrl : existing?.smokeManifestUrl,
      smokeScalar: smokeScalar !== undefined ? smokeScalar : existing?.smokeScalar,
      smokePersonLayer:
        smokePersonLayer !== undefined
          ? Boolean(smokePersonLayer)
          : existing?.smokePersonLayer ?? false,
      smokeReleaseZoneName:
        smokeReleaseZoneName !== undefined
          ? smokeReleaseZoneName
          : existing?.smokeReleaseZoneName,
      smokeFrameIndex:
        smokeFrameIndex !== undefined ? smokeFrameIndex : existing?.smokeFrameIndex,
      streamlineSmokeEnabled:
        kind === 'streamline'
          ? Boolean(existing?.streamlineSmokeEnabled)
          : undefined,
      streamlineLineVisible:
        kind === 'streamline'
          ? existing?.streamlineLineVisible !== false
          : undefined,
      seeThrough: existing?.seeThrough ?? (kind === 'volume' ? false : undefined),
    }
    if (idx >= 0) {
      list[idx] = entry
    } else {
      list.push(entry)
    }
  }

  function vizLayerTypeName(kind) {
    return KIND_LABELS[kind] ?? kind ?? ''
  }

  function vizLayerKindForUE(internalKind) {
    if (internalKind === 'cloud') return 'contour'
    if (internalKind === 'radar_cloud') return 'contour'
    if (internalKind === 'radar_wave') return 'contour'
    if (
      internalKind === 'radar_wavefront' ||
      internalKind === 'radar_wavefront_cloud' ||
      internalKind === 'radar_heatmap' ||
      internalKind === 'radar_trails' ||
      internalKind === 'radar_structure'
    ) return 'contour'
    if (
      internalKind === 'contour' ||
      internalKind === 'vector' ||
      internalKind === 'volume' ||
      internalKind === 'smoke' ||
      internalKind === 'streamline' ||
      internalKind === 'particle' ||
      internalKind === 'monitor'
    ) {
      return internalKind
    }
    return 'contour'
  }

  function vizLayerIdForUE(l) {
    const k = l?.kind
    const tid = currentTask.value?.id
    if (k === 'streamline' && tid != null && tid !== '') {
      return String(tid)
    }
    return l?.id
  }

function buildVizLayerPayloadEntry(l) {
  const k = l.kind
  const ueKind = vizLayerKindForUE(k)
  const idUe = vizLayerIdForUE(l)
  return {
    id: idUe,
    local_id: l.id,
    name: l.label ?? l.name ?? '',
    kind: ueKind,
    layer_type: ueKind,
    layer_type_name: vizLayerTypeName(k),
    visible: l.visible,
      label: l.label,
    }
  }

  function sendVizLayerVisibilityToUE(changedLayer) {
    
    if (!playerRef.value) { return }
    // 模拟图层不发送给 UE
    if (changedLayer.isMock) {
      
      return
    }
    const layerName = changedLayer.label ?? changedLayer.name ?? ''
    const ck = changedLayer.kind
    const ueKind = vizLayerKindForUE(ck)
    // 过滤掉模拟图层后发送给 UE
    const layers = generatedVizLayers.value
      .filter((l) => !l.isMock)
      .map((l) => buildVizLayerPayloadEntry(l))
    const idForUe = vizLayerIdForUE(changedLayer)
    const payload = {
      type: 'vizLayerVisibility',
      data: JSON.stringify({
        id: idForUe,
        local_id: changedLayer.id,
        name: layerName,
        visible: changedLayer.visible,
        kind: ueKind,
        layer_type: ueKind,
        layer_type_name: vizLayerTypeName(ck),
        layer_id: idForUe,
        label: changedLayer.label,
        layers,
      }),
    }
    playerRef.value.emitMessage(payload)
    
  }

  function onGeneratedLayerCheckboxChange(layer) {
    sendVizLayerVisibilityToUE(layer)
  }

  /** 从「已生成图层」列表移除一项，并同步当前完整列表给 UE */
  function removeGeneratedLayer(layer) {
    if (!layer?.id) return
    const sid = String(layer.id)
    const idx = generatedVizLayers.value.findIndex((l) => String(l.id) === sid)
    if (idx < 0) return
    const removed = { ...generatedVizLayers.value[idx] }
    // 使用 splice 就地删除，避免替换整个数组引用触发额外的响应式更新
    generatedVizLayers.value.splice(idx, 1)
    // 模拟图层删除时不发送给 UE
    if (removed.isMock) {
      
      return
    }
    if (!playerRef.value) return
    // 过滤掉模拟图层后发送给 UE
    const layers = generatedVizLayers.value
      .filter((l) => !l.isMock)
      .map((l) => buildVizLayerPayloadEntry(l))
    const ueKind = vizLayerKindForUE(removed.kind)
    const idForUe = vizLayerIdForUE(removed)
    playerRef.value.emitMessage({
      type: 'deleteLayer',
      data: JSON.stringify({
        id: idForUe,
        name: removed.label ?? removed.name ?? '',
        kind: ueKind,
        layer_type: ueKind,
        layer_type_name: vizLayerTypeName(removed.kind),
        layer_id: idForUe,
        label: removed.label,
        layers,
      }),
    })
    
  }

  /**
   * 在指定图层中，按物理时间查找最接近的帧
   * @param {string} layerId
   * @param {number} physicalTime
   * @returns {object|null} 帧对象
   */
  function findFrameByPhysicalTime(layerId, physicalTime) {
    const layer = generatedVizLayers.value.find((l) => String(l.id) === String(layerId))
    if (!layer?.physicalTimes?.length || !layer?.images?.length) return null
    const pts = layer.physicalTimes
    const imgs = layer.images
    // 用较短数组的长度做遍历，避免索引越界
    const len = Math.min(pts.length, imgs.length)
    let closestIdx = 0
    let minDiff = Infinity
    for (let i = 0; i < len; i++) {
      const diff = Math.abs(Number(pts[i]) - Number(physicalTime))
      if (diff < minDiff) { minDiff = diff; closestIdx = i }
    }
    return imgs[closestIdx] ?? null
  }

  /**
   * 在指定图层中，按 time_step 查找帧
   * @param {string} layerId
   * @param {number|string} timeStep
   * @returns {object|null} 帧对象
   */
  function findFrameByTimeStep(layerId, timeStep) {
    const layer = generatedVizLayers.value.find((l) => String(l.id) === String(layerId))
    if (!layer?.images?.length) return null
    const n = Number(timeStep)
    const hit = layer.images.find((img) => Number(img.time_step) === n)
    if (hit) return hit
    return layer.images.find((img) => String(img.time_step) === String(timeStep)) ?? null
  }

  /**
   * 获取图层的预览 URL（按给定物理时间）
   */
  function getLayerFrameUrl(layerId, physicalTime) {
    const frame = findFrameByPhysicalTime(layerId, physicalTime)
    if (!frame) return ''
    return frame.png_url || frame.svg_url || frame.url || ''
  }

  return {
    KIND_LABELS,
    generatedVizLayers,
    vizLayersListCollapsed,
    buildGeneratedLayerId,
    buildGeneratedLayerLabel,
    registerGeneratedLayer,
    purgeExcludedGeneratedLayers,
    upsertGeneratedVizLayer,
    vizLayerTypeName,
    vizLayerKindForUE,
    vizLayerIdForUE,
    buildVizLayerPayloadEntry,
    sendVizLayerVisibilityToUE,
    onGeneratedLayerCheckboxChange,
    removeGeneratedLayer,
    findFrameByPhysicalTime,
    findFrameByTimeStep,
    getLayerFrameUrl,
  }
}



