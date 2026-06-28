<script setup>
import { ref } from 'vue'
import { Download } from '@element-plus/icons-vue'
import {
  svgUrlToPngBlob,
  svgUrlToPngDataUrl,
  downloadSvgAsPng,
} from '@/utils/svgToPng'
import { ElMessage } from 'element-plus'

const props = defineProps({
  svgUrl: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    default: 'visualization',
  },
})

const pngPreview = ref('')
const converting = ref(false)

// 方法1: 转换并预览PNG
const convertAndPreview = async () => {
  converting.value = true
  try {
    const dataUrl = await svgUrlToPngDataUrl(props.svgUrl, {
      scale: 2, // 2倍分辨率，更清晰
      backgroundColor: 'white', // 白色背景
    })
    pngPreview.value = dataUrl
    ElMessage.success('转换成功')
  } catch (error) {
    ElMessage.error('转换失败: ' + error.message)
  } finally {
    converting.value = false
  }
}

// 方法2: 直接下载PNG
const downloadPng = async () => {
  converting.value = true
  try {
    await downloadSvgAsPng(props.svgUrl, props.filename, {
      scale: 2,
      backgroundColor: 'white',
    })
    ElMessage.success('下载成功')
  } catch (error) {
    ElMessage.error('下载失败: ' + error.message)
  } finally {
    converting.value = false
  }
}

// 方法3: 获取Blob用于上传
const uploadPng = async () => {
  converting.value = true
  try {
    const blob = await svgUrlToPngBlob(props.svgUrl, {
      scale: 2,
      backgroundColor: 'white',
    })

    // 创建FormData用于上传
    const formData = new FormData()
    formData.append('file', blob, `${props.filename}.png`)

    // 这里可以调用你的上传API
    // await uploadApi.upload(formData)

    ElMessage.success('PNG已生成，可以上传')
  } catch (error) {
    ElMessage.error('生成失败: ' + error.message)
  } finally {
    converting.value = false
  }
}
</script>

<template>
  <div class="svg-to-png-demo">
    <div class="actions">
      <el-button
        type="primary"
        :loading="converting"
        @click="convertAndPreview">
        转换并预览
      </el-button>

      <el-button
        type="success"
        :icon="Download"
        :loading="converting"
        @click="downloadPng">
        下载PNG
      </el-button>

      <el-button :loading="converting" @click="uploadPng">
        生成PNG Blob
      </el-button>
    </div>

    <div v-if="pngPreview" class="preview">
      <img :src="pngPreview" alt="PNG预览" />
    </div>
  </div>
</template>

<style scoped>
.svg-to-png-demo {
  padding: 1rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.preview {
  border: 1px solid #ddd;
  padding: 1rem;
  border-radius: 0.5rem;
}

.preview img {
  max-width: 100%;
  height: auto;
}
</style>
