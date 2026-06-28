<script setup>
import { ref, watch, computed } from 'vue'
import { formatTimelineValue } from '@/utils/timelineLabel'
import {
  VideoPlay,
  VideoPause,
  RefreshRight,
  CaretLeft,
  CaretRight,
  DArrowLeft,
  DArrowRight,
  ArrowDown,
  ArrowUp,
} from '@element-plus/icons-vue'

const props = defineProps({
  currentStep: {
    type: Number,
    default: 0,
  },
  totalSteps: {
    type: Number,
    default: 100,
  },
  physicalTimes: {
    type: Array,
    default: () => [],
  },
  isPlaying: {
    type: Boolean,
    default: false,
  },
  isCollapsed: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  /** overlay：主页底部浮动；inline：雷达模块网格内嵌 */
  layout: {
    type: String,
    default: 'overlay',
    validator: (v) => ['overlay', 'inline'].includes(v),
  },
  showCollapseTrigger: {
    type: Boolean,
    default: true,
  },
  speed: {
    type: Number,
    default: 1,
  },
  /**
   * 多图层数据
   */
  layers: {
    type: Array,
    default: () => [],
  },
  /**
   * 当前选中的图层 id（null = 叠加所有）
   */
  selectedLayerId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits([
  'update:currentStep',
  'update:speed',
  'update:selectedLayerId',
  'play',
  'pause',
  'stop',
  'seek',
  'toggle-collapse',
])

const internalStep = ref(props.currentStep)
const normalizeSpeedToMultiplier = (raw) => {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  return n > 60 ? n / 100 : n
}
const internalSpeed = ref(1)
const speedMarks = {
  1: '1',
  12: '12',
  24: '24',
  30: '30',
  60: '60',
}

watch(
  () => props.currentStep,
  (newVal) => {
    internalStep.value = newVal
  },
)

watch(
  () => props.speed,
  (newVal) => {
    internalSpeed.value = normalizeSpeedToMultiplier(newVal)
  },
  { immediate: true },
)

const internalSelectedLayerId = ref(props.selectedLayerId)

const multiLayerCount = computed(() =>
  Array.isArray(props.layers) ? props.layers.length : 0,
)
const isSingleStep = computed(() => Number(props.totalSteps) <= 0)
const sliderMax = computed(() => (isSingleStep.value ? 1 : props.totalSteps))
const sliderValue = computed(() => (isSingleStep.value ? 1 : internalStep.value))

watch(
  () => props.selectedLayerId,
  (newVal) => {
    internalSelectedLayerId.value = newVal
  },
)

const handleLayerChange = (val) => {
  emit('update:selectedLayerId', val)
}

const handleSliderInput = (val) => {
  if (props.disabled) return
  if (isSingleStep.value) return
  internalStep.value = val
  emit('update:currentStep', val)
  emit('seek', val)
}

const handleSliderChange = (val) => {
  if (props.disabled) return
  if (isSingleStep.value) {
    internalStep.value = 0
    emit('seek', 0)
    emit('update:currentStep', 0)
    return
  }
  internalStep.value = val
  emit('seek', val)
  emit('update:currentStep', val)
}

const handleSpeedChange = (val) => {
  if (props.disabled) return
  const n = Number(val)
  if (!Number.isFinite(n) || n <= 0) return
  internalSpeed.value = n
  emit('update:speed', n)
}

const formatSpeed = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '1 FPS'
  return `${Math.round(n)} FPS`
}

const togglePlay = () => {
  if (props.disabled) return
  if (isSingleStep.value) return
  if (props.isPlaying) {
    emit('pause')
  } else {
    emit('play')
  }
}

const handleStop = () => {
  if (props.disabled) return
  emit('stop')
}

const prevStep = () => {
  if (props.disabled) return
  if (isSingleStep.value) return
  const next = Math.max(0, internalStep.value - 1)
  handleSliderChange(next)
}

const nextStep = () => {
  if (props.disabled) return
  if (isSingleStep.value) return
  const next = Math.min(props.totalSteps, internalStep.value + 1)
  handleSliderChange(next)
}

const formatStep = (step) => {
  return formatTimelineValue(step, props.physicalTimes)
}
</script>

<template>
  <div
    class="timeline-wrapper"
    :class="{
      'is-collapsed': isCollapsed,
      'layout-inline': layout === 'inline',
    }">
    <!-- 折叠触发器 -->
    <div
      v-if="showCollapseTrigger"
      class="collapse-trigger"
      @click="emit('toggle-collapse')">
      <el-icon :size="20">
        <ArrowDown v-if="!isCollapsed" />
        <ArrowUp v-else />
      </el-icon>
      <span class="trigger-text">时间轴</span>
    </div>

    <!-- 多图层切换（折叠展开后显示） -->
    <!-- <div v-if="multiLayerCount > 0" class="timeline-layer-switcher" :class="{ 'is-collapsed': isCollapsed }">
      <el-select
        v-model="internalSelectedLayerId"
        size="small"
        placeholder="选择图层"
        clearable
        @change="handleLayerChange"
        class="timeline-layer-select"
        popper-class="timeline-layer-popper">
        <el-option label="全部叠加" :value="null" />
        <el-option
          v-for="layer in layers"
          :key="layer.id"
          :label="layer.label || layer.kind"
          :value="layer.id" />
      </el-select>
    </div> -->

    <div class="timeline-control">
      <div class="timeline-decoration-line"></div>
      <div class="timeline-content">
        <!-- 左侧控制按钮 -->
        <div class="control-buttons">
          <!-- <el-tooltip content="停止" placement="top">
            <el-button
              circle
              class="control-btn stop-btn"
              :icon="RefreshRight"
              :disabled="isSingleStep || disabled"
              @click="handleStop" />
          </el-tooltip> -->

          <el-button
            circle
            class="control-btn step-btn"
            :icon="DArrowLeft"
            :disabled="isSingleStep || disabled"
            @click="handleSliderChange(0)" />

          <el-button
            circle
            class="control-btn step-btn"
            :icon="CaretLeft"
            :disabled="isSingleStep || disabled"
            @click="prevStep" />

          <el-button
            circle
            class="play-pause-btn"
            :class="{ 'is-playing': isPlaying }"
            :disabled="isSingleStep || disabled"
            @click="togglePlay">
            <el-icon :size="24">
              <VideoPause v-if="isPlaying" />
              <VideoPlay v-else />
            </el-icon>
          </el-button>

          <el-button
            circle
            class="control-btn step-btn"
            :icon="CaretRight"
            :disabled="isSingleStep || disabled"
            @click="nextStep" />

          <el-button
            circle
            class="control-btn step-btn"
            :icon="DArrowRight"
            :disabled="isSingleStep || disabled"
            @click="handleSliderChange(totalSteps)" />
        </div>

        <!-- 中间时间轴 -->
        <div class="timeline-slider-wrapper">
          <div class="step-info">
            <span class="current-step">{{ formatStep(internalStep) }}</span>
            <span class="total-steps">/ {{ formatStep(totalSteps) }}</span>
          </div>
          <el-slider
            :model-value="sliderValue"
            :max="sliderMax"
            :min="0"
            :step="1"
            :show-tooltip="true"
            :disabled="isSingleStep || disabled"
            class="custom-timeline-slider"
            @update:model-value="handleSliderInput"
            @input="handleSliderInput"
            @change="handleSliderChange" />
        </div>

        <!-- 速度控制 -->
        <div class="speed-control">
          <el-tooltip content="动画速度" placement="top">
            <div class="speed-slider-wrapper">
              <!-- <el-icon class="speed-icon"><RefreshRight /></el-icon> -->
              <el-slider
                :model-value="internalSpeed"
                :min="1"
                :max="60"
                :step="1"
                :marks="speedMarks"
                :format-tooltip="formatSpeed"
                :disabled="disabled"
                class="speed-slider"
                @input="handleSpeedChange" />
              <span class="speed-value">{{ formatSpeed(internalSpeed) }}</span>
            </div>
          </el-tooltip>
        </div>

        <!-- 右侧装饰/状态 -->
        <div class="status-indicator">
          <div class="status-dot" :class="{ active: isPlaying }"></div>
          <span class="status-text">{{
            isPlaying ? 'ANIMATING' : 'PAUSED'
          }}</span>
          <div class="tech-details">
            <div class="detail-line"></div>
            <div class="detail-line"></div>
            <div class="detail-line"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.timeline-wrapper {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);

  &.is-collapsed:not(.layout-inline) {
    transform: none;

    .timeline-control {
      display: none;
    }

    .collapse-trigger {
      top: auto;
      bottom: 0;
      border-bottom: 1px solid rgba(0, 243, 255, 0.3);
    }
  }

  &.layout-inline {
    position: relative;
    bottom: auto;
    left: auto;
    right: auto;
    z-index: 1;
    width: 100%;
    min-width: 0;

    &.is-collapsed {
      transform: none;

      .timeline-control {
        height: 0;
        min-height: 0;
        padding-top: 0;
        padding-bottom: 0;
        border-top-color: transparent;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
      }
    }
  }
}

