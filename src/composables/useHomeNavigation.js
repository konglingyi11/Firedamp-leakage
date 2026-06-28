import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'

export const NAV_MODULES = {
  HOME: 'home',
  MODEL: 'model',
  TASKS: 'tasks',
  PARAMETERS: 'parameters',
  VISUALIZATION: 'visualization',
  STATISTICS: 'statistics',
  ANALYSIS: 'analysis',
  RADAR_MEDIUM: 'radarMedium',
  RADAR_EM: 'radarEm',
}

const TASK_DEPENDENT_MODULES = [
  NAV_MODULES.VISUALIZATION,
  NAV_MODULES.STATISTICS,
  NAV_MODULES.ANALYSIS,
]

export function useHomeNavigation(options = {}) {
  const {
    showRadarDataModule = false,
    getCurrentTask = () => null,
    onEnterModule = null,
    onLeaveModule = null,
    onTimelineStop = null,
    onEnterVisualization = null,
    onEnterStatistics = null,
    onEnterRadarMedium = null,
  } = options

  const activeModule = ref(NAV_MODULES.HOME)
  const returningFromVisualization = ref(false)

  const isRadarEmModule = computed(() => activeModule.value === NAV_MODULES.RADAR_EM)

  const showPanels = computed(() => {
    return (
      activeModule.value !== NAV_MODULES.HOME &&
      activeModule.value !== NAV_MODULES.MODEL &&
      activeModule.value !== NAV_MODULES.RADAR_EM
    )
  })

  const showModelGrid = computed(() => {
    return activeModule.value === NAV_MODULES.MODEL
  })

  function hasCurrentTask() {
    const task = getCurrentTask?.()
    return !!task
  }

  function handleNavClick(module) {
    if (module === NAV_MODULES.RADAR_MEDIUM && !showRadarDataModule) return

    if (TASK_DEPENDENT_MODULES.includes(module)) {
      if (!hasCurrentTask()) {
        activeModule.value = NAV_MODULES.TASKS
        ElMessage.warning('请先选择任务')
        return
      }
    }

    if (module === NAV_MODULES.TASKS && activeModule.value === NAV_MODULES.VISUALIZATION) {
      returningFromVisualization.value = true
    } else {
      returningFromVisualization.value = false
    }

    const prevModule = activeModule.value

    if (prevModule === NAV_MODULES.VISUALIZATION && module !== NAV_MODULES.VISUALIZATION) {
      onTimelineStop?.()
    }
    if (prevModule === NAV_MODULES.RADAR_EM && module !== NAV_MODULES.RADAR_EM) {
      onTimelineStop?.()
    }

    onLeaveModule?.(prevModule, module)

    activeModule.value = module

    if (module === NAV_MODULES.STATISTICS) {
      onEnterStatistics?.()
    }

    if (module === NAV_MODULES.RADAR_MEDIUM) {
      onEnterRadarMedium?.()
    }

    if (module === NAV_MODULES.VISUALIZATION) {
      onEnterVisualization?.()
    }

    onEnterModule?.(module, prevModule)
  }

  watch(activeModule, (m) => {
    if (!showRadarDataModule && m === NAV_MODULES.RADAR_MEDIUM) {
      activeModule.value = NAV_MODULES.HOME
    }
  })

  return {
    activeModule,
    returningFromVisualization,
    isRadarEmModule,
    showPanels,
    showModelGrid,
    handleNavClick,
    NAV_MODULES,
  }
}
