<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  CircleCheck,
  Clock,
  Loading,
  Monitor,
  Refresh,
  RefreshLeft,
} from '@element-plus/icons-vue'
import { workerApi } from '@/api/worker'
import { ElMessageBox, ElMessage } from 'element-plus'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '启动计算任务',
  },
  workers: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  selectedWorkerId: {
    type: [String, Number],
    default: '',
  },
  confirmText: {
    type: String,
    default: '下一步',
  },
  showRuntimeConfig: {
    type: Boolean,
    default: false,
  },
  runtimeConfig: {
    type: Object,
    default: () => ({
      time_steps: 100,
      time_step_size: 0.01,
      iterations_per_time_step: 20,
      processes: 4,
    }),
  },
})

const emit = defineEmits([
  'update:modelValue',
  'update:selectedWorkerId',
  'refresh',
  'confirm',
])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const currentStep = ref(0)
const localRuntimeConfig = reactive({
  time_steps: 100,
  time_step_size: 0.01,
  iterations_per_time_step: 20,
  processes: 4,
  image_generation_granularity: 10, // 图片预生成粒度
})

watch(
  () => props.modelValue,
  (val, oldVal) => {
    // 只在弹窗从关闭变为打开时重置步骤
    if (val && !oldVal) {
      currentStep.value = 0
    }
  },
)

watch(
  () => props.runtimeConfig,
  (cfg) => {
    Object.assign(localRuntimeConfig, {
      time_steps: cfg?.time_steps ?? 100,
      time_step_size: cfg?.time_step_size ?? 0.01,
      iterations_per_time_step: cfg?.iterations_per_time_step ?? 20,
      processes: cfg?.processes ?? 4,
      image_generation_granularity: cfg?.image_generation_granularity ?? 10,
    })
  },
  { immediate: true, deep: true },
)

const nextStep = () => {
  if (!props.selectedWorkerId) return
  currentStep.value = 1
}

const prevStep = () => {
  currentStep.value = 0
}

const handleConfirm = () => {
  
  emit('confirm', {
    workerId: props.selectedWorkerId,
    runtimeConfig: { ...localRuntimeConfig },
  })
}

const getWorkerStatusText = (status) => {
  if (!status) return '未知'
  const s = String(status).toLowerCase()
  if (s === 'idle') return '空闲'
  if (s === 'busy') return '繁忙'
  if (s === 'offline') return '离线'
  return status
}

const formatHeartbeat = (value) => {
  if (!value) return '未知'
  try {
    const now = Date.now()
    const ts = new Date(value).getTime()
    if (Number.isNaN(ts)) return String(value)
    const diffSec = Math.max(0, Math.floor((now - ts) / 1000))
    return `${diffSec}秒前`
  } catch {
    return String(value)
  }
}

/** 展示 Worker 接口中的整数字段（与文档一致） */
const formatWorkerInt = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : '—'
}

const handleResetWorker = async (worker, event) => {
  if (event && event.stopPropagation) event.stopPropagation()
  try {
    await ElMessageBox.confirm(
      `确定要复位计算节点「${worker.hostname || worker.id}」吗？复位将停止该节点上的所有仿真任务、清理环境，并恢复为空闲状态。`,
      '复位确认',
      {
        confirmButtonText: '确定复位',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'reset-confirm-box',
      },
    )

    await workerApi.resetWorker(worker.id)
    ElMessage.success('节点复位成功')
    emit('refresh')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to reset worker:', error)
      ElMessage.error('节点复位失败')
    }
  }
}

const handleResetSelectedWorker = (e) => {
  const worker = props.workers.find((w) => w.id === props.selectedWorkerId)
  if (worker) handleResetWorker(worker, e)
  else ElMessage.warning('请先选择要复位的节点')
}

const setGuideStep = (step) => {
  if (!props.showRuntimeConfig) return
  currentStep.value = step === 1 ? 1 : 0
}

const closeDialog = () => {
  visible.value = false
}

