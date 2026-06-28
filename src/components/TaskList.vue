<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  Setting,
  View,
  Edit,
  VideoPlay,
  RefreshRight,
  Delete,
  InfoFilled,
  Clock,
  PieChart,
  Timer,
  Memo,
  Loading,
  Refresh,
  List,
  CircleCheck,
  SwitchButton,
  WarningFilled,
  CircleClose,
  SuccessFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTaskList } from '@/composables/useTaskList'
import { formatDuration, getParamsDisplay } from '@/utils/taskFormat'
import { normalizeWorkersList } from '@/utils/worker'
import { colorsToLinearGradient } from '@/utils/volumeColormap'
import {
  isPregenProgressTerminal,
  normalizePregenProgressResponse,
} from '@/utils/pregenProgress'
import taskApi from '@/api/task'
import { gasNameMap } from '@/constants/gasVariables'
import WorkerSelectDialog from './WorkerSelectDialog.vue'

const emit = defineEmits(['navigate', 'refresh', 'select-task', 'task-deleted'])

const {
  tasks,
  loading,
  total,
  currentPage,
  pageSize,
  fetchTasks,
  handleDeleteTask,
} = useTaskList()

// ── 状态格式化 ──

const getStatusType = (status) => {
  const map = {
    completed: 'success',
    in_progress: 'primary',
    initializing: 'primary',
    failed: 'danger',
    stopped: 'warning',
    created: 'info',
    not_started: 'info',
    pending: 'info',
  }
  return map[status] || 'info'
}

const getStatusLabel = (status) => {
  const map = {
    completed: '已完成',
    in_progress: '运行中',
    initializing: '初始化中',
    failed: '失败',
    stopped: '已停止',
    pending: '等待中',
    created: '已创建',
    not_started: '未开始',
  }
  return map[status] || status
}

const getStatusIcon = (status) => {
  const map = {
    completed: SuccessFilled,
    failed: CircleClose,
    stopped: WarningFilled,
    not_started: Clock,
    created: Clock,
    pending: Clock,
  }
  return map[status] || InfoFilled
}

const formatProgress = (p) => `${Number(p).toFixed(1)}%`

const getPregenContourBandStyle = (item) => {
  if (Array.isArray(item?.custom_colors) && item.custom_colors.length > 0) {
    return { background: colorsToLinearGradient(item.custom_colors) }
  }
  return {}
}

const getPregenContourBandTitle = (item) =>
  Array.isArray(item?.custom_colors) ? item.custom_colors.join(' → ') : ''

// ── 刷新 & 任务点击 ──

const refreshTasks = () => fetchTasks()

const handleTaskClick = (task) => {
  emit('select-task', task)
}

// ── 删除任务 ──

const handleDelete = async (task) => {
  const deletedTaskId = await handleDeleteTask(task.id)
  if (deletedTaskId != null) {
    emit('task-deleted', deletedTaskId)
  }
}

// ── 任务详情弹窗 ──

const detailDialogVisible = ref(false)
const taskDetail = ref(null)
const loadingDetail = ref(false)
let detailPollingTimer = null

const detailRuntimeConfig = computed(
  () =>
    taskDetail.value?.runtime_config ||
    taskDetail.value?.params?.runtime_config ||
    null,
)

const detailPregenConfig = computed(
  () =>
    taskDetail.value?.pregen_config ||
    taskDetail.value?.params?.pregen_config ||
    null,
)

const hasRuntimeProgress = computed(
  () =>
    taskDetail.value?.progress !== undefined &&
    taskDetail.value?.progress !== null,
)

const isRuntimeProgressComplete = computed(() => {
  if (!taskDetail.value) return false
  return (
    taskDetail.value.status === 'completed' ||
    Number(taskDetail.value.progress ?? 0) >= 100
  )
})

const hasPregenProgress = computed(
  () =>
    (taskDetail.value?.pregen_progress !== undefined &&
      taskDetail.value?.pregen_progress !== null) ||
    (taskDetail.value?.pregen_status !== undefined &&
      taskDetail.value?.pregen_status !== null),
)

const shouldShowPregenProgress = computed(
  () => isRuntimeProgressComplete.value && hasPregenProgress.value,
)

