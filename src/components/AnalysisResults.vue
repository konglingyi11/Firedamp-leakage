<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const analysisResults = ref({
  totalScanArea: '1,250 m²',
  totalScanTime: '2小时35分钟',
  lifeFormDetected: 4,
  anomalyDetected: 3,
  confidenceLevel: 0.87,
})

const anomalies = ref([
  {
    id: 1,
    type: '温度异常',
    location: 'A区-3层-东北角',
    value: '32.5°C',
    threshold: '25°C',
    severity: 'high',
    timestamp: '2024-01-25 14:30:22',
  },
  {
    id: 2,
    type: '湿度异常',
    location: 'B区-2层-西南角',
    value: '78%',
    threshold: '60%',
    severity: 'medium',
    timestamp: '2024-01-25 14:35:45',
  },
  {
    id: 3,
    type: '气体浓度异常',
    location: 'C区-1层-中央',
    value: '甲烷 0.001%',
    threshold: '0.0002%',
    severity: 'high',
    timestamp: '2024-01-25 14:40:18',
  },
])

const generateReport = () => {
  
  // 这里可以添加生成报告的逻辑
  ElMessage.success('分析报告已生成')
}

const exportData = () => {
  
  // 这里可以添加导出数据的逻辑
  ElMessage.success('数据导出成功')
}
</script>

<template>
  <div class="analysis-results">
    <h3>分析结果</h3>

    <!-- 分析概览 -->
    <div class="analysis-section overview-section">
      <div class="section-header">
        <span>分析概览</span>
        <div class="header-buttons">
          <el-button size="small" type="primary" @click="generateReport"
            >生成报告</el-button
          >
          <el-button size="small" @click="exportData">导出数据</el-button>
        </div>
      </div>
      <div class="section-content">
        <div class="overview-grid">
          <div class="overview-item">
            <div class="overview-label">扫描总面积</div>
            <div class="overview-value">
              {{ analysisResults.totalScanArea }}
            </div>
          </div>
          <div class="overview-item">
            <div class="overview-label">总扫描时间</div>
            <div class="overview-value">
              {{ analysisResults.totalScanTime }}
            </div>
          </div>
          <div class="overview-item">
            <div class="overview-label">检测到的生命形式</div>
            <div class="overview-value">
              {{ analysisResults.lifeFormDetected }} 种
            </div>
          </div>
          <div class="overview-item">
            <div class="overview-label">异常点数量</div>
            <div class="overview-value">
              {{ analysisResults.anomalyDetected }} 个
            </div>
          </div>
          <div class="overview-item full-width">
            <div class="overview-label">置信度</div>
            <div class="overview-value">
              <el-progress
                :percentage="analysisResults.confidenceLevel * 100"
                :color="
                  analysisResults.confidenceLevel > 0.8
                    ? '#10b981'
                    : analysisResults.confidenceLevel > 0.6
                      ? '#f59e0b'
                      : '#ef4444'
                "
                :stroke-width="10" />
              <span class="confidence-text"
                >{{ (analysisResults.confidenceLevel * 100).toFixed(0) }}%</span
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 异常检测结果 -->
    <div class="analysis-section anomaly-section">
      <div class="section-header">
        <span>异常检测</span>
      </div>
      <div class="section-content">
        <div class="anomaly-list">
          <el-alert
            v-for="anomaly in anomalies"
            :key="anomaly.id"
            :title="anomaly.type"
            :type="
              anomaly.severity === 'high'
                ? 'error'
                : anomaly.severity === 'medium'
                  ? 'warning'
                  : 'info'
            "
            show-icon
            :closable="false"
            class="anomaly-item">
            <template #default>
              <div class="anomaly-details">
                <p><strong>位置:</strong> {{ anomaly.location }}</p>
                <p><strong>检测值:</strong> {{ anomaly.value }}</p>
                <p><strong>阈值:</strong> {{ anomaly.threshold }}</p>
                <p><strong>检测时间:</strong> {{ anomaly.timestamp }}</p>
              </div>
            </template>
          </el-alert>
        </div>
      </div>
    </div>

    <!-- 分析结论 -->
    <div class="analysis-section conclusion-section">
      <div class="section-header">
        <span>分析结论</span>
      </div>
      <div class="section-content">
        <div class="conclusion-content">
          <p>1. 掩埋空间内存在多种生命形式，其中微生物数量最多，分布广泛。</p>
          <p>2. 检测到3处异常点，主要集中在温度、湿度和气体浓度方面。</p>
          <p>3. A区东北角温度异常升高，可能存在地热活动或其他热源。</p>
          <p>4. C区中央甲烷浓度异常，建议进一步调查是否存在甲烷释放源。</p>
          <p>5. 整体环境参数在正常范围内，适合生命存在。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analysis-results {
  /* 移除固定高度，允许内容自然撑开 */
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.analysis-results h3 {
  margin-bottom: 0.3125rem;
  font-family: var(--font-family-tech);
  color: var(--primary-color);
  font-size: var(--text-card-title);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.0625rem;
  display: none; /* 标题已在面板头部显示，这里隐藏 */
}

.analysis-section {
  background: rgba(13, 20, 35, 0.85);
  border: 1px solid rgba(0, 243, 255, 0.2);
  border-radius: 0.5rem;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  backdrop-filter: blur(10px);
}

.analysis-section::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  background: linear-gradient(180deg, var(--primary-color), var(--primary-light));
  opacity: 0.7;
}

