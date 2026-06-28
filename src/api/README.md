# Fluent Worker API 接口文档

## 概述

本模块封装了 Fluent Worker 节点的所有 API 接口，用于执行 Fluent 仿真任务，包括启动仿真、监控进度和管理任务生命周期。

## 文件结构

```
src/api/
├── index.js        # API 入口文件，导出所有 API 模块
├── worker.js       # Worker 相关接口
├── task.js         # 任务相关接口
├── health.js       # 健康检查接口
├── model.js        # 模型管理接口
├── postProcessing.js # 后处理相关接口
├── ribbon.js       # 色带管理接口
└── fluent.js       # Fluent API 组合导出
```

## API 接口列表

### Worker 相关接口 (4个)

| 接口               | 方法 | 路径                              | 说明                         |
| ------------------ | ---- | --------------------------------- | ---------------------------- |
| Worker发送心跳     | POST | /api/v1/workers/heartbeat         | Worker节点发送心跳保持连接   |
| 获取活跃Worker列表 | GET  | /api/v1/workers/                  | 获取所有活跃的Worker节点列表 |
| 获取Worker信息     | GET  | /api/v1/workers/{worker_id}       | 获取指定Worker的详细信息     |
| 复位Worker节点     | POST | /api/v1/workers/{worker_id}/reset | 复位指定的Worker节点         |

### 任务相关接口 (8个)

| 接口         | 方法   | 路径                             | 说明                       |
| ------------ | ------ | -------------------------------- | -------------------------- |
| 获取任务列表 | GET    | /api/v1/tasks/                   | 获取所有任务列表，支持分页 |
| 创建任务     | POST   | /api/v1/tasks/                   | 创建新的Fluent仿真任务     |
| 解析任务参数 | POST   | /api/v1/tasks/{task_id}/analyze  | 解析任务的参数配置         |
| 编辑任务     | PUT    | /api/v1/tasks/{task_id}          | 更新任务信息               |
| 删除任务     | DELETE | /api/v1/tasks/{task_id}          | 删除指定任务               |
| 运行任务     | POST   | /api/v1/tasks/{task_id}/run      | 启动任务执行               |
| 停止任务     | POST   | /api/v1/tasks/{task_id}/stop     | 停止正在运行的任务         |
| 获取任务进度 | GET    | /api/v1/tasks/{task_id}/progress | 获取任务执行进度           |

### 健康检查接口 (1个)

| 接口         | 方法 | 路径            | 说明             |
| ------------ | ---- | --------------- | ---------------- |
| 获取健康状态 | GET  | /api/v1/health/ | 获取系统健康状态 |

### 模型管理接口 (5个)

| 接口           | 方法   | 路径                      | 说明                   |
| -------------- | ------ | ------------------------- | ---------------------- |
| 获取模型列表   | GET    | /api/v1/models/           | 获取所有模型列表       |
| 上传并创建模型 | POST   | /api/v1/models/           | 上传模型文件并创建模型 |
| 获取模型详情   | GET    | /api/v1/models/{model_id} | 获取指定模型的详细信息 |
| 修改模型信息   | PUT    | /api/v1/models/{model_id} | 更新模型信息           |
| 删除模型       | DELETE | /api/v1/models/{model_id} | 删除指定模型           |

### 色带管理接口 (5个)

| 接口         | 方法   | 路径                        | 说明             |
| ------------ | ------ | --------------------------- | ---------------- |
| 创建色带     | POST   | /api/v1/ribbons/            | 创建新的色带     |
| 分页获取色带 | GET    | /api/v1/ribbons/            | 分页获取色带列表 |
| 获取色带详情 | GET    | /api/v1/ribbons/{ribbon_id} | 获取色带详情     |
| 修改色带     | PUT    | /api/v1/ribbons/{ribbon_id} | 更新色带信息     |
| 删除色带     | DELETE | /api/v1/ribbons/{ribbon_id} | 删除指定色带     |

## 使用方法

### 1. 基本使用

```javascript
import { workerApi, taskApi, healthApi, modelApi, ribbonApi } from '@/api'

// Worker 相关调用
const workers = await workerApi.getWorkers()
const workerInfo = await workerApi.getWorkerInfo('worker-001')

// 任务相关调用
const tasks = await taskApi.getTasks({ page: 1, page_size: 10 })
const newTask = await taskApi.createTask({
  name: '测试任务',
  description: '这是一个测试任务',
  config: {},
})

// 健康检查
const health = await healthApi.getHealthStatus()

// 模型管理
const models = await modelApi.getModels()
const modelInfo = await modelApi.getModelInfo('model-001')

// 色带管理
const ribbons = await ribbonApi.getRibbons({ page: 1, page_size: 10 })
const newRibbon = await ribbonApi.createRibbon({
  name: '测试色带',
  color: '#FF5733',
  description: '这是一个测试色带',
})
```

### 2. 使用组合导出

```javascript
import api from '@/api'

// 使用默认导出
const workers = await api.worker.getWorkers()
const tasks = await api.task.getTasks()
const health = await api.health.getHealthStatus()
const models = await api.model.getModels()
const ribbons = await api.ribbon.getRibbons()
```