const handleShowDetail = async (task) => {
  detailDialogVisible.value = true
  loadingDetail.value = true
  try {
    const res = await taskApi.getTaskDetail(task.id)
    const taskData = res?.data || res
    taskDetail.value = {
      ...taskData,
      progress: taskData.progress !== undefined ? taskData.progress : 0,
    }
    startDetailPolling(task.id)
  } catch (e) {
    console.error('获取任务详情失败', e)
  } finally {
    loadingDetail.value = false
  }
}

const startDetailPolling = (taskId) => {
  stopDetailPolling()
  if (!taskDetail.value) return
  // 初始检查：如果任务状态为completed且预生成状态也为completed，则不开始轮询
  const initialPregenStatus = taskDetail.value.pregen_status
  const initialTaskStatus = taskDetail.value.status
  if (
    initialTaskStatus === 'completed' &&
    initialPregenStatus === 'completed'
  ) {
    return
  }
  // 开始轮询
  detailPollingTimer = setInterval(async () => {
    try {
      // 先获取任务进度
      const progressRes = await taskApi.getTaskProgress(taskId)

      // 更新任务进度
      const progressData = progressRes?.data || progressRes
      if (progressData) {
        Object.assign(taskDetail.value, {
          progress:
            progressData.progress_percentage !== undefined
              ? progressData.progress_percentage
              : progressData.progress || taskDetail.value.progress,
          current_step:
            progressData.current_step || taskDetail.value.current_step,
          total_steps: progressData.total_steps || taskDetail.value.total_steps,
          elapsed_time:
            progressData.elapsed_time || taskDetail.value.elapsed_time,
          estimated_remaining_time:
            progressData.estimated_remaining_time ||
            taskDetail.value.estimated_remaining_time,
          message: progressData.message || taskDetail.value.message,
          status: progressData.status || taskDetail.value.status,
        })
      }

      // 只有当任务进度完成时，才请求预生成进度
      const taskProgress = taskDetail.value?.progress || 0
      const taskStatus = taskDetail.value?.status
      const isTaskCompleted = taskStatus === 'completed' || taskProgress >= 100

      if (isTaskCompleted) {
        const pregenRes = await taskApi.getTaskPregenProgress(taskId)
        const pregenData = normalizePregenProgressResponse(pregenRes)
        if (pregenData.raw) {
          Object.assign(taskDetail.value, {
            pregen_progress: pregenData.progress,
            pregen_status: pregenData.status,
            pregen_status_text: pregenData.statusText,
            pregen_completed_count: pregenData.completedCount,
            pregen_total_count: pregenData.totalCount,
            pregen_current_phase: pregenData.currentPhase,
            pregen_major_phase_name: pregenData.majorPhaseName,
            pregen_major_phase_current: pregenData.majorPhaseCurrent,
            pregen_major_phase_total: pregenData.majorPhaseTotal,
            pregen_minor_phase_name: pregenData.minorPhaseName,
            pregen_minor_phase_current: pregenData.minorPhaseCurrent,
            pregen_minor_phase_total: pregenData.minorPhaseTotal,
            pregen_failure_count: pregenData.failureCount,
            pregen_failure_summary: pregenData.failureSummary,
            pregen_error_message: pregenData.errorMessage,
          })
        }
      }

      // 检查是否需要继续轮询
      // 只要满足以下条件之一，就继续轮询：
      // 1. 任务状态仍在运行中
      // 2. 预生成状态仍在运行中
      const stillTaskRunning = [
        'in_progress',
        'initializing',
        'pending',
        'pregen_running',
      ].includes(taskDetail.value?.status)
      const stillPregenRunning =
        taskDetail.value?.pregen_status &&
        !isPregenProgressTerminal({
          status: taskDetail.value.pregen_status,
        })
      const still = stillTaskRunning || stillPregenRunning
      if (!still) stopDetailPolling()
    } catch (error) {
      console.error('获取任务进度失败:', error)
    }
  }, 3000)
}

const stopDetailPolling = () => {
  if (detailPollingTimer) {
    clearInterval(detailPollingTimer)
    detailPollingTimer = null
  }
}

// ── 启动任务（WorkerSelectDialog） ──

