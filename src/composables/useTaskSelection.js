import taskApi from '@/api/task.js'
import postProcessingApi from '@/api/postProcessing.js'
import { clearTaskTimelineState } from '@/utils/taskTimelineState.js'

export function useTaskSelection(options) {
  const {
    currentTask, taskListRef, visualization, visualizationDimension,
    visualization2DType, visualization3DType, isBatchLoading, batchLoadingText,
    batchLoadProgress, batchLoadCurrent, batchLoadTotal, batchLoadedImages,
    hasAppliedSettings, isTimelineCollapsed, previewImageUrl, previewFrameCount,
    previewVMin, previewVMax, previewPhysicalWidth, previewPhysicalHeight,
    previewRows, previewCols, timelineCurrentStep, timelineTimeSteps,
    timelinePhysicalTimes, timelineTotalSteps, postProcessingTimeStepsTaskId,
    selectedPlane, planeCoordinate, generatedVizLayers, latest2DVMin, latest2DVMax,
    playerRef, ueMsg, activeModule, leftPanelCollapsed, rightPanelCollapsed,
    vizLayersListCollapsed, visualizationSettingsKey, returningFromVisualization,
    selectedModel
  } = options.refs

  const {
    syncContourLayerMeta, fallbackToRuntimeConfig, clearAllPolling, stopUpdatePoll,
    handleTimelineStop, resolveAnimationSpeedMultiplier, emitResetLevelToUE,
    showWarning, tryAutoLoadOnHomeEnter, clearTimelineToUEDebounce,
    loadTaskModelInfo
  } = options.methods

  const { taskStore } = options.store

  const clearCurrentTimelineState = () => {
    clearTaskTimelineState({
      clearTimelineToUEDebounce,
      timelineTimeSteps,
      timelinePhysicalTimes,
      timelineTotalSteps,
      postProcessingTimeStepsTaskId,
      handleTimelineStop,
      hasAppliedSettings,
      isTimelineCollapsed,
    })
  }

const loadVisualizationPreset = (preset) => {
  switch (preset) {
    case 'standard':
      visualization.value = {
        colorScheme: 'default',
        transparency: 100,
        resolution: 'medium',
        volume_resolution: 64,
        useMockVolumeData: false,
        model_dissolve: {
          enabled: true,
          duration: 1.5,
          edge_width: 0.045,
          particle_strength: 1.2,
          color: '#72ff66',
        },
        testVolumeCsvUrl: '',
        density_scale: 100,
        step_count: 128,
        volume_raymarch_steps: 160,
        volume_raymarch_opacity: 0.1,
        animationSpeed: 50,
        layers: ['temperature', 'humidity'],
        radar_frequencies: [],
        startTimeStep: null,
        endTimeStep: null,
        vmin: null,
        vmax: null,
        usePregen: true,
        // 矢量图参数（即使当前 preset 是矢量，也保持字段齐全）
        vectorColor: '#ffffff',
        quality_preset: '1k',
        transparent_background: true,
        glyph_density: 4,
        gasColors: {},
        gasCmaps: {},
        volume_variables: [],
        cloud_variables: [],
        volume_csv: {
          enable_frame_memory_cache: false,
          frame_memory_cache_max_frames: 1,
          enable_prefetch: false,
          prefetch_ahead_frames: 0,
          prefetch_max_concurrent_requests: 1,
          warmup_prefetch_frames_at_init: 0,
          prefetch_all_frames_at_init: false,
        },
        streamline: {
          time_step: 0,
          seed_count: 50,
          points_per_streamline: 40,
          line_width: 0.38,
          display_time: 5,
          color: '#ffffff',
        },
      }
      visualizationDimension.value = '2d'
      visualization2DType.value = 'vector'
      break
    case 'thermal':
      visualization.value = {
        colorScheme: 'thermal',
        transparency: 80,
        resolution: 'high',
        volume_resolution: 64,
        useMockVolumeData: false,
        model_dissolve: {
          enabled: true,
          duration: 1.5,
          edge_width: 0.045,
          particle_strength: 1.2,
          color: '#72ff66',
        },
        testVolumeCsvUrl: '',
        density_scale: 100,
        step_count: 128,
        volume_raymarch_steps: 160,
        volume_raymarch_opacity: 0.1,
        animationSpeed: 30,
        layers: ['temperature'],
        radar_frequencies: [],
        startTimeStep: null,
        endTimeStep: null,
        vmin: null,
        vmax: null,
        usePregen: true,
        vectorColor: '#ffffff',
        quality_preset: '1k',
        transparent_background: true,
        glyph_density: 4,
        gasColors: {},
        gasCmaps: {},
        volume_variables: [],
        cloud_variables: [],
        volume_csv: {
          enable_frame_memory_cache: false,
          frame_memory_cache_max_frames: 1,
          enable_prefetch: false,
          prefetch_ahead_frames: 0,
          prefetch_max_concurrent_requests: 1,
          warmup_prefetch_frames_at_init: 0,
          prefetch_all_frames_at_init: false,
        },
        streamline: {
          time_step: 0,
          seed_count: 50,
          points_per_streamline: 40,
          line_width: 0.38,
          display_time: 5,
          color: '#ffffff',
        },
      }
      visualizationDimension.value = '2d'
      visualization2DType.value = 'cloud'
      break
    case 'wind':
      visualization.value = {
        colorScheme: 'speed',
        transparency: 60,
        resolution: 'medium',
        volume_resolution: 64,
        useMockVolumeData: false,
        model_dissolve: {
          enabled: true,
          duration: 1.5,
          edge_width: 0.045,
          particle_strength: 1.2,
          color: '#72ff66',
        },
        testVolumeCsvUrl: '',
        density_scale: 100,
        step_count: 128,
        volume_raymarch_steps: 160,
        volume_raymarch_opacity: 0.1,
        animationSpeed: 70,
        layers: ['windFlow'],
        radar_frequencies: [],
        startTimeStep: null,
        endTimeStep: null,
        vmin: null,
        vmax: null,
        usePregen: true,
        vectorColor: '#ffffff',
        quality_preset: '1k',
        transparent_background: true,
        glyph_density: 4,
        gasColors: {},
        gasCmaps: {},
        volume_variables: [],
        cloud_variables: [],
        volume_csv: {
          enable_frame_memory_cache: false,
          frame_memory_cache_max_frames: 1,
          enable_prefetch: false,
          prefetch_ahead_frames: 0,
          prefetch_max_concurrent_requests: 1,
          warmup_prefetch_frames_at_init: 0,
          prefetch_all_frames_at_init: false,
        },
        streamline: {
          time_step: 0,
          seed_count: 50,
          points_per_streamline: 40,
          line_width: 0.38,
          display_time: 5,
          color: '#ffffff',
        },
      }
      visualizationDimension.value = '3d'
      visualization3DType.value = 'streamline'
      break
    case 'comprehensive':
      visualization.value = {
        colorScheme: 'multicolor',
        transparency: 50,
        resolution: 'high',
        volume_resolution: 96,
        useMockVolumeData: false,
        model_dissolve: {
          enabled: true,
          duration: 1.5,
          edge_width: 0.045,
          particle_strength: 1.2,
          color: '#72ff66',
        },
        testVolumeCsvUrl: '',
        density_scale: 100,
        step_count: 128,
        volume_raymarch_steps: 160,
        volume_raymarch_opacity: 0.1,
        animationSpeed: 40,
        layers: ['temperature', 'humidity', 'pressure', 'windFlow'],
        radar_frequencies: [],
        startTimeStep: null,
        endTimeStep: null,
        vmin: null,
        vmax: null,
        usePregen: true,
        vectorColor: '#ffffff',
        quality_preset: '1k',
        transparent_background: true,
        glyph_density: 4,
        gasColors: {},
        gasCmaps: {},
        volume_variables: [],
        cloud_variables: [],
        volume_csv: {
          enable_frame_memory_cache: false,
          frame_memory_cache_max_frames: 1,
          enable_prefetch: false,
          prefetch_ahead_frames: 0,
          prefetch_max_concurrent_requests: 1,
          warmup_prefetch_frames_at_init: 0,
          prefetch_all_frames_at_init: false,
        },
        streamline: {
          time_step: 0,
          seed_count: 50,
          points_per_streamline: 40,
          line_width: 0.38,
          display_time: 5,
          color: '#ffffff',
        },
      }
      visualizationDimension.value = '3d'
      visualization3DType.value = 'volume'
      break
    case 'manifest_bin_test':
      visualization.value = {
        colorScheme: 'default',
        transparency: 100,
        resolution: 'medium',
        volume_resolution: 64,
        useMockVolumeData: false,
        model_dissolve: {
          enabled: true,
          duration: 1.5,
          edge_width: 0.045,
          particle_strength: 1.2,
          color: '#72ff66',
        },
        testManifestUrl: '/test-data/manifest.json',
        density_scale: 100,
        step_count: 128,
        volume_raymarch_steps: 160,
        volume_raymarch_opacity: 0.1,
        animationSpeed: 50,
        layers: ['temperature'],
        startTimeStep: null,
        endTimeStep: null,
        vmin: null,
        vmax: null,
        usePregen: false,
        gasColors: {},
        gasCmaps: {},
        volume_variables: [],
        cloud_variables: [],
        radar_frequencies: [],
        volume_csv: {
          enable_frame_memory_cache: false,
          frame_memory_cache_max_frames: 1,
          enable_prefetch: false,
          prefetch_ahead_frames: 0,
          prefetch_max_concurrent_requests: 1,
          warmup_prefetch_frames_at_init: 0,
          prefetch_all_frames_at_init: false,
        },
        streamline: {
          time_step: 0,
          seed_count: 50,
          points_per_streamline: 40,
          line_width: 0.38,
          display_time: 5,
          color: '#ffffff',
        },
      }
  }
}

const resetVisualizationSettings = () => {
  const keptVmin = visualization.value?.vmin
  const keptVmax = visualization.value?.vmax
  visualization.value = {
    colorScheme: 'default',
    variable: '',
    transparency: 100,
    resolution: 'medium',
    volume_resolution: 64,
    volume_res_mode: 'resolution',
    volume_render_mode: 'raymarch',
    useMockVolumeData: false,
    model_dissolve: {
      enabled: true,
      duration: 1.5,
      edge_width: 0.045,
      particle_strength: 1.2,
      color: '#72ff66',
    },
    testVolumeCsvUrl: '',
    sampling_ratio: 1,
    density_scale: 100,
    step_count: 128,
    volume_raymarch_steps: 160,
    volume_raymarch_opacity: 0.1,
    animationSpeed: 100,
    layers: ['temperature', 'humidity'],
    customColormap: '',
    manualColors: ['#3b4cc0', '#dddddd', '#b40426'],
    startTimeStep: null,
    endTimeStep: null,
    vmin: keptVmin,
    vmax: keptVmax,
    usePregen: true,
    pregen_config: {
      enabled: true,
      plane_spacing: 0.01,
      point_spacing: 0.02,
      contour: {
        cmap: 'coolwarm',
        custom_colors: [],
      },
      vector: {
        color: 'black',
        quality_preset: '1k',
        transparent_background: true,
        glyph_density: 4,
        line_width: 1,
      },
      streamline: {
        seed_count: 80,
        points_per_streamline: 10,
      },
      volume: {
        resolution: 64,
      },
      volume_texture: {
        resolution: 64,
        sampling_ratio: 1,
      },
    },
    vectorColor: '#ffffff',
    quality_preset: '1k',
    transparent_background: true,
    glyph_density: 4,
    gasColors: {},
    gasCmaps: {},
    volume_variables: [],
    cloud_variables: [],
    radar_frequencies: [],
    volume_csv: {
      enable_frame_memory_cache: false,
      frame_memory_cache_max_frames: 1,
      enable_prefetch: false,
      prefetch_ahead_frames: 0,
      prefetch_max_concurrent_requests: 1,
      warmup_prefetch_frames_at_init: 0,
      prefetch_all_frames_at_init: false,
    },
    streamline: {
      time_step: 0,
      seed_count: 50,
      points_per_streamline: 40,
      line_width: 0.38,
      display_time: 5,
      color: '#ffffff',
    },
  }
  visualizationDimension.value = '2d'
  visualization2DType.value = 'cloud'
  visualization3DType.value = 'volume'
  selectedPlane.value = 'xy'
  planeCoordinate.value = 0

  // 已生成图层列表
  generatedVizLayers.value = []
  vizLayersListCollapsed.value = false
  visualizationSettingsKey.value += 1

  // 预览与批量缓存
  previewImageUrl.value = ''
  previewVMin.value = 0
  previewVMax.value = 0
  latest2DVMin.value = null
  latest2DVMax.value = null
  previewRows.value = 1
  previewCols.value = 1
  previewFrameCount.value = 0
  previewPhysicalWidth.value = null
  previewPhysicalHeight.value = null
  batchLoadedImages.value = []
  isBatchLoading.value = false
  batchLoadProgress.value = 0
  batchLoadCurrent.value = 0
  batchLoadTotal.value = 0

  // 时间轴数据与防抖
  clearCurrentTimelineState()

  if (playerRef.value) {
    const defaultConfig = {
      ...visualization.value,
      animationSpeed: resolveAnimationSpeedMultiplier(
        visualization.value.animationSpeed,
      ),
      plane: selectedPlane.value,
      coordinate: planeCoordinate.value,
    }
    ueMsg.resetSettings(defaultConfig)
    
    // 通知 UE 清空图层显隐列表（与前端「已生成图层」一致）
    ueMsg.vizLayerVisibility({
        id: '',
        name: '',
        visible: false,
        kind: 'contour',
        layer_type: 'contour',
        layer_type_name: '',
        layer_id: '',
        label: '',
        layers: [],
        reset: true,
      })
    
  }
}

const handleTaskSelect = async (task) => {
  
  
  
  
  
  

  const prevId = currentTask.value?.id
  let selectedTask = task
  try {
    const detailRes = await taskApi.getTaskDetail(task.id)
    const detailTask = detailRes?.data || detailRes
    if (detailTask && detailTask.id) {
      selectedTask = detailTask
      
    }
  } catch (error) {
    console.warn('Failed to load task detail, fallback to list item:', error)
  }

  if (typeof loadTaskModelInfo === 'function') {
    selectedTask = await loadTaskModelInfo(selectedTask)
  }
  currentTask.value = selectedTask

  // 保存任务 ID 到 localStorage
  localStorage.setItem('activeTaskId', selectedTask.id)

  if (selectedTask.status !== 'completed') {
    clearCurrentTimelineState()
  }

  if (selectedTask.status === 'completed') {
    // 点击任务进入可视化时，通知 UE 加载对应任务/模型建筑
    const emitLoadbuildingToUE = (taskInfo) => {
      if (!playerRef.value || !taskInfo?.id) return
      const modelid =
        taskInfo.model_id ??
        taskInfo.modelId ??
        taskInfo?.model?.id ??
        selectedModel.value?.id ??
        ''
      const dataStr = JSON.stringify({
        task_id: taskInfo.id,
        modelid,
      })
      playerRef.value.emitMessage({
        type: 'Loadbuilding',
        data: dataStr,
      })
      
      
    }

    // 先让 UE 清空/刷新状态，再加载本任务模型
    const nextId = selectedTask?.id
    if (prevId != null && nextId != null && prevId !== nextId) {
      
      emitResetLevelToUE()
    }
    emitLoadbuildingToUE(selectedTask)

    // 只有完成的任务才获取元数据（用于可视化）
    try {
      const metadata = await taskStore.selectTask(selectedTask)
      
    } catch (error) {
      console.error('❌ 获取任务元数据失败:', error)
      showWarning?.('获取任务元数据失败，部分功能可能受限')
    }

    // 已完成任务统一回到首页
    activeModule.value = 'home'
    returningFromVisualization.value = false

    // 获取任务的真实时间步信息
    let hasApiTimeSteps = false
    try {
      const res = await postProcessingApi.getTaskTimeSteps(selectedTask.id)
      const timeSteps = res.data?.time_steps || res.time_steps || []
      const physicalTimes = res.data?.physical_times || res.physical_times || []

      if (timeSteps.length > 0) {
        const validTimeSteps = timeSteps
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => Number.isFinite(Number(t)) && Number(t) !== 0)
          .map(({ i }) => timeSteps[i])

        if (validTimeSteps.length > 0) {
          const hasPhysical =
            Array.isArray(physicalTimes) &&
            physicalTimes.length === timeSteps.length
          const validPhysicalTimes = hasPhysical
            ? timeSteps
                .map((t, i) => ({ t, physicalTime: physicalTimes[i] }))
                .filter(
                  ({ t }) => Number.isFinite(Number(t)) && Number(t) !== 0,
                )
                .map(({ physicalTime }) => physicalTime)
            : []

          timelineTotalSteps.value = validTimeSteps.length - 1
          previewFrameCount.value = validTimeSteps.length
          timelinePhysicalTimes.value =
            validPhysicalTimes.length > 0 ? validPhysicalTimes : validTimeSteps
          timelineTimeSteps.value = validTimeSteps
          postProcessingTimeStepsTaskId.value = selectedTask.id
          hasApiTimeSteps = true

          
        } else {
          timelineTotalSteps.value = 0
          previewFrameCount.value = 0
          timelinePhysicalTimes.value = []
          timelineTimeSteps.value = []
          postProcessingTimeStepsTaskId.value = null
          console.warn(
            `Task ${selectedTask.id} time_steps are invalid (not finite numbers)`,
          )
        }
      } else {
        // 兜底：如果没有获取到时间步，尝试使用 runtime_config（内部会更新 postProcessingTimeStepsTaskId）
        fallbackToRuntimeConfig(selectedTask)
      }
    } catch (error) {
      console.warn(
        'Failed to fetch task time steps, falling back to config:',
        error,
      )
      fallbackToRuntimeConfig(selectedTask)
    }

    timelineCurrentStep.value = 0

    // 完成任务切回首页后，只有时间步接口成功时才尝试自动加载预生成内容
    if (activeModule.value === 'home' && hasApiTimeSteps) {
      tryAutoLoadOnHomeEnter?.()
    }
  } else if (
    selectedTask.status === 'in_progress' ||
    selectedTask.status === 'initializing'
  ) {
    // 运行中或初始化中的任务：跳转到任务列表查看详情
    
    activeModule.value = 'tasks'
    // TaskList 组件会自动显示当前选中的任务
  } else {
    // 其他状态（未开始、失败、已停止等）：跳转到参数设置页查看/修改参数
    
    activeModule.value = 'parameters'
  }
}

  return {
    loadVisualizationPreset,
    resetVisualizationSettings,
    handleTaskSelect
  }
}
