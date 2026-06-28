import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import taskApi from '@/api/task.js'

export const useTaskStore = defineStore('task', () => {
  // ── 任务状态 ──
  const currentTask = ref(null)
  const selectedModel = ref(null)

  // ── 任务元数据 ──
  const taskMetadata = ref(null)
  const isLoadingMetadata = ref(false)
  const metadataError = ref(null)

  // ── 计算属性 ──

  /** 所有变量名列表 */
  const variableNames = computed(() => {
    const vars = taskMetadata.value?.variables || taskMetadata.value?.data?.variables
    if (!vars) return []
    return Object.keys(vars)
  })

  /** 气体变量列表 */
  const gasVariables = computed(() => {
    return variableNames.value.filter((name) =>
      name.toLowerCase().startsWith('mass_fraction_of_'),
    )
  })

  /** 物理变量列表 */
  const physicalVariables = computed(() => {
    return variableNames.value.filter(
      (name) => !name.toLowerCase().startsWith('mass_fraction_of_'),
    )
  })

  /** 变量范围映射 */
  const variableRanges = computed(() => {
    const vars = taskMetadata.value?.variables || taskMetadata.value?.data?.variables || {}
    return vars
  })

  // ── 方法 ──

  const isCompletedStatus = (status) =>
    String(status || '').trim().toLowerCase() === 'completed'

  const resolveTaskForMetadata = async (taskId, knownTask = null) => {
    if (knownTask?.id === taskId) return knownTask
    if (currentTask.value?.id === taskId) return currentTask.value

    const res = await taskApi.getTaskDetail(taskId)
    return res?.data || res
  }

  /**
   * 设置当前任务
   * @param {Object} task - 任务对象
   */
  const setCurrentTask = (task) => {
    const previousTaskId = currentTask.value?.id
    currentTask.value = task
    if (previousTaskId !== task?.id) {
      taskMetadata.value = null
      metadataError.value = null
    }
    try {
      if (task?.id) {
        localStorage.setItem('activeTaskId', String(task.id))
      } else {
        localStorage.removeItem('activeTaskId')
      }
    } catch (_) {
      // Ignore localStorage sync failures.
    }
  }

  /**
   * 获取任务元数据
   * @param {string} taskId - 任务 ID
   * @param {boolean} forceRefresh - 是否强制刷新（忽略缓存）
   * @param {Object|null} knownTask - 已知任务对象，用于判断完成状态
   * @returns {Promise<Object>} - 元数据对象
   */
  const fetchTaskMetadata = async (taskId, forceRefresh = false, knownTask = null) => {
    // 如果已有缓存且不强制刷新，直接返回
    if (
      taskMetadata.value &&
      !forceRefresh &&
      currentTask.value?.id === taskId
    ) {
      return taskMetadata.value
    }

    isLoadingMetadata.value = true
    metadataError.value = null

    try {
      const taskForMetadata = await resolveTaskForMetadata(taskId, knownTask)
      if (!isCompletedStatus(taskForMetadata?.status)) {
        return null
      }

      const res = await taskApi.getTaskMetadata(taskId)
      const metadata = res.data || res

      taskMetadata.value = metadata

      return metadata
    } catch (error) {
      console.error('❌ 获取任务元数据失败:', error)
      metadataError.value = error.message || '获取元数据失败'
      throw error
    } finally {
      isLoadingMetadata.value = false
    }
  }

  /**
   * 获取指定变量的范围
   * @param {string} variableName - 变量名
   * @returns {Object|null} - { vmin, vmax } 或 null
   */
  const getVariableRange = (variableName) => {
    const vars = taskMetadata.value?.variables || taskMetadata.value?.data?.variables
    if (!vars) return null
    if (vars[variableName]) return vars[variableName]
    const target = String(variableName ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-:()（）]/g, '')
    if (!target) return null
    for (const [key, value] of Object.entries(vars)) {
      const normalizedKey = String(key ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_\-:()（）]/g, '')
      if (normalizedKey === target) return value
    }
    return null
  }

  /**
   * 检查变量是否存在
   * @param {string} variableName - 变量名
   * @returns {boolean}
   */
  const hasVariable = (variableName) => {
    return variableNames.value.includes(variableName)
  }

  /**
   * 清除任务数据
   */
  const clearTask = () => {
    currentTask.value = null
    selectedModel.value = null
    taskMetadata.value = null
    metadataError.value = null
  }

  /**
   * 选择任务并获取元数据
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} - 元数据对象
   */
  const selectTask = async (task) => {
    setCurrentTask(task)

    if (task && task.id) {
      try {
        const metadata = await fetchTaskMetadata(task.id, false, task)
        return metadata
      } catch (error) {
        console.error('选择任务失败:', error)
        throw error
      }
    }
  }

  // ── 导航方法 ──

  /** 获取任务状态对应的标签类型 */
  const getTaskStatusType = (status) => {
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
      case 'not_started':
      case 'pending':
        return 'info'
      default:
        return 'info'
    }
  }

  /** 获取任务状态的中文文本 */
  const getTaskStatusText = (status) => {
    switch (status) {
      case 'completed': return '已完成'
      case 'in_progress': return '运行中'
      case 'initializing': return '初始化中'
      case 'failed': return '失败'
      case 'stopped': return '已停止'
      case 'pending': return '等待中'
      case 'created': return '已创建'
      case 'not_started': return '未开始'
      default: return status
    }
  }

  return {
    // ── 任务状态 ──
    currentTask,
    selectedModel,
    taskMetadata,
    isLoadingMetadata,
    metadataError,

    // ── 计算属性 ──
    variableNames,
    gasVariables,
    physicalVariables,
    variableRanges,

    // ── 方法 ──
    setCurrentTask,
    fetchTaskMetadata,
    getVariableRange,
    hasVariable,
    clearTask,
    selectTask,
    getTaskStatusType,
    getTaskStatusText,
  }
})