.collapse-trigger {
  position: absolute;
  top: -1.5rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(8, 12, 24, 0.9);
  border: 1px solid rgba(0, 243, 255, 0.3);
  border-bottom: none;
  padding: 0.25rem 1.25rem;
  border-radius: 0.5rem 0.5rem 0 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--primary-color);
  font-family: var(--font-family-tech);
  font-size: var(--text-caption);
  letter-spacing: 0.125rem;
  transition: all 0.3s;
  backdrop-filter: blur(10px);
  z-index: 101;

  &:hover {
    background: rgba(0, 243, 255, 0.1);
    border-color: var(--primary-color);
    box-shadow: 0 -0.3125rem 0.9375rem rgba(0, 243, 255, 0.2);
  }
}

.timeline-layer-switcher {
  position: absolute;
  top: -1.5rem;
  right: 1rem;
  z-index: 101;

  &.is-collapsed {
    display: none;
  }
}

.timeline-layer-select {
  width: 12rem;
  --el-fill-color-blank: rgba(8, 12, 24, 0.92);
  --el-text-color-regular: rgba(220, 247, 255, 0.96);
  --el-border-color: rgba(0, 243, 255, 0.3);
  --el-border-color-hover: rgba(0, 243, 255, 0.5);
  --el-color-primary: #00f3ff;
}

