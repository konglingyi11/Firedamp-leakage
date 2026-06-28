import { ref, computed, watch, nextTick } from 'vue'

export function useGeneratedLayerPaging(options = {}) {
  const {
    readyGeneratedVizLayers,
    generatedLayerPage,
    generatedVizLayers,
    visualization,
    monitoringPoints,
    getVariableDisplayName,
    applyMonitoringLayerVisibility,
    syncMonitoringPointsToStore,
    syncMonitoringPointLayers,
    syncPointsToThree,
    syncMonitoringPointsToPanel,
    sendVizLayerVisibilityToUE,
    syncSelectedGeneratedLayerAfterBatch,
    isGeneratedLayerSelectable,
    isMonitoringGeneratedLayer,
    KIND_LABELS,
  } = options

  const generatedLayerPages = computed(() => {
    const allLayers = readyGeneratedVizLayers.value || []
    const groups = [
      {
        key: 'monitor',
        label: '监测点',
        count: allLayers.filter((layer) => layer.kind === 'monitor').length,
      },
      {
        key: 'cloud',
        label: '云图',
        count: allLayers.filter((layer) => layer.kind === 'contour').length,
      },
      {
        key: 'radar_cloud',
        label: '雷达云图',
        count: allLayers.filter((layer) => layer.kind === 'radar_cloud').length,
      },
      {
        key: 'radar_wavefront',
        label: '波前传播',
        count: allLayers.filter((layer) =>
          ['radar_wavefront', 'radar_wavefront_cloud'].includes(layer.kind),
        ).length,
      },
      {
        key: 'radar_heatmap',
        label: '场强热力',
        count: allLayers.filter((layer) => layer.kind === 'radar_heatmap').length,
      },
      {
        key: 'radar_trails',
        label: '能量轨迹',
        count: allLayers.filter((layer) => layer.kind === 'radar_trails').length,
      },
      {
        key: 'radar_structure',
        label: '介质结构',
        count: allLayers.filter((layer) => layer.kind === 'radar_structure').length,
      },
      {
        key: 'vector',
        label: '矢量图',
        count: allLayers.filter((layer) => layer.kind === 'vector').length,
      },
      {
        key: 'volume',
        label: '体渲染',
        count: allLayers.filter((layer) => layer.kind === 'volume').length,
      },
      {
        key: 'smoke',
        label: '烟雾层',
        count: allLayers.filter((layer) => layer.kind === 'smoke').length,
      },
      {
        key: 'streamline',
        label: '流线图',
        count: allLayers.filter((layer) => layer.kind === 'streamline').length,
      },
      {
        key: 'video',
        label: '骨骼识别',
        count: allLayers.filter((layer) => layer.kind === 'video').length,
      },
      // 粒子图层暂不在列表展示（仍注册 / 仍可用于三维渲染）
      {
        key: 'model',
        label: '几何模型',
        count: allLayers.filter(
          (layer) =>
            layer.kind === 'model' ||
            layer.kind === 'realModel' ||
            layer.kind === 'bounds',
        ).length,
      },
    ]
    return groups.filter((group) => group.count > 0)
  })

  const cloudVariableFilter = ref([])
  const cloudPlaneFilter = ref([])
  const vectorPlaneFilter = ref([])

  /** 云图气体筛选：'__all__' 表示全部（分页展示），空或具体值表示单气体视图 */
  const cloudGasFilter = ref('__all__')
  /** 全部模式下的分页索引（跳过"全部"选项，从第一个气体开始） */
  const cloudGasPage = ref(0)

  function parseGeneratedLayerMeta(layer) {
    const id = String(layer?.id ?? '')
    const parts = id.split(':')
    if (parts[0] === 'radar_cloud') {
      return {
        plane: (parts[2] || '').toLowerCase(),
        coordinate: parts[3] || '',
        variable: parts.slice(4).join(':') || '',
      }
    }
    if (
      parts[0] === 'radar_wavefront' ||
      parts[0] === 'radar_wavefront_cloud' ||
      parts[0] === 'radar_heatmap'
    ) {
      return {
        plane: (parts[2] || '').toLowerCase(),
        coordinate: parts[3] || '',
        variable: parts.slice(4).join(':') || '',
      }
    }
    if (parts[0] === 'cloud' || parts[0] === 'contour') {
      return {
        plane: (parts[2] || '').toLowerCase(),
        coordinate: parts[3] || '',
        variable: parts.slice(4).join(':') || '',
      }
    }
    if (parts[0] === 'vector') {
      return {
        plane: (parts[2] || '').toLowerCase(),
        coordinate: parts[3] || '',
        variable: '',
      }
    }
    return {
      plane: '',
      coordinate: '',
      variable: '',
    }
  }

  const cloudVariableFilterOptions = computed(() => {
    const seen = new Set()
    const options = []
    for (const layer of readyGeneratedVizLayers.value) {
      if (layer.kind !== 'contour') continue
      const variable = parseGeneratedLayerMeta(layer).variable
      if (!variable || seen.has(variable)) continue
      seen.add(variable)
      options.push({
        value: variable,
        label: getVariableDisplayName(variable),
      })
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  })

  /** 云图气体下拉选项（含"全部"） */
  const cloudGasFilterOptions = computed(() => {
    const seen = new Set()
    const list = [{ value: '__all__', label: '全部' }]
    for (const layer of readyGeneratedVizLayers.value) {
      if (layer.kind !== 'contour') continue
      const v = parseGeneratedLayerMeta(layer).variable
      if (!v || seen.has(v)) continue
      seen.add(v)
      list.push({ value: v, label: getVariableDisplayName(v) })
    }
    return list
  })

  /** 当前选中气体的图层数量 */
  const cloudCurrentPageCount = computed(() => {
    if (cloudGasFilter.value === '__all__') {
      return readyGeneratedVizLayers.value.filter((l) => l.kind === 'contour').length
    }
    return (readyGeneratedVizLayers.value || []).filter((layer) => {
      if (layer.kind !== 'contour') return false
      const meta = parseGeneratedLayerMeta(layer)
      return meta.variable === cloudGasFilter.value
    }).length
  })

  const cloudPlaneFilterOptions = computed(() => {
    const seen = new Set()
    const options = []
    for (const layer of readyGeneratedVizLayers.value) {
      if (layer.kind !== 'contour') continue
      const plane = parseGeneratedLayerMeta(layer).plane
      if (!plane || seen.has(plane)) continue
      seen.add(plane)
      options.push({
        value: plane,
        label: plane.toUpperCase(),
      })
    }
    return options.sort((a, b) => a.label.localeCompare(b.label))
  })

  const vectorPlaneFilterOptions = computed(() => {
    const seen = new Set()
    const options = []
    for (const layer of readyGeneratedVizLayers.value) {
      if (layer.kind !== 'vector') continue
      const plane = parseGeneratedLayerMeta(layer).plane
      if (!plane || seen.has(plane)) continue
      seen.add(plane)
      options.push({
        value: plane,
        label: plane.toUpperCase(),
      })
    }
    return options.sort((a, b) => a.label.localeCompare(b.label))
  })

  function matchesGeneratedLayerFilter(selectedValues, currentValue) {
    if (!Array.isArray(selectedValues) || selectedValues.length === 0) return true
    return selectedValues.includes(currentValue)
  }

  const pagedGeneratedVizLayers = computed(() => {
    const allLayers = readyGeneratedVizLayers.value
    if (generatedLayerPage.value === 'cloud') {
      // 自动修正分页越界
      const totalGasPages = cloudGasFilterOptions.value.length - 1
      if (totalGasPages > 0 && cloudGasPage.value >= totalGasPages) {
        cloudGasPage.value = 0
      }
      // 全部模式下，取当前页对应的气体变量
      const gasVars = cloudGasFilterOptions.value.filter((o) => o.value !== '__all__')
      const currentGasVar = cloudGasFilter.value === '__all__'
        ? (gasVars[cloudGasPage.value]?.value ?? null)
        : cloudGasFilter.value

      return allLayers.filter((layer) => {
        if (layer.kind !== 'contour') return false
        const meta = parseGeneratedLayerMeta(layer)
        if (
          !matchesGeneratedLayerFilter(cloudVariableFilter.value, meta.variable)
        ) {
          return false
        }
        if (!matchesGeneratedLayerFilter(cloudPlaneFilter.value, meta.plane)) {
          return false
        }
        if (currentGasVar && meta.variable !== currentGasVar) {
          return false
        }
        return true
      })
    }
    if (generatedLayerPage.value === 'radar_cloud') {
      return allLayers.filter((layer) => layer.kind === 'radar_cloud')
    }
    if (generatedLayerPage.value === 'radar_wavefront') {
      return allLayers.filter((layer) =>
        ['radar_wavefront', 'radar_wavefront_cloud'].includes(layer.kind),
      )
    }
    if (generatedLayerPage.value === 'radar_heatmap') {
      return allLayers.filter((layer) => layer.kind === 'radar_heatmap')
    }
    if (generatedLayerPage.value === 'radar_trails') {
      return allLayers.filter((layer) => layer.kind === 'radar_trails')
    }
    if (generatedLayerPage.value === 'radar_structure') {
      return allLayers.filter((layer) => layer.kind === 'radar_structure')
    }
    if (generatedLayerPage.value === 'vector') {
      return allLayers.filter((layer) => {
        if (layer.kind !== 'vector') return false
        const meta = parseGeneratedLayerMeta(layer)
        if (!matchesGeneratedLayerFilter(vectorPlaneFilter.value, meta.plane)) {
          return false
        }
        return true
      })
    }
    if (generatedLayerPage.value === 'volume') {
      return allLayers.filter((layer) => layer.kind === 'volume')
    }
    if (generatedLayerPage.value === 'smoke') {
      return allLayers.filter((layer) => layer.kind === 'smoke')
    }
    if (generatedLayerPage.value === 'streamline') {
      return allLayers.filter((layer) => layer.kind === 'streamline')
    }
    if (generatedLayerPage.value === 'particle') {
      return allLayers.filter((layer) => layer.kind === 'particle')
    }
    if (generatedLayerPage.value === 'monitor') {
      return allLayers.filter((layer) => layer.kind === 'monitor')
    }
    if (generatedLayerPage.value === 'video') {
      return allLayers.filter((layer) => layer.kind === 'video')
    }
    if (generatedLayerPage.value === 'model') {
      return allLayers.filter(
        (layer) =>
          layer.kind === 'model' ||
          layer.kind === 'realModel' ||
          layer.kind === 'bounds',
      )
    }
    return allLayers
  })

  const pagedGeneratedVizLayerGroups = computed(() => {
    const groups = []
    const groupMap = new Map()
    for (const layer of pagedGeneratedVizLayers.value || []) {
      const key = String(layer?.kind || 'unknown')
      if (!groupMap.has(key)) {
        const group = {
          key,
          label: KIND_LABELS[key] || key,
          layers: [],
        }
        groupMap.set(key, group)
        groups.push(group)
      }
      groupMap.get(key).layers.push(layer)
    }
    return groups
  })

  function setGeneratedLayerGroupVisibility(layers, visible) {
    const targetLayers = Array.isArray(layers) ? layers.filter(Boolean) : []
    if (!targetLayers.length) return

    if (targetLayers.every((layer) => isMonitoringGeneratedLayer(layer))) {
      let nextPoints = monitoringPoints.value
      for (const layer of targetLayers) {
        nextPoints = applyMonitoringLayerVisibility(nextPoints, layer, visible)
      }
      monitoringPoints.value = nextPoints
      syncMonitoringPointsToStore()
      syncMonitoringPointLayers()
      syncPointsToThree()
      nextTick(syncMonitoringPointsToPanel)
      return
    }

    let changed = false
    for (const layer of targetLayers) {
      if (layer.visible !== visible) {
        layer.visible = visible
        changed = true
      }
    }

    if (!changed) {
      syncSelectedGeneratedLayerAfterBatch(
        visible ? targetLayers.find((layer) => isGeneratedLayerSelectable(layer)) : null,
      )
      return
    }

    sendVizLayerVisibilityToUE(targetLayers[0])
    syncSelectedGeneratedLayerAfterBatch(
      visible ? targetLayers.find((layer) => isGeneratedLayerSelectable(layer)) : null,
    )
  }

  const hasVolumeLayerInCurrentPage = computed(() =>
    (pagedGeneratedVizLayers.value || []).some(
      (layer) => layer.kind === 'volume',
    ),
  )

  const showVolumeRaymarchControls = computed(
    () =>
      generatedLayerPage.value === 'volume' && hasVolumeLayerInCurrentPage.value,
  )

  const volumeRaymarchSteps = computed({
    get: () => {
      const raw = Number(visualization.value.volume_raymarch_steps)
      if (!Number.isFinite(raw)) return 160
      return Math.max(8, Math.min(256, Math.round(raw)))
    },
    set: (value) => {
      const n = Number(value)
      visualization.value.volume_raymarch_steps = Number.isFinite(n)
        ? Math.max(8, Math.min(256, Math.round(n)))
        : 160
    },
  })

  const volumeRaymarchOpacity = computed({
    get: () => {
      const raw = Number(visualization.value.volume_raymarch_opacity)
      if (!Number.isFinite(raw)) return 0.1
      return Math.max(0.1, Math.min(3, raw))
    },
    set: (value) => {
      const n = Number(value)
      visualization.value.volume_raymarch_opacity = Number.isFinite(n)
        ? Math.max(0.1, Math.min(3, n))
        : 0.1
    },
  })

  watch(
    generatedLayerPages,
    (pages) => {
      if (!pages.length) return
      if (!pages.some((page) => page.key === generatedLayerPage.value)) {
        generatedLayerPage.value = pages[0].key
      }
    },
    { immediate: true },
  )

  watch(
    cloudVariableFilterOptions,
    (options) => {
      const validValues = new Set(options.map((option) => option.value))
      cloudVariableFilter.value = cloudVariableFilter.value.filter((value) =>
        validValues.has(value),
      )
    },
    { immediate: true },
  )

  watch(
    cloudPlaneFilterOptions,
    (options) => {
      const validValues = new Set(options.map((option) => option.value))
      cloudPlaneFilter.value = cloudPlaneFilter.value.filter((value) =>
        validValues.has(value),
      )
    },
    { immediate: true },
  )

  watch(
    vectorPlaneFilterOptions,
    (options) => {
      const validValues = new Set(options.map((option) => option.value))
      vectorPlaneFilter.value = vectorPlaneFilter.value.filter((value) =>
        validValues.has(value),
      )
    },
    { immediate: true },
  )

  return {
    generatedLayerPages,
    cloudVariableFilter,
    cloudPlaneFilter,
    vectorPlaneFilter,
    cloudGasFilter,
    cloudGasPage,
    parseGeneratedLayerMeta,
    cloudVariableFilterOptions,
    cloudGasFilterOptions,
    cloudCurrentPageCount,
    cloudPlaneFilterOptions,
    vectorPlaneFilterOptions,
    matchesGeneratedLayerFilter,
    pagedGeneratedVizLayers,
    pagedGeneratedVizLayerGroups,
    setGeneratedLayerGroupVisibility,
    hasVolumeLayerInCurrentPage,
    showVolumeRaymarchControls,
    volumeRaymarchSteps,
    volumeRaymarchOpacity,
  }
}
