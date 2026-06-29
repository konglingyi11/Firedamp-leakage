<script setup>
import { ref, computed, watch, nextTick, onMounted, isRef } from 'vue'
import { ElMessage } from 'element-plus'
import { CaretTop, CaretBottom } from '@element-plus/icons-vue'
import { isGoafTask } from '@/utils/taskType'

const props = defineProps({
  playerRef: {
    type: Object,
    default: null,
  },
  currentTask: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['refresh-sources'])

const player = computed(() => {
  if (!props.playerRef) return null
  // 父组件可能传 ref 实例，也可能已经解包，兼容两种情况
  const raw = isRef(props.playerRef) ? props.playerRef.value || null : props.playerRef
  // 如果 raw 本身还是 ref（异步组件多层解包），再解一次
  if (raw && isRef(raw)) return raw.value || null
  return raw
})

// 状态
const goafGasState = ref({ stage: 'idle' })
const goafGasSources = ref([])
const goafGasParams = ref({})
const collapsed = ref(false)
const goafGasParamsExpanded = ref(true)
// 默认隐藏参数调节面板，点击"调试"按钮才显示
const showDebugPanel = ref(false)
const debugPanelRef = ref(null)
// 显示参数面板时自动滚动到可见区域，避免被 max-height 裁剪看不到
watch(showDebugPanel, async (v) => {
  if (v) {
    await nextTick()
    debugPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
})
const goafBlocks = ref([])
const goafBlockScale = ref(0.5)
const TARGET_COAL_OBJECT_NAME = 'tyFlow004'
const targetCoalObjectVisible = ref(true)
const targetCoalObjectExists = ref(false)

// 刷新
const refreshGoafGasState = () => {
  goafGasState.value = player.value?.getGoafGasState?.() || { stage: 'idle' }
}
const refreshGoafGasSources = () => {
  goafGasSources.value = player.value?.getGoafGasSources?.() || []
}
const refreshGoafGasParams = () => {
  goafGasParams.value = player.value?.getGoafGasParams?.() || {}
}
const refreshGoafBlocks = () => {
  goafBlocks.value = player.value?.getGoafBlocks?.() || []
}
const refreshGoafBlockScale = () => {
  goafBlockScale.value = player.value?.getGoafBlockScale?.() ?? 1
}
const refreshTargetCoalObjectVisibility = () => {
  const exists = player.value?.findNamedObject?.(TARGET_COAL_OBJECT_NAME) != null
  targetCoalObjectExists.value = exists
  if (exists) {
    targetCoalObjectVisible.value =
      player.value?.getNamedObjectVisible?.(TARGET_COAL_OBJECT_NAME) ?? true
  }
}
const syncGoafGasConfig = () => {
  refreshGoafGasState()
  refreshGoafGasSources()
  refreshGoafGasParams()
  refreshGoafBlockScale()
}

// 操作
const handleGoafGasOneClick = () => {
  player.value?.startGoafGasLeak?.(true)
  syncGoafGasConfig()
  ElMessage.success('已一键触发瓦斯泄漏（自动点火）')
}
const handleGoafGasStart = () => {
  player.value?.startGoafGasLeak?.(false)
  syncGoafGasConfig()
  ElMessage.success('已开始瓦斯泄漏积聚')
}
const handleGoafGasIgnite = () => {
  player.value?.igniteGoafGas?.()
  syncGoafGasConfig()
  refreshGoafBlocks()
  ElMessage.success('已触发点火')
}
const handleGoafGasExtinguish = () => {
  player.value?.extinguishGoafFlame?.()
  syncGoafGasConfig()
  ElMessage.success('已熄灭火焰')
}
const handleGoafGasReset = () => {
  player.value?.resetGoafGasLeak?.()
  syncGoafGasConfig()
  refreshGoafBlocks()
  ElMessage.success('已重置瓦斯泄漏')
}
const handleGoafGasExplode = () => {
  player.value?.triggerGoafGasExplosion?.()
  syncGoafGasConfig()
  ElMessage.success('已触发爆炸')
}
const updateGoafGasSource = (index, axis, value) => {
  const sources = [...goafGasSources.value]
  if (!sources[index]) return
  sources[index] = { ...sources[index], [axis]: Number(value) }
  goafGasSources.value = sources
  player.value?.setGoafGasSources?.(sources)
}
const toggleGoafGasSourceVisible = (index) => {
  const sources = [...goafGasSources.value]
  if (!sources[index]) return
  sources[index] = { ...sources[index], visible: sources[index].visible === false }
  goafGasSources.value = sources
  player.value?.setGoafGasSources?.(sources)
}
const addGoafGasSource = () => {
  const existing = goafGasSources.value
  const base = existing.length
    ? existing.reduce(
        (acc, s) => ({
          x: acc.x + (s.x || 0),
          y: acc.y + (s.y || 0),
          z: acc.z + (s.z || 0),
        }),
        { x: 0, y: 0, z: 0 },
      )
    : { x: 0, y: 2, z: 0 }
  const n = existing.length || 1
  const sources = [
    ...existing,
    {
      x: Number((base.x / n).toFixed(2)),
      y: Number((base.y / n).toFixed(2)),
      z: Number((base.z / n).toFixed(2)),
      type: 'goaf',
      emissionFactor: 1.0,
      height: Number((base.y / n).toFixed(2)),
      visible: true,
    },
  ]
  goafGasSources.value = sources
  player.value?.setGoafGasSources?.(sources)
}
const removeGoafGasSource = (index) => {
  const sources = goafGasSources.value.filter((_, i) => i !== index)
  goafGasSources.value = sources
  player.value?.setGoafGasSources?.(sources)
}
const updateGoafGasParam = (key, value) => {
  goafGasParams.value = { ...goafGasParams.value, [key]: value }
  player.value?.setGoafGasParams?.({ [key]: value })
}

// 煤/石块
const addGoafBlock = (type) => {
  const existing = goafBlocks.value
  const baseX = existing.length
    ? existing.reduce((s, b) => s + (b.position?.x || 0), 0) / existing.length
    : 0
  const baseZ = existing.length
    ? existing.reduce((s, b) => s + (b.position?.z || 0), 0) / existing.length
    : 0
  player.value?.addGoafBlock?.({
    type,
    position: [
      baseX + (Math.random() - 0.5) * 4,
      1,
      baseZ + (Math.random() - 0.5) * 4,
    ],
    size: [2, 2, 2],
    procedural: true,
  })
  refreshGoafBlocks()
}
const updateGoafBlock = (id, patch) => {
  player.value?.updateGoafBlock?.(id, patch)
  refreshGoafBlocks()
}
const removeGoafBlock = (id) => {
  player.value?.removeGoafBlock?.(id)
  refreshGoafBlocks()
}
const clearGoafBlocks = () => {
  player.value?.clearGoafBlocks?.()
  refreshGoafBlocks()
}
const updateGoafBlockScale = (value) => {
  const scale = Number(value)
  goafBlockScale.value = scale
  player.value?.setGoafBlockScale?.(scale)
}
const toggleTargetCoalObjectVisibility = () => {
  player.value?.setNamedObjectVisible?.(
    TARGET_COAL_OBJECT_NAME,
    targetCoalObjectVisible.value,
  )
}

// 监听任务变化，自动同步
watch(
  () => isGoafTask(props.currentTask),
  (isGoaf) => {
    if (isGoaf) {
      nextTick(() => {
        syncGoafGasConfig()
        refreshGoafBlocks()
        refreshGoafBlockScale()
        refreshTargetCoalObjectVisibility()
        setTimeout(() => {
          player.value?.logModelObjectNames?.()
          refreshTargetCoalObjectVisibility()
        }, 2000)
      })
    } else {
      goafGasSources.value = []
      goafGasParams.value = {}
      goafGasState.value = { stage: 'idle' }
      goafBlocks.value = []
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (isGoafTask(props.currentTask)) {
    syncGoafGasConfig()
    refreshGoafBlocks()
    refreshGoafBlockScale()
    refreshTargetCoalObjectVisibility()
  }
})

// 暴露刷新方法，供父组件在 ThreeVisualizationCanvas 触发 goaf-gas-sources-updated 时调用
defineExpose({
  refreshGoafGasSources,
  syncGoafGasConfig,
})
</script>

<template>
  <div class="goaf-gas-config-float" :class="{ collapsed: collapsed }">
    <div class="goaf-gas-config-header">
      <span class="goaf-gas-config-title">采空区瓦斯泄漏</span>
      <div class="goaf-gas-config-header-right">
        <span class="goaf-gas-config-stage">{{ goafGasState.stage }}</span>
        <button
          type="button"
          class="goaf-gas-config-toggle"
          :title="collapsed ? '展开' : '折叠'"
          @click="collapsed = !collapsed">
          <el-icon>
            <CaretBottom v-if="collapsed" />
            <CaretTop v-else />
          </el-icon>
        </button>
      </div>
    </div>

    <div v-show="!collapsed" class="goaf-gas-config-body">


      <!-- 触发按钮 -->
      <div class="goaf-gas-actions">
        <button
          type="button"
          class="goaf-gas-btn goaf-gas-btn--primary"
          title="一键触发：泄漏并自动点火"
          @click="handleGoafGasOneClick">
          一键触发
        </button>
        <button
          type="button"
          class="goaf-gas-btn"
          title="开始瓦斯泄漏积聚"
          @click="handleGoafGasStart">
          开始泄漏
        </button>
        <!-- <button
          type="button"
          class="goaf-gas-btn goaf-gas-btn--danger"
          title="手动点火"
          @click="handleGoafGasIgnite">
          点火
        </button> -->
        <button
          type="button"
          class="goaf-gas-btn goaf-gas-btn--warning"
          title="手动触发爆炸"
          @click="handleGoafGasExplode">
          爆炸
        </button>
        <button
          type="button"
          class="goaf-gas-btn"
          :class="{ 'goaf-gas-btn--primary': showDebugPanel }"
          :title="showDebugPanel ? '隐藏参数调节面板' : '显示参数调节面板'"
          @click="showDebugPanel = !showDebugPanel">
          调试
        </button>
        <button
          type="button"
          class="goaf-gas-btn"
          title="重置瓦斯泄漏状态"
          @click="handleGoafGasReset">
          重置
        </button>
      </div>

      <!-- 泄漏源位置 -->
      <div class="goaf-gas-section">
        <div class="goaf-gas-section-title">
          <span>泄漏源位置</span>
          <button
            type="button"
            class="goaf-gas-btn goaf-gas-btn--mini"
            title="添加一个泄漏源"
            @click="addGoafGasSource">
            + 添加
          </button>
        </div>
        <div class="goaf-gas-source-list">
          <div
            v-for="(source, idx) in goafGasSources"
            :key="idx"
            class="goaf-gas-source">
            <span class="goaf-gas-source-label">源{{ idx + 1 }}</span>
            <label
              >X<input
                type="number"
                step="0.1"
                :value="source.x"
                @change="updateGoafGasSource(idx, 'x', $event.target.value)"
            /></label>
            <label
              >Y<input
                type="number"
                step="0.1"
                :value="source.y"
                @change="updateGoafGasSource(idx, 'y', $event.target.value)"
            /></label>
            <label
              >Z<input
                type="number"
                step="0.1"
                :value="source.z"
                @change="updateGoafGasSource(idx, 'z', $event.target.value)"
            /></label>
            <button
              type="button"
              class="goaf-gas-btn goaf-gas-btn--mini goaf-gas-btn--toggle"
              :title="source.visible === false ? '显示该泄漏源' : '隐藏该泄漏源'"
              @click="toggleGoafGasSourceVisible(idx)">
              {{ source.visible === false ? '显' : '隐' }}
            </button>
            <button
              type="button"
              class="goaf-gas-btn goaf-gas-btn--mini goaf-gas-btn--danger"
              title="删除该泄漏源"
              @click="removeGoafGasSource(idx)">
              删除
            </button>
          </div>
        </div>
      </div>

      <!-- 煤/石块管理 -->
      <div class="goaf-gas-section">
        <div class="goaf-gas-section-title">
          <span>煤/石块</span>
          <div class="goaf-gas-section-actions">
            <button
              type="button"
              class="goaf-gas-btn goaf-gas-btn--mini goaf-gas-btn--primary"
              title="添加一个煤炭块"
              @click="addGoafBlock('coal')">
              + 煤块
            </button>
            <button
              type="button"
              class="goaf-gas-btn goaf-gas-btn--mini goaf-gas-btn--primary"
              title="添加一个石块"
              @click="addGoafBlock('rock')">
              + 石块
            </button>
            <button
              v-if="goafBlocks.length > 0"
              type="button"
              class="goaf-gas-btn goaf-gas-btn--mini goaf-gas-btn--danger"
              title="清空所有煤/石块"
              @click="clearGoafBlocks">
              清空
            </button>
          </div>
        </div>

        <label class="goaf-gas-row">
          <span>整体缩放</span>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.1"
            :value="goafBlockScale"
            @input="updateGoafBlockScale(Number($event.target.value))" />
          <span class="goaf-gas-value">{{ goafBlockScale.toFixed(1) }}</span>
        </label>

        <label
          v-if="targetCoalObjectExists"
          class="goaf-gas-row goaf-gas-row--field">
          <span>煤炭</span>
          <label class="goaf-gas-checkbox">
            <input
              type="checkbox"
              v-model="targetCoalObjectVisible"
              @change="toggleTargetCoalObjectVisibility" />
            <span>{{ targetCoalObjectVisible ? '显示' : '隐藏' }}</span>
          </label>
        </label>

        <div
          v-for="(block, idx) in goafBlocks"
          :key="block.id"
          class="goaf-gas-block">
          <div class="goaf-gas-block-head">
            <span
              class="goaf-gas-block-tag"
              :class="`goaf-gas-block-tag--${block.type}`">
              {{ block.type === 'rock' ? '石' : '煤' }} #{{ idx + 1 }}
            </span>
            <div class="goaf-gas-block-actions">
              <button
                type="button"
                class="goaf-gas-btn goaf-gas-btn--mini goaf-gas-btn--danger"
                title="删除该块"
                @click="removeGoafBlock(block.id)">
                删除
              </button>
            </div>
          </div>
          <label class="goaf-gas-row goaf-gas-row--field">
            <span>位置 X</span>
            <input
              type="number"
              step="0.5"
              :value="block.position.x.toFixed(2)"
              @change="
                updateGoafBlock(block.id, {
                  position: [
                    Number($event.target.value),
                    block.position.y,
                    block.position.z,
                  ],
                })
              " />
          </label>
          <label class="goaf-gas-row goaf-gas-row--field">
            <span>位置 Y</span>
            <input
              type="number"
              step="0.5"
              :value="block.position.y.toFixed(2)"
              @change="
                updateGoafBlock(block.id, {
                  position: [
                    block.position.x,
                    Number($event.target.value),
                    block.position.z,
                  ],
                })
              " />
          </label>
          <label class="goaf-gas-row goaf-gas-row--field">
            <span>位置 Z</span>
            <input
              type="number"
              step="0.5"
              :value="block.position.z.toFixed(2)"
              @change="
                updateGoafBlock(block.id, {
                  position: [
                    block.position.x,
                    block.position.y,
                    Number($event.target.value),
                  ],
                })
              " />
          </label>
          <label class="goaf-gas-row">
            <span>尺寸 W</span>
            <input
              type="range"
              min="0.2"
              max="8"
              step="0.1"
              :value="block.size.x.toFixed(2)"
              @input="
                updateGoafBlock(block.id, {
                  size: [
                    Number($event.target.value),
                    block.size.y,
                    block.size.z,
                  ],
                })
              " />
            <span class="goaf-gas-value">{{ block.size.x.toFixed(2) }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>尺寸 H</span>
            <input
              type="range"
              min="0.2"
              max="8"
              step="0.1"
              :value="block.size.y.toFixed(2)"
              @input="
                updateGoafBlock(block.id, {
                  size: [
                    block.size.x,
                    Number($event.target.value),
                    block.size.z,
                  ],
                })
              " />
            <span class="goaf-gas-value">{{ block.size.y.toFixed(2) }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>尺寸 D</span>
            <input
              type="range"
              min="0.2"
              max="8"
              step="0.1"
              :value="block.size.z.toFixed(2)"
              @input="
                updateGoafBlock(block.id, {
                  size: [
                    block.size.x,
                    block.size.y,
                    Number($event.target.value),
                  ],
                })
              " />
            <span class="goaf-gas-value">{{ block.size.z.toFixed(2) }}</span>
          </label>
          <label class="goaf-gas-row goaf-gas-row--field">
            <span>类型</span>
            <select
              :value="block.type"
              @change="updateGoafBlock(block.id, { type: $event.target.value })">
              <option value="coal">煤炭</option>
              <option value="rock">岩石</option>
            </select>
          </label>
        </div>
      </div>

      <!-- 参数调节（默认隐藏，点击"调试"按钮显示） -->
      <div v-show="showDebugPanel" ref="debugPanelRef" class="goaf-gas-section">
        <div
          class="goaf-gas-section-title goaf-gas-section-title--collapsible"
          @click="goafGasParamsExpanded = !goafGasParamsExpanded">
          <span>参数</span>
          <el-icon class="goaf-gas-caret">
            <CaretTop v-if="!goafGasParamsExpanded" />
            <CaretBottom v-else />
          </el-icon>
        </div>
        <div v-show="goafGasParamsExpanded" class="goaf-gas-params-body">
          <label class="goaf-gas-row">
            <span>泄漏速率</span>
            <input
              type="range"
              min="0.01"
              max="0.5"
              step="0.01"
              :value="goafGasParams.leakRatePercent ?? 0.02"
              @input="
                updateGoafGasParam(
                  'leakRatePercent',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.leakRatePercent ?? 0.02).toFixed(2)
            }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>爆炸下限(%)</span>
            <input
              type="range"
              min="1"
              max="10"
              step="0.5"
              :value="goafGasParams.methaneLowerExplosiveLimit ?? 5"
              @input="
                updateGoafGasParam(
                  'methaneLowerExplosiveLimit',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              goafGasParams.methaneLowerExplosiveLimit ?? 5
            }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>爆炸上限(%)</span>
            <input
              type="range"
              min="10"
              max="20"
              step="0.5"
              :value="goafGasParams.methaneUpperExplosiveLimit ?? 16"
              @input="
                updateGoafGasParam(
                  'methaneUpperExplosiveLimit',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              goafGasParams.methaneUpperExplosiveLimit ?? 16
            }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>爆炸强度</span>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              :value="goafGasParams.explosionIntensity ?? 1.2"
              @input="
                updateGoafGasParam(
                  'explosionIntensity',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.explosionIntensity ?? 1.2).toFixed(1)
            }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>火花强度</span>
            <input
              type="range"
              min="0.2"
              max="2"
              step="0.1"
              :value="goafGasParams.ignitionSparkStrength ?? 1"
              @input="
                updateGoafGasParam(
                  'ignitionSparkStrength',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.ignitionSparkStrength ?? 1).toFixed(1)
            }}</span>
          </label>
          <label class="goaf-gas-row goaf-gas-row--color">
            <span>烟雾颜色</span>
            <input
              type="color"
              :value="goafGasParams.gasColor ?? '#9db3a8'"
              @change="updateGoafGasParam('gasColor', $event.target.value)" />
          </label>
          <label class="goaf-gas-row">
            <span>烟雾速度</span>
            <input
              type="range"
              min="0.05"
              max="0.6"
              step="0.05"
              :value="goafGasParams.smokeSpeed ?? 0.15"
              @input="
                updateGoafGasParam(
                  'smokeSpeed',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.smokeSpeed ?? 0.15).toFixed(2)
            }}</span>
          </label>

          <div class="goaf-gas-section-title" style="margin-top: 0.5rem">烟雾方向速度</div>
          <label class="goaf-gas-row">
            <span>X 轴速度</span>
            <input
              type="range"
              min="-2.0"
              max="2.0"
              step="0.1"
              :value="goafGasParams.smokeVelX ?? -0.15"
              @input="
                updateGoafGasParam('smokeVelX', Number($event.target.value))
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.smokeVelX ?? -0.15).toFixed(1)
            }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>Y 轴速度</span>
            <input
              type="range"
              min="-2.0"
              max="2.0"
              step="0.1"
              :value="goafGasParams.smokeVelY ?? 0.05"
              @input="
                updateGoafGasParam('smokeVelY', Number($event.target.value))
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.smokeVelY ?? 0.05).toFixed(1)
            }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>Z 轴速度（上浮）</span>
            <input
              type="range"
              min="-1.0"
              max="3.0"
              step="0.1"
              :value="goafGasParams.smokeVelZ ?? 0.05"
              @input="
                updateGoafGasParam('smokeVelZ', Number($event.target.value))
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.smokeVelZ ?? 0.05).toFixed(1)
            }}</span>
          </label>
          <label class="goaf-gas-row">
            <span>高度增益</span>
            <input
              type="range"
              min="0"
              max="1.0"
              step="0.05"
              :value="goafGasParams.smokeVelHeightGain ?? 0.1"
              @input="
                updateGoafGasParam(
                  'smokeVelHeightGain',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.smokeVelHeightGain ?? 0.1).toFixed(2)
            }}</span>
          </label>

          <label class="goaf-gas-row">
            <span>烟雾不透明度</span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              :value="goafGasParams.smokeOpacity ?? 0.5"
              @input="
                updateGoafGasParam(
                  'smokeOpacity',
                  Number($event.target.value),
                )
              " />
            <span class="goaf-gas-value">{{
              (goafGasParams.smokeOpacity ?? 0.5).toFixed(2)
            }}</span>
          </label>

          <div class="goaf-gas-section-title" style="margin-top: 0.5rem">效果开关</div>
          <label class="goaf-gas-row">
            <span>爆炸</span>
            <input
              type="checkbox"
              :checked="goafGasParams.explosionEnabled !== false"
              @change="
                updateGoafGasParam('explosionEnabled', $event.target.checked)
              " />
          </label>
          <label class="goaf-gas-row">
            <span>火球蔓延</span>
            <input
              type="checkbox"
              :checked="goafGasParams.fireballEnabled === true"
              @change="
                updateGoafGasParam('fireballEnabled', $event.target.checked)
              " />
          </label>

          <label class="goaf-gas-row">
            <span>火球蔓延方向</span>
            <select
              :value="goafGasParams.fireballAxis ?? 'auto'"
              @change="updateGoafGasParam('fireballAxis', $event.target.value)">
              <option value="auto">自动</option>
              <option value="x">+X</option>
              <option value="-x">-X</option>
              <option value="y">+Y</option>
              <option value="-y">-Y</option>
              <option value="z">+Z</option>
              <option value="-z">-Z</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.goaf-gas-config-float {
  --layers-float-width: clamp(13.5rem, 22vw, 18rem);
  width: var(--layers-float-width);
  max-height: calc(100vh - 9rem);
  overflow-y: auto;
  background: rgba(10, 18, 30, 0.92);
  border: 1px solid rgba(0, 243, 255, 0.18);
  border-radius: 0.5rem;
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  color: var(--text-primary, rgba(255, 255, 255, 0.9));
  font-size: var(--text-caption, 0.75rem);
  z-index: 60;
  padding: 0.55rem 0.5rem;
  margin-top: 0.55rem;
}

