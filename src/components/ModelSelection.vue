<script setup>
import { ref } from 'vue'

const models = ref([
  { id: 1, name: '地下洞穴系统', description: '模拟地下洞穴环境的三维模型', thumbnail: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=underground%20cave%20system%203D%20model%20scientific%20visualization&image_size=square' },
  { id: 2, name: '掩埋建筑遗址', description: '模拟掩埋建筑遗址的三维模型', thumbnail: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=buried%20building%20ruins%203D%20model%20archaeological&image_size=square' },
  { id: 3, name: '地下管道网络', description: '模拟地下管道网络的三维模型', thumbnail: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=underground%20pipeline%20network%203D%20model%20technical&image_size=square' },
  { id: 4, name: '矿道系统', description: '模拟矿道系统的三维模型', thumbnail: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=mine%20tunnel%20system%203D%20model%20industrial&image_size=square' }
])

const selectedModel = ref(null)

const selectModel = (model) => {
  selectedModel.value = model
}
</script>

<template>
  <div class="model-selection">
    <h3>模型库</h3>
    <div class="model-list">
      <el-card 
        v-for="model in models" 
        :key="model.id"
        :class="{ 'selected': selectedModel?.id === model.id }"
        @click="selectModel(model)"
        class="model-card"
      >
        <template #header>
          <div class="model-header">
            <span>{{ model.name }}</span>
            <el-button 
              size="small" 
              type="primary" 
              :disabled="!selectedModel || selectedModel.id !== model.id"
            >
              加载模型
            </el-button>
          </div>
        </template>
        <div class="model-content">
          <img :src="model.thumbnail" :alt="model.name" class="model-thumbnail" />
          <p class="model-description">{{ model.description }}</p>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.model-selection {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.model-selection h3 {
  margin-bottom: 20px;
  color: #3b82f6;
  font-size: var(--text-card-title);
  font-weight: 600;
}

.model-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.model-card {
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid #334155;
  background-color: #0f172a;
  color: #e2e8f0;
}

.model-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
  border-color: #3b82f6;
}

.model-card.selected {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.model-content {
  margin-top: 10px;
}

.model-thumbnail {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 4px;
  margin-bottom: 10px;
}

.model-description {
  font-size: var(--text-caption);
  color: #94a3b8;
  margin: 0;
  line-height: var(--leading-normal);
}
</style>