const startDialogVisible = ref(false)
const startingTask = ref(null)
const startWorkers = ref([])
const startSelectedWorkerId = ref('')
const startLoadingWorkers = ref(false)

const handleRunTask = (task) => {
  startingTask.value = task
  startDialogVisible.value = true
  fetchStartWorkers()
}

const fetchStartWorkers = async () => {
  startLoadingWorkers.value = true
  try {
    const res = await taskApi.getWorkers()
    startWorkers.value = normalizeWorkersList(res)
    if (startWorkers.value.length > 0 && !startSelectedWorkerId.value) {
      startSelectedWorkerId.value = startWorkers.value[0].id
    }
  } catch (e) {
    console.error('获取 Worker 列表失败', e)
  } finally {
    startLoadingWorkers.value = false
  }
}

const confirmRunTask = async (payload) => {
  
  if (!startingTask.value) {
    console.error('No startingTask')
    return
  }

  // 先保存任务引用，避免弹窗关闭后丢失
  const taskToStart = startingTask.value

  try {
    const workerId = payload?.workerId || startSelectedWorkerId.value
    const runtimeConfig = payload?.runtimeConfig
    const requestData = { worker_id: workerId }
    if (runtimeConfig) {
      requestData.runtime_config = runtimeConfig
    }
    
    await taskApi.runTask(taskToStart.id, requestData)

    // API 调用成功后再关闭弹窗
    startDialogVisible.value = false
    ElMessage.success('任务已启动')

    // 启动任务后自动打开详情弹窗以便查看进度
    await fetchTasks()
    await handleShowDetail(taskToStart)
  } catch (e) {
    console.error('启动任务失败:', e)
    ElMessage.error('启动任务失败: ' + (e.message || ''))
  }
}

// ── 停止任务 ──

const handleStopTask = async (task) => {
  try {
    await ElMessageBox.confirm('确定要停止该任务吗？', '提示', {
      type: 'warning',
    })
    await taskApi.stopTask(task.id)
    ElMessage.success('任务已停止')
    fetchTasks()
  } catch {
    /* cancelled */
  }
}

// ── 重新启动任务（WorkerSelectDialog） ──

const restartDialogVisible = ref(false)
const restartingTask = ref(null)
const restartWorkers = ref([])
const restartSelectedWorkerId = ref('')
const restartLoadingWorkers = ref(false)

const handleRestartTask = (task) => {
  restartingTask.value = task
  restartDialogVisible.value = true
  fetchRestartWorkers()
}

const fetchRestartWorkers = async () => {
  restartLoadingWorkers.value = true
  try {
    const res = await taskApi.getWorkers()
    restartWorkers.value = normalizeWorkersList(res)
    if (restartWorkers.value.length > 0 && !restartSelectedWorkerId.value) {
      restartSelectedWorkerId.value = restartWorkers.value[0].id
    }
  } catch (e) {
    console.error('获取 Worker 列表失败', e)
  } finally {
    restartLoadingWorkers.value = false
  }
}

const confirmRestartTask = async (payload) => {
  if (!restartingTask.value) return

  // 先保存任务引用，避免弹窗关闭后丢失
  const taskToRestart = restartingTask.value

  try {
    const workerId = payload?.workerId || restartSelectedWorkerId.value
    const runtimeConfig = payload?.runtimeConfig
    const requestData = { worker_id: workerId }
    if (runtimeConfig) {
      requestData.runtime_config = runtimeConfig
    }
    await taskApi.runTask(taskToRestart.id, requestData)

    // API 调用成功后再关闭弹窗
    restartDialogVisible.value = false
    ElMessage.success('任务已重新启动')

    // 重启任务后自动打开详情弹窗以便查看进度
    await fetchTasks()
    await handleShowDetail(taskToRestart)
  } catch (e) {
    ElMessage.error('重新启动失败: ' + (e.message || ''))
  }
}

// ── 编辑任务名称 ──

const editDialogVisible = ref(false)
const editFormRef = ref(null)
const editForm = ref({ id: '', name: '' })
const editRules = {
  name: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
}

const openEditDialog = (task) => {
  editForm.value = { id: task.id, name: task.name || '' }
  editDialogVisible.value = true
}

