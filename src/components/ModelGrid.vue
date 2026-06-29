<script setup>
import { ref, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import modelApi, { unwrapApiModel } from '../api/model.js'
import taskApi from '../api/task.js'
import {
  createMockGoafTask,
  createMockGoafModelInfo,
} from '../api/mockGoafTask.js'
import {
  Box,
  Check,
  Grid,
  ArrowRight,
  Edit,
  View,
  InfoFilled,
  Setting,
  Document,
  List,
  Delete,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatModelDeleteError } from '@/utils/modelDeleteError.js'

const props = defineProps({
  initialSelectedId: {
    type: [String, Number],
    default: null,
  },
})

const models = ref([])
const loading = ref(false)
const deletingModelId = ref(null)
const selectedModel = ref(props.initialSelectedId)

watch(
  () => props.initialSelectedId,
  (newVal) => {
    
    if (newVal) {
      selectedModel.value = newVal
    }
  },
  { immediate: true },
)

// 编辑对话框相关状态
const editDialogVisible = ref(false)
const editingModelId = ref(null)
const editFormRef = ref(null)
const editForm = reactive({
  name: '',
  category: '',
  survivalSpace: '',
  difficulty: '',
  geometryModelFile: null,
  realModelFile: null,
  previewImageFile: null,
  videoFile: null,
})
const editGeometryFileList = ref([])
const editRealFileList = ref([])
const editPreviewFileList = ref([])
const editVideoFileList = ref([])
const editCurrentPreviewUrl = ref('')
const updatingModel = ref(false)

const MODEL_FILE_EXTENSIONS = ['.fbx', '.glb', '.gltf', '.obj', '.stl']
const PREVIEW_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
const PREVIEW_IMAGE_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif'
const MODEL_FILE_ACCEPT =
  '.fbx,.glb,.gltf,.obj,.stl,model/gltf-binary,model/gltf+json,model/obj,model/stl'

const emit = defineEmits(['select', 'taskCreated', 'spawnActor'])
const router = useRouter()

// 手动触发模型分析
const analyzeLoading = ref(false)
const handleAnalyze = async (modelId) => {
  try {
    await ElMessageBox.confirm(
      '确定要手动触发模型分析吗？这将重新分析模型的几何、网格和边界条件等信息。',
      '触发分析确认',
      {
        confirmButtonText: '确定分析',
        cancelButtonText: '取消',
        type: 'info',
        customClass: 'edit-dialog',
      },
    )
  } catch {
    return
  }

  analyzeLoading.value = true
  try {
    await modelApi.analyzeModel(modelId)
    ElMessage.success('模型分析已触发，请稍后刷新查看状态')
    // 重新拉取最新详情
    const res = await modelApi.getModelInfo(modelId)
    activeModelDetail.value = unwrapApiModel(res)
    // 同步更新模型列表中的分析状态
    fetchModels()
  } catch (error) {
    console.error('分析失败:', error)
    ElMessage.error('分析触发失败')
  } finally {
    analyzeLoading.value = false
  }
}

const handleVideoUpload = async (uploadFile) => {
  const rawFile = uploadFile?.raw || uploadFile
  if (!rawFile) {
    ElMessage.error('获取文件失败')
    return
  }

  // 验证文件类型
  const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm']
  const fileName = rawFile.name?.toLowerCase() || ''
  const isValidVideo = videoExtensions.some(ext => fileName.endsWith(ext))
  if (!isValidVideo) {
    ElMessage.error('请上传 mp4/avi/mov/mkv/webm 格式的视频文件')
    return
  }

  // 验证文件大小（100MB限制）
  if (rawFile.size > 100 * 1024 * 1024) {
    ElMessage.error('视频文件大小不能超过 100MB')
    return
  }

  try {
    ElMessage.info('视频上传中...')
    // TODO: 调用后端 API 上传视频
    // const res = await modelApi.uploadVideo(activeModelDetail.value.id, rawFile)
    
    // 模拟上传成功
    activeModelDetail.value.video_url = URL.createObjectURL(rawFile)
    ElMessage.success('视频上传成功')
  } catch (error) {
    console.error('视频上传失败:', error)
    ElMessage.error('视频上传失败')
  }
}

const fetchModels = async () => {
  loading.value = true
  try {
    const res = await modelApi.getModels()
    // 兼容后端返回格式：可能是数组，也可能是 { list: [] }
    const modelList = Array.isArray(res) ? res : res.list || []

    models.value = modelList.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.building_type, // 优先使用 building_type
      survivalSpace: item.survival_space,
      difficulty: item.rescue_difficulty,
      image: item.preview_url || '/model-preview-1.png', // 默认图片
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      is_analyzed: item.is_analyzed,
    }))

    // 追加本地「采空区瓦斯泄漏模拟数据」卡片
    models.value.push({
      id: createMockGoafModelInfo().id,
      name: '采空区瓦斯泄漏',
      category: '采空区',
      survivalSpace: '-',
      difficulty: '-',
      image: 'https://caikongqu-1315816428.cos.ap-nanjing.myqcloud.com/采空区/图片.png',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      is_analyzed: true,
      isSimulated: true,
    })
  } catch (error) {
    console.error('Failed to fetch models:', error)
  } finally {
    loading.value = false
  }
}

