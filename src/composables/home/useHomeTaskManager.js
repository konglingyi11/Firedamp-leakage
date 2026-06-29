import { ref, watch, onMounted } from 'vue'
import taskApi from '@/api/task.js'
import modelApi from '@/api/model.js'
import postProcessingApi from '@/api/postProcessing.js'
import { useTaskStore } from '@/stores/task.js'
import { ElMessage } from 'element-plus'
import { isGoafTask } from '@/utils/taskType'
import {
  createMockGoafTask,
  createMockGoafModelInfo,
} from '@/api/mockGoafTask.js'

// 采空区任务本地模型路径（与 ThreeVisualizationCanvas 保持一致）
const GOAF_GEOMETRY_MODEL_URL = '/采空区/场景.glb'
const GOAF_REAL_MODEL_URL = '/采空区/场景.glb'

function pickFirstUrl(...values) {
  for (const v of values) {
    if (v != null && String(v).trim() !== '') {
      return String(v).trim()
    }
  }
  return ''
}

function isMeetingRoomTask(task) {
  // 已禁用会议室特殊判断
  return false
}

function getTaskModelId(task, selectedModel = null) {
  return (
    task?.model_id ||
    task?.modelId ||
    task?.model?.id ||
    selectedModel?.id ||
    null
  )
}

function getModelInfoGeometryUrl(modelInfo) {
  return (
    modelInfo?.geometry_model_url ||
    modelInfo?.geometry_model_file ||
    modelInfo?.geometryModelUrl ||
    modelInfo?.glb_url ||
    modelInfo?.glbUrl ||
    modelInfo?.glb_file_url ||
    modelInfo?.glbFileUrl ||
    ''
  )
}

function getModelInfoRealUrl(modelInfo) {
  return (
    modelInfo?.real_model_url ||
    modelInfo?.real_model_file ||
    modelInfo?.realModelUrl ||
    ''
  )
}

function isCompletedTask(task) {
  return (
    String(task?.status || '')
      .trim()
      .toLowerCase() === 'completed'
  )
}

function mergeTaskModelInfo(task, modelInfo) {
  const geometryUrl = getModelInfoGeometryUrl(modelInfo)
  const realUrl = getModelInfoRealUrl(modelInfo)
  return {
    ...task,
    modelInfo,
    ...(geometryUrl
      ? {
          geometry_model_url: geometryUrl,
          geometry_model_file: geometryUrl,
          glb_url: geometryUrl,
        }
      : {}),
    ...(realUrl ? { real_model_url: realUrl, real_model_file: realUrl } : {}),
  }
}

function extractTaskListItems(res) {
  if (Array.isArray(res?.items)) return res.items
  if (Array.isArray(res?.data?.items)) return res.data.items
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.data)) return res.data
  return []
}

function getTaskLatestTime(task) {
  const raw =
    task?.created_at ??
    task?.createdAt ??
    task?.updated_at ??
    task?.updatedAt ??
    task?.completed_at ??
    task?.completedAt ??
    task?.started_at ??
    task?.startedAt
  const time = Date.parse(raw)
  return Number.isFinite(time) ? time : 0
}