.goaf-gas-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid rgba(0, 243, 255, 0.12);
}

.goaf-gas-config-title {
  font-size: var(--text-caption, 0.75rem);
  font-weight: 600;
  color: var(--text-primary, rgba(255, 255, 255, 0.9));
}

.goaf-gas-config-stage {
  font-size: var(--text-caption, 0.75rem);
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  text-transform: capitalize;
}

.goaf-gas-config-header-right {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.goaf-gas-config-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary, rgba(255, 255, 255, 0.8));
  cursor: pointer;
  transition: all 0.2s ease;
}

.goaf-gas-config-toggle:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--text-primary, rgba(255, 255, 255, 0.95));
}

.goaf-gas-config-float.collapsed {
  max-height: 2.2rem;
  padding-bottom: 0;
  overflow: hidden;
}

.goaf-gas-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  margin-bottom: 0.55rem;
}

.goaf-gas-btn {
  padding: 0.35rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary, rgba(255, 255, 255, 0.9));
  font-size: var(--text-caption, 0.75rem);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.goaf-gas-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
}

.goaf-gas-btn--primary {
  background: rgba(0, 163, 255, 0.18);
  border-color: rgba(0, 163, 255, 0.35);
  color: #7ee7ff;
}

.goaf-gas-btn--primary:hover {
  background: rgba(0, 163, 255, 0.28);
}

