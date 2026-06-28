<script setup>
import { computed, reactive } from 'vue'
import { Check } from '@element-plus/icons-vue'

const props = defineProps({
  applying: { type: Boolean, default: false },
  batchLoading: { type: Boolean, default: false },
})

const emit = defineEmits(['apply'])

function handleApply() {
  emit('apply')
}

const radarVizMode = defineModel('radarVizMode', {
  type: String,
  default: 'cloud',
})

const plane = defineModel('plane', {
  type: String,
  default: 'xy',
})

const planeCoordinate = defineModel('planeCoordinate', {
  type: Number,
  default: 0,
})

const radarEmitter = defineModel('radarEmitter', {
  type: Object,
  default: () => ({ x: 0, y: 0, z: 0 }),
})

const state = reactive({
  pulseEnabled: true,
  linearSweepEnabled: false,
})

function setVizMode(value) {
  radarVizMode.value = value
}

function setPlane(p) {
  plane.value = p
}

const coordinateAxisName = computed(() => {
  const p = plane.value
  if (p === 'xy') return 'Z'
  if (p === 'xz') return 'Y'
  return 'X'
})

function emitterComponent(axis) {
  const cur =
    radarEmitter.value && typeof radarEmitter.value === 'object'
      ? radarEmitter.value
      : { x: 0, y: 0, z: 0 }
  return Number(cur[axis]) || 0
}

function patchEmitter(axis, raw) {
  const n = Number(raw)
  const cur =
    radarEmitter.value && typeof radarEmitter.value === 'object'
      ? { ...radarEmitter.value }
      : { x: 0, y: 0, z: 0 }
  cur[axis] = Number.isFinite(n) ? n : 0
  radarEmitter.value = cur
}

const mediumParams = [
  { label: '介电常数', value: '5.0', unit: 'F/m', color: '#288dff' },
  { label: '电导率', value: '0.15', unit: 'S/m', color: '#25e0ba' },
  { label: '磁导率', value: '1.0', unit: 'H/m', color: '#ffd750' },
  { label: '密度', value: '1400', unit: 'kg/m³', color: '#ff8a25' },
]
</script>