const selectModel = (model) => {
  selectedModel.value = model.id
  
  emit('select', model)
}

const openModelPreview = (model) => {
  router.push({
    name: 'ModelPreview',
    params: { id: model.id },
  })
}

const createTask = () => {
  if (!selectedModel.value) {
    console.warn('未选择模型')
    return
  }

  const selected = models.value.find((m) => m.id === selectedModel.value)
  const isSimulated = selected?.isSimulated === true
  const defaultName = isSimulated ? '采空区瓦斯泄漏模拟' : '会议室'

  ElMessageBox.prompt('请输入任务名称', '创建任务', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    inputValue: defaultName,
    inputValidator: (value) => {
      if (!value) return '请输入任务名称'
      return true
    },
    customClass: 'create-task-dialog',
  })
    .then(async ({ value }) => {
      try {
        // 本地模拟卡片：不调用后端，直接构造合成任务
        if (isSimulated) {
          const syntheticTask = {
            ...createMockGoafTask({ name: value, isSimulated: true }),
            ...createMockGoafModelInfo(),
            isSimulated: true,
          }
          emit('taskCreated', syntheticTask)
          return
        }

        const payload = {
          name: value,
          model_id: selectedModel.value,
        }

        const res = await taskApi.createTask(payload)
        // 任务创建成功后，再通知生成 Actor
        emit('spawnActor', selectedModel.value)
        emit('taskCreated', res)
      } catch (error) {
        console.error('Create task failed:', error)
        ElMessage.error('创建任务失败: ' + (error.message || '未知错误'))
      }
    })
    .catch(() => {})
}

// 打开编辑对话框
const openEditDialog = (model) => {
  editingModelId.value = model.id
  editForm.name = model.name
  editForm.category = model.category
  editForm.survivalSpace = model.survivalSpace
  editForm.difficulty = model.difficulty
  editForm.geometryModelFile = null
  editForm.realModelFile = null
  editForm.previewImageFile = null
  editForm.videoFile = null
  editGeometryFileList.value = []
  editRealFileList.value = []
  editPreviewFileList.value = []
  editVideoFileList.value = []
  editCurrentPreviewUrl.value =
    model.image && !model.image.startsWith('/model-preview')
      ? model.image
      : ''
  editDialogVisible.value = true
}

const isModelUploadFile = (file) => {
  const rawFile = file?.raw || file
  const name = rawFile?.name?.toLowerCase() || ''
  return MODEL_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))
}

const createModelFileHandlers = (fileKey, fileListRef, isVideo = false) => {
  const handleChange = (uploadFile, uploadFiles) => {
    if (isVideo) {
      if (!isVideoFile(uploadFile)) {
        ElMessage.error('请上传 .mp4 / .avi / .mov / .mkv / .webm 格式的视频文件')
        editForm[fileKey] = null
        fileListRef.value = []
        return
      }
    } else {
      if (!isModelUploadFile(uploadFile)) {
        ElMessage.error('请上传 .fbx / .glb / .gltf / .obj / .stl 格式的模型文件')
        editForm[fileKey] = null
        fileListRef.value = []
        return
      }
    }

    editForm[fileKey] = uploadFile.raw
    fileListRef.value = uploadFiles.slice(-1)
  }

  const handleRemove = () => {
    editForm[fileKey] = null
    fileListRef.value = []
  }

  const handleExceed = () => {
    ElMessage.warning(isVideo ? '只能上传一个视频文件，请先移除当前文件' : '只能上传一个模型文件，请先移除当前文件')
  }

  return { handleChange, handleRemove, handleExceed }
}

