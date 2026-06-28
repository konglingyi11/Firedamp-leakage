<template>
  <div class="api-example">
    <h3>Axios 封装使用示例</h3>

    <el-button @click="handleGetData" type="primary">GET 请求示例</el-button>
    <el-button @click="handlePostData" type="success">POST 请求示例</el-button>
    <el-button @click="handleUpload" type="warning">文件上传示例</el-button>

    <div v-if="data" class="result">
      <pre>{{ JSON.stringify(data, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { userApi, exampleApi } from '@/api'
import { ElMessage } from 'element-plus'

const data = ref(null)

// GET 请求示例
const handleGetData = async () => {
  try {
    const res = await exampleApi.getList({ page: 1, size: 10 })
    data.value = res
    ElMessage.success('获取数据成功')
  } catch (error) {
    console.error('请求失败：', error)
  }
}

// POST 请求示例
const handlePostData = async () => {
  try {
    const res = await exampleApi.create({
      name: '测试数据',
      description: '这是一条测试数据'
    })
    data.value = res
    ElMessage.success('创建成功')
  } catch (error) {
    console.error('请求失败：', error)
  }
}

// 文件上传示例
const handleUpload = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    try {
      const res = await exampleApi.uploadFile(file)
      data.value = res
      ElMessage.success('上传成功')
    } catch (error) {
      console.error('上传失败：', error)
    }
  }
  input.click()
}
</script>

<style scoped>
.api-example {
  padding: 20px;
}

.result {
  margin-top: 20px;
  padding: 15px;
  background: #f5f5f5;
  border-radius: 4px;
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