.goaf-gas-btn--danger {
  background: rgba(255, 60, 60, 0.15);
  border-color: rgba(255, 60, 60, 0.35);
  color: #ff9d9d;
}

.goaf-gas-btn--danger:hover {
  background: rgba(255, 60, 60, 0.25);
}

.goaf-gas-btn--warning {
  background: rgba(255, 160, 0, 0.15);
  border-color: rgba(255, 160, 0, 0.35);
  color: #ffd28f;
}

.goaf-gas-btn--warning:hover {
  background: rgba(255, 160, 0, 0.25);
}

.goaf-gas-btn--mini {
  padding: 0.2rem 0.35rem;
  font-size: 0.65rem;
}

.goaf-gas-btn--toggle {
  min-width: 1.6rem;
}

.goaf-gas-section {
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid rgba(0, 243, 255, 0.08);
}

.goaf-gas-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-caption, 0.75rem);
  font-weight: 600;
  color: var(--text-secondary, rgba(255, 255, 255, 0.8));
  margin-bottom: 0.4rem;
}

.goaf-gas-section-title--collapsible {
  cursor: pointer;
  user-select: none;
}

.goaf-gas-section-title--collapsible:hover {
  color: var(--text-primary, rgba(255, 255, 255, 0.95));
}

.goaf-gas-section-actions {
  display: flex;
  gap: 0.3rem;
}