const geometryModelUpload = createModelFileHandlers(
  'geometryModelFile',
  editGeometryFileList,
)
const realModelUpload = createModelFileHandlers('realModelFile', editRealFileList)

const isPreviewImageFile = (file) => {
  const rawFile = file?.raw || file
  const name = rawFile?.name?.toLowerCase() || ''
  const type = rawFile?.type?.toLowerCase() || ''
  if (PREVIEW_IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true
  return type.startsWith('image/')
}

const createPreviewImageHandlers = (fileKey, fileListRef) => {
  const handleChange = (uploadFile, uploadFiles) => {
    if (!isPreviewImageFile(uploadFile)) {
      ElMessage.error('请上传 .jpg / .jpeg / .png / .webp / .gif 格式的图片')
      editForm[fileKey] = null
      fileListRef.value = []
      return
    }

    editForm[fileKey] = uploadFile.raw
    fileListRef.value = uploadFiles.slice(-1)
  }

  const handleRemove = () => {
    editForm[fileKey] = null
    fileListRef.value = []
  }

  const handleExceed = () => {
    ElMessage.warning('只能上传一张预览图，请先移除当前图片')
  }

  return { handleChange, handleRemove, handleExceed }
}

const previewImageUpload = createPreviewImageHandlers(
  'previewImageFile',
  editPreviewFileList,
)

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.webm']
const isVideoFile = (file) => {
  const rawFile = file?.raw || file
  const name = rawFile?.name?.toLowerCase() || ''
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext))
}

const videoModelUpload = createModelFileHandlers(
  'videoFile',
  editVideoFileList,
  true,
)