<template>
  <div class="radar-medium-right">
    <section class="rm-section">
      <div class="rm-section-head">雷达波展示</div>
      <div
        class="rm-dimension-row"
        role="radiogroup"
        aria-label="雷达波云图或体渲染">
        <button
          type="button"
          class="rm-dim-chip"
          :class="{ active: radarVizMode === 'cloud' }"
          role="radio"
          :aria-checked="radarVizMode === 'cloud'"
          @click="setVizMode('cloud')">
          云图
        </button>
        <button
          type="button"
          class="rm-dim-chip"
          :class="{ active: radarVizMode === 'volume' }"
          role="radio"
          :aria-checked="radarVizMode === 'volume'"
          @click="setVizMode('volume')">
          体
        </button>
      </div>
      <p class="rm-dimension-hint">
        云图：二维切面叠加雷达回波；体：三维体渲染。「应用设置」在当前所选模式下生效。
      </p>
    </section>

    <section v-if="radarVizMode === 'cloud'" class="rm-section">
      <div class="rm-section-head">切面</div>
      <div class="rm-plane-cards" role="radiogroup" aria-label="选择二维平面">
        <button
          type="button"
          class="rm-plane-card"
          :class="{ active: plane === 'xy' }"
          @click="setPlane('xy')">
          <span class="rm-plane-label">XY</span>
          <span class="rm-plane-desc">水平</span>
        </button>
        <button
          type="button"
          class="rm-plane-card"
          :class="{ active: plane === 'xz' }"
          @click="setPlane('xz')">
          <span class="rm-plane-label">XZ</span>
          <span class="rm-plane-desc">正面</span>
        </button>
        <button
          type="button"
          class="rm-plane-card"
          :class="{ active: plane === 'yz' }"
          @click="setPlane('yz')">
          <span class="rm-plane-label">YZ</span>
          <span class="rm-plane-desc">侧面</span>
        </button>
      </div>
      <div class="rm-coordinate-row">
        <span class="rm-coord-label">{{ coordinateAxisName }} 轴位置</span>
        <el-input-number
          v-model="planeCoordinate"
          size="small"
          class="rm-coord-input"
          :step="0.1"
          :precision="2" />
        <span class="rm-coord-unit">cm</span>
      </div>
    </section>

    <section v-else class="rm-section">
      <div class="rm-section-head">发射点</div>
      <p class="rm-emitter-hint">三维雷达波发射位置（与场景长度单位一致，默认 cm）。</p>
      <div class="rm-emitter-grid">
        <div class="rm-emitter-field">
          <span class="rm-emitter-axis">X</span>
          <el-input-number
            :model-value="emitterComponent('x')"
            size="small"
            class="rm-emitter-input"
            :step="0.01"
            :precision="3"
            @update:model-value="patchEmitter('x', $event)" />
        </div>
        <div class="rm-emitter-field">
          <span class="rm-emitter-axis">Y</span>
          <el-input-number
            :model-value="emitterComponent('y')"
            size="small"
            class="rm-emitter-input"
            :step="0.01"
            :precision="3"
            @update:model-value="patchEmitter('y', $event)" />
        </div>
        <div class="rm-emitter-field">
          <span class="rm-emitter-axis">Z</span>
          <el-input-number
            :model-value="emitterComponent('z')"
            size="small"
            class="rm-emitter-input"
            :step="0.01"
            :precision="3"
            @update:model-value="patchEmitter('z', $event)" />
        </div>
      </div>
    </section>

    <section class="rm-section">
      <div class="rm-section-head">介质参数</div>
      <dl class="rm-params">
        <div v-for="item in mediumParams" :key="item.label" class="rm-param-row">
          <dt>{{ item.label }}</dt>
          <dd :style="{ color: item.color }">
            {{ item.value }}
            <small>{{ item.unit }}</small>
          </dd>
        </div>
      </dl>
    </section>

    <section class="rm-section">
      <div class="rm-section-head">调制方式</div>
      <div class="rm-toggles">
        <label class="rm-toggle">
          <span>脉冲调制</span>
          <input v-model="state.pulseEnabled" type="checkbox" />
          <i></i>
        </label>
        <label class="rm-toggle">
          <span>线性调频</span>
          <input v-model="state.linearSweepEnabled" type="checkbox" />
          <i></i>
        </label>
      </div>
    </section>

    <section class="rm-section rm-apply-section">
      <el-button
        type="primary"
        class="rm-apply-btn"
        :icon="Check"
        :loading="props.applying || props.batchLoading"
        :disabled="props.applying || props.batchLoading"
        @click="handleApply">
        应用设置
      </el-button>
    </section>
  </div>
</template>