const handleUpdateTask = async () => {
  if (!editFormRef.value) return
  try {
    await editFormRef.value.validate()
    await taskApi.updateTask(editForm.value.id, { name: editForm.value.name })
    ElMessage.success('任务名称已更新')
    editDialogVisible.value = false
    // 同时刷新详情（如果打开着的话）
    if (taskDetail.value && taskDetail.value.id === editForm.value.id) {
      taskDetail.value.name = editForm.value.name
    }
    fetchTasks()
  } catch (e) {
    if (e !== 'cancel') console.error('更新失败', e)
  }
}

// ── 触发预生成 ──

const triggerPregenLoading = ref(false)

const handleTriggerPregen = async () => {
  if (!taskDetail.value?.id) return
  triggerPregenLoading.value = true
  try {
    await taskApi.triggerTaskPregen(taskDetail.value.id)
    ElMessage.success('预生成已触发')
    // 刷新详情以获取新进度
    const res = await taskApi.getTaskDetail(taskDetail.value.id)
    taskDetail.value = res?.data || res
    startDetailPolling(taskDetail.value.id)
  } catch (e) {
    ElMessage.error('触发预生成失败: ' + (e.message || ''))
  } finally {
    triggerPregenLoading.value = false
  }
}

// ── 生命周期 ──

onMounted(() => fetchTasks())
onUnmounted(() => stopDetailPolling())
</script>

