<template>
  <div class="api-demo">
    <h3>Fluent Worker API 调用示例</h3>

    <div class="demo-section">
      <h4>Worker 相关接口</h4>
      <el-button @click="testGetWorkers" type="primary">获取活跃Worker列表</el-button>
      <el-button @click="testWorkerHeartbeat" type="success">Worker发送心跳</el-button>
      <el-button @click="testGetWorkerInfo" type="info">获取Worker信息</el-button>
      <el-button @click="testResetWorker" type="warning">复位Worker节点</el-button>
    </div>

    <div class="demo-section">
      <h4>任务相关接口</h4>
      <el-button @click="testGetTasks" type="primary">获取任务列表</el-button>
      <el-button @click="testCreateTask" type="success">创建任务</el-button>
      <el-button @click="testAnalyzeTask" type="info">解析任务参数</el-button>
      <el-button @click="testUpdateTask" type="warning">编辑任务</el-button>
      <el-button @click="testDeleteTask" type="danger">删除任务</el-button>
      <el-button @click="testRunTask" type="success">运行任务</el-button>
      <el-button @click="testStopTask" type="danger">停止任务</el-button>
      <el-button @click="testGetTaskProgress" type="info">获取任务进度</el-button>
    </div>

    <div class="demo-section">
      <h4>健康检查接口</h4>
      <el-button @click="testGetHealthStatus" type="primary">获取健康状态</el-button>
    </div>

    <div class="demo-section">
      <h4>响应结果</h4>
      <el-card class="result-card">
        <pre>{{ apiResponse }}</pre>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { workerApi, taskApi, healthApi } from '@/api'

const apiResponse = ref('等待API调用...')

const testGetWorkers = async () => {
  try {
    const result = await workerApi.getWorkers()
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('获取Worker列表成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('获取Worker列表失败')
  }
}

const testWorkerHeartbeat = async () => {
  try {
    const result = await workerApi.workerHeartbeat({
      worker_id: 'worker-001',
      status: 'active',
      timestamp: Date.now()
    })
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('Worker心跳发送成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('Worker心跳发送失败')
  }
}

const testGetWorkerInfo = async () => {
  try {
    const result = await workerApi.getWorkerInfo('worker-001')
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('获取Worker信息成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('获取Worker信息失败')
  }
}

const testResetWorker = async () => {
  try {
    const result = await workerApi.resetWorker('worker-001')
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('Worker复位成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('Worker复位失败')
  }
}

const testGetTasks = async () => {
  try {
    const result = await taskApi.getTasks({ page: 1, page_size: 10 })
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('获取任务列表成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('获取任务列表失败')
  }
}

const testCreateTask = async () => {
  try {
    const result = await taskApi.createTask({
      name: '测试任务',
      description: '这是一个测试任务',
      config: {}
    })
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('创建任务成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('创建任务失败')
  }
}

const testAnalyzeTask = async () => {
  try {
    const result = await taskApi.analyzeTask('task-001', {})
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('解析任务参数成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('解析任务参数失败')
  }
}

const testUpdateTask = async () => {
  try {
    const result = await taskApi.updateTask('task-001', {
      name: '更新后的任务名称',
      description: '更新后的任务描述'
    })
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('更新任务成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('更新任务失败')
  }
}

const testDeleteTask = async () => {
  try {
    const result = await taskApi.deleteTask('task-001')
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('删除任务成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('删除任务失败')
  }
}

const testRunTask = async () => {
  try {
    const result = await taskApi.runTask('task-001', {})
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('运行任务成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('运行任务失败')
  }
}

const testStopTask = async () => {
  try {
    const result = await taskApi.stopTask('task-001')
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('停止任务成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('停止任务失败')
  }
}

const testGetTaskProgress = async () => {
  try {
    const result = await taskApi.getTaskProgress('task-001')
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('获取任务进度成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('获取任务进度失败')
  }
}

const testGetHealthStatus = async () => {
  try {
    const result = await healthApi.getHealthStatus()
    apiResponse.value = JSON.stringify(result, null, 2)
    ElMessage.success('获取健康状态成功')
  } catch (error) {
    apiResponse.value = JSON.stringify(error, null, 2)
    ElMessage.error('获取健康状态失败')
  }
}
</script>

<style scoped>
.api-demo {
  padding: 20px;
}

.demo-section {
  margin-bottom: 24px;
}

.demo-section h4 {
  margin-bottom: 12px;
  color: #333;
}

.demo-section .el-button {
  margin-right: 8px;
  margin-bottom: 8px;
}

.result-card {
  background-color: #f5f5f5;
}

.result-card pre {
  margin: 0;
  padding: 16px;
  background-color: #2d2d2d;
  color: #f8f8f2;
  border-radius: 4px;
  overflow-x: auto;
  font-size: var(--text-caption);
  line-height: var(--leading-normal);
}
</style>
