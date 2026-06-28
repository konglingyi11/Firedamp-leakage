import { ref, computed } from 'vue'

export const PANEL_SIDES = {
  LEFT: 'left',
  RIGHT: 'right',
}

export function useHomePanels(options = {}) {
  const {
    getActiveModule = () => 'home',
    getVisualizationDimension = () => '2d',
    getVisualization2DType = () => 'cloud',
    getVisualization3DType = () => 'volume',
    getVisualizationOptionsDomain = () => 'gas',
    getShowMicroMotionPanel = () => false,
    getMicroMotionLoading = () => false,
    getShowPanels = () => true,
  } = options

  const leftPanelCollapsed = ref(false)
  const rightPanelCollapsed = ref(false)

  const leftComponent = computed(() => {
    const module = getActiveModule()
    switch (module) {
      case 'tasks':
        return 'TaskList'
      case 'parameters':
        return 'ParameterSettings'
      case 'visualization': {
        const domain = getVisualizationOptionsDomain()
        if (domain === 'radar') {
          return 'VisualizationSettings'
        }
        const dim = getVisualizationDimension()
        const type2d = getVisualization2DType()
        const type3d = getVisualization3DType()
        if (dim === '2d' && type2d === 'cloud') {
          return 'VisualizationSettings'
        } else if (dim === '3d' && type3d !== 'streamline') {
          return 'VisualizationSettings'
        }
        return null
      }
      case 'statistics':
        return 'DataStatistics'
      case 'radarMedium':
        return 'RadarMediumLeftPanel'
      case 'analysis':
        return 'AnalysisResults'
      default:
        return null
    }
  })

  const rightComponent = computed(() => {
    const module = getActiveModule()
    if (module === 'visualization') {
      return 'VisualizationOptions'
    }
    if (module === 'radarMedium') {
      return 'RadarMediumRightPanel'
    }
    if (module === 'statistics') {
      return getShowMicroMotionPanel() || getMicroMotionLoading()
        ? 'MicroMotionResults'
        : null
    }
    return null
  })

  const leftTitle = computed(() => {
    const module = getActiveModule()
    switch (module) {
      case 'tasks':
        return '任务列表'
      case 'parameters':
        return '参数设置'
      case 'visualization':
        return '可视化设置'
      case 'statistics':
        return '监测点数据'
      case 'radarMedium':
        return '环境与波形'
      case 'analysis':
        return '数据分析'
      default:
        return ''
    }
  })

  const rightTitle = computed(() => {
    const module = getActiveModule()
    if (module === 'visualization') {
      return '可视化选项'
    }
    if (module === 'radarMedium') {
      return '介质与调制'
    }
    if (module === 'statistics') {
      return '微动识别'
    }
    return ''
  })

  const hasLeftPanel = computed(() => !!leftComponent.value)
  const hasRightPanel = computed(() => !!rightComponent.value)

  const isVisualizationOptionsOpen = computed(() => {
    const module = getActiveModule()
    return (
      module === 'visualization' &&
      getShowPanels() &&
      rightComponent.value === 'VisualizationOptions' &&
      !rightPanelCollapsed.value
    )
  })

  function toggleLeftPanel() {
    leftPanelCollapsed.value = !leftPanelCollapsed.value
  }

  function toggleRightPanel() {
    rightPanelCollapsed.value = !rightPanelCollapsed.value
  }

  function collapseLeftPanel() {
    leftPanelCollapsed.value = true
  }

  function expandLeftPanel() {
    leftPanelCollapsed.value = false
  }

  function collapseRightPanel() {
    rightPanelCollapsed.value = true
  }

  function expandRightPanel() {
    rightPanelCollapsed.value = false
  }

  return {
    leftPanelCollapsed,
    rightPanelCollapsed,
    leftComponent,
    rightComponent,
    leftTitle,
    rightTitle,
    hasLeftPanel,
    hasRightPanel,
    isVisualizationOptionsOpen,
    toggleLeftPanel,
    toggleRightPanel,
    collapseLeftPanel,
    expandLeftPanel,
    collapseRightPanel,
    expandRightPanel,
  }
}