const handleDeleteModel = async (model) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除模型“${model.name || model.id}”吗？删除后不可恢复。`,
      '删除模型确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'edit-dialog',
      },
    )
  } catch {
    return
  }

  deletingModelId.value = model.id
  try {
    await modelApi.deleteModel(model.id)
    ElMessage.success('模型删除成功')
    if (isSelected(model.id)) {
      selectedModel.value = null
      emit('select', null)
    }
    fetchModels()
  } catch (error) {
    console.error('删除模型失败:', error)
    ElMessage.error('模型删除失败')
  } finally {
    deletingModelId.value = null
  }
}

// 预览图片
const previewVisible = ref(false)
const previewImage = ref('')

// 模型详情相关
const detailDialogVisible = ref(false)
const activeModelDetail = ref(null)
const loadingDetail = ref(false)

const handlePreviewImage = (image) => {
  if (!image) return
  previewImage.value = image
  previewVisible.value = true
}

// 打开模型详情弹窗
const openDetailDialog = async (model) => {
  detailDialogVisible.value = true
  loadingDetail.value = true
  activeModelDetail.value = null

  try {
    const res = await modelApi.getModelInfo(model.id)
    activeModelDetail.value = unwrapApiModel(res)
    // 模拟视频数据（实际数据应从API获取）
    activeModelDetail.value.video_url = 'https://example.com/videos/model_demo.mp4'
  } catch (error) {
    console.error('获取模型详情失败:', error)
    ElMessage.error('获取模型详情失败')
  } finally {
    loadingDetail.value = false
  }
}

// 安全的数值格式化函数
const safeToFixed = (value, decimals = 2) => {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A'
  }
  return Number(value).toFixed(decimals)
}

// 格式化温度显示（K -> ℃）
const formatTemperature = (kelvin) => {
  if (kelvin === null || kelvin === undefined || isNaN(kelvin)) {
    return 'N/A'
  }
  const celsius = kelvin - 273.15
  return `${celsius.toFixed(2)} ℃ (${kelvin.toFixed(2)} K)`
}

// 格式化压力显示（Pa -> kPa）
const formatPressure = (pa) => {
  if (pa === null || pa === undefined || isNaN(pa)) {
    return 'N/A'
  }
  const kPa = pa / 1000
  return `${kPa.toFixed(3)} kPa (${pa.toFixed(2)} Pa)`
}

// 格式化速度显示
const formatVelocity = (velocity) => {
  if (velocity === null || velocity === undefined) {
    return 'N/A'
  }
  if (Array.isArray(velocity)) {
    const formatted = velocity
      .map((v) =>
        v !== null && v !== undefined && !isNaN(v) ? v.toFixed(2) : '0.00',
      )
      .join(', ')
    return `[${formatted}] m/s`
  }
  return isNaN(velocity) ? 'N/A' : `${velocity.toFixed(2)} m/s`
}

// 提交模型更新
const handleUpdateModel = async () => {
  if (updatingModel.value) return

  updatingModel.value = true
  try {
    const payload = {}

    if (editForm.name.trim()) payload.name = editForm.name.trim()
    if (editForm.category.trim()) payload.building_type = editForm.category.trim()
    if (editForm.survivalSpace.trim()) {
      payload.survival_space = editForm.survivalSpace.trim()
    }
    if (editForm.difficulty.trim()) {
      payload.rescue_difficulty = editForm.difficulty.trim()
    }
    if (editForm.geometryModelFile) {
      payload.geometry_model_file = editForm.geometryModelFile
    }
    if (editForm.realModelFile) {
      payload.real_model_file = editForm.realModelFile
    }
    if (editForm.previewImageFile) {
      payload.preview_image = editForm.previewImageFile
    }
    if (editForm.videoFile) {
      payload.video_file = editForm.videoFile
    }

    if (Object.keys(payload).length === 0) {
      ElMessage.warning('请至少修改一项内容后再提交')
      return
    }

    await modelApi.updateModel(editingModelId.value, payload)
    ElMessage.success('模型信息修改成功')
    editDialogVisible.value = false
    fetchModels()
  } catch (error) {
    console.error('Failed to update model:', error)
    ElMessage.error(error?.message || '模型修改失败')
  } finally {
    updatingModel.value = false
  }
}

onMounted(() => {
  fetchModels()
})

const isSelected = (id) => {
  if (selectedModel.value === null || selectedModel.value === undefined)
    return false
  return String(selectedModel.value) === String(id)
}
</script>

<template>
  <div class="model-grid-container">
    <div class="grid-header model-guide-header">
      <h2>
        <el-icon style="vertical-align: middle; margin-right: 0.5rem"
          ><Grid
        /></el-icon>
        模型选择
      </h2>
      <p>选择倒塌类型模型进行分析</p>
    </div>

    <div class="model-grid" v-loading="loading">
      <el-card
        v-for="(model, index) in models"
        :key="model.id"
        class="model-card"
        :class="{
          selected: isSelected(model.id),
          'model-card--guide-first': index === 0,
          'model-card--simulated': model.isSimulated,
        }"
        shadow="hover"
        @click="selectModel(model)">
        <template #header>
          <div class="card-header">
            <span class="model-name">{{ model.name }}</span>
            <div class="header-actions">
              <el-button
                link
                type="info"
                @click.stop="openDetailDialog(model)"
                class="detail-btn"
                title="查看详情">
                <el-icon><InfoFilled /></el-icon>
              </el-button>
              <el-button
                link
                type="success"
                @click.stop="openModelPreview(model)"
                class="preview-model-btn"
                title="预览模型">
                <el-icon><View /></el-icon>
              </el-button>
              <template v-if="!model.isSimulated">
                <el-button
                  link
                  type="primary"
                  @click.stop="openEditDialog(model)"
                  class="edit-btn"
                  title="编辑信息">
                  <el-icon><Edit /></el-icon>
                </el-button>
                <el-button
                  link
                  type="danger"
                  :loading="deletingModelId === model.id"
                  :disabled="deletingModelId !== null"
                  @click.stop="handleDeleteModel(model)"
                  class="delete-btn"
                  title="删除模型">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </template>
              <el-tag
                v-if="selectedModel === model.id"
                type="success"
                size="small">
                <el-icon style="vertical-align: middle"><Check /></el-icon>
                已选择
              </el-tag>
            </div>
          </div>
        </template>

        <div class="model-preview">
          <div class="preview-circle">
            <!-- <el-icon class="preview-icon"><Box /></el-icon> -->
            <el-image :src="model.image" class="preview-image" fit="cover" />
            <div
              class="preview-overlay"
              @click.stop="handlePreviewImage(model.image)">
              <el-icon><View /></el-icon>
            </div>
          </div>
        </div>

        <el-descriptions :column="1" size="small" class="model-info">
          <el-descriptions-item label="类别">
            <el-tag size="small" type="info">{{ model.category }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="存活空间">
            <span class="info-text">{{ model.survivalSpace }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="搜救难点">
            <el-text type="warning" size="small">{{
              model.difficulty
            }}</el-text>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </div>

    <!-- Start Task Button -->
    <transition name="fade">
      <div v-if="selectedModel" class="create-task-btn-container">
        <el-button type="primary" class="create-task-btn" @click="createTask">
          开始任务
          <el-icon class="el-icon--right"><ArrowRight /></el-icon>
        </el-button>
      </div>
    </transition>

    <!-- 编辑模型对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      title="修改模型信息"
      width="500px"
      append-to-body
      class="edit-dialog">
      <el-form
        ref="editFormRef"
        :model="editForm"
        label-width="6.25rem"
        label-position="left">
        <el-form-item label="模型名称">
          <el-input v-model="editForm.name" placeholder="可选，留空则不修改" />
        </el-form-item>
        <el-form-item label="建筑类别">
          <el-input v-model="editForm.category" placeholder="可选，留空则不修改" />
        </el-form-item>
        <el-form-item label="存活空间">
          <el-input
            v-model="editForm.survivalSpace"
            placeholder="可选，留空则不修改" />
        </el-form-item>
        <el-form-item label="搜救难点">
          <el-input
            v-model="editForm.difficulty"
            placeholder="可选，留空则不修改" />
        </el-form-item>
        <el-form-item label="预览图">
          <div class="preview-image-upload-wrap">
            <div
              v-if="editCurrentPreviewUrl && !editPreviewFileList.length"
              class="edit-current-preview">
              <el-image
                :src="editCurrentPreviewUrl"
                class="edit-current-preview-image"
                fit="cover" />
              <span class="edit-current-preview-label">当前预览图</span>
            </div>
            <el-upload
              class="glb-upload preview-image-upload"
              action="#"
              :accept="PREVIEW_IMAGE_ACCEPT"
              :auto-upload="false"
              :limit="1"
              list-type="picture"
              :file-list="editPreviewFileList"
              :on-change="previewImageUpload.handleChange"
              :on-remove="previewImageUpload.handleRemove"
              :on-exceed="previewImageUpload.handleExceed">
              <el-button type="primary" plain>选择预览图</el-button>
              <template #tip>
                <div class="el-upload__tip">
                  可选，支持 .jpg / .jpeg / .png / .webp / .gif
                </div>
              </template>
            </el-upload>
          </div>
        </el-form-item>
        <el-form-item label="几何模型">
          <el-upload
            class="model-file-upload"
            action="#"
            :accept="MODEL_FILE_ACCEPT"
            :auto-upload="false"
            :limit="1"
            :file-list="editGeometryFileList"
            :on-change="geometryModelUpload.handleChange"
            :on-remove="geometryModelUpload.handleRemove"
            :on-exceed="geometryModelUpload.handleExceed">
            <el-button type="primary" plain>选择几何模型</el-button>
            <template #tip>
              <div class="el-upload__tip">
                可选，支持 .fbx / .glb / .gltf / .obj / .stl
              </div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="真实模型">
          <el-upload
            class="model-file-upload"
            action="#"
            :accept="MODEL_FILE_ACCEPT"
            :auto-upload="false"
            :limit="1"
            :file-list="editRealFileList"
            :on-change="realModelUpload.handleChange"
            :on-remove="realModelUpload.handleRemove"
            :on-exceed="realModelUpload.handleExceed">
            <el-button type="primary" plain>选择真实模型</el-button>
            <template #tip>
              <div class="el-upload__tip">
                可选，支持 .fbx / .glb / .gltf / .obj / .stl
              </div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="视频">
          <el-upload
            class="model-file-upload"
            action="#"
            accept=".mp4,.avi,.mov,.mkv,.webm"
            :auto-upload="false"
            :limit="1"
            :file-list="editVideoFileList"
            :on-change="videoModelUpload.handleChange"
            :on-remove="videoModelUpload.handleRemove"
            :on-exceed="videoModelUpload.handleExceed">
            <el-button type="primary" plain>选择视频</el-button>
            <template #tip>
              <div class="el-upload__tip">
                可选，支持 .mp4 / .avi / .mov / .mkv / .webm
              </div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="editDialogVisible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="updatingModel"
            @click="handleUpdateModel">
            确定
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 图片预览弹窗 -->
    <el-image-viewer
      v-if="previewVisible"
      :url-list="[previewImage]"
      @close="previewVisible = false" />

    <!-- 模型详情弹窗 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="模型详情"
      width="700px"
      append-to-body
      class="detail-dialog">
      <div
        v-loading="loadingDetail"
        element-loading-background="rgba(0, 0, 0, 0.7)"
        style="min-height: 200px">
        <div v-if="activeModelDetail" class="detail-content">
          <!-- 基本信息 -->
          <div class="detail-section">
            <div class="section-title">
              <el-icon><Box /></el-icon>
              基本信息
            </div>
            <div class="info-grid">
              <div class="info-item">
                <span class="label">模型ID</span>
                <span class="value mono">{{ activeModelDetail.id }}</span>
              </div>
              <div class="info-item">
                <span class="label">模型名称</span>
                <span class="value highlight">{{
                  activeModelDetail.name || '未命名'
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">建筑类别</span>
                <el-tag size="small" type="info">{{
                  activeModelDetail.building_type || 'N/A'
                }}</el-tag>
              </div>
              <div class="info-item">
                <span class="label">存活空间</span>
                <span class="value">{{
                  activeModelDetail.survival_space || 'N/A'
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">搜救难点</span>
                <span class="value">{{
                  activeModelDetail.rescue_difficulty || 'N/A'
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">几何模型</span>
                <span class="value mono">{{
                  activeModelDetail.geometry_model_url ||
                  activeModelDetail.geometry_model_file ||
                  '未上传'
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">真实模型</span>
                <span class="value mono">{{
                  activeModelDetail.real_model_url ||
                  activeModelDetail.real_model_file ||
                  '未上传'
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">视频</span>
                <div class="value mono">
                  <div v-if="activeModelDetail.video_url" style="margin-bottom: 8px;">
                    <video controls width="100%" style="max-height: 200px;">
                      <source :src="activeModelDetail.video_url" type="video/mp4">
                      浏览器不支持视频播放
                    </video>
                  </div>
                  <div v-else style="margin-bottom: 8px; color: #909399;">未上传</div>
                  <el-upload
                    class="video-upload"
                    action="#"
                    accept=".mp4,.avi,.mov,.mkv,.webm"
                    :auto-upload="false"
                    :limit="1"
                    :show-file-list="false"
                    :on-change="handleVideoUpload">
                    <el-button type="primary" plain>选择视频</el-button>
                    <template #tip>
                      <div class="el-upload__tip">可选，支持 .mp4 / .avi / .mov / .mkv / .webm</div>
                    </template>
                  </el-upload>
                </div>
              </div>
              <div class="info-item">
                <span class="label">分析状态</span>
                <el-tag
                  size="small"
                  :type="activeModelDetail.is_analyzed ? 'success' : 'warning'">
                  {{ activeModelDetail.is_analyzed ? '已分析' : '未分析' }}
                </el-tag>
              </div>
              <div class="info-item">
                <span class="label">操作</span>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :loading="analyzeLoading"
                  :disabled="analyzeLoading"
                  class="analyze-btn"
                  @click="handleAnalyze(activeModelDetail.id)">
                  {{ analyzeLoading ? '分析中…' : '手动触发分析' }}
                </el-button>
              </div>
              <div class="info-item">
                <span class="label">创建时间</span>
                <span class="value">{{
                  new Date(activeModelDetail.created_at).toLocaleString()
                }}</span>
              </div>
              <div class="info-item">
                <span class="label">更新时间</span>
                <span class="value">{{
                  new Date(activeModelDetail.updated_at).toLocaleString()
                }}</span>
              </div>
            </div>
          </div>

          <!-- 物种顺序 -->
          <div
            v-if="
              activeModelDetail.species_order && activeModelDetail.species_order.length > 0
            "
            class="detail-section">
            <div class="section-title">
              <el-icon><List /></el-icon>
              气体种类
            </div>
            <div class="species-list">
              <el-tag
                v-for="(species, index) in activeModelDetail.species_order"
                :key="index"
                size="small"
                type="info"
                style="margin: 0.25rem">
                {{ species }}
              </el-tag>
            </div>
          </div>

          <!-- 环境参数预设 -->
          <div v-if="activeModelDetail.params" class="detail-section">
            <div class="section-title">
              <el-icon><Setting /></el-icon>
              环境参数预设
            </div>
            <div class="info-grid">
              <div
                class="info-item"
                v-if="
                  activeModelDetail.params.operating_temperature !== undefined &&
                  activeModelDetail.params.operating_temperature !== null
                ">
                <span class="label">工作温度</span>
                <span class="value">
                  {{
                    formatTemperature(activeModelDetail.params.operating_temperature)
                  }}
                </span>
              </div>
              <div
                class="info-item"
                v-if="
                  activeModelDetail.params.operating_pressure !== undefined &&
                  activeModelDetail.params.operating_pressure !== null
                ">
                <span class="label">工作压力</span>
                <span class="value">
                  {{ formatPressure(activeModelDetail.params.operating_pressure) }}
                </span>
              </div>
            </div>
          </div>

          <!-- 物理模型配置 -->
          <div v-if="activeModelDetail.params" class="detail-section">
            <div class="section-title">
              <el-icon><Setting /></el-icon>
              物理模型配置
            </div>
            <div class="info-grid">
              <div
                class="info-item"
                v-if="activeModelDetail.params.gravity_enabled !== undefined">
                <span class="label">重力</span>
                <el-tag
                  size="small"
                  :type="
                    activeModelDetail.params.gravity_enabled ? 'success' : 'info'
                  ">
                  {{ activeModelDetail.params.gravity_enabled ? '启用' : '禁用' }}
                </el-tag>
              </div>
              <div
                class="info-item"
                v-if="
                  activeModelDetail.params.gravity_vector &&
                  activeModelDetail.params.gravity_vector.length > 0
                ">
                <span class="label">重力矢量</span>
                <span class="value mono"
                  >[{{ activeModelDetail.params.gravity_vector.join(', ') }}]</span
                >
              </div>
              <div
                class="info-item"
                v-if="activeModelDetail.params.energy_enabled !== undefined">
                <span class="label">能量方程</span>
                <el-tag
                  size="small"
                  :type="
                    activeModelDetail.params.energy_enabled ? 'success' : 'info'
                  ">
                  {{ activeModelDetail.params.energy_enabled ? '启用' : '禁用' }}
                </el-tag>
              </div>
              <div class="info-item" v-if="activeModelDetail.params.viscous_model">
                <span class="label">粘性模型</span>
                <span class="value">{{
                  activeModelDetail.params.viscous_model
                }}</span>
              </div>
            </div>
          </div>

        </div>

        <div v-else-if="!loadingDetail" class="empty-detail">暂无详情数据</div>
      </div>
    </el-dialog>
  </div>
</template>
<!-- <el-dialog
      v-model="createTaskDialogVisible"
      title="创建任务"
      width="500px"
      append-to-body
      class="edit-dialog">
      <el-form
        ref="createTaskFormRef"
        :model="createTaskForm"
        label-width="6.25rem"
        @submit.prevent>
        <el-form-item
          label="任务名称"
          prop="name"
          :rules="[{ required: true, message: '请输入任务名称', trigger: 'blur' }]">
          <el-input
            v-model="createTaskForm.name"
            placeholder="请输入任务名称"
            @keyup.enter="confirmCreateTask" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="createTaskDialogVisible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="creatingTask"
            @click="confirmCreateTask">
            确定
          </el-button>
        </div>
      </template>
    </el-dialog> -->

<style scoped src="@/assets/styles/components/ModelGrid.css"></style>
<style src="@/assets/styles/components/ModelGridDialogs.css"></style>

