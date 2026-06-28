<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import {
  createCompactStatisticsLineOption,
  formatChartNumericDisplay,
} from '@/utils/charts'
import {
  simulatedRadarWaveSeries,
  simulatedRadarWaveSnapshot,
} from '@/utils/simulatedRadarProbe'

const props = defineProps({
  probePoint: { type: Object, default: null },
})

const DEMO_STEPS = 11
const demoXAxis = () =>
  Array.from({ length: DEMO_STEPS }, (_, i) => i)

/** 侧栏占位条：环境与雷达表征（雷达两项随 probe 与时间索引取样变化） */
const envBarsStatic = computed(() => [
  { label: '温度', value: 13, text: '5°C' },
  { label: '湿度', value: 91, text: '26%Rh' },
  { label: '压力', value: 49, text: '101kPa' },
  { label: '距离', value: 44, text: '18m' },
])

const radarBarSnapshot = computed(() => {
  const p =
    props.probePoint &&
    props.probePoint.id != null &&
    props.probePoint.id !== ''
      ? props.probePoint
      : null
  if (!p) return { attn: '—', inten: '—' }
  const s = simulatedRadarWaveSnapshot(p, DEMO_STEPS - 1, DEMO_STEPS)
  return { attn: s.attenuation, inten: s.intensity }
})

const radarEnvBars = computed(() => [
  ...envBarsStatic.value,
  { label: '衰减率取样', value: 56, text: radarBarSnapshot.value.attn },
  { label: '强度取样', value: 56, text: radarBarSnapshot.value.inten },
])

const wavePanels = [
  {
    id: 'attn',
    title: '电磁波衰减率',
    yAxisName: '衰减率',
    unit: '',
    color: '#3b82f6',
    kind: 'attenuation',
  },
  {
    id: 'intensity',
    title: '电磁波强度',
    yAxisName: '强度',
    unit: '',
    color: '#a855f7',
    kind: 'intensity',
  },
]

const resolvedProbe = computed(() => {
  if (props.probePoint?.id != null && props.probePoint.id !== '')
    return props.probePoint
  return null
})

const chartHandles = ref([])

function teardownPanel(id) {
  const i = chartHandles.value.findIndex((h) => h.id === id)
  if (i === -1) return
  const { inst, ro } = chartHandles.value.splice(i, 1)[0]
  ro.disconnect()
  inst.dispose()
}

function teardownAll() {
  wavePanels.slice().forEach((p) => teardownPanel(p.id))
}

/** ref 挂载/卸载；卸载 dispose */
function bindHost(id, el) {
  teardownPanel(id)
  if (!el) return
  const panel = wavePanels.find((p) => p.id === id)
  if (!panel) return
  const inst = echarts.init(el)
  const baseOpt = createCompactStatisticsLineOption({
    yAxisName: panel.yAxisName,
    unit: panel.unit ?? '',
    color: panel.color,
    seriesName: panel.title,
  })
  if (panel.kind === 'attenuation') {
    baseOpt.series = (baseOpt.series || []).map((s) =>
      s?.type === 'line' ? { ...s, areaStyle: undefined } : s,
    )
  }
  inst.setOption(baseOpt)
  const probe = resolvedProbe.value
  const xs = demoXAxis()
  const sim = simulatedRadarWaveSeries(probe, xs)
  const raw =
    panel.kind === 'attenuation' ? sim.attenuation : sim.intensity
  const safeData =
    probe && raw.length ? raw.map((v, i) => [xs[i], v]) : []

  inst.setOption({
    ...(safeData.length
      ? {
          tooltip: {
            formatter(params) {
              if (!params?.length) return ''
              const p0 = params[0]
              const x = Array.isArray(p0.value) ? p0.value[0] : p0.axisValue
              const xv = typeof x === 'number' ? x : Number(x)
              const xStr = Number.isFinite(xv)
                ? formatChartNumericDisplay(xv)
                : String(x ?? '')
              const lines = params.map((param) => {
                const val = Array.isArray(param.value)
                  ? param.value[1]
                  : param.value
                return `${param.seriesName}: ${formatChartNumericDisplay(val)}${panel.unit ? panel.unit : ''}`
              })
              return `${xStr}<br/>${lines.join('<br/>')}`
            },
          },
          graphic: [],
          series: [{ data: safeData }],
        }
      : {
          graphic: [
            {
              type: 'text',
              left: 'center',
              top: 'middle',
              style: {
                text: '请先在场景中布置监测点',
                fill: '#94a3b8',
                fontSize: 12,
              },
            },
          ],
          series: [{ data: [] }],
        }),
  })
  const ro = new ResizeObserver(() => inst.resize())
  ro.observe(el)
  chartHandles.value.push({ id: panel.id, inst, ro })
}

