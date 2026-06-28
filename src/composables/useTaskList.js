import { ref, watch, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import taskApi from '@/api/task'

export function useTaskList() {
  const tasks = ref([])
  const loading = ref(false)
  const total = ref(0)
  const currentPage = ref(1)
  const pageSize = ref(10)

  const pollingTimers = {}

  const fetchTasks = async () => {
    loading.value = true
    try {
      const res = await taskApi.getTasks({
        page: currentPage.value,
        page_size: pageSize.value,
      })
      tasks.value = res.items || []
      total.value = res.total || 0
      managePolling()
    } catch (e) {
      console.error('Failed to fetch tasks', e)
    } finally {
      loading.value = false
    }
  }

  const managePolling = () => {
    Object.keys(pollingTimers).forEach((id) => {
      const stillExists = tasks.value.find((t) => String(t.id) === id)
      if (!stillExists) {
        clearInterval(pollingTimers[id])
        delete pollingTimers[id]
      }
    })

    tasks.value.forEach((task) => {
      const id = String(task.id)
      const needsPolling = [
        'pending',
        'running',
        'pregen_running',
        'in_progress',
        'initializing',
      ].includes(task.status)
      if (needsPolling && !pollingTimers[id]) {
        pollingTimers[id] = setInterval(() => updateTaskStatus(id), 3000)
      } else if (!needsPolling && pollingTimers[id]) {
        clearInterval(pollingTimers[id])
        delete pollingTimers[id]
      }
    })
  }

  const updateTaskStatus = async (id) => {
    try {
      const res = await taskApi.getTaskProgress(id)
      const progressData = res?.data || res
      if (progressData) {
        const idx = tasks.value.findIndex((t) => String(t.id) === id)
        if (idx >= 0) {
          tasks.value[idx] = {
            ...tasks.value[idx],
            status: progressData.status,
            progress: progressData.progress_percentage !== undefined ? progressData.progress_percentage : progressData.progress,
            current_step: progressData.current_step,
            total_steps: progressData.total_steps,
            elapsed_time: progressData.elapsed_time,
            estimated_remaining_time: progressData.estimated_remaining_time,
            message: progressData.message,
          }
          const stillRunning = [
            'pending',
            'running',
            'pregen_running',
            'in_progress',
            'initializing',
          ].includes(progressData.status)
          if (!stillRunning && pollingTimers[id]) {
            clearInterval(pollingTimers[id])
            delete pollingTimers[id]
            fetchTasks() // Refresh full list once done
          }
        }
      }
    } catch (e) {
      console.error('Status update failed', e)
    }
  }

  const handleDeleteTask = async (id) => {
    try {
      await ElMessageBox.confirm('确定要删除该任务吗？', '警告', {
        type: 'warning',
      })
      await taskApi.deleteTask(id)
      ElMessage.success('任务已删除')
      // 检查是否删除的是当前活跃任务，如果是则清除localStorage中的activeTaskId
      const activeTaskId = localStorage.getItem('activeTaskId')
      if (String(activeTaskId) === String(id)) {
        localStorage.removeItem('activeTaskId')
      }
      await fetchTasks()
      return id
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        throw error
      }
      return null
    }
  }

  onUnmounted(() => {
    Object.values(pollingTimers).forEach(clearInterval)
  })

  watch([currentPage, pageSize], () => fetchTasks())

  return {
    tasks,
    loading,
    total,
    currentPage,
    pageSize,
    fetchTasks,
    handleDeleteTask,
  }
}