.goaf-gas-source-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.goaf-gas-source {
  display: grid;
  grid-template-columns: 2rem 1fr 1fr 1fr 1.8rem 1.8rem;
  gap: 0.25rem;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  padding: 0.3rem;
  border-radius: 0.25rem;
}

.goaf-gas-source-label {
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  font-size: 0.65rem;
}

.goaf-gas-source label {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  font-size: 0.65rem;
}

.goaf-gas-source input[type='number'] {
  width: 100%;
  min-width: 0;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.2rem;
  color: inherit;
  padding: 0.15rem 0.2rem;
  font-size: 0.65rem;
}

.goaf-gas-row {
  display: grid;
  grid-template-columns: 4.5rem 1fr 2.2rem;
  gap: 0.4rem;
  align-items: center;
  margin-bottom: 0.3rem;
  font-size: 0.7rem;
  color: var(--text-secondary, rgba(255, 255, 255, 0.8));
}

.goaf-gas-row--field {
  grid-template-columns: 4.5rem 1fr;
}

.goaf-gas-row--color {
  grid-template-columns: 4.5rem 1fr;
}

.goaf-gas-row input[type='range'] {
  width: 100%;
  accent-color: #00f3ff;
}

.goaf-gas-row input[type='number'],
.goaf-gas-row select {
  width: 100%;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.2rem;
  color: inherit;
  padding: 0.2rem 0.3rem;
  font-size: 0.7rem;
}

.goaf-gas-row input[type='color'] {
  width: 100%;
  height: 1.6rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.2rem;
  cursor: pointer;
}

.goaf-gas-row input[type='checkbox'] {
  justify-self: start;
  accent-color: #00f3ff;
}

.goaf-gas-value {
  text-align: right;
  color: #00f3ff;
  font-variant-numeric: tabular-nums;
}

.goaf-gas-checkbox {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
}

.goaf-gas-block {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0.35rem;
  padding: 0.4rem;
  margin-bottom: 0.4rem;
}

.goaf-gas-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.goaf-gas-block-tag {
  font-size: 0.65rem;
  padding: 0.15rem 0.35rem;
  border-radius: 0.2rem;
  font-weight: 600;
}

.goaf-gas-block-tag--coal {
  background: rgba(20, 20, 20, 0.6);
  color: #b8b8b8;
}

.goaf-gas-block-tag--rock {
  background: rgba(58, 52, 44, 0.6);
  color: #c4b8a8;
}

.goaf-gas-block-actions {
  display: flex;
  gap: 0.25rem;
}

.goaf-gas-caret {
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  font-size: 0.75rem;
}

.goaf-gas-params-body {
  padding-top: 0.1rem;
}
</style>