<template>
  <div class="task-list-container">
    <div class="panel-header-custom">
      <div class="header-left">
        <el-icon><List /></el-icon>
        <span>任务列表</span>
      </div>
      <el-button type="primary" link :icon="Refresh" @click="refreshTasks"
        >刷新</el-button
      >
    </div>

    <div class="task-list" v-loading="loading">
      <div v-if="tasks.length === 0 && !loading" class="empty-state">
        暂无任务
      </div>

      <div
        v-for="(task, index) in tasks"
        :key="task.id"
        class="task-item"
        :class="{ 'task-item--guide-first': index === 0 }"
        @click="handleTaskClick(task)">
        <div class="task-main">
          <div class="task-info">
            <span class="task-name">{{ task.name || '未命名任务' }}</span>
            <span class="task-id">ID: {{ task.id }}</span>
          </div>
          <div class="task-actions">
            <el-tag
              size="small"
              :type="getStatusType(task.status)"
              class="status-tag">
              <el-icon
                v-if="
                  task.status === 'in_progress' ||
                  task.status === 'initializing'
                "
                class="is-loading"
                ><Loading
              /></el-icon>
              <el-icon v-else
                ><component :is="getStatusIcon(task.status)"
              /></el-icon>
              {{ getStatusLabel(task.status) }}
            </el-tag>
            <el-button
              type="icon"
              link
              :icon="InfoFilled"
              @click.stop="handleShowDetail(task)"
              class="action-btn"
              title="任务详情" />
            <el-button
              type="danger"
              link
              :icon="Delete"
              @click.stop="handleDelete(task)"
              class="delete-btn"
              title="删除任务" />
          </div>
        </div>

        <div class="task-meta">
          <span class="time">{{
            new Date(task.created_at).toLocaleString()
          }}</span>
          <div
            v-if="
              task.progress !== undefined &&
              task.progress !== null &&
              task.status !== 'not_started' &&
              task.status !== 'created'
            "
            class="progress-bar">
            <el-progress
              :percentage="Math.round(task.progress || 0)"
              :stroke-width="6"
              :show-text="false"
              :status="
                task.status === 'failed'
                  ? 'exception'
                  : task.status === 'completed'
                    ? 'success'
                    : ''
              " />
          </div>
          <el-button
            v-if="task.status === 'not_started'"
            type="success"
            link
            :icon="VideoPlay"
            @click.stop="handleRunTask(task)"
            class="run-btn-corner"
            :class="{ 'task-run-btn--guide-first': index === 0 }"
            title="开始任务">
            开始任务
          </el-button>
          <el-button
            v-if="
              task.status === 'in_progress' || task.status === 'initializing'
            "
            type="warning"
            link
            :icon="SwitchButton"
            @click.stop="handleStopTask(task)"
            class="stop-btn-corner"
            title="停止任务">
            停止任务
          </el-button>
          <el-button
            v-if="task.status === 'stopped'"
            type="success"
            link
            :icon="Refresh"
            @click.stop="handleRestartTask(task)"
            class="run-btn-corner"
            :class="{ 'task-run-btn--guide-first': index === 0 }"
            title="重新开始">
            重新开始
          </el-button>
        </div>
      </div>
    </div>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        layout="prev, pager, next"
        :total="total"
        small
        background
        @current-change="fetchTasks" />
    </div>

    <WorkerSelectDialog
      v-model="startDialogVisible"
      :workers="startWorkers"
      :loading="startLoadingWorkers"
      :selected-worker-id="startSelectedWorkerId"
      :show-runtime-config="true"
      :runtime-config="startingTask?.runtime_config"
      confirm-text="启动任务"
      @update:selected-worker-id="(id) => (startSelectedWorkerId = id)"
      @refresh="fetchStartWorkers"
      @confirm="confirmRunTask" />

    <WorkerSelectDialog
      v-model="restartDialogVisible"
      :workers="restartWorkers"
      :loading="restartLoadingWorkers"
      :selected-worker-id="restartSelectedWorkerId"
      :show-runtime-config="true"
      :runtime-config="restartingTask?.runtime_config"
      confirm-text="重新启动"
      @update:selected-worker-id="(id) => (restartSelectedWorkerId = id)"
      @refresh="fetchRestartWorkers"
      @confirm="confirmRestartTask" />

    <!-- 编辑任务弹窗 -->
    <el-dialog
      v-model="editDialogVisible"
      title="修改任务名称"
      width="31.25rem"
      append-to-body
      class="edit-dialog">
      <el-form
        ref="editFormRef"
        :model="editForm"
        :rules="editRules"
        label-width="80px"
        @submit.prevent>
        <el-form-item label="任务名称" prop="name">
          <el-input
            v-model="editForm.name"
            placeholder="请输入任务名称"
            @keyup.enter="handleUpdateTask" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="editDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleUpdateTask">确定</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 任务详情弹窗 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="任务详情"
      width="37.5rem"
      append-to-body
      :close-on-click-modal="false"
      class="detail-dialog"
      :before-close="
        (done) => {
          stopDetailPolling()
          done()
        }
      ">
      <div
        v-loading="loadingDetail"
        element-loading-background="rgba(0, 0, 0, 0.7)"
        style="min-height: 12.5rem">
        <div v-if="taskDetail" class="detail-content">
          <!-- 基本信息 -->
          <div class="detail-section">
            <div class="section-title">基本信息</div>
            <div class="info-grid">
              <div class="info-item">
                <span class="label">任务ID</span>
                <span class="value mono">{{ taskDetail.id }}</span>
              </div>
              <div class="info-item">
                <span class="label">任务名称</span>
                <div class="value-with-action">
                  <span class="value highlight">{{
                    taskDetail.name || '未命名任务'
                  }}</span>
                  <el-button
                    type="primary"
                    link
                    :icon="Edit"
                    @click="openEditDialog(taskDetail)"
                    class="edit-btn-small"
                    title="修改名称" />
                </div>
              </div>
              <div class="info-item">
                <span class="label">状态</span>
                <el-tag
                  size="small"
                  :type="getStatusType(taskDetail.status)"
                  class="status-tag">
                  <el-icon
                    ><component :is="getStatusIcon(taskDetail.status)"
                  /></el-icon>
                  {{ getStatusLabel(taskDetail.status) }}
                </el-tag>
              </div>
              <div class="info-item">
                <span class="label">创建时间</span>
                <span class="value">{{
                  new Date(taskDetail.created_at).toLocaleString()
                }}</span>
              </div>
              <div class="info-item" v-if="taskDetail.updated_at">
                <span class="label">更新时间</span>
                <span class="value">{{
                  new Date(taskDetail.updated_at).toLocaleString()
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">模型ID</span>
                <span class="value mono">{{
                  taskDetail.model_id || 'N/A'
                }}</span>
              </div>
              <div class="info-item" v-if="taskDetail.worker_id">
                <span class="label">计算节点</span>
                <span class="value mono">{{ taskDetail.worker_id }}</span>
              </div>
            </div>
          </div>

          <!-- 物种顺序 -->
          <div
            v-if="
              taskDetail.species_order && taskDetail.species_order.length > 0
            "
            class="detail-section">
            <div class="section-title">气体种类</div>
            <div class="species-order-wrap">
              <el-tag
                v-for="(s, i) in taskDetail.species_order"
                :key="s"
                size="small"
                class="species-order-tag">
                {{ s }}
              </el-tag>
            </div>
          </div>

          <!-- 运行时配置 -->
          <div v-if="detailRuntimeConfig" class="detail-section">
            <div class="section-title">运行时配置</div>
            <div class="info-grid">
              <div class="info-item">
                <span class="label">时间步数</span>
                <span class="value mono">{{
                  detailRuntimeConfig.time_steps
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">时间步长</span>
                <span class="value mono">{{
                  detailRuntimeConfig.time_step_size
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">每步迭代</span>
                <span class="value mono">{{
                  detailRuntimeConfig.iterations_per_time_step
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">进程数</span>
                <span class="value mono">{{
                  detailRuntimeConfig.processes
                }}</span>
              </div>
            </div>
          </div>

          <!-- 预生成配置（按云图 / 矢量图 / 流线图 / 体渲染分组） -->
          <div
            v-if="detailPregenConfig"
            class="detail-section pregen-config-section">
            <div class="section-title">预生成配置</div>
            <div class="pregen-groups">
              <div v-if="detailPregenConfig.contour" class="pregen-group">
                <div class="pregen-group-title">云图</div>
                <div
                  v-if="
                    detailPregenConfig.plane_spacing ||
                    detailPregenConfig.point_spacing
                  "
                  class="pregen-grid">
                  <div
                    v-if="detailPregenConfig.plane_spacing"
                    class="pregen-item">
                    <span class="pregen-label">平面间距</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.plane_spacing
                    }}</span>
                  </div>
                  <div
                    v-if="detailPregenConfig.point_spacing"
                    class="pregen-item">
                    <span class="pregen-label">点间距</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.point_spacing
                    }}</span>
                  </div>
                </div>
                <div class="pregen-gas-list">
                  <div
                    v-for="(item, index) in detailPregenConfig.contour"
                    :key="index"
                    class="pregen-gas-item">
                    <span class="pregen-gas-name">{{
                      gasNameMap[item.variable]?.zh || item.variable
                    }}</span>
                    <div class="pregen-gas-colors">
                      <span
                        class="pregen-color-band"
                        :style="getPregenContourBandStyle(item)"
                        :title="getPregenContourBandTitle(item)"></span>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="detailPregenConfig.vector" class="pregen-group">
                <div class="pregen-group-title">矢量图</div>
                <div class="pregen-grid">
                  <div class="pregen-item">
                    <span class="pregen-label">矢量图质量预设</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.vector.quality_preset
                    }}</span>
                  </div>
                  <div class="pregen-item">
                    <span class="pregen-label">矢量图颜色</span>
                    <span
                      class="pregen-color-block"
                      :style="{
                        backgroundColor: detailPregenConfig.vector.color,
                      }"
                      :title="detailPregenConfig.vector.color"></span>
                  </div>
                  <div class="pregen-item">
                    <span class="pregen-label">箭头密度</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.vector.glyph_density
                    }}</span>
                  </div>
                  <div class="pregen-item">
                    <span class="pregen-label">线宽</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.vector.line_width
                    }}</span>
                  </div>
                </div>
              </div>
              <div v-if="detailPregenConfig.streamline" class="pregen-group">
                <div class="pregen-group-title">流线图</div>
                <div class="pregen-grid">
                  <div class="pregen-item">
                    <span class="pregen-label">种子数量</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.streamline.seed_count
                    }}</span>
                  </div>
                  <div class="pregen-item">
                    <span class="pregen-label">每条流线点数</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.streamline.points_per_streamline
                    }}</span>
                  </div>
                </div>
              </div>
              <div v-if="detailPregenConfig.volume" class="pregen-group">
                <div class="pregen-group-title">体渲染</div>
                <div class="pregen-grid">
                  <div class="pregen-item">
                    <span class="pregen-label">分辨率</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.volume.resolution ||
                      detailPregenConfig.volume.sampling_ratio
                    }}</span>
                  </div>
                </div>
              </div>
              <!-- <div
                v-if="detailPregenConfig.volume_texture"
                class="pregen-group">
                <div class="pregen-group-title">体纹理</div>
                <div class="pregen-grid">
                  <div class="pregen-item">
                    <span class="pregen-label">分辨率</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.volume_texture.resolution
                    }}</span>
                  </div>
                  <div class="pregen-item">
                    <span class="pregen-label">采样率</span>
                    <span class="pregen-value mono">{{
                      detailPregenConfig.volume_texture.sampling_ratio
                    }}</span>
                  </div>
                </div>
              </div> -->
            </div>
          </div>

          <!-- 进度信息：运行进度 + 下面紧跟后处理预生成进度 -->
          <div
            v-if="hasRuntimeProgress || shouldShowPregenProgress"
            class="detail-section">
            <div class="section-title">运行进度</div>
            <div class="progress-info-container">
              <!-- 运行进度 -->
              <template v-if="hasRuntimeProgress">
                <div
                  v-if="taskDetail.status === 'completed'"
                  class="progress-completed-tag-wrap">
                  <el-tag
                    type="success"
                    size="default"
                    class="progress-completed-tag">
                    <el-icon><CircleCheck /></el-icon>
                    <span>已完成</span>
                  </el-tag>
                </div>
                <template v-else>
                  <el-progress
                    :percentage="Number(taskDetail.progress?.toFixed(2)) || 0"
                    :stroke-width="24"
                    :text-inside="true"
                    :format="formatProgress"
                    :status="taskDetail.status === 'failed' ? 'exception' : ''"
                    class="detail-progress" />
                </template>

                <div
                  v-if="
                    (taskDetail.status === 'in_progress' ||
                      taskDetail.status === 'initializing') &&
                    (taskDetail.current_step !== undefined ||
                      taskDetail.total_steps !== undefined ||
                      taskDetail.estimated_remaining_time !== undefined)
                  "
                  class="progress-details">
                  <div class="progress-details-row">
                    <div
                      class="detail-item"
                      v-if="
                        taskDetail.current_step !== undefined ||
                        taskDetail.total_steps !== undefined
                      ">
                      <span class="detail-label">时间步:</span>
                      <span class="detail-value mono">{{
                        (taskDetail.current_step || 0) +
                        ' / ' +
                        (taskDetail.total_steps || 0)
                      }}</span>
                    </div>
                    <div
                      class="detail-item"
                      v-if="taskDetail.estimated_remaining_time !== undefined">
                      <span class="detail-label">预估剩余时间:</span>
                      <span class="detail-value mono">{{
                        formatDuration(taskDetail.estimated_remaining_time)
                      }}</span>
                    </div>
                  </div>
                </div>
              </template>

              <!-- 后处理预生成进度（样式与运行进度一致） -->
              <template v-if="shouldShowPregenProgress">
                <div class="pregen-progress-row">
                  <div class="pregen-title-row">
                    <div class="section-title pregen-section-title">
                      后处理预生成进度
                    </div>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="triggerPregenLoading"
                      @click="handleTriggerPregen">
                      <el-icon><Refresh /></el-icon>
                      重新启动
                    </el-button>
                  </div>
                  <template
                    v-if="
                      taskDetail.pregen_status === 'completed' ||
                      taskDetail.pregen_progress >= 100
                    ">
                    <div class="progress-completed-tag-wrap">
                      <el-tag
                        type="success"
                        size="default"
                        class="progress-completed-tag">
                        <el-icon><CircleCheck /></el-icon>
                        <span>已完成</span>
                      </el-tag>
                      <span
                        v-if="
                          taskDetail.pregen_completed_count != null &&
                          taskDetail.pregen_total_count != null
                        "
                        class="pregen-counts-inline">
                        {{ taskDetail.pregen_completed_count.toLocaleString() }}
                        / {{ taskDetail.pregen_total_count.toLocaleString() }}
                      </span>
                    </div>
                  </template>
                  <template v-else-if="taskDetail.pregen_status === 'failed'">
                    <div class="progress-completed-tag-wrap">
                      <el-tooltip
                        v-if="taskDetail.pregen_error_message"
                        :content="taskDetail.pregen_error_message"
                        placement="top"
                        effect="dark"
                        :show-after="500"
                        :hide-after="5000">
                        <el-tag
                          type="danger"
                          size="default"
                          class="progress-completed-tag">
                          <el-icon><CircleClose /></el-icon>
                          <span>失败</span>
                        </el-tag>
                      </el-tooltip>
                      <el-tag
                        v-else
                        type="danger"
                        size="default"
                        class="progress-completed-tag">
                        <el-icon><CircleClose /></el-icon>
                        <span>失败</span>
                      </el-tag>
                    </div>
                  </template>
                  <template v-else>
                    <el-tooltip
                      v-if="taskDetail.pregen_error_message"
                      :content="taskDetail.pregen_error_message"
                      placement="top"
                      effect="dark"
                      :show-after="500"
                      :hide-after="5000">
                      <el-progress
                        :percentage="
                          Number((taskDetail.pregen_progress ?? 0).toFixed(2))
                        "
                        :stroke-width="24"
                        :text-inside="true"
                        :format="(p) => `${Number(p).toFixed(0)}%`"
                        status="exception"
                        class="detail-progress" />
                    </el-tooltip>
                    <el-progress
                      v-else
                      :percentage="
                        Number((taskDetail.pregen_progress ?? 0).toFixed(2))
                      "
                      :stroke-width="24"
                      :text-inside="true"
                      :format="(p) => `${Number(p).toFixed(0)}%`"
                      class="detail-progress" />
                    <div
                      v-if="
                        taskDetail.pregen_completed_count != null ||
                        taskDetail.pregen_current_phase ||
                        taskDetail.pregen_major_phase_name ||
                        taskDetail.pregen_minor_phase_name
                      "
                      class="progress-details">
                      <div class="progress-details-row">
                        <div
                          v-if="
                            taskDetail.pregen_completed_count != null &&
                            taskDetail.pregen_total_count != null
                          "
                          class="detail-item">
                          <span class="detail-label">已完成 / 总数:</span>
                          <span class="detail-value mono">
                            {{
                              (
                                taskDetail.pregen_completed_count ?? 0
                              ).toLocaleString()
                            }}
                            /
                            {{
                              (
                                taskDetail.pregen_total_count ?? 0
                              ).toLocaleString()
                            }}
                          </span>
                        </div>
                        <div
                          v-if="taskDetail.pregen_current_phase"
                          class="detail-item">
                          <span class="detail-label">当前阶段:</span>
                          <span class="detail-value mono">{{
                            taskDetail.pregen_current_phase
                          }}</span>
                        </div>
                        <div
                          v-if="taskDetail.pregen_major_phase_name"
                          class="detail-item">
                          <span class="detail-label">主阶段:</span>
                          <span class="detail-value mono">
                            {{ taskDetail.pregen_major_phase_name }}
                            <template
                              v-if="
                                taskDetail.pregen_major_phase_current != null &&
                                taskDetail.pregen_major_phase_total != null
                              ">
                              ({{
                                taskDetail.pregen_major_phase_current
                              }}
                              /
                              {{ taskDetail.pregen_major_phase_total }})
                            </template>
                          </span>
                        </div>
                        <div
                          v-if="taskDetail.pregen_minor_phase_name"
                          class="detail-item">
                          <span class="detail-label">子阶段:</span>
                          <span class="detail-value mono">
                            {{ taskDetail.pregen_minor_phase_name }}
                            <template
                              v-if="
                                taskDetail.pregen_minor_phase_current != null &&
                                taskDetail.pregen_minor_phase_total != null
                              ">
                              ({{
                                taskDetail.pregen_minor_phase_current
                              }}
                              /
                              {{ taskDetail.pregen_minor_phase_total }})
                            </template>
                          </span>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div v-else-if="!loadingDetail" class="empty-detail">暂无详情数据</div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped src="@/assets/styles/components/TaskList.css"></style>
<style src="@/assets/styles/components/TaskListDialogs.css"></style>