.timeline-layer-select :deep(.el-input__wrapper) {
  background: rgba(8, 12, 24, 0.92);
  border: 1px solid rgba(0, 243, 255, 0.3);
  border-radius: 0.5rem;
  box-shadow: none;
}

.timeline-layer-select :deep(.el-input__inner) {
  color: rgba(220, 247, 255, 0.96);
  font-family: var(--font-family-tech);
  font-size: var(--text-caption);
}

.timeline-layer-select :deep(.el-input__suffix) {
  color: rgba(0, 243, 255, 0.7);
}

.timeline-control {
  height: 5rem;
  background: linear-gradient(
    0deg,
    rgba(8, 12, 24, 0.95) 0%,
    rgba(12, 18, 35, 0.8) 100%
  );
  backdrop-filter: blur(15px);
  border-top: 1px solid rgba(0, 243, 255, 0.3);
  display: flex;
  flex-direction: column;
  padding: 0 2.5rem;
  box-shadow: 0 -0.625rem 1.875rem rgba(0, 0, 0, 0.5);
  animation: slideInUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
  transition: height 0.28s ease, opacity 0.28s ease, padding 0.28s ease;
}

.layout-inline .timeline-control {
  height: 5rem;
  border: 1px solid rgba(0, 243, 255, 0.22);
  border-radius: var(--radius-md);
  box-shadow: 0 0 1.5rem rgba(0, 0, 0, 0.45);
  animation: none;
}

.layout-inline .collapse-trigger {
  top: -1.375rem;
}

@keyframes slideInUp {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.timeline-decoration-line {
  position: absolute;
  top: 0;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--primary-color),
    transparent
  );
  box-shadow: 0 0 0.625rem var(--primary-color);
}

.timeline-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 1.875rem;
}

.control-buttons {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.control-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 243, 255, 0.2);
  color: var(--text-secondary);
  transition: all 0.3s;

  &:hover {
    background: rgba(0, 243, 255, 0.1);
    border-color: var(--primary-color);
    color: var(--primary-color);
    box-shadow: 0 0 0.625rem rgba(0, 243, 255, 0.3);
  }
}

.play-pause-btn {
  width: 3rem;
  height: 3rem;
  background: var(--primary-color);
  border: none;
  color: #000;
  box-shadow: 0 0 0.9375rem rgba(0, 243, 255, 0.5);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);

  &:hover {
    transform: scale(1.1);
    box-shadow: 0 0 1.5625rem rgba(0, 243, 255, 0.7);
  }

  &.is-playing {
    background: #ff4757;
    box-shadow: 0 0 0.9375rem rgba(245, 108, 108, 0.5);
    color: white;

    &:hover {
      box-shadow: 0 0 1.5625rem rgba(245, 108, 108, 0.7);
    }
  }
}

.timeline-slider-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.step-info {
  display: flex;
  align-items: baseline;
  gap: 0.25rem;
  margin-bottom: -0.25rem;
  font-family: var(--font-family-mono);
}

.current-step {
  font-size: clamp(0.75rem, 1.5vw, 1rem);
  font-weight: bold;
  color: var(--primary-color);
  text-shadow: 0 0 0.5rem rgba(0, 243, 255, 0.4);
}

.total-steps {
  font-size: clamp(0.625rem, 1vw, 0.75rem);
  color: var(--text-tertiary);
}

