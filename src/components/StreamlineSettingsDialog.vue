<script setup>
import { ref, computed, watch } from 'vue'
import { Setting, QuestionFilled } from '@element-plus/icons-vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  layer: {
    type: Object,
    default: null,
  },
  visualization: {
    type: Object,
    required: true,
  },
  pregenConfig: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['update:visible', 'apply'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

// 本地副本，用于编辑
const localSettings = ref({
  seed_count: 50,
  points_per_streamline: 40,
  line_width: 0.38,
  display_time: 5,
  color: '#ff3b30',
  smoke_enabled: false,
})

// 从 visualization 初始化本地设置
watch(
  () => props.visible,
  (visible) => {
    if (visible && props.visualization?.streamline) {
      localSettings.value = {
        seed_count: props.visualization.streamline.seed_count ?? 50,
        points_per_streamline:
          props.visualization.streamline.points_per_streamline ?? 40,
        line_width: props.visualization.streamline.line_width ?? 0.38,
        display_time: props.visualization.streamline.display_time ?? 5,
        color: props.visualization.streamline.color ?? '#ff3b30',
        smoke_enabled:
          props.layer?.streamlineSmokeEnabled ??
          props.visualization.streamline.smoke_enabled ??
          false,
      }
    }
  },
  { immediate: true },
)

// 是否使用预生成数据
const isUsingPregen = computed(() => props.visualization?.usePregen === true)

// 从 pregenConfig 获取流线配置
const pregenStreamlineConfig = computed(() => props.pregenConfig?.streamline)

// 判断特定配置项是否在 pregenConfig 中定义
const hasPregenStreamlineSeedCount = computed(
  () => pregenStreamlineConfig.value?.seed_count != null,
)
const hasPregenStreamlinePointsPerStreamline = computed(
  () => pregenStreamlineConfig.value?.points_per_streamline != null,
)
const hasPregenStreamlineLineWidth = computed(
  () => pregenStreamlineConfig.value?.line_width != null,
)

const normalizeLineWidth = (value) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return 0.38
  return Math.min(20, Math.max(0.1, numericValue))
}

const handleApply = () => {
  const settingsToApply = {
    ...localSettings.value,
    line_width: normalizeLineWidth(localSettings.value.line_width),
  }
  localSettings.value.line_width = settingsToApply.line_width

  // 更新 visualization.streamline
  if (!props.visualization.streamline) {
    props.visualization.streamline = {}
  }
  Object.assign(props.visualization.streamline, settingsToApply)

  emit('apply', settingsToApply)
  dialogVisible.value = false
}

