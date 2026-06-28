import { ref, computed, onBeforeUnmount, nextTick } from 'vue'

const DEFAULT_STAGES = [
  '正在接入雷达回波...',
  '正在提取微动特征...',
  '正在匹配识别目标...',
  '正在生成识别结果...',
  '识别完成：目标1',
]

const DEFAULT_PERCENTS = [18, 42, 68, 88, 100]

export function useMicroMotionLoading(options = {}) {
  const {
    stages = DEFAULT_STAGES,
    percents = DEFAULT_PERCENTS,
    stageDuration = 2800,
    finishDelay = 700,
    maxDuration = 13000,
    onFinish = null,
    getResultsRef = () => null,
  } = options

  const microMotionLoading = ref(false)
  const showMicroMotionPanel = ref(false)
  const microMotionLoadingStageIndex = ref(0)
  const microMotionLoadingStages = stages
  const microMotionLoadingPercents = percents

  let loadingTimer = null
  let loadingInterval = null
  let startTime = 0

  const microMotionLoadingProgress = computed(() => {
    if (!microMotionLoading.value) {
      return 100
    }
    return microMotionLoadingPercents[microMotionLoadingStageIndex.value] ?? 0
  })

  const microMotionLoadingStageText = computed(() => {
    if (!microMotionLoading.value) {
      return ''
    }
    return microMotionLoadingStages[microMotionLoadingStageIndex.value] ?? microMotionLoadingStages[0]
  })

  function startMicroMotionLoading() {
    stopMicroMotionLoading()

    microMotionLoading.value = true
    microMotionLoadingStageIndex.value = 0
    startTime = Date.now()

    loadingInterval = setInterval(() => {
      if (microMotionLoadingStageIndex.value >= stages.length - 1) {
        if (loadingInterval) {
          clearInterval(loadingInterval)
          loadingInterval = null
        }
        return
      }
      microMotionLoadingStageIndex.value += 1
      if (microMotionLoadingStageIndex.value >= stages.length - 1) {
        if (loadingInterval) {
          clearInterval(loadingInterval)
          loadingInterval = null
        }
        if (loadingTimer) {
          clearTimeout(loadingTimer)
          loadingTimer = null
        }
        loadingTimer = setTimeout(finishMicroMotionLoading, finishDelay)
      }
    }, stageDuration)

    loadingTimer = setTimeout(finishMicroMotionLoading, maxDuration)
  }

  function finishMicroMotionLoading() {
    stopMicroMotionLoading()
    nextTick(() => {
      const resultsRef = getResultsRef?.()
      resultsRef?.selectFirstTarget?.()
    })
    onFinish?.()
  }

  function stopMicroMotionLoading() {
    if (loadingTimer) {
      clearTimeout(loadingTimer)
      loadingTimer = null
    }
    if (loadingInterval) {
      clearInterval(loadingInterval)
      loadingInterval = null
    }
    microMotionLoading.value = false
    microMotionLoadingStageIndex.value = 0
  }

  function toggleMicroMotionPanel() {
    showMicroMotionPanel.value = !showMicroMotionPanel.value
  }

  function closeMicroMotionPanel() {
    showMicroMotionPanel.value = false
  }

  function openMicroMotionPanel() {
    showMicroMotionPanel.value = true
  }

  function cleanup() {
    stopMicroMotionLoading()
  }

  onBeforeUnmount(() => {
    cleanup()
  })

  return {
    microMotionLoading,
    showMicroMotionPanel,
    microMotionLoadingStageIndex,
    microMotionLoadingStages,
    microMotionLoadingPercents,
    microMotionLoadingProgress,
    microMotionLoadingStageText,
    startMicroMotionLoading,
    stopMicroMotionLoading,
    finishMicroMotionLoading,
    toggleMicroMotionPanel,
    openMicroMotionPanel,
    closeMicroMotionPanel,
    cleanup,
  }
}