function refreshPanelsData() {
  nextTick(() => {
    wavePanels.forEach(({ id }) => {
      const hit = chartHandles.value.find((h) => h.id === id)
      if (!hit) return
      const panel = wavePanels.find((p) => p.id === id)
      if (!panel || !hit.inst) return
      const probe = resolvedProbe.value
      const xs = demoXAxis()
      const sim = simulatedRadarWaveSeries(probe, xs)
      const raw =
        panel.kind === 'attenuation' ? sim.attenuation : sim.intensity
      const safeData =
        probe && raw.length ? raw.map((v, i) => [xs[i], v]) : []
      hit.inst.setOption(
        safeData.length
          ? {
              graphic: [],
              tooltip: {
                formatter(params) {
                  if (!params?.length) return ''
                  const p0 = params[0]
                  const x = Array.isArray(p0.value) ? p0.value[0] : p0.axisValue
                  const xv = typeof x === 'number' ? x : Number(x)
                  const xStr = Number.isFinite(xv)
                    ? formatChartNumericDisplay(xv)
                    : String(x ?? '')
                  const lines = params.map((param) => {
                    const val = Array.isArray(param.value)
                      ? param.value[1]
                      : param.value
                    return `${param.seriesName}: ${formatChartNumericDisplay(val)}${panel.unit ? panel.unit : ''}`
                  })
                  return `${xStr}<br/>${lines.join('<br/>')}`
                },
              },
              series: [{ data: safeData }],
            }
          : {
              tooltip: {},
              graphic: [
                {
                  type: 'text',
                  left: 'center',
                  top: 'middle',
                  style: {
                    text: '请先在场景中布置监测点',
                    fill: '#94a3b8',
                    fontSize: 12,
                  },
                },
              ],
              series: [{ data: [] }],
            },
      )
      hit.inst.resize()
    })
  })
}

watch(
  () => [
    resolvedProbe.value?.id,
    resolvedProbe.value?.x,
    resolvedProbe.value?.y,
    resolvedProbe.value?.z,
  ],
  () => refreshPanelsData(),
  { deep: true },
)

onBeforeUnmount(() => teardownAll())
</script>

<template>
  <div class="radar-medium-left">
    <section class="rm-section">
      <div class="rm-section-head">环境参数</div>
      <div class="rm-bars">
        <div v-for="item in radarEnvBars" :key="item.label" class="rm-bar-row">
          <span class="rm-bar-label">{{ item.label }}</span>
          <span class="rm-bar-track">
            <span class="rm-bar-fill" :style="{ width: `${item.value}%` }"></span>
          </span>
          <span class="rm-bar-value">{{ item.text }}</span>
        </div>
      </div>
    </section>

    <section
      v-for="panel in wavePanels"
      :key="panel.id"
      class="rm-section rm-chart-section">
      <div class="rm-section-head">{{ panel.title }}</div>
      <div class="rm-echart-host chart-item-stats">
        <div
          class="rm-echart-el"
          :ref="(el) => bindHost(panel.id, el)" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.radar-medium-left {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.rm-section {
  padding: 0.35rem 0;
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

.rm-bars {
  display: grid;
  gap: 0.65rem;
}

.rm-bar-row {
  display: grid;
  grid-template-columns: 3.5rem minmax(0, 1fr) 4.75rem;
  align-items: center;
  gap: 0.5rem;
}

.rm-bar-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.625rem;
  padding: 0.2rem 0.35rem;
  border-radius: 3px;
  border: 1px solid rgba(0, 243, 255, 0.2);
  border-left: 2px solid var(--primary-color, #00f3ff);
  background: linear-gradient(
    90deg,
    rgba(0, 243, 255, 0.06) 0%,
    rgba(0, 0, 0, 0.2) 100%
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 0 12px rgba(0, 243, 255, 0.04);
  font-family: var(--font-family-tech, sans-serif);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: rgba(186, 230, 253, 0.92);
  text-shadow: 0 0 20px rgba(0, 243, 255, 0.12);
}

.rm-bar-track {
  position: relative;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 243, 255, 0.08);
  border: 1px solid rgba(0, 243, 255, 0.15);
}

.rm-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(0, 243, 255, 0.35),
    var(--primary-color, #00f3ff)
  );
  box-shadow: 0 0 6px rgba(0, 243, 255, 0.35);
}

.rm-bar-value {
  font-size: 11px;
  font-weight: 700;
  color: rgba(232, 246, 255, 0.9);
  text-align: right;
  font-family: var(--font-family-mono, monospace);
}

/* 对齐 DataStatistics.css .chart-item / 背景边框 */
.rm-echart-host {
  overflow: hidden;
  border-radius: 0.5rem;
}

.chart-item-stats {
  width: 100%;
  flex-shrink: 0;
  background: rgba(13, 20, 35, 0.5);
  border: 1px solid rgba(0, 243, 255, 0.12);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.chart-item-stats:hover {
  border-color: rgba(0, 243, 255, 0.22);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.rm-echart-el {
  width: 100%;
  height: 13.5rem;
  min-height: 13.5rem;
}
</style>