.custom-timeline-slider {
  :deep(.el-slider__runway) {
    background: rgba(255, 255, 255, 0.1);
    height: 0.375rem;
  }

  :deep(.el-slider__bar) {
    background: linear-gradient(
      90deg,
      var(--primary-color),
      var(--accent-secondary)
    );
    height: 0.375rem;
    box-shadow: 0 0 0.625rem rgba(0, 243, 255, 0.4);
  }

  :deep(.el-slider__button) {
    width: 0.875rem;
    height: 0.875rem;
    background: #fff;
    border: 2px solid var(--primary-color);
    box-shadow: 0 0 0.625rem rgba(0, 243, 255, 0.5);
    transition: transform 0.2s;

    &:hover {
      transform: scale(1.3);
    }
  }
}

.speed-control {
  min-width: 15rem;
  padding: 0 0.9375rem;
  border-left: 1px solid rgba(0, 243, 255, 0.1);
  border-right: 1px solid rgba(0, 243, 255, 0.1);
}

.speed-slider-wrapper {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.speed-icon {
  color: var(--text-tertiary);
  font-size: var(--font-md);
}

.speed-slider {
  width: 9rem;
  margin-top: 0.75rem;

  :deep(.el-slider__runway) {
    background: rgba(255, 255, 255, 0.1);
    height: 0.25rem;
  }

  :deep(.el-slider__bar) {
    background: linear-gradient(90deg, #00f3ff, #7c5cff);
    height: 0.25rem;
    box-shadow: 0 0 0.625rem rgba(0, 243, 255, 0.35);
  }

  :deep(.el-slider__button) {
    width: 0.75rem;
    height: 0.75rem;
    border: 2px solid var(--primary-color);
    box-shadow: 0 0 0.5rem rgba(0, 243, 255, 0.45);
  }

  :deep(.el-slider__marks-text) {
    color: rgba(170, 210, 230, 0.72);
    font-family: var(--font-family-mono);
    font-size: 0.625rem;
    margin-top: 0.125rem;
    white-space: nowrap;
  }
}

.speed-value {
  font-family: var(--font-family-mono);
  font-size: var(--text-caption);
  color: var(--primary-color);
  min-width: 2.1875rem;
  text-align: right;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 8.75rem;
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #909399;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    top: -0.125rem;
    left: -0.125rem;
    right: -0.125rem;
    bottom: -0.125rem;
    border-radius: 50%;
    border: 1px solid currentColor;
    opacity: 0;
  }

  &.active {
    background: var(--primary-color);
    box-shadow: 0 0 0.625rem var(--primary-color);
    animation: pulse 2s infinite;

    &::after {
      opacity: 0.5;
      animation: ripple 2s infinite;
    }
  }
}

@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
  100% {
    opacity: 1;
  }
}

@keyframes ripple {
  0% {
    transform: scale(1);
    opacity: 0.5;
  }
  100% {
    transform: scale(2.5);
    opacity: 0;
  }
}

.status-text {
  font-family: var(--font-family-tech);
  font-size: var(--text-caption);
  letter-spacing: 0.125rem;
  color: var(--text-secondary);
}

.tech-details {
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
}

.detail-line {
  width: 1.25rem;
  height: 0.125rem;
  background: var(--primary-color);
  opacity: 0.3;

  &:nth-child(2) {
    width: 0.9375rem;
  }
  &:nth-child(3) {
    width: 0.625rem;
  }
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .timeline-control {
    padding: 0 var(--space-lg);
  }

  .status-indicator {
    display: none;
  }
}

@media (max-width: 768px) {
  .timeline-control {
    height: 6rem;
    padding: 0 var(--space-md);
  }

  .timeline-content {
    flex-direction: column;
    justify-content: center;
    gap: 0.75rem;
  }

  .control-buttons {
    gap: var(--space-xs);
  }

  .play-pause-btn {
    width: 2.5rem;
    height: 2.5rem;
  }

  .speed-control {
    min-width: auto;
    padding: 0 0.5rem;
    border-left: none;
    border-right: none;
    border-top: 1px solid rgba(0, 243, 255, 0.1);
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .speed-slider-wrapper {
    max-width: 15rem;
  }
}

@media (max-width: 480px) {
  .timeline-wrapper.is-collapsed {
    transform: translateY(7rem);
  }

  .timeline-control {
    height: 7rem;
    padding: 0 var(--space-xs);
  }

  .timeline-content {
    gap: var(--space-xs);
  }

  .control-buttons {
    gap: var(--space-2xs);
  }

  .control-btn {
    width: 1.75rem;
    height: 1.75rem;
  }

  .play-pause-btn {
    width: 2rem;
    height: 2rem;
  }

  .speed-control {
    max-width: 100%;
  }

  .speed-slider-wrapper {
    max-width: 13rem;
  }

  .speed-slider {
    width: 7.5rem;
  }

  .step-info {
    font-size: var(--text-body);
  }

  .current-step {
    font-size: var(--text-body);
  }
}
</style>