defineExpose({
  setGuideStep,
  closeDialog,
})
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="640px"
    append-to-body
    :close-on-click-modal="false"
    class="worker-dialog">
    <div class="dialog-steps-wrapper" v-if="showRuntimeConfig">
      <el-steps :active="currentStep" finish-status="success" align-center>
        <el-step title="选择计算节点" />
        <el-step title="运行配置" />
      </el-steps>
    </div>

    <div v-if="!showRuntimeConfig || currentStep === 0" class="step-content">
      <div class="worker-list-header">
        <span>可用节点列表</span>
      </div>

      <div v-loading="loading" class="worker-list">
        <div v-if="workers.length === 0 && !loading" class="no-workers">
          <el-empty description="暂无可用的计算节点" />
        </div>

        <div v-else class="worker-cards">
          <div
            v-for="(worker, index) in workers"
            :key="worker.id"
            class="worker-card"
            :class="{
              selected: selectedWorkerId === worker.id,
              'worker-card--guide-first': index === 0,
            }"
            @click="emit('update:selectedWorkerId', worker.id)">
            <div class="worker-card-header">
              <div class="worker-icon">
                <el-icon :size="20"><Monitor /></el-icon>
              </div>
              <div class="worker-title">
                <span class="worker-name">
                  {{ worker.hostname || worker.id }}
                  <span
                    v-if="worker.is_active"
                    class="active-dot"
                    title="节点活跃"></span>
                </span>
                <span class="worker-ip"
                  >{{ worker.ip_address || '-' }}:{{ worker.port || '-' }}</span
                >
              </div>
              <div
                class="worker-status-badge"
                :class="(worker.status || 'idle').toLowerCase()">
                {{ getWorkerStatusText(worker.status) }}
              </div>
            </div>

            <div class="worker-meta">
              <span
                ><el-icon :size="14"><Clock /></el-icon> 最后心跳:
                {{ formatHeartbeat(worker.last_heartbeat) }}</span
              >
              <span v-if="worker.current_task_id" class="active-task"
                ><el-icon :size="14"><Loading /></el-icon> 任务:
                {{ worker.current_task_id }}</span
              >
              <span v-else
                ><el-icon :size="14"><CircleCheck /></el-icon>
                未分配计算任务</span
              >
            </div>

            <div class="worker-stats">
              <div class="worker-stats-title">Fluent 资源</div>
              <div class="worker-stats-grid">
                <div class="worker-stat">
                  <span class="stat-label">可用 Fluent 线程</span>
                  <span class="stat-value available">{{
                    formatWorkerInt(worker.available_fluent_threads)
                  }}</span>
                </div>
                <div class="worker-stat">
                  <span class="stat-label">已占用 Fluent 线程</span>
                  <span class="stat-value used">{{
                    formatWorkerInt(worker.used_fluent_threads)
                  }}</span>
                </div>
                <div class="worker-stat">
                  <span class="stat-label">最大 Fluent 线程</span>
                  <span class="stat-value max">{{
                    formatWorkerInt(worker.max_fluent_threads)
                  }}</span>
                </div>
                <div class="worker-stat">
                  <span class="stat-label">运行中 Fluent 数</span>
                  <span class="stat-value running">{{
                    formatWorkerInt(worker.running_fluent_count)
                  }}</span>
                </div>
                <div class="worker-stat worker-stat-reserved">
                  <span class="stat-label">系统预留线程</span>
                  <span class="stat-value reserved">{{
                    formatWorkerInt(worker.reserved_threads)
                  }}</span>
                </div>
              </div>
            </div>

            <div
              v-if="selectedWorkerId === worker.id"
              class="selected-indicator">
              <el-icon :size="20"><CircleCheck /></el-icon>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showRuntimeConfig && currentStep === 1"
      class="step-content config-step">
      <el-form
        :model="localRuntimeConfig"
        label-width="140px"
        class="runtime-config-form">
        <div class="config-section-title">运行时参数设置</div>

        <el-form-item label="时间步数 (Steps)">
          <el-input-number
            v-model="localRuntimeConfig.time_steps"
            :min="1"
            :max="10000"
            style="width: 100%" />
          <div class="form-tip">总计算步数，决定模拟的时长</div>
        </el-form-item>

        <el-form-item label="时间步长 (Size)">
          <el-input-number
            v-model="localRuntimeConfig.time_step_size"
            :precision="3"
            :step="0.001"
            :min="0.001"
            style="width: 100%" />
          <div class="form-tip">每步代表的物理时间长度（秒）</div>
        </el-form-item>

        <el-form-item label="单步迭代次数">
          <el-input-number
            v-model="localRuntimeConfig.iterations_per_time_step"
            :min="1"
            :max="200"
            style="width: 100%" />
          <div class="form-tip">每个时间步内的收敛计算次数</div>
        </el-form-item>

        <el-form-item label="并行进程数">
          <el-input-number
            v-model="localRuntimeConfig.processes"
            :min="1"
            :max="128"
            style="width: 100%" />
          <div class="form-tip">利用计算节点的 CPU 核心数</div>
        </el-form-item>

        <!-- <el-form-item label="图片预生成粒度">
          <el-input
            v-model.number="localRuntimeConfig.image_generation_granularity"
            placeholder="请输入粒度值"
            style="width: 100%" />
          <div class="form-tip">
            每隔多少距离生成一张可视化图片（单位：厘米）
          </div>
        </el-form-item> -->
      </el-form>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <div class="left-btns">
          <el-button :icon="Refresh" @click="emit('refresh')">刷新</el-button>
          <el-button
            v-if="!showRuntimeConfig || currentStep === 0"
            :icon="RefreshLeft"
            :disabled="!selectedWorkerId"
            @click="handleResetSelectedWorker"
            class="reset-worker-btn">
            复位
          </el-button>
          <el-button
            v-if="showRuntimeConfig && currentStep === 1"
            :icon="RefreshLeft"
            @click="prevStep">
            上一步
          </el-button>
        </div>

        <div class="right-btns">
          <el-button class="worker-guide-cancel-btn" @click="visible = false">取消</el-button>
          <el-button
            v-if="showRuntimeConfig && currentStep === 0"
            type="primary"
            :disabled="!selectedWorkerId"
            class="worker-guide-next-btn"
            @click="nextStep">
            下一步
          </el-button>
          <el-button
            v-else
            type="primary"
            :disabled="!selectedWorkerId"
            class="worker-guide-confirm-btn"
            @click="handleConfirm">
            {{ confirmText }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<!-- 复位确认弹窗：与项目深色风格一致（未 scoped，弹窗在 body 下） -->

<style scoped src="@/assets/styles/components/WorkerSelectDialog.css"></style>
<style src="@/assets/styles/components/WorkerSelectDialogGlobal.css"></style>
