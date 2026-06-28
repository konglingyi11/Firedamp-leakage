import * as echarts from 'echarts'

/**
 * 图表数值展示：常规区间用小数，极小/极大用科学计数法，避免质量分数等量级被 toFixed(3) 抹成 0。
 */
export function formatChartNumericDisplay(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs < 1e-4 || abs >= 1e6) {
    return n.toExponential(6)
  }
  if (abs >= 1) return n.toFixed(3)
  if (abs >= 0.1) return n.toFixed(4)
  if (abs >= 0.01) return n.toFixed(5)
  return n.toFixed(6)
}

function buildStatisticsGradientArea(color) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: `${color}4D` },
    { offset: 1, color: `${color}1A` },
  ])
}

function buildStatisticsTooltipOption(unit = '') {
  return {
    trigger: 'axis',
    axisPointer: { type: 'cross' },
    formatter(params) {
      const formatTooltipValue = (value) => {
        const numericValue = Array.isArray(value) ? value[1] : value
        return formatChartNumericDisplay(numericValue)
      }
      const lines = params.map(
        (p) =>
          `${p.seriesName}: ${formatTooltipValue(p.value)}${unit}`,
      )
      return `${params[0]?.name || ''}<br/>${lines.join('<br/>')}`
    },
  }
}

/** 与数据统计页折线图相同的数值轴刻度风格 */
export function buildStatisticsXAxis(compact = false) {
  return {
    type: 'value',
    boundaryGap: false,
    axisLine: { lineStyle: { color: '#334155' } },
    axisLabel: {
      color: '#94a3b8',
      hideOverlap: true,
      margin: compact ? 6 : 10,
      fontSize: compact ? 10 : 12,
      formatter: (value) => Number(value).toFixed(4),
    },
    name: '时间 (s)',
    nameTextStyle: { color: '#94a3b8', fontSize: compact ? 10 : 12 },
  }
}

/** 与数据统计页折线图相同的 Y 轴风格 */
export function buildStatisticsYAxis(yAxisName, unit, compact = false) {
  return {
    type: 'value',
    name: `${yAxisName}${unit ? ' (' + unit + ')' : ''}`,
    nameTextStyle: { color: '#94a3b8', fontSize: compact ? 10 : 12 },
    axisLine: { lineStyle: { color: '#334155' } },
    axisLabel: {
      color: '#94a3b8',
      fontSize: compact ? 10 : 12,
      formatter: (value) => formatChartNumericDisplay(value),
    },
    splitLine: { lineStyle: { color: '#334155', opacity: 0.3 } },
  }
}

/** 数据统计页同款折线 + 半透明渐变填充 */
export function buildStatisticsAreaLineSeries(spec) {
  const { name = '', color } = spec
  return {
    name,
    data: [],
    type: 'line',
    smooth: true,
    lineStyle: { color },
    itemStyle: { color },
    areaStyle: { color: buildStatisticsGradientArea(color) },
  }
}

export function createBaseLineOption(title, yAxisName, color, unit = '') {
  return {
    title: {
      text: title,
      textStyle: { color: '#e2e8f0', fontSize: 14 },
    },
    tooltip: buildStatisticsTooltipOption(unit),
    grid: {
      left: '12%',
      right: '8%',
      top: 88,
      bottom: '3%',
      containLabel: true,
    },
    xAxis: buildStatisticsXAxis(false),
    yAxis: buildStatisticsYAxis(yAxisName, unit, false),
    series: [buildStatisticsAreaLineSeries({ name: '', color })],
  }
}

/**
 * 侧栏等小容器使用：与 {@link createBaseLineOption} 同一套轴线/渐变/字号体系，无外置标题网格略收紧。
 * @param {object} opts
 * @param {string} opts.yAxisName
 * @param {string} [opts.unit]
 * @param {string} opts.color — 与同页 `COLOR_PALETTE` / 环境监测图一致语义
 * @param {string} [opts.seriesName] — Tooltip 序列名（默认等同于 yAxisName）
 */
export function createCompactStatisticsLineOption({
  yAxisName,
  color,
  unit = '',
  seriesName,
}) {
  return {
    backgroundColor: 'transparent',
    animation: false,
    title: { show: false },
    tooltip: buildStatisticsTooltipOption(unit),
    grid: {
      left: '12%',
      right: '10%',
      top: '6%',
      bottom: '14%',
      containLabel: true,
    },
    xAxis: buildStatisticsXAxis(true),
    yAxis: buildStatisticsYAxis(yAxisName, unit, true),
    series: [
      buildStatisticsAreaLineSeries({
        name: seriesName || yAxisName,
        color,
      }),
    ],
  }
}