.analysis-section:hover {
  border-color: var(--primary-color);
  box-shadow: 0 8px 24px rgba(0, 243, 255, 0.15);
  transform: translateY(-2px);
  background: rgba(13, 20, 35, 0.95);
}

.section-header {
  background: linear-gradient(90deg, rgba(0, 243, 255, 0.15), transparent);
  border-bottom: 1px solid rgba(0, 243, 255, 0.2);
  color: var(--primary-light);
  padding: 0.75rem 0.9375rem;
  font-family: var(--font-family-tech);
  font-weight: 600;
  font-size: var(--text-body);
  display: flex;
  justify-content: space-between;
  align-items: center;
  letter-spacing: 0.0625rem;
}

.section-content {
  padding: 1.25rem;
}

.header-buttons {
  display: flex;
  gap: 0.625rem;
}

/* 按钮样式覆盖 */
.header-buttons :deep(.el-button) {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(0, 243, 255, 0.3);
  color: var(--text-secondary);
  font-family: var(--font-family-base);
  border-radius: 0.25rem;
  transition: all 0.3s ease;
}

.header-buttons :deep(.el-button:hover) {
  background: rgba(0, 243, 255, 0.1);
  border-color: var(--primary-color);
  color: var(--primary-color);
  transform: translateY(-1px);
}

.header-buttons :deep(.el-button--primary) {
  background: rgba(0, 243, 255, 0.15);
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.header-buttons :deep(.el-button--primary:hover) {
  background: rgba(0, 243, 255, 0.3);
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.3);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}

.overview-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.overview-item:hover {
  border-color: var(--primary-color);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 4px 12px rgba(0, 243, 255, 0.15);
}

.overview-item.full-width {
  grid-column: span 2;
}

.overview-label {
  color: var(--text-tertiary);
  font-size: var(--text-caption);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.0625rem;
}

.overview-value {
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  font-size: var(--text-panel-title);
  font-weight: 600;
  text-shadow: 0 0 0.625rem rgba(0, 243, 255, 0.2);
  display: flex;
  align-items: center;
}

.confidence-text {
  margin-left: 0.9375rem;
  font-size: var(--text-card-title);
  font-weight: bold;
  color: var(--success-color);
  font-family: var(--font-family-mono);
}

/* 进度条样式覆盖 */
:deep(.el-progress-bar__outer) {
  background-color: rgba(255, 255, 255, 0.1) !important;
  border-radius: 2px !important;
}

:deep(.el-progress-bar__inner) {
  border-radius: 2px !important;
  box-shadow: 0 0 0.625rem currentColor;
}

.anomaly-list {
  display: flex;
  flex-direction: column;
  gap: 0.9375rem;
}

.anomaly-item {
  background-color: rgba(255, 51, 102, 0.05);
  border: 1px solid rgba(255, 51, 102, 0.2);
  padding: 0.625rem;
  border-radius: 0.5rem;
  transition: all 0.3s ease;
}

.anomaly-item:hover {
  border-color: rgba(255, 51, 102, 0.4);
  box-shadow: 0 4px 12px rgba(255, 51, 102, 0.15);
}

.anomaly-item.el-alert--warning {
  background-color: rgba(247, 185, 85, 0.05);
  border-color: rgba(247, 185, 85, 0.2);
}

.anomaly-item.el-alert--warning:hover {
  border-color: rgba(247, 185, 85, 0.4);
  box-shadow: 0 4px 12px rgba(247, 185, 85, 0.15);
}

.anomaly-details {
  margin-top: 0.625rem;
  font-size: var(--text-body);
  line-height: 1.6;
  color: var(--text-secondary);
}

.anomaly-details strong {
  color: var(--text-primary);
}

.conclusion-content {
  font-size: var(--text-body);
  line-height: 1.8;
}

.conclusion-content p {
  margin-bottom: 0.75rem;
  color: var(--text-secondary);
  border-left: 2px solid rgba(0, 243, 255, 0.2);
  padding-left: 0.625rem;
  transition: all 0.3s ease;
}

.conclusion-content p:hover {
  border-left-color: var(--primary-color);
  padding-left: 1rem;
  color: var(--text-primary);
}

:deep(.el-alert__title) {
  color: var(--text-primary);
  font-weight: 600;
  font-size: var(--text-body);
}

:deep(.el-alert__description) {
  color: var(--text-secondary);
}

:deep(.el-alert__icon) {
  font-size: var(--text-panel-title);
  margin-right: 0.625rem;
}

/* 警告框图标颜色 */
:deep(.el-alert--error .el-alert__icon) {
  color: var(--danger-color);
}
:deep(.el-alert--warning .el-alert__icon) {
  color: var(--warning-color);
}
</style>
