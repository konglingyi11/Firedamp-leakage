import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./DataStatistics.vue', import.meta.url), 'utf8')
const guideSource = readFileSync(new URL('../composables/useHomeGuides.js', import.meta.url), 'utf8')
const [mainPanelTemplate] = source.split('<!-- 图表详情弹窗 -->')

assert.ok(
  !mainPanelTemplate.includes('class="charts-container stats-guide-charts"'),
  '数据统计主面板不应渲染内嵌图表容器',
)

for (const refName of [
  'gasMassFractionChartRef',
  'windSpeedChartRef',
  'temperatureChartRef',
  'humidityChartRef',
  'pressureChartRef',
]) {
  assert.ok(
    !mainPanelTemplate.includes(`ref="${refName}"`),
    `数据统计主面板不应渲染 ${refName}`,
  )
}

assert.ok(source.includes('ref="dialogChartRef"'), '图表详情弹窗应保留')
assert.ok(source.includes('ref="overviewGasTrendChartRef"'), '数据统计总览弹窗应保留')
assert.ok(
  source.includes('stats-guide-overview-charts'),
  '全屏图表按钮应作为教程目标保留',
)
assert.ok(
  !guideSource.includes("resolveGuideTarget('.stats-guide-charts')"),
  '数据统计教程不应再指向隐藏的内嵌图表区域',
)
assert.ok(
  !guideSource.includes("resolveGuideTarget('.stats-guide-time-range')"),
  '数据统计教程不应再指向隐藏的时间区间区域',
)
assert.ok(
  guideSource.includes("resolveGuideTarget('.stats-guide-overview-charts')"),
  '数据统计教程应指向全屏图表入口',
)
assert.ok(
  source.includes('setOverviewChartsLoading'),
  '数据统计总览加载监测点数据时应控制图表 loading',
)
assert.ok(
  source.includes('setOverviewChartsLoading(true)'),
  '数据统计总览开始加载时应显示图表 loading',
)
assert.ok(
  source.includes('setOverviewChartsLoading(false)'),
  '数据统计总览加载结束后应关闭图表 loading',
)

const microSource = readFileSync(
  new URL('./MicroMotionResults.vue', import.meta.url),
  'utf8',
)
for (const cls of [
  'stats-guide-micro-overview',
  'stats-guide-micro-gesture',
  'stats-guide-micro-waveform',
]) {
  assert.ok(microSource.includes(cls), `微动识别面板应保留教程锚点 ${cls}`)
}
for (const selector of [
  '.stats-guide-micro-panel',
  '.stats-guide-micro-overview',
  '.stats-guide-micro-gesture',
  '.stats-guide-micro-waveform',
]) {
  assert.ok(
    guideSource.includes(`resolveGuideTarget('${selector}')`),
    `数据统计教程应指向微动识别锚点 ${selector}`,
  )
}