### 3. 使用 Composition API

```javascript
import { useFluentApi } from '@/api'

const { worker, task, health, model, ribbon } = useFluentApi()

const workers = await worker.getWorkers()
const tasks = await task.getTasks()
const health = await health.getHealthStatus()
const models = await model.getModels()
const ribbons = await ribbon.getRibbons()
```

## 完整示例

```javascript
import { workerApi, taskApi, healthApi } from '@/api'

// 1. 检查系统健康状态
const healthStatus = await healthApi.getHealthStatus()


// 2. 获取活跃的Worker列表
const workers = await workerApi.getWorkers()


// 3. 获取指定Worker信息
if (workers.length > 0) {
  const workerInfo = await workerApi.getWorkerInfo(workers[0].worker_id)
  
}

// 4. 创建新任务
const newTask = await taskApi.createTask({
  name: 'Fluent仿真任务',
  description: '执行流体动力学仿真',
  config: {
    solver: 'pressure-based',
    turbulence_model: 'k-epsilon',
  },
})


// 5. 解析任务参数
const analyzedTask = await taskApi.analyzeTask(newTask.task_id, {})


// 6. 运行任务
const runResult = await taskApi.runTask(newTask.task_id, {})


// 7. 获取任务进度
const progress = await taskApi.getTaskProgress(newTask.task_id)


// 8. 停止任务（如果需要）
const stopResult = await taskApi.stopTask(newTask.task_id)


// 9. 更新任务
const updatedTask = await taskApi.updateTask(newTask.task_id, {
  name: '更新后的任务名称',
  description: '更新后的描述',
})


// 10. 删除任务（如果需要）
const deleteResult = await taskApi.deleteTask(newTask.task_id)


// 11. 复位Worker节点
const resetResult = await workerApi.resetWorker(workers[0].worker_id)


// 12. 获取模型列表
const models = await modelApi.getModels()


// 13. 上传并创建模型
const fileInput = document.getElementById('model-file-input')
const file = fileInput.files[0]
const newModel = await modelApi.createModel({
  file: file,
  name: '倾斜式倒塌模型',
  building_type: '倾斜式倒塌',
  survival_space: '高位形成生命三角区域',
  rescue_difficulty: '需高空作业，施救难度大',
})


// 14. 获取模型详情
const modelInfo = await modelApi.getModelInfo(newModel.id)


// 15. 修改模型信息
const updatedModel = await modelApi.updateModel(newModel.id, {
  name: '更新后的模型名称',
  building_type: '堆叠式倒塌',
  survival_space: '楼板层形成空间密集区',
  rescue_difficulty: '人员被困深度较深，搜索难度高',
})


// 16. 删除模型（如果需要）
const deleteModelResult = await modelApi.deleteModel(newModel.id)


// 17. 创建色带
const newRibbon = await ribbonApi.createRibbon({
  name: '高温色带',
  color: '#FF4500',
  description: '用于显示高温区域',
})


// 18. 分页获取色带列表
const ribbons = await ribbonApi.getRibbons({ page: 1, page_size: 10 })


// 19. 获取色带详情
const ribbonInfo = await ribbonApi.getRibbonInfo(newRibbon.id)


// 20. 修改色带
const updatedRibbon = await ribbonApi.updateRibbon(newRibbon.id, {
  name: '高温危险色带',
  color: '#FF0000',
  description: '用于显示高温危险区域',
})


// 21. 删除色带（如果需要）
const deleteRibbonResult = await ribbonApi.deleteRibbon(newRibbon.id)

```

## 错误处理

所有API调用都使用统一的错误处理机制，错误信息会通过 Element Plus 的 ElMessage 组件显示。

```javascript
import { workerApi } from '@/api'
import { ElMessage } from 'element-plus'

try {
  const workers = await workerApi.getWorkers()
  
} catch (error) {
  console.error('获取失败:', error)
  ElMessage.error('获取Worker列表失败')
}
```

## 演示组件

项目中包含一个完整的API演示组件 `FluentApiDemo.vue`，展示了所有接口的调用方法。

### 使用演示组件

```vue
<template>
  <FluentApiDemo />
</template>

<script setup>
import FluentApiDemo from '@/components/FluentApiDemo.vue'
</script>
```

## 配置说明

API 基础路径在 `src/utils/request.js` 中配置：

```javascript
const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json;charset=UTF-8',
  },
})
```

环境变量配置文件：

- `.env.development`: 开发环境配置
- `.env.production`: 生产环境配置

示例配置：

```bash
VITE_API_BASE_URL=http://localhost:8080
```

## 注意事项

1. 所有接口都需要正确的后端服务支持
2. 建议在生产环境中配置正确的 API 基础路径
3. 某些接口可能需要身份验证（token）
4. 请求超时时间默认为15秒，可根据需要调整
5. 错误信息会自动显示在页面中，无需手动处理

## 技术栈

- Vue 3
- Axios
- Element Plus
- Composition API

## 更新日志

- 2026-04-06: 新增色带管理接口（5个），总计23个API接口
- 2026-01-26: 新增模型管理接口（5个），总计18个API接口
- 2026-01-26: 初始版本，实现所有13个API接口