const handleCancel = () => {
  dialogVisible.value = false
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="流线图设置"
    width="480px"
    :close-on-click-modal="false"
    :append-to-body="true"
    class="streamline-settings-dialog dark-dialog">
    <el-form label-width="140px" class="streamline-form">
      <el-form-item>
        <template #label>
          <span class="label-with-tip">
            线条粗细
            <el-tooltip placement="top" effect="dark">
              <template #content>
                <div class="setting-tip-content">
                  <div><strong>line_width：流线渲染宽度</strong></div>
                  <div>作用：控制流线的视觉粗细。</div>
                  <div>越大：流线更明显、更容易观察。</div>
                  <div>越小：流线更精细，但可能难以看清。</div>
                </div>
              </template>
              <el-icon class="label-tip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-input
          v-model.number="localSettings.line_width"
          class="line-width-input"
          type="number"
          :disabled="isUsingPregen && hasPregenStreamlineLineWidth"
          min="0.1"
          max="20"
          step="0.1"
          style="width: 100%"
          placeholder="0.38" />
      </el-form-item>

      <el-form-item label="流线颜色">
        <div class="color-picker-row">
          <div
            class="color-swatch"
            :style="{ backgroundColor: localSettings.color }" />
          <el-color-picker
            v-model="localSettings.color"
            color-format="hex"
            :show-alpha="false"
            popper-class="dark-theme-picker" />
          <span class="color-hex">{{
            (localSettings.color || '#ff3b30').toUpperCase()
          }}</span>
        </div>
      </el-form-item>

      <el-form-item label="烟雾效果">
        <div class="switch-row">
          <el-switch
            v-model="localSettings.smoke_enabled"
            active-text="开启"
            inactive-text="关闭"
            inline-prompt />
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleApply">应用</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style>
/* 全局样式，与项目其他弹窗保持一致 */
.streamline-settings-dialog.dark-dialog {
  --el-dialog-bg-color: rgba(13, 20, 35, 0.98) !important;
}

.streamline-settings-dialog.dark-dialog .el-dialog {
  background: rgba(13, 20, 35, 0.98) !important;
  backdrop-filter: blur(1.25rem);
  border: 1px solid var(--primary-color);
  box-shadow: 0 0 50px rgba(0, 0, 0, 0.8);
  border-radius: 0.625rem;
  overflow: hidden;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.streamline-settings-dialog.dark-dialog .el-dialog__header {
  background: linear-gradient(
    90deg,
    rgba(0, 243, 255, 0.1) 0%,
    transparent 100%
  ) !important;
  border-bottom: 1px solid rgba(0, 243, 255, 0.2);
  margin-right: 0 !important;
  padding: 1rem 1.25rem !important;
}

.streamline-settings-dialog.dark-dialog .el-dialog__title {
  color: var(--primary-light);
  font-family: var(--font-family-tech);
  font-weight: 600;
  letter-spacing: 1px;
}

.streamline-settings-dialog.dark-dialog
  .el-dialog__headerbtn
  .el-dialog__close {
  color: var(--text-secondary);
}

.streamline-settings-dialog.dark-dialog
  .el-dialog__headerbtn:hover
  .el-dialog__close {
  color: var(--primary-color);
}

.streamline-settings-dialog.dark-dialog .el-dialog__body {
  padding: 1.5rem 1.25rem !important;
  background: transparent !important;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.streamline-settings-dialog.dark-dialog .el-dialog__footer {
  border-top: 1px solid rgba(0, 243, 255, 0.2);
  padding: 0.875rem 1rem !important;
  background: transparent !important;
}

.streamline-settings-dialog.dark-dialog .el-form-item__label {
  color: var(--text-secondary) !important;
}

.streamline-settings-dialog.dark-dialog .el-button {
  border-radius: var(--radius-md);
  font-weight: 500;
  transition: all 0.3s ease;
}

.streamline-settings-dialog.dark-dialog .el-button--default {
  background: rgba(26, 35, 50, 0.6);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.streamline-settings-dialog.dark-dialog .el-button--default:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
  background: rgba(26, 35, 50, 0.8);
}

.streamline-settings-dialog.dark-dialog .el-button--primary {
  background: linear-gradient(
    135deg,
    var(--primary-color) 0%,
    var(--accent-secondary) 100%
  );
  border: none;
  box-shadow: 0 4px 15px rgba(0, 212, 255, 0.4);
  color: #000;
  font-weight: 600;
}

.streamline-settings-dialog.dark-dialog .el-button--primary:hover {
  transform: translateY(-2px);
  box-shadow:
    0 6px 20px rgba(0, 212, 255, 0.6),
    var(--shadow-glow);
}
</style>

<style scoped>
.streamline-form {
  padding: 0 1rem;
}

.label-with-tip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.label-tip-icon {
  color: var(--primary-color);
  cursor: help;
  font-size: 14px;
  opacity: 0.8;
  transition: opacity 0.3s ease;
}

.label-tip-icon:hover {
  opacity: 1;
}

.setting-tip-content {
  max-width: 280px;
  line-height: 1.6;
}

.setting-tip-content > div {
  margin-bottom: 0.5rem;
}

.setting-tip-content > div:last-child {
  margin-bottom: 0;
}

.line-width-input :deep(.el-input__wrapper) {
  background: rgba(3, 12, 24, 0.82);
  border: 1px solid var(--primary-color);
  border-radius: 0.5rem;
  box-shadow: 0 0 0 1px rgba(0, 243, 255, 0.12) inset;
}

.line-width-input :deep(.el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px var(--primary-color) inset,
    0 0 18px rgba(0, 243, 255, 0.24);
}

.line-width-input :deep(.el-input__inner) {
  appearance: textfield;
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  font-weight: 600;
  text-align: center;
}

.line-width-input :deep(input[type='number']::-webkit-inner-spin-button),
.line-width-input :deep(input[type='number']::-webkit-outer-spin-button) {
  appearance: none;
  margin: 0;
}

.color-picker-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
}

.color-swatch {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.2s;
}

.color-swatch:hover {
  border-color: var(--border-hover);
  transform: scale(1.05);
  box-shadow: var(--shadow-sm);
}

.color-hex {
  flex: 1;
  font-family: var(--font-family-mono);
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.switch-row {
  display: flex;
  align-items: center;
  min-height: 32px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