export function useHomeTaskManager(options = {}) {
  const {
    onTaskChange = null,
    onTaskLoaded = null,
    registerBaseLayers = null,
  } = options

  const taskStore = useTaskStore()
  const currentTask = ref(null)
  const selectedModel = ref(null)
  const metadataLoadingTaskIds = new Set()

  async function ensureTaskMetadataCached(taskId, context = 'metadata') {
    if (!taskId) return
    if (metadataLoadingTaskIds.has(taskId)) return
    metadataLoadingTaskIds.add(taskId)
    try {
      await taskStore.fetchTaskMetadata(taskId)
    } catch (error) {
      console.warn(`[${context}] metadata load failed:`, error)
    } finally {
      metadataLoadingTaskIds.delete(taskId)
    }
  }

  async function getLatestTaskFromList() {
    const res = await taskApi.getTasks({ page: 1, page_size: 10 })
    const tasks = extractTaskListItems(res)
    if (!tasks.length) return null
    return [...tasks].sort((a, b) => getTaskLatestTime(b) - getTaskLatestTime(a))[0]
  }

  async function loadTaskModelInfo(task, { showWarning = false } = {}) {
    const modelId = getTaskModelId(task, selectedModel.value)
    if (!modelId) return task

    try {
      const modelInfo = await modelApi.getModelInfo(modelId)
      return mergeTaskModelInfo(task, modelInfo)
    } catch (error) {
      console.error('获取模型详情失败:', error)
      if (showWarning) {
        ElMessage.warning('获取模型参数失败，请手动填写')
      }
      return task
    }
  }

  async function fetchTaskTimeSteps(taskId) {
    try {
      const res = await postProcessingApi.getTaskTimeSteps(taskId)
      const timeSteps = res.data?.time_steps || res.time_steps || []
      const physicalTimes = res.data?.physical_times || res.physical_times || []
      return { timeSteps, physicalTimes }
    } catch (error) {
      console.warn('Failed to fetch task time steps:', error)
      return { timeSteps: [], physicalTimes: [] }
    }
  }

  function filterValidTimeSteps(timeSteps, physicalTimes = []) {
    const validIndices = timeSteps
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => Number.isFinite(Number(t)) && Number(t) !== 0)
      .map(({ i }) => i)

    const validTimeSteps = validIndices.map((i) => timeSteps[i])
    const validPhysicalTimes =
      physicalTimes.length === timeSteps.length
        ? validIndices.map((i) => physicalTimes[i])
        : []

    return { validTimeSteps, validPhysicalTimes }
  }

  function setCurrentTask(task) {
    currentTask.value = task
    taskStore.setCurrentTask(task)
    onTaskChange?.(task)
    if (task) {
      registerBaseLayers?.(task)
    }
  }

  // 构造合成模拟任务（采空区瓦斯泄漏模拟），供 activateSavedTask 各失败分支回退使用
  function createSyntheticGoafTask() {
    return {
      ...createMockGoafTask({ name: '采空区瓦斯泄漏模拟', isSimulated: true }),
      ...createMockGoafModelInfo(),
      geometry_model_url: '/采空区/场景.glb',
      real_model_url: '/采空区/场景.glb',
      isSimulated: true,
    }
  }

  async function activateSavedTask() {
    try {
      const savedTaskId = localStorage.getItem('activeTaskId')
      const taskToActivate = savedTaskId
        ? { id: savedTaskId }
        : await getLatestTaskFromList()

      if (!taskToActivate?.id) {
        // 没有保存的任务也没有后端任务时，默认选中「采空区瓦斯泄漏模拟」
        const syntheticTask = createSyntheticGoafTask()
        setCurrentTask(syntheticTask)
        onTaskLoaded?.(syntheticTask, { completed: false })
        return
      }

      if (taskToActivate?.id) {
        try {
          const detailRes = await taskApi.getTaskDetail(taskToActivate.id)
          const task = await loadTaskModelInfo(detailRes?.data || detailRes)
          if (task && task.id) {
            setCurrentTask(task)

            const completed = isCompletedTask(task)
            if (completed) {
              await ensureTaskMetadataCached(task.id, 'home-auto-load')
            }

            onTaskLoaded?.(task, { completed })
          } else {
            // 任务详情加载失败（如 mock adapter 返回空对象）：回退到合成模拟任务，
            // 避免仅清除 localStorage 而不设置 currentTask，导致页面空载
            console.warn('Task not found, falling back to synthetic mock task')
            localStorage.removeItem('activeTaskId')
            const syntheticTask = createSyntheticGoafTask()
            setCurrentTask(syntheticTask)
            onTaskLoaded?.(syntheticTask, { completed: false })
          }
        } catch (taskError) {
          console.warn('Failed to load task, falling back to synthetic mock task:', taskError)
          localStorage.removeItem('activeTaskId')
          const syntheticTask = createSyntheticGoafTask()
          setCurrentTask(syntheticTask)
          onTaskLoaded?.(syntheticTask, { completed: false })
        }
      }
    } catch (error) {
      console.warn('Failed to activate saved task:', error)
    }
  }

  function resolveGeometryModelUrl(task) {
    const modelInfo = task?.modelInfo || task?.model_info || {}
    const model = task?.model || {}
    const metadata = task?.metadata || modelInfo.metadata || {}
    return pickFirstUrl(
      isGoafTask(task) ? GOAF_GEOMETRY_MODEL_URL : '',
      task?.geometry_model_url,
      task?.geometry_model_file,
      task?.geometryModelUrl,
      task?.glb_url,
      task?.glbUrl,
      task?.geometry_glb_url,
      task?.geometryGlbUrl,
      task?.model_glb_url,
      task?.modelGlbUrl,
      model?.geometry_model_url,
      model?.geometry_model_file,
      model?.geometryModelUrl,
      model?.glb_url,
      model?.glbUrl,
      modelInfo?.geometry_model_url,
      modelInfo?.geometry_model_file,
      modelInfo?.geometryModelUrl,
      modelInfo?.glb_url,
      modelInfo?.glbUrl,
      modelInfo?.glb_file_url,
      modelInfo?.glbFileUrl,
      metadata?.geometry_model_url,
      metadata?.geometry_model_file,
      metadata?.geometryModelUrl,
      metadata?.glb_url,
      metadata?.glbUrl,
    )
  }

  function resolveRealModelUrl(task) {
    const modelInfo = task?.modelInfo || task?.model_info || {}
    const model = task?.model || {}
    const metadata = task?.metadata || modelInfo.metadata || {}
    return pickFirstUrl(
      isGoafTask(task) ? GOAF_REAL_MODEL_URL : '',
      task?.real_model_url,
      task?.real_model_file,
      task?.realModelUrl,
      task?.params?.real_model_url,
      task?.params?.real_model_file,
      model?.real_model_url,
      model?.real_model_file,
      model?.realModelUrl,
      modelInfo?.real_model_url,
      modelInfo?.real_model_file,
      modelInfo?.realModelUrl,
      metadata?.real_model_url,
      metadata?.real_model_file,
      metadata?.realModelUrl,
    )
  }

  function taskHasGeometryGlbUrl(task) {
    return Boolean(
      isMeetingRoomTask(task) || resolveGeometryModelUrl(task)
    )
  }

  function taskHasLocalRealModelUrl(task) {
    return isGoafTask(task) || isMeetingRoomTask(task)
  }

  function getTaskStatusType(status) {
    switch (status) {
      case 'completed':
        return 'success'
      case 'in_progress':
      case 'initializing':
        return 'primary'
      case 'failed':
        return 'danger'
      case 'stopped':
        return 'warning'
      case 'created':
        return 'info'
      case 'not_started':
        return 'info'
      case 'pending':
        return 'info'
      default:
        return 'info'
    }
  }

  function getTaskStatusText(status) {
    switch (status) {
      case 'completed':
        return '已完成'
      case 'in_progress':
        return '运行中'
      case 'initializing':
        return '初始化中'
      case 'failed':
        return '失败'
      case 'stopped':
        return '已停止'
      case 'pending':
        return '等待中'
      case 'created':
        return '已创建'
      case 'not_started':
        return '未开始'
      default:
        return status
    }
  }

  watch(currentTask, (task) => {
    if (task) {
      localStorage.setItem('activeTaskId', task.id)
    }
  })

  return {
    currentTask,
    selectedModel,
    isMeetingRoomTask,
    isCompletedTask,
    getTaskModelId,
    getModelInfoGeometryUrl,
    getModelInfoRealUrl,
    resolveGeometryModelUrl,
    resolveRealModelUrl,
    taskHasGeometryGlbUrl,
    taskHasLocalRealModelUrl,
    mergeTaskModelInfo,
    loadTaskModelInfo,
    ensureTaskMetadataCached,
    getLatestTaskFromList,
    fetchTaskTimeSteps,
    filterValidTimeSteps,
    setCurrentTask,
    activateSavedTask,
    getTaskStatusType,
    getTaskStatusText,
    extractTaskListItems,
    getTaskLatestTime,
  }
}
