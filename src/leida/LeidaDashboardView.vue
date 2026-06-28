<script setup>
import {
  Bell,
  Connection,
  CopyDocument,
  Download,
  FolderOpened,
  QuestionFilled,
  UserFilled,
  VideoPause,
  VideoPlay,
} from '@element-plus/icons-vue'
import LeidaPanelsShell from './LeidaPanelsShell.vue'
import LeidaSceneViewport from './components/LeidaSceneViewport.vue'
import './styles/leida-dashboard.css'

const taskId = 'EM2025072101'

function copyTaskId() {
  navigator.clipboard?.writeText(taskId)
}
</script>

<template>
  <div class="leida-page">
    <header class="leida-header">
      <div class="leida-brand">
        <span class="leida-brand-icon"><Connection /></span>
        <h1>掩埋空间电磁传播仿真与可视化系统</h1>
      </div>
      <div class="leida-task-id">
        任务编号：<code>{{ taskId }}</code>
        <button class="leida-btn icon-only" title="复制" @click="copyTaskId"><CopyDocument /></button>
      </div>
      <div class="leida-header-actions">
        <button class="leida-btn"><FolderOpened />导入模型</button>
        <button class="leida-btn primary"><VideoPlay />运行仿真</button>
        <button class="leida-btn muted"><VideoPause />暂停</button>
        <button class="leida-btn"><Download />导出结果</button>
        <button class="leida-btn icon-only" title="通知"><Bell /></button>
        <button class="leida-btn icon-only" title="帮助"><QuestionFilled /></button>
        <button class="leida-btn icon-only" title="用户"><UserFilled /></button>
      </div>
    </header>

    <LeidaPanelsShell :task-id="taskId" v-slot="{ viewMode }">
      <LeidaSceneViewport :view-mode="viewMode" />
    </LeidaPanelsShell>
  </div>
</template>
