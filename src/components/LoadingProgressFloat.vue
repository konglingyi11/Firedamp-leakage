<script setup>
import { ref } from 'vue'
import { Loading, Clock } from '@element-plus/icons-vue'

const props = defineProps({
  batchLoading: {
    type: Boolean,
    default: false
  },
  batchProgress: {
    type: Number,
    default: 0
  },
  batchCurrent: {
    type: Number,
    default: 0
  },
  batchTotal: {
    type: Number,
    default: 0
  },
  loadingText: {
    type: String,
    default: '正在加载...'
  }
})

const isHovered = ref(false)

const handleMouseEnter = () => {
  isHovered.value = true
}

const handleMouseLeave = () => {
  isHovered.value = false
}
</script>

<template>
  <div 
    class="loading-progress-float"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- 悬浮按钮 -->
    <div class="float-button">
      <el-icon v-if="batchLoading" class="loading-icon"><Loading /></el-icon>
      <el-icon v-else class="idle-icon"><Clock /></el-icon>
      <span v-if="batchLoading" class="progress-badge">{{ batchProgress }}%</span>
    </div>
    
    <!-- 弹出面板 -->
    <div v-if="isHovered && batchLoading" class="progress-panel">
      <div class="panel-header">
        <el-icon><Loading /></el-icon>
        <span>加载进度</span>
      </div>
      <div class="panel-content">
        <div class="loading-info">
          <span class="loading-text">{{ loadingText }}</span>
          <span class="progress-percentage">{{ batchProgress }}%</span>
        </div>
        <el-progress
          :percentage="batchProgress"
          :stroke-width="6"
          :show-text="false"
          color="#00d4ff"
          class="progress-bar" />
        <div class="batch-info">
          <span>进度: {{ batchCurrent }} / {{ batchTotal }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 默认随父级排版（如左轨 flex）；勿用 absolute+居中，否则会与画面中央提示重叠 */
.loading-progress-float {
  position: relative;
  top: auto;
  left: auto;
  transform: none;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.float-button {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: rgba(13, 20, 35, 0.95);
  border: 1px solid rgba(0, 243, 255, 0.3);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  box-shadow: 0 4px 12px rgba(0, 243, 255, 0.2);
}

.float-button:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 243, 255, 0.3);
  border-color: rgba(0, 243, 255, 0.5);
}

.loading-icon {
  font-size: 1.5rem;
  color: #00d4ff;
  animation: spin 2s linear infinite;
}

.idle-icon {
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.6);
}

.progress-badge {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  background: #00d4ff;
  color: #000;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  border-radius: 1rem;
  min-width: 1.5rem;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 243, 255, 0.4);
}

.progress-panel {
  margin-top: 1rem;
  width: 20rem;
  background: rgba(13, 20, 35, 0.95);
  border: 1px solid rgba(0, 243, 255, 0.3);
  border-radius: 0.75rem;
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  animation: slideIn 0.3s ease-out;
  overflow: hidden;
}

.panel-header {
  padding: 1rem;
  border-bottom: 1px solid rgba(0, 243, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(0, 243, 255, 0.05);
}

.panel-header span {
  font-size: 1rem;
  font-weight: 600;
  color: #00d4ff;
}

.panel-header .el-icon {
  color: #00d4ff;
  font-size: 1.25rem;
}

.panel-content {
  padding: 1rem;
}

.loading-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.loading-text {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
}

.progress-percentage {
  font-size: 0.875rem;
  color: #00d4ff;
  font-weight: 600;
}

.progress-bar {
  margin-bottom: 0.75rem;
}

.batch-info {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  text-align: right;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(1rem) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 小屏：固定在右下角，避免挡中央画面 */
@media (max-width: 768px) {
  .loading-progress-float {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    top: auto;
    left: auto;
    transform: none;
  }
  
  .float-button {
    width: 3rem;
    height: 3rem;
  }
  
  .progress-panel {
    width: 16rem;
  }
}
</style>