<style scoped>
.radar-medium-right {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.rm-section-head {
  margin-bottom: 0.65rem;
  padding-left: 0.5rem;
  border-left: 3px solid var(--primary-color, #00f3ff);
  font-family: var(--font-family-tech, sans-serif);
  font-size: var(--text-caption, 12px);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--primary-color, #00f3ff);
}

.rm-dimension-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.rm-dim-chip {
  margin: 0;
  padding: 0.5rem 0.35rem;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid rgba(0, 243, 255, 0.22);
  background: rgba(0, 0, 0, 0.32);
  font-family: var(--font-family-tech, sans-serif);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(208, 232, 246, 0.82);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.rm-dim-chip:hover {
  border-color: rgba(0, 243, 255, 0.45);
  color: rgba(232, 248, 255, 0.95);
}

.rm-dim-chip.active {
  border-color: rgba(0, 243, 255, 0.62);
  background: linear-gradient(
    165deg,
    rgba(0, 180, 220, 0.28) 0%,
    rgba(0, 60, 90, 0.45) 100%
  );
  color: #f0fcff;
  box-shadow: 0 0 0.65rem rgba(0, 243, 255, 0.18);
}

.rm-dimension-hint {
  margin: 0.55rem 0 0;
  padding: 0;
  font-size: 10px;
  line-height: 1.45;
  font-weight: 500;
  color: rgba(180, 210, 228, 0.72);
}

.rm-plane-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
}

.rm-plane-card {
  margin: 0;
  padding: 0.45rem 0.2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid rgba(0, 243, 255, 0.2);
  background: rgba(0, 0, 0, 0.28);
  cursor: pointer;
  color: rgba(210, 232, 246, 0.88);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.rm-plane-card:hover {
  border-color: rgba(0, 243, 255, 0.42);
}

.rm-plane-card.active {
  border-color: rgba(0, 243, 255, 0.55);
  background: rgba(0, 120, 160, 0.22);
}

.rm-plane-label {
  font-family: var(--font-family-tech, sans-serif);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.rm-plane-desc {
  font-size: 10px;
  opacity: 0.85;
}

.rm-coordinate-row {
  margin-top: 0.65rem;
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.35rem;
}

.rm-coord-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(220, 236, 246, 0.88);
}

.rm-coord-input {
  width: 7.5rem;
}

.rm-coord-unit {
  font-size: 11px;
  color: rgba(180, 210, 228, 0.75);
}

.rm-emitter-hint {
  margin: 0 0 0.5rem;
  padding: 0;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(180, 210, 228, 0.72);
}

.rm-emitter-grid {
  display: grid;
  gap: 0.5rem;
}

.rm-emitter-field {
  display: grid;
  grid-template-columns: 1.25rem 1fr;
  align-items: center;
  gap: 0.4rem;
}

.rm-emitter-axis {
  font-weight: 800;
  font-size: 12px;
  color: var(--primary-color, #00f3ff);
  font-family: var(--font-family-mono, monospace);
}

.rm-emitter-input {
  width: 100%;
}

.rm-params {
  margin: 0;
  display: grid;
  gap: 0.85rem;
}

.rm-param-row {
  display: grid;
  grid-template-columns: 5rem 1fr;
  align-items: baseline;
  gap: 0.35rem;
}

.rm-param-row dt {
  margin: 0;
  font-size: var(--text-body, 13px);
  font-weight: 600;
  color: rgba(220, 236, 246, 0.88);
}

.rm-param-row dd {
  margin: 0;
  text-align: right;
  font-size: clamp(1.1rem, 2.4vw, 1.35rem);
  font-weight: 800;
  font-family: var(--font-family-mono, monospace);
  text-shadow: 0 0 0.75rem rgba(0, 243, 255, 0.25);
}

.rm-param-row small {
  margin-left: 0.2rem;
  font-size: 10px;
  font-weight: 700;
  opacity: 0.85;
}

.rm-toggles {
  display: grid;
  gap: 1rem;
}

.rm-toggle {
  display: grid;
  grid-template-columns: 1fr 52px;
  align-items: center;
  gap: 0.65rem;
  font-size: var(--text-body, 13px);
  font-weight: 600;
  color: rgba(220, 236, 246, 0.92);
}

.rm-toggle input {
  display: none;
}

.rm-toggle i {
  position: relative;
  width: 52px;
  height: 28px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(0, 243, 255, 0.2);
}

.rm-toggle i::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.28);
  transition: transform 160ms ease;
}

.rm-toggle input:checked + i {
  background: linear-gradient(180deg, var(--primary-color, #00f3ff), rgba(0, 140, 175, 0.95));
  border-color: rgba(0, 243, 255, 0.55);
  box-shadow: 0 0 0.65rem rgba(0, 243, 255, 0.28);
}

.rm-toggle input:checked + i::after {
  transform: translateX(24px);
}

.rm-apply-section {
  margin-top: 0.25rem;
}

.rm-apply-btn {
  width: 100%;
  font-family: var(--font-family-tech, sans-serif);
  font-weight: 700;
  letter-spacing: 0.06em;
}
</style>
