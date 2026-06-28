<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Plus,
  Edit,
  Delete,
  Refresh,
  Check,
  Close,
  ArrowLeft,
} from '@element-plus/icons-vue'
import ribbonApi from '@/api/ribbon.js'
import {
  DEFAULT_COLOR_MAP_PAGE_SIZE,
  getColorMapPageItems,
  getColorMapTotal,
} from '@/utils/colorMapPagination.js'
import { colorsToLinearGradient } from '@/utils/volumeColormap.js'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue', 'color-maps-updated'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const activeTab = ref('list') // 'list' 或 'form'
const colorMaps = ref([])
const loading = ref(false)
const formLoading = ref(false)

// 分页相关
const currentPage = ref(1)
const total = ref(0)
const displayedColorMaps = computed(() =>
  getColorMapPageItems(colorMaps.value, currentPage.value),
)

const form = ref({
  name: '',
  colors: ['#000000', '#ffffff'],
  description: '',
})

const editingColorMap = ref(null)
const dialogTitle = computed(() =>
  editingColorMap.value ? '编辑色带' : '创建色带',
)

const fetchColorMaps = async () => {
  loading.value = true
  try {
    const response = await ribbonApi.getRibbons({
      page: currentPage.value,
      page_size: DEFAULT_COLOR_MAP_PAGE_SIZE,
    })
    colorMaps.value = response.data?.items || response.items || []
    total.value = getColorMapTotal(response, colorMaps.value.length)
  } catch (e) {
    console.error('获取色带列表失败:', e)
    ElMessage.error('获取色带列表失败')
    colorMaps.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  editingColorMap.value = null
  form.value = {
    name: '',
    colors: ['#000000', '#ffffff'],
    description: '',
  }
  activeTab.value = 'form'
}

const openEditDialog = (colorMap) => {
  editingColorMap.value = colorMap
  form.value = {
    name: colorMap.name || '',
    colors: colorMap.colors || ['#000000', '#ffffff'],
    description: colorMap.description || '',
  }
  activeTab.value = 'form'
}

const backToList = () => {
  activeTab.value = 'list'
  editingColorMap.value = null
}

// 分页处理
const handleCurrentChange = (val) => {
  currentPage.value = val
  fetchColorMaps()
}

const deleteColorMap = async (colorMap) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除色带「${colorMap.name || colorMap.id}」吗？`,
      '删除色带',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )

    await ribbonApi.deleteRibbon(colorMap.id)
    ElMessage.success('删除色带成功')
    await fetchColorMaps()
    emit('color-maps-updated')
  } catch (e) {
    if (e !== 'cancel') {
      console.error('删除色带失败:', e)
      ElMessage.error('删除色带失败')
    }
  }
}

const saveColorMap = async () => {
  if (!form.value.name) {
    ElMessage.warning('请输入色带名称')
    return
  }

  formLoading.value = true
  try {
    if (editingColorMap.value) {
      await ribbonApi.updateRibbon(editingColorMap.value.id, {
        name: form.value.name,
        colors: form.value.colors,
        description: form.value.description,
      })
      ElMessage.success('更新色带成功')
    } else {
      await ribbonApi.createRibbon({
        name: form.value.name,
        colors: form.value.colors,
        description: form.value.description,
      })
      ElMessage.success('创建色带成功')
    }

    await fetchColorMaps()
    emit('color-maps-updated')
    activeTab.value = 'list'
    editingColorMap.value = null
  } catch (e) {
    console.error('保存色带失败:', e)
    ElMessage.error('保存色带失败')
  } finally {
    formLoading.value = false
  }
}

const addColor = () => {
  form.value.colors.push('#ffffff')
}

const removeColor = (index) => {
  if (form.value.colors.length > 2) {
    form.value.colors.splice(index, 1)
  } else {
    ElMessage.warning('色带至少需要2个颜色')
  }
}

const getGradientStyle = (colors) => {
  return {
    background: colorsToLinearGradient(colors),
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      fetchColorMaps()
      activeTab.value = 'list'
    }
  },
)
</script>

<template>
  <el-dialog
    v-model="visible"
    width="min(56rem, 96vw)"
    append-to-body
    destroy-on-close
    align-center
    class="worker-dialog color-map-manager-dialog">
    <template #header>
      <div class="cmm-dialog-title">
        <el-icon><Plus /></el-icon>
        <span>色带管理</span>
      </div>
    </template>

    <!-- 标签页 -->
    <div class="cmm-tabs">
      <!-- 色带列表页 -->
      <div v-if="activeTab === 'list'">
        <div v-if="loading" class="cmm-loading">
          <el-icon class="is-loading"><Refresh /></el-icon>
          <span>加载色带列表…</span>
        </div>
        <div v-else-if="colorMaps.length === 0" class="cmm-empty">
          <span>暂无色带数据</span>
          <el-button type="primary" size="small" @click="openCreateDialog">
            <el-icon><Plus /></el-icon>
            <span>创建色带</span>
          </el-button>
        </div>
        <div v-else class="cmm-list">
          <div class="cmm-header">
            <h4>色带列表</h4>
            <el-button type="primary" size="small" @click="openCreateDialog">
              <el-icon><Plus /></el-icon>
              <span>创建色带</span>
            </el-button>
          </div>
          <div class="cmm-grid">
            <div
              v-for="colorMap in displayedColorMaps"
              :key="colorMap.id"
              class="cmm-item">
              <div class="cmm-item-header">
                <h5>{{ colorMap.name }}</h5>
                <div class="cmm-item-actions">
                  <el-button
                    type="primary"
                    size="small"
                    circle
                    @click="openEditDialog(colorMap)"
                    title="编辑">
                    <el-icon><Edit /></el-icon>
                  </el-button>
                  <el-button
                    type="danger"
                    size="small"
                    circle
                    @click="deleteColorMap(colorMap)"
                    title="删除">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
              </div>
              <div
                class="cmm-item-gradient"
                :style="
                  getGradientStyle(colorMap.colors || ['#000000', '#ffffff'])
                "></div>
              <div v-if="colorMap.description" class="cmm-item-description">
                {{ colorMap.description }}
              </div>
              <div class="cmm-item-meta">
                <span class="cmm-item-colors">
                  颜色: {{ (colorMap.colors || []).length }} 个
                </span>
                <span class="cmm-item-id"> ID: {{ colorMap.id }} </span>
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="!loading && colorMaps.length > 0"
          class="pagination-container">
          <el-pagination
            v-model:current-page="currentPage"
            :page-size="DEFAULT_COLOR_MAP_PAGE_SIZE"
            layout="prev, pager, next"
            :total="total"
            small
            background
            @current-change="handleCurrentChange" />
        </div>
      </div>

      <!-- 色带表单页 -->
      <div v-if="activeTab === 'form'">
        <div class="cmm-form-header">
          <el-button
            type="info"
            size="small"
            @click="backToList"
            class="cmm-back-btn">
            <el-icon><ArrowLeft /></el-icon>
            <span>返回列表</span>
          </el-button>
          <h4>{{ dialogTitle }}</h4>
        </div>
        <div class="cmm-form">
          <el-form label-position="top">
            <el-form-item label="色带名称">
              <el-input
                v-model="form.name"
                placeholder="请输入色带名称"
                :disabled="formLoading" />
            </el-form-item>

            <el-form-item label="颜色列表">
              <div class="cmm-colors-list">
                <div
                  v-for="(color, index) in form.colors"
                  :key="index"
                  class="cmm-color-item">
                  <input
                    type="color"
                    v-model="form.colors[index]"
                    class="cmm-color-input"
                    :disabled="formLoading" />
                  <span class="cmm-color-value">{{ color }}</span>
                  <el-button
                    v-if="form.colors.length > 2"
                    type="danger"
                    size="small"
                    circle
                    @click="removeColor(index)"
                    :disabled="formLoading"
                    title="删除颜色">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
                <el-button
                  type="primary"
                  size="small"
                  @click="addColor"
                  :disabled="formLoading"
                  class="cmm-add-color-btn">
                  <el-icon><Plus /></el-icon>
                  <span>添加颜色</span>
                </el-button>
              </div>
            </el-form-item>

            <el-form-item label="描述">
              <el-input
                v-model="form.description"
                type="textarea"
                rows="3"
                placeholder="请输入色带描述"
                :disabled="formLoading" />
            </el-form-item>
          </el-form>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button
        v-if="activeTab === 'form'"
        @click="backToList"
        :disabled="formLoading">
        <el-icon><Close /></el-icon>
        <span>取消</span>
      </el-button>
      <el-button
        v-if="activeTab === 'form'"
        type="primary"
        @click="saveColorMap"
        :loading="formLoading">
        <el-icon><Check /></el-icon>
        <span>保存</span>
      </el-button>
      <el-button v-else type="primary" @click="visible = false">
        关闭
      </el-button>
    </template>
  </el-dialog>
</template>

<style>
.cmm-dialog-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-card-title);
  font-weight: 600;
  color: var(--primary-light, #e8fcff);
}

.cmm-dialog-title .el-icon {
  color: var(--primary-color, #49d1e0);
  font-size: var(--font-xl);
}

.cmm-loading,
.cmm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem 1rem;
  color: rgba(226, 247, 255, 0.65);
  font-size: var(--text-body);
}

.cmm-list {
  max-height: min(72vh, 46rem);
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.35rem;
}

.cmm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(0, 243, 255, 0.12);
}

.cmm-form-header {
  display: flex;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(0, 243, 255, 0.12);
  gap: 1rem;
}

.cmm-back-btn {
  flex-shrink: 0;
}

.cmm-form-header h4 {
  margin: 0;
  font-size: var(--text-card-title);
  font-weight: 600;
  color: rgba(232, 248, 255, 0.92);
  flex: 1;
}

.cmm-header h4 {
  margin: 0;
  font-size: var(--text-card-title);
  font-weight: 600;
  color: rgba(232, 248, 255, 0.92);
  flex: 1;
}

.cmm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.cmm-item {
  background: rgba(10, 18, 34, 0.6);
  border: 1px solid rgba(0, 243, 255, 0.15);
  border-radius: 0.5rem;
  padding: 1rem;
  transition: all 0.3s ease;
}

.cmm-item:hover {
  border-color: rgba(0, 243, 255, 0.3);
  box-shadow: 0 0 15px rgba(0, 243, 255, 0.1);
}

.cmm-item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}

.cmm-item-header h5 {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 600;
  color: rgba(232, 248, 255, 0.92);
  flex: 1;
}

.cmm-item-actions {
  display: flex;
  gap: 0.5rem;
}

.cmm-item-gradient {
  height: 2rem;
  border-radius: 0.25rem;
  margin-bottom: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.cmm-item-description {
  font-size: var(--text-caption);
  color: rgba(226, 247, 255, 0.65);
  margin-bottom: 0.75rem;
  line-height: var(--leading-normal);
}

.cmm-item-meta {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-caption);
  color: rgba(226, 247, 255, 0.5);
}

.cmm-form {
  padding: 0.5rem 0;
}

.cmm-colors-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cmm-color-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cmm-color-input {
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid rgba(0, 243, 255, 0.35);
  border-radius: 0.25rem;
  background: transparent;
  cursor: pointer;
}

.cmm-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.cmm-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}

.cmm-color-value {
  flex: 1;
  font-size: var(--text-caption);
  color: rgba(226, 247, 255, 0.8);
}

.cmm-add-color-btn {
  align-self: flex-start;
  margin-top: 0.25rem;
}

.color-map-manager-dialog :deep(.el-input__wrapper) {
  background: rgba(10, 18, 34, 0.8) !important;
  border-color: rgba(0, 243, 255, 0.2) !important;
}

.color-map-manager-dialog :deep(.el-input__inner) {
  color: rgba(232, 248, 255, 0.92) !important;
}

.color-map-manager-dialog :deep(.el-input__inner::placeholder) {
  color: rgba(226, 247, 255, 0.42) !important;
}

.color-map-manager-dialog :deep(.el-textarea__inner) {
  background: rgba(10, 18, 34, 0.8) !important;
  border-color: rgba(0, 243, 255, 0.2) !important;
  color: rgba(232, 248, 255, 0.92) !important;
  resize: vertical;
}

.color-map-manager-dialog :deep(.el-textarea__inner::placeholder) {
  color: rgba(226, 247, 255, 0.42) !important;
}

/* 表单样式优化 */
.cmm-form {
  padding: 0.5rem 0;
}

.cmm-form :deep(.el-form-item) {
  margin-bottom: 1.5rem;
}

.cmm-form :deep(.el-form-item__label) {
  color: rgba(232, 248, 255, 0.92) !important;
  font-weight: 600;
  margin-bottom: 0.5rem;
  font-size: var(--text-body);
}

.cmm-form :deep(.el-input__wrapper) {
  background: rgba(10, 18, 34, 0.8) !important;
  border-color: rgba(0, 243, 255, 0.2) !important;
  border-radius: 0.375rem !important;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3) !important;
  transition: all 0.3s ease !important;
}

.cmm-form :deep(.el-input__wrapper:hover) {
  border-color: rgba(0, 243, 255, 0.4) !important;
  background: rgba(14, 24, 44, 0.9) !important;
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.3),
    0 0 10px rgba(0, 243, 255, 0.1) !important;
}

.cmm-form :deep(.el-input__wrapper.is-focus) {
  border-color: rgba(0, 243, 255, 0.55) !important;
  box-shadow:
    0 0 0 3px rgba(0, 243, 255, 0.15),
    inset 0 1px 3px rgba(0, 0, 0, 0.3) !important;
  background: rgba(18, 32, 52, 0.95) !important;
}

.cmm-form :deep(.el-input__inner) {
  color: rgba(232, 248, 255, 0.92) !important;
  font-size: var(--text-body) !important;
  font-weight: 500 !important;
}

.cmm-form :deep(.el-textarea__inner) {
  background: rgba(10, 18, 34, 0.8) !important;
  border-color: rgba(0, 243, 255, 0.2) !important;
  color: rgba(232, 248, 255, 0.92) !important;
  resize: vertical;
  border-radius: 0.375rem !important;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3) !important;
  font-size: var(--text-body) !important;
  line-height: var(--leading-normal) !important;
}

.cmm-form :deep(.el-textarea__inner:hover) {
  border-color: rgba(0, 243, 255, 0.4) !important;
  background: rgba(14, 24, 44, 0.9) !important;
}

.cmm-form :deep(.el-textarea__inner:focus) {
  border-color: rgba(0, 243, 255, 0.55) !important;
  box-shadow:
    0 0 0 3px rgba(0, 243, 255, 0.15),
    inset 0 1px 3px rgba(0, 0, 0, 0.3) !important;
  background: rgba(18, 32, 52, 0.95) !important;
}

/* 颜色选择器样式 */
.cmm-color-input {
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: 2px solid rgba(0, 243, 255, 0.35);
  border-radius: 0.5rem;
  background: transparent;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.2);
}

.cmm-color-input:hover {
  border-color: rgba(0, 243, 255, 0.6);
  box-shadow: 0 0 15px rgba(0, 243, 255, 0.3);
  transform: scale(1.05);
}

.cmm-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
  border-radius: 0.375rem;
}

.cmm-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 0.375rem;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
}

/* 颜色项样式 */
.cmm-color-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: rgba(10, 18, 34, 0.6);
  border: 1px solid rgba(0, 243, 255, 0.15);
  border-radius: 0.5rem;
  transition: all 0.3s ease;
}

.cmm-color-item:hover {
  background: rgba(14, 24, 44, 0.8);
  border-color: rgba(0, 243, 255, 0.3);
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.15);
}

.cmm-color-value {
  flex: 1;
  font-size: var(--text-body);
  font-weight: 500;
  color: rgba(232, 248, 255, 0.92);
  font-family: 'Courier New', monospace;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.cmm-add-color-btn {
  align-self: flex-start;
  margin-top: 0.5rem;
  background: linear-gradient(
    135deg,
    rgba(0, 243, 255, 0.2),
    rgba(0, 212, 255, 0.1)
  );
  border: 1px solid rgba(0, 243, 255, 0.3);
  color: rgba(0, 243, 255, 0.9);
  font-weight: 600;
  transition: all 0.3s ease;
}

.cmm-add-color-btn:hover {
  background: linear-gradient(
    135deg,
    rgba(0, 243, 255, 0.3),
    rgba(0, 212, 255, 0.2)
  );
  border-color: rgba(0, 243, 255, 0.5);
  box-shadow: 0 0 15px rgba(0, 243, 255, 0.3);
  transform: translateY(-1px);
}

/* 按钮样式优化 */
.cmm-back-btn {
  flex-shrink: 0;
  background: rgba(10, 18, 34, 0.8) !important;
  border: 1px solid rgba(0, 243, 255, 0.3) !important;
  color: rgba(0, 243, 255, 0.9) !important;
  transition: all 0.3s ease !important;
}

.cmm-back-btn:hover {
  background: rgba(14, 24, 44, 0.9) !important;
  border-color: rgba(0, 243, 255, 0.5) !important;
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.2) !important;
}

/* 分页组件样式 */
.pagination-container {
  margin-top: 1rem;
  display: flex;
  justify-content: center;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

/* 分页组件样式优化 - 深色主题 */
:deep(.el-pagination) {
  --el-pagination-bg-color: transparent;
  --el-pagination-text-color: var(--text-secondary);
  --el-pagination-button-color: var(--text-secondary);
  --el-pagination-button-bg-color: rgba(255, 255, 255, 0.05);
  --el-pagination-button-disabled-bg-color: transparent;
  --el-pagination-hover-color: var(--primary-color);
}

:deep(.el-pagination.is-background .el-pager li:not(.is-disabled).is-active) {
  background-color: var(--primary-color);
  color: #000;
  font-weight: bold;
  border-color: var(--primary-color);
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.5);
}

:deep(.el-pagination.is-background .el-pager li) {
  background-color: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  min-width: 2rem;
  border-radius: 0.25rem;
  margin: 0 0.125rem;
  font-family: var(--font-family-mono);
  transition: all 0.3s;
}

:deep(.el-pagination.is-background .el-pager li:not(.is-disabled):hover) {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background-color: rgba(0, 243, 255, 0.1);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 243, 255, 0.2);
}

:deep(.el-pagination.is-background .btn-prev),
:deep(.el-pagination.is-background .btn-next) {
  background-color: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  border-radius: 0.25rem;
  margin: 0 0.125rem;
  transition: all 0.3s;
}

:deep(.el-pagination.is-background .btn-prev:disabled),
:deep(.el-pagination.is-background .btn-next:disabled) {
  background-color: transparent;
  color: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.05);
}

:deep(.el-pagination.is-background .btn-prev:not(:disabled):hover),
:deep(.el-pagination.is-background .btn-next:not(:disabled):hover) {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background-color: rgba(0, 243, 255, 0.1);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 243, 255, 0.2);
}

/* 对话框底部按钮样式 */
.color-map-manager-dialog :deep(.el-dialog__footer) {
  padding: 1.5rem;
  border-top: 1px solid rgba(0, 243, 255, 0.12);
  background: rgba(10, 18, 34, 0.8);
}

.color-map-manager-dialog :deep(.el-button) {
  transition: all 0.3s ease;
  border-radius: 0.375rem;
  font-weight: 600;
  padding: 0.5rem 1.5rem;
}

.color-map-manager-dialog :deep(.el-button--primary) {
  background: linear-gradient(
    135deg,
    rgba(0, 243, 255, 0.2),
    rgba(0, 212, 255, 0.1)
  );
  border: 1px solid rgba(0, 243, 255, 0.3);
  color: rgba(0, 243, 255, 0.9);
}

.color-map-manager-dialog :deep(.el-button--primary:hover) {
  background: linear-gradient(
    135deg,
    rgba(0, 243, 255, 0.3),
    rgba(0, 212, 255, 0.2)
  );
  border-color: rgba(0, 243, 255, 0.5);
  box-shadow: 0 0 15px rgba(0, 243, 255, 0.3);
  transform: translateY(-1px);
}

.color-map-manager-dialog :deep(.el-button:not(.el-button--primary)) {
  background: rgba(10, 18, 34, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(232, 248, 255, 0.9);
}

.color-map-manager-dialog :deep(.el-button:not(.el-button--primary):hover) {
  background: rgba(14, 24, 44, 0.9);
  border-color: rgba(255, 255, 255, 0.3);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.15);
}

/* Element Plus 弹窗 append-to-body 后，使用真实 DOM 选择器兜底覆盖输入框 */
.color-map-manager-dialog .cmm-form .el-input__wrapper,
.color-map-manager-dialog .cmm-form .el-textarea__inner {
  background:
    linear-gradient(180deg, rgba(15, 27, 45, 0.96) 0%, rgba(8, 16, 30, 0.96) 100%)
    !important;
  border: 1px solid rgba(0, 243, 255, 0.28) !important;
  border-radius: 0.45rem !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 0 0 1px rgba(0, 243, 255, 0.08) !important;
  color: rgba(232, 248, 255, 0.94) !important;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.color-map-manager-dialog .cmm-form .el-input__wrapper {
  min-height: 2.75rem;
  padding: 0 0.9rem;
}

.color-map-manager-dialog .cmm-form .el-textarea__inner {
  min-height: 6rem !important;
  padding: 0.75rem 0.9rem !important;
  resize: vertical;
}

.color-map-manager-dialog .cmm-form .el-input__wrapper:hover,
.color-map-manager-dialog .cmm-form .el-textarea__inner:hover {
  background:
    linear-gradient(180deg, rgba(18, 32, 52, 0.98) 0%, rgba(10, 20, 36, 0.98) 100%)
    !important;
  border-color: rgba(0, 243, 255, 0.48) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 0 0 1px rgba(0, 243, 255, 0.16),
    0 0 14px rgba(0, 243, 255, 0.14) !important;
}

.color-map-manager-dialog .cmm-form .el-input__wrapper.is-focus,
.color-map-manager-dialog .cmm-form .el-textarea__inner:focus {
  border-color: rgba(0, 243, 255, 0.72) !important;
  box-shadow:
    0 0 0 1px rgba(0, 243, 255, 0.42),
    0 0 18px rgba(0, 243, 255, 0.22) !important;
}

.color-map-manager-dialog .cmm-form .el-input__inner,
.color-map-manager-dialog .cmm-form .el-textarea__inner {
  color: rgba(232, 248, 255, 0.94) !important;
  caret-color: var(--primary-color);
}

.color-map-manager-dialog .cmm-form .el-input__inner::placeholder,
.color-map-manager-dialog .cmm-form .el-textarea__inner::placeholder {
  color: rgba(226, 247, 255, 0.38) !important;
}

.color-map-manager-dialog .cmm-color-value {
  min-height: 2.5rem;
  display: flex;
  align-items: center;
  padding: 0 0.85rem;
  background: rgba(5, 12, 24, 0.74);
  border: 1px solid rgba(0, 243, 255, 0.18);
  border-radius: 0.4rem;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
</style>
