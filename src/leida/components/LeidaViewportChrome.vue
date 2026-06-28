<script setup>
import { ref, watch } from 'vue'
import { Box, Grid, Operation, SwitchButton, Tools } from '@element-plus/icons-vue'

const props = defineProps({
  /** 为 false 时仅保留 slot 容器，不渲染色条/工具栏（避免切换模块时重建 Three 画布） */
  showChrome: { type: Boolean, default: true },
  showToolbar: { type: Boolean, default: true },
  /** top-left：独立 /leida 页；left-center：主页雷达模式（避开右侧配置面板） */
  colorbarPlacement: {
    type: String,
    default: 'top-left',
    validator: (v) => ['top-left', 'left-center', 'right-center'].includes(v),
  },
  colorbarDismissible: { type: Boolean, default: true },
})

const emit = defineEmits(['view-mode'])

const viewMode = ref('perspective')
const colorbarVisible = ref(true)

watch(
  () => props.showChrome,
  (visible) => {
    if (visible) colorbarVisible.value = true
  },
)

function setViewMode(mode) {
  viewMode.value = mode
  emit('view-mode', mode)
}
</script>

<template>
  <section
    class="leida-viewport"
    :class="{ 'leida-viewport--bare': !showChrome }">
    <div class="leida-viewport-main">
      <div
        v-if="showChrome && colorbarVisible"
        class="leida-colorbar"
        :class="[
          `is-${colorbarPlacement}`,
          { 'is-dismissible': colorbarDismissible },
        ]">
        <button
          v-if="colorbarDismissible"
          type="button"
          class="leida-colorbar-close"
          title="关闭色条"
          aria-label="关闭色条"
          @click="colorbarVisible = false">
          &times;
        </button>
        <strong>电场强度（伏/米）</strong>
        <span>1.0×10⁴</span>
        <div class="leida-colorbar-scale" />
        <span>1.0×10⁰</span>
      </div>
      <div class="leida-viewport-slot">
        <slot :view-mode="viewMode" />
      </div>
    </div>
    <div v-if="showChrome && showToolbar" class="leida-viewport-toolbar">
      <div class="leida-cam-tools">
        <button title="实体"><Box /></button>
        <button title="框选"><Grid /></button>
        <button title="旋转"><Operation /></button>
        <button title="移动"><Tools /></button>
        <button title="全屏"><SwitchButton /></button>
      </div>
      <div class="leida-view-modes">
        <button :class="{ active: viewMode === 'top' }" @click="setViewMode('top')">俯视</button>
        <button :class="{ active: viewMode === 'section' }" @click="setViewMode('section')">剖切</button>
        <button :class="{ active: viewMode === 'perspective' }" @click="setViewMode('perspective')">透视</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.leida-viewport--bare {
  display: block;
  background: transparent;
  border: none;
  border-radius: 0;
  overflow: visible;
}

.leida-viewport--bare .leida-viewport-main {
  position: absolute;
  inset: 0;
}

.leida-viewport-slot {
  position: absolute;
  inset: 0;
  min-height: 0;
}

.leida-viewport-slot :deep(.pixel-streaming-area),
.leida-viewport-slot :deep(.leida-scene-wrap) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
