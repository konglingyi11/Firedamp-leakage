import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import taskApi from '@/api/task.js'
import { normalizeWorkersList } from '@/utils/worker'

/**
 * Worker 选择对话框逻辑
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.activeModule
 * @param {import('vue').Ref} deps.runtimeConfig
 */
export function useWorkerDialog({ activeModule, runtimeConfig }) {
  const workerDialogVisible = ref(false)
  const workers = ref([])
  const selectedWorkerId = ref('')
  const loadingWorkers = ref(false)
  const pendingTaskId = ref(null)

  const fetchWorkers = async () => {
    loadingWorkers.value = true
    try {
      const res = await taskApi.getWorkers()
      workers.value = normalizeWorkersList(res)

      if (workers.value.length > 0 && !selectedWorkerId.value) {
        const idleWorker = workers.value.find((w) => w.status === 'idle')
        selectedWorkerId.value = idleWorker ? idleWorker.id : workers.value[0].id
      }
    } catch (error) {
      console.error('Failed to fetch workers:', error)
      ElMessage.error({ message: '获取计算节点列表失败', duration: 1500 })
    } finally {
      loadingWorkers.value = false
    }
  }

  const handleResetWorker = async () => {
    if (!selectedWorkerId.value) return
    try {
      await ElMessageBox.confirm(
        '确定要复位该计算节点吗？复位将停止该节点上的所有仿真任务、清理环境，并恢复为空闲状态。',
        '复位确认',
        {
          confirmButtonText: '确定复位',
          cancelButtonText: '取消',
          type: 'warning',
          customClass: 'worker-dialog',
        },
      )
      await taskApi.resetWorker(selectedWorkerId.value)
      fetchWorkers()
    } catch (error) {
      if (error !== 'cancel') {
        console.error('Failed to reset worker:', error)
        ElMessage.error({
          message: '节点复位失败: ' + (error.message || '未知错误'),
          duration: 1500,
        })
      }
    }
  }

  const handleStartAnalysis = (taskId) => {
    
    pendingTaskId.value = taskId
    workerDialogVisible.value = true
    fetchWorkers()
  }

  const runTask = async (taskId, workerId, onTaskStarted) => {
    try {
      const requestData = {
        worker_id: workerId,
        runtime_config: runtimeConfig.value,
      }
      
      await taskApi.runTask(taskId, requestData)
      activeModule.value = 'tasks'
      if (typeof onTaskStarted === 'function') onTaskStarted()
    } catch (error) {
      console.error('Failed to run task:', error)
      ElMessage.error({
        message: '启动任务失败: ' + (error.message || '未知错误'),
        duration: 1500,
      })
    }
  }

  const confirmRunTask = async (data) => {
    const workerId = data?.workerId
    if (!workerId) {
      ElMessage.warning('请选择一个计算节点')
      return
    }
    // taskId 优先从参数传入，其次从 pendingTaskId（兼容 HomeView 自带的 WorkerSelectDialog）
    const taskId = data?.taskId ?? pendingTaskId.value
    if (!taskId) {
      ElMessage.warning({ message: '没有可运行的任务', duration: 1500 })
      return
    }
    workerDialogVisible.value = false
    if (data?.runtimeConfig) {
      Object.assign(runtimeConfig.value, data.runtimeConfig)
    }
    await runTask(taskId, workerId, data?.onTaskStarted)
  }

  return {
    workerDialogVisible,
    workers,
    selectedWorkerId,
    loadingWorkers,
    pendingTaskId,
    fetchWorkers,
    handleResetWorker,
    handleStartAnalysis,
    confirmRunTask,
    runTask,
  }
}
