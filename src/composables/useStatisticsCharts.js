import { shallowRef, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { createBaseLineOption, formatChartNumericDisplay } from '@/utils/charts'
import { COLOR_PALETTE } from '@/utils/gas'
import {
  simulatedRadarWaveSeries,
  averageOrNull,
} from '@/utils/simulatedRadarProbe'

export function useStatisticsCharts(refs, state) {
  const charts = {
    windSpeed: shallowRef(null),
    temperature: shallowRef(null),
    humidity: shallowRef(null),
    pressure: shallowRef(null),
    gasMassFraction: shallowRef(null),
    dialog: shallowRef(null),
    overviewGasTrend: shallowRef(null),
    overviewWindSpeed: shallowRef(null),
    overviewTemperature: shallowRef(null),
    overviewHumidity: shallowRef(null),
    overviewPressure: shallowRef(null),
    overviewGasSnapshot: shallowRef(null),
    overviewPointGasTotal: shallowRef(null),
    overviewGasHeatmap: shallowRef(null),
    overviewPointSpatial: shallowRef(null),
    overviewEnvRadar: shallowRef(null),
    overviewWaveAttenuation: shallowRef(null),
    overviewWaveIntensity: shallowRef(null),
  }

  const initCharts = (handlers) => {
    const configs = [
      {
        key: 'windSpeed',
        title: '风速变化',
        y: '风速',
        unit: 'm/s',
        color: '#a855f7',
      },
      {
        key: 'temperature',
        title: '温度变化',
        y: '温度',
        unit: '°C',
        color: '#f97316',
      },
      {
        key: 'humidity',
        title: '湿度变化',
        y: '湿度',
        unit: '%',
        color: '#3b82f6',
      },
      {
        key: 'pressure',
        title: '气压变化',
        y: '气压',
        unit: 'kPa',
        color: '#10b981',
      },
    ]

    configs.forEach((cfg) => {
      const el = refs[cfg.key + 'ChartRef'].value
      if (el) {
        charts[cfg.key].value = echarts.init(el)
        charts[cfg.key].value.setOption(
          createBaseLineOption(cfg.title, cfg.y, cfg.color, cfg.unit),
        )
        charts[cfg.key].value
          .getZr()
          .on('click', (e) => handlers.onChartClick(e, cfg.key))
      }
    })

    if (refs.gasMassFractionChartRef.value) {
      charts.gasMassFraction.value = echarts.init(
        refs.gasMassFractionChartRef.value,
      )
      charts.gasMassFraction.value.setOption(
        createBaseLineOption(
          '掩埋空间·气体质量分数变化',
          '质量分数',
          '#f59e0b',
          '',
        ),
      )
      charts.gasMassFraction.value
        .getZr()
        .on('click', (e) => handlers.onChartClick(e, 'gasMassFraction'))
    }
  }

  const dialogChartMeta = {
    gasMassFraction: {
      title: '掩埋空间·气体质量分数详情',
      yAxisName: '质量分数',
      unit: '',
      color: '#f59e0b',
    },
    windSpeed: {
      title: '风速变化详情',
      yAxisName: '风速',
      unit: 'm/s',
      color: '#a855f7',
    },
    temperature: {
      title: '温度变化详情',
      yAxisName: '温度',
      unit: '°C',
      color: '#f97316',
    },
    humidity: {
      title: '湿度变化详情',
      yAxisName: '湿度',
      unit: '%',
      color: '#3b82f6',
    },
    pressure: {
      title: '气压变化详情',
      yAxisName: '气压',
      unit: 'kPa',
      color: '#10b981',
    },
  }

  const computeXAxisBounds = (series) => {
    let min = Infinity,
      max = -Infinity
    for (const s of series) {
      for (const p of s.data) {
        const x = Array.isArray(p) ? p[0] : p
        if (x < min) min = x
        if (x > max) max = x
      }
    }
    if (min === Infinity) return {}
    const span = max - min
    const padding = span > 0 ? span * 0.04 : Math.abs(max || 1) * 0.04
    return {
      xAxis: {
        min: min - padding,
        max: max + padding,
      },
    }
  }

  const createEmptyText = (text) => [
    {
      type: 'text',
      left: 'center',
      top: 'middle',
      style: {
        text,
        fill: '#94a3b8',
        fontSize: 14,
      },
    },
  ]

  const createCompactLegendOption = (series) => ({
    show: series.length > 1,
    type: 'scroll',
    top: 32,
    left: 14,
    right: 14,
    height: 40,
    pageButtonItemGap: 6,
    pageButtonGap: 10,
    pageIconColor: '#7dd3fc',
    pageIconInactiveColor: 'rgba(125, 211, 252, 0.35)',
    pageTextStyle: { color: '#94a3b8' },
    textStyle: {
      color: '#cbd5e1',
      fontSize: 11,
      overflow: 'truncate',
      width: 128,
    },
    itemWidth: 18,
    itemHeight: 10,
    itemGap: 12,
    tooltip: { show: true },
  })

  const updateEnvCharts = () => {
    const keys = ['windSpeed', 'temperature', 'humidity', 'pressure']
    keys.forEach((key, baseIdx) => {
      const chart = charts[key].value
      if (!chart) return
      const history = state.envDataHistory.value[key] || {}
      const series = []
      state.pointIdsForFetch.value.forEach((pointId, idx) => {
        const pointData = history[pointId]
        if (pointData) {
          const { xAxisData, seriesData } = state.filterDataByTime(pointData)
          const color =
            COLOR_PALETTE[(baseIdx * 2 + idx) % COLOR_PALETTE.length]
          const point = state.monitoringPoints.value.find(
            (p) => p.id === pointId,
          )
          series.push({
            name: point?.name || pointId,
            type: 'line',
            smooth: true,
            data: seriesData.map((v, i) => [xAxisData[i], v]),
            lineStyle: { color },
            itemStyle: { color },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: color + '4D' },
                { offset: 1, color: color + '1A' },
              ]),
            },
          })
        }
      })
      chart.setOption({
        series,
        legend: createCompactLegendOption(series),
        ...computeXAxisBounds(series),
      })
    })

    // 更新气体质量分数图表
    updateGasMassFractionChart()
  }

  const updateGasMassFractionChart = () => {
    const chart = charts.gasMassFraction.value
    if (!chart) return

    const series = []
    const gasData = state.gasMassFractionData.value || {}

    state.selectedGasesForChart.value.forEach((gasId, gasIdx) => {
      const gasInfo = state.availableGases.value.find((g) => g.id === gasId)
      const gasColor =
        gasInfo?.color || COLOR_PALETTE[gasIdx % COLOR_PALETTE.length]

      state.pointIdsForFetch.value.forEach((pointId, pointIdx) => {
        const pointData = gasData[gasId]?.[pointId]
        if (pointData && pointData.length > 0) {
          const { xAxisData, seriesData } = state.filterDataByTime(pointData)
          const point = state.monitoringPoints.value.find(
            (p) => p.id === pointId,
          )
          const seriesName =
            state.pointIdsForFetch.value.length > 1
              ? `${gasInfo?.name || gasId} - ${point?.name || pointId}`
              : gasInfo?.name || gasId

          series.push({
            name: seriesName,
            type: 'line',
            smooth: true,
            data: seriesData.map((v, i) => [xAxisData[i], v]),
            lineStyle: { color: gasColor },
            itemStyle: { color: gasColor },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: gasColor + '4D' },
                { offset: 1, color: gasColor + '1A' },
              ]),
            },
          })
        }
      })
    })

    chart.setOption({
      series,
      legend: createCompactLegendOption(series),
      ...computeXAxisBounds(series),
    })
  }

  const getDialogPointIds = (selectedPointIds = []) => {
    if (Array.isArray(selectedPointIds) && selectedPointIds.length)
      return selectedPointIds
    if (state.selectedPointId.value) return [state.selectedPointId.value]
    return state.pointIdsForFetch.value
  }

  const getDialogSeries = (
    chartType,
    selectedPointIds = [],
    selectedGasIds = state.selectedGasesForChart.value,
  ) => {
    const pointIds = getDialogPointIds(selectedPointIds)

    if (chartType === 'gasMassFraction') {
      const gasData = state.gasMassFractionData.value || {}
      return selectedGasIds.flatMap((gasId, gasIdx) => {
        const gasInfo = state.availableGases.value.find((g) => g.id === gasId)
        const gasColor =
          gasInfo?.color || COLOR_PALETTE[gasIdx % COLOR_PALETTE.length]

        return pointIds.flatMap((pointId) => {
          const pointData = gasData[gasId]?.[pointId]
          if (!pointData?.length) return []

          const { xAxisData, seriesData } = state.filterDataByTime(pointData)
          const point = state.monitoringPoints.value.find(
            (p) => p.id === pointId,
          )
          const seriesName =
            pointIds.length > 1
              ? `${gasInfo?.name || gasId} - ${point?.name || pointId}`
              : gasInfo?.name || gasId

          return [
            {
              name: seriesName,
              type: 'line',
              smooth: true,
              data: seriesData.map((v, i) => [xAxisData[i], v]),
              lineStyle: { color: gasColor },
              itemStyle: { color: gasColor },
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: gasColor + '4D' },
                  { offset: 1, color: gasColor + '1A' },
                ]),
              },
            },
          ]
        })
      })
    }

    const history = state.envDataHistory.value[chartType] || {}
    const baseColor = dialogChartMeta[chartType]?.color || COLOR_PALETTE[0]
    return pointIds.flatMap((pointId, idx) => {
      const pointData = history[pointId]
      if (!pointData?.length) return []

      const { xAxisData, seriesData } = state.filterDataByTime(pointData)
      const point = state.monitoringPoints.value.find((p) => p.id === pointId)
      const color = COLOR_PALETTE[idx % COLOR_PALETTE.length] || baseColor
      return [
        {
          name: point?.name || pointId,
          type: 'line',
          smooth: true,
          data: seriesData.map((v, i) => [xAxisData[i], v]),
          lineStyle: { color },
          itemStyle: { color },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: color + '4D' },
              { offset: 1, color: color + '1A' },
            ]),
          },
        },
      ]
    })
  }

  const initDialogChart = (chartType, selectedPointIds = []) => {
    if (!refs.dialogChartRef.value || !chartType || !dialogChartMeta[chartType])
      return

    if (!charts.dialog.value) {
      charts.dialog.value = echarts.init(refs.dialogChartRef.value)
    }

    const meta = dialogChartMeta[chartType]
    charts.dialog.value.setOption(
      createBaseLineOption(meta.title, meta.yAxisName, meta.color, meta.unit),
      true,
    )
    updateDialogChart(chartType, selectedPointIds)
  }

  const updateDialogChart = (chartType, selectedPointIds = []) => {
    const chart = charts.dialog.value
    if (!chart || !chartType) return

    const series = getDialogSeries(chartType, selectedPointIds)
    chart.setOption({
      series,
      legend: createCompactLegendOption(series),
      ...computeXAxisBounds(series),
    })
    chart.resize()
  }

  const overviewLineConfigs = [
    {
      chartKey: 'overviewGasTrend',
      refKey: 'overviewGasTrendChartRef',
      dataKey: 'gasMassFraction',
      title: '掩埋空间·气体质量分数趋势',
      yAxisName: '质量分数',
      unit: '',
      color: '#f59e0b',
    },
    {
      chartKey: 'overviewWindSpeed',
      refKey: 'overviewWindSpeedChartRef',
      dataKey: 'windSpeed',
      title: '风速趋势',
      yAxisName: '风速',
      unit: 'm/s',
      color: '#a855f7',
    },
    {
      chartKey: 'overviewTemperature',
      refKey: 'overviewTemperatureChartRef',
      dataKey: 'temperature',
      title: '温度趋势',
      yAxisName: '温度',
      unit: '°C',
      color: '#f97316',
    },
    {
      chartKey: 'overviewHumidity',
      refKey: 'overviewHumidityChartRef',
      dataKey: 'humidity',
      title: '湿度趋势',
      yAxisName: '湿度',
      unit: '%',
      color: '#3b82f6',
    },
    {
      chartKey: 'overviewPressure',
      refKey: 'overviewPressureChartRef',
      dataKey: 'pressure',
      title: '气压趋势',
      yAxisName: '气压',
      unit: 'kPa',
      color: '#10b981',
    },
    {
      chartKey: 'overviewWaveAttenuation',
      refKey: 'overviewWaveAttenuationChartRef',
      simulateRadarWave: 'attenuation',
      title: '电磁波衰减率',
      yAxisName: '衰减率',
      unit: '',
      color: '#3b82f6',
    },
    {
      chartKey: 'overviewWaveIntensity',
      refKey: 'overviewWaveIntensityChartRef',
      simulateRadarWave: 'intensity',
      title: '电磁波强度',
      yAxisName: '强度',
      unit: '',
      color: '#a855f7',
    },
  ]

  const overviewPieConfigs = [
    { chartKey: 'overviewGasSnapshot', refKey: 'overviewGasSnapshotChartRef' },
    {
      chartKey: 'overviewPointGasTotal',
      refKey: 'overviewPointGasTotalChartRef',
    },
  ]

  const overviewAnalyticConfigs = [
    { chartKey: 'overviewGasHeatmap', refKey: 'overviewGasHeatmapChartRef' },
    {
      chartKey: 'overviewPointSpatial',
      refKey: 'overviewPointSpatialChartRef',
    },
    { chartKey: 'overviewEnvRadar', refKey: 'overviewEnvRadarChartRef' },
  ]

  const overviewChartKeys = [
    ...overviewLineConfigs.map((cfg) => cfg.chartKey),
    ...overviewPieConfigs.map((cfg) => cfg.chartKey),
    ...overviewAnalyticConfigs.map((cfg) => cfg.chartKey),
  ]

  const overviewWaveChartKeys = ['overviewWaveAttenuation', 'overviewWaveIntensity']
  const overviewGlobalLoadingKeys = overviewChartKeys.filter(
    (key) => !overviewWaveChartKeys.includes(key),
  )

  const overviewLoadingOption = {
    text: '加载数据中...',
    color: '#67e8f9',
    textColor: '#cbd5e1',
    maskColor: 'rgba(15, 23, 42, 0.62)',
  }

  const setOverviewChartsLoading = (loading) => {
    overviewGlobalLoadingKeys.forEach((key) => {
      const chart = charts[key].value
      if (!chart) return
      if (loading) chart.showLoading('default', overviewLoadingOption)
      else chart.hideLoading()
    })
  }

  const createOverviewLineOption = (cfg, series) => {
    const baseOption = createBaseLineOption(
      cfg.title,
      cfg.yAxisName,
      cfg.color,
      cfg.unit,
    )
    const xAxisBounds = computeXAxisBounds(series).xAxis || {}
    return {
      ...baseOption,
      grid: {
        left: 56,
        right: 72,
        top: 92,
        bottom: 36,
        containLabel: true,
      },
      legend: createCompactLegendOption(series),
      graphic: series.length ? [] : createEmptyText('暂无可展示数据'),
      xAxis: {
        ...baseOption.xAxis,
        ...xAxisBounds,
        axisLabel: {
          ...baseOption.xAxis.axisLabel,
          hideOverlap: true,
          margin: 10,
        },
      },
      series,
    }
  }

  const getSnapshotTimeIndex = () => {
    if (!state.timeOptions.value.length) return -1
    let index = state.timeOptions.value.findIndex(
      (option) => option.value === state.envSnapshotTime.value,
    )
    if (index >= 0) return index

    const target = Number(state.envSnapshotTime.value)
    if (!Number.isFinite(target)) return state.timeOptions.value.length - 1

    let bestIndex = 0
    let bestDistance = Infinity
    state.timeOptions.value.forEach((option, optionIndex) => {
      const distance = Math.abs(Number(option.value) - target)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = optionIndex
      }
    })
    return bestIndex
  }

  const getOverviewPointIds = (selectedPointIds = []) => {
    if (Array.isArray(selectedPointIds) && selectedPointIds.length)
      return selectedPointIds
    if (state.pointIdsForFetch.value.length) return state.pointIdsForFetch.value
    if (state.selectedPointId.value) return [state.selectedPointId.value]
    return []
  }

  const getOverviewGasIds = (selectedGasIds = []) => {
    if (Array.isArray(selectedGasIds) && selectedGasIds.length)
      return selectedGasIds
    return state.selectedGasesForChart.value
  }

  const getPointName = (pointId) =>
    state.monitoringPoints.value.find(
      (point) => String(point.id) === String(pointId),
    )?.name || pointId

  const getGasName = (gasId) =>
    state.availableGases.value.find((gas) => gas.id === gasId)?.name || gasId

  const getFilteredNumericValues = (values) => {
    if (!values?.length) return []
    const { seriesData } = state.filterDataByTime(values)
    return seriesData
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
  }

  const getFilteredXAxisData = () => {
    if (!state.timeOptions.value.length) return []
    const { xAxisData } = state.filterDataByTime(
      new Array(state.timeOptions.value.length).fill(0),
    )
    return xAxisData
  }

  /** 任务时间轴未返回时仍为电磁波模拟曲线提供横轴，避免空白占位 */
  const RADAR_WAVE_FALLBACK_STEP_COUNT = 72
  const RADAR_WAVE_FALLBACK_T_MAX = 2

  const getRadarWaveXAxisData = () => {
    const fromTask = getFilteredXAxisData()
    if (fromTask.length) return fromTask
    const n = RADAR_WAVE_FALLBACK_STEP_COUNT
    if (n <= 1) return [0]
    return Array.from(
      { length: n },
      (_, i) => (i / (n - 1)) * RADAR_WAVE_FALLBACK_T_MAX,
    )
  }

  const buildRadarWaveSimSeries = (waveKind, pointIdsList) => {
    const ids = Array.isArray(pointIdsList) ? pointIdsList : []
    const xAxisData = getRadarWaveXAxisData()
    if (!ids.length) return []

    const baseAccent = waveKind === 'attenuation' ? '#3b82f6' : '#a855f7'

    return ids.flatMap((pointId, idx) => {
      const point = state.monitoringPoints.value.find(
        (p) => String(p.id) === String(pointId),
      )
      if (!point) return []
      const sim = simulatedRadarWaveSeries(point, xAxisData)
      const vals = waveKind === 'attenuation' ? sim.attenuation : sim.intensity
      if (!vals?.length) return []
      const color =
        ids.length === 1
          ? baseAccent
          : COLOR_PALETTE[
              (idx * 5 + (waveKind === 'attenuation' ? 2 : 5)) %
                COLOR_PALETTE.length
            ]
      const entries = vals.map((v, i) => [xAxisData[i], v])
      const gradient =
        waveKind === 'intensity'
          ? {
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: `${color}4D` },
                  { offset: 1, color: `${color}1A` },
                ]),
              },
            }
          : { areaStyle: null }
      return [
        {
          name:
            ids.length === 1
              ? waveKind === 'attenuation'
                ? '衰减率'
                : '强度'
              : `${getPointName(pointId)}`,
          type: 'line',
          smooth: true,
          data: entries,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: ids.length === 1 ? 2.25 : 1.85, color },
          itemStyle: { color },
          ...gradient,
        },
      ]
    })
  }

  const averagePositiveValues = (values) => {
    const numericValues = getFilteredNumericValues(values)
    if (!numericValues.length) return null
    return (
      numericValues.reduce((sum, value) => sum + (value > 0 ? value : 0), 0) /
      numericValues.length
    )
  }

  const getGasSnapshotPieData = (
    selectedPointIds = [],
    selectedGasIds = [],
  ) => {
    const pointIds = getOverviewPointIds(selectedPointIds)
    const gasIds = getOverviewGasIds(selectedGasIds)
    const timeIndex = getSnapshotTimeIndex()
    if (!pointIds.length || timeIndex < 0) return []

    const gasData = state.gasMassFractionData.value || {}
    return gasIds.flatMap((gasId) => {
      const value = pointIds.reduce((sum, pointId) => {
        const numeric = Number(gasData[gasId]?.[pointId]?.[timeIndex] ?? 0)
        return Number.isFinite(numeric) && numeric > 0 ? sum + numeric : sum
      }, 0)
      if (value <= 0) return []

      const gasInfo = state.availableGases.value.find((gas) => gas.id === gasId)
      return [{ name: gasInfo?.name || gasId, value }]
    })
  }

  const getPointGasTotalPieData = (
    selectedPointIds = [],
    selectedGasIds = [],
  ) => {
    const gasData = state.gasMassFractionData.value || {}
    const gasIds = getOverviewGasIds(selectedGasIds)
    return getOverviewPointIds(selectedPointIds).flatMap((pointId) => {
      let total = 0
      gasIds.forEach((gasId) => {
        const values = gasData[gasId]?.[pointId]
        if (!values?.length) return
        const { seriesData } = state.filterDataByTime(values)
        total += seriesData.reduce((sum, value) => {
          const numeric = Number(value)
          return Number.isFinite(numeric) && numeric > 0 ? sum + numeric : sum
        }, 0)
      })
      if (total <= 0) return []

      const point = state.monitoringPoints.value.find(
        (item) => item.id === pointId,
      )
      return [{ name: point?.name || pointId, value: total }]
    })
  }

  const getGasHeatmapData = (selectedPointIds = [], selectedGasIds = []) => {
    const gasData = state.gasMassFractionData.value || {}
    const pointIds = getOverviewPointIds(selectedPointIds)
    const gasIds = getOverviewGasIds(selectedGasIds)
    const pointNames = pointIds.map(getPointName)
    const gasNames = gasIds.map(getGasName)
    let hasSourceData = false
    const data = []

    pointIds.forEach((pointId, pointIndex) => {
      gasIds.forEach((gasId, gasIndex) => {
        const average = averagePositiveValues(gasData[gasId]?.[pointId])
        if (average !== null) hasSourceData = true
        data.push([gasIndex, pointIndex, average ?? 0])
      })
    })

    return {
      pointNames,
      gasNames,
      data: hasSourceData ? data : [],
      max: data.reduce((max, item) => Math.max(max, Number(item[2]) || 0), 0),
    }
  }

  const getPointSpatialData = (selectedPointIds = [], selectedGasIds = []) => {
    const gasData = state.gasMassFractionData.value || {}
    const gasIds = getOverviewGasIds(selectedGasIds)
    return getOverviewPointIds(selectedPointIds).flatMap((pointId) => {
      const point = state.monitoringPoints.value.find(
        (item) => String(item.id) === String(pointId),
      )
      const x = Number(point?.x)
      const y = Number(point?.y)
      const z = Number(point?.z)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return []

      let value = 0
      let count = 0
      gasIds.forEach((gasId) => {
        const average = averagePositiveValues(gasData[gasId]?.[pointId])
        if (average === null) return
        value += average
        count += 1
      })
      if (!count) return []

      return [
        {
          name: point?.name || pointId,
          value: [x, y, value, Number.isFinite(z) ? z : null],
        },
      ]
    })
  }

  const getEnvRadarData = (selectedPointIds = [], selectedGasIds = []) => {
    const gasData = state.gasMassFractionData.value || {}
    const gasIds = getOverviewGasIds(selectedGasIds)
    const envKeys = ['windSpeed', 'temperature', 'humidity', 'pressure']
    const xAxisRadar = getRadarWaveXAxisData()
    const rows = getOverviewPointIds(selectedPointIds).flatMap((pointId) => {
      const probe = state.monitoringPoints.value.find(
        (item) => String(item.id) === String(pointId),
      )
      const envValues = envKeys.map((key) =>
        averagePositiveValues(state.envDataHistory.value[key]?.[pointId]),
      )
      const gasValues = gasIds
        .map((gasId) => averagePositiveValues(gasData[gasId]?.[pointId]))
        .filter((value) => value !== null)
      const radarSim =
        probe && xAxisRadar.length
          ? simulatedRadarWaveSeries(probe, xAxisRadar)
          : { attenuation: [], intensity: [] }
      const attnAvg = averageOrNull(radarSim.attenuation) ?? null
      const intenAvg = averageOrNull(radarSim.intensity) ?? null
      const hasRadar = attnAvg != null || intenAvg != null
      if (
        envValues.every((value) => value === null)
        && !gasValues.length
        && !hasRadar
      ) {
        return []
      }

      return [
        {
          name: getPointName(pointId),
          raw: [
            envValues[0] ?? 0,
            envValues[1] ?? 0,
            envValues[2] ?? 0,
            envValues[3] ?? 0,
            gasValues.length
              ? gasValues.reduce((sum, value) => sum + value, 0) /
                gasValues.length
              : 0,
            attnAvg ?? 0,
            intenAvg ?? 0,
          ],
        },
      ]
    })
    const maxValues = [0, 1, 2, 3, 4, 5, 6].map((index) =>
      Math.max(...rows.map((row) => Math.abs(row.raw[index])), 0),
    )
    return rows.map((row) => ({
      name: row.name,
      raw: row.raw,
      value: row.raw.map((value, index) =>
        maxValues[index] > 0
          ? Math.min(100, (Math.abs(value) / maxValues[index]) * 100)
          : 0,
      ),
    }))
  }

  const createPieOption = (title, data, emptyText) => ({
    title: {
      text: title,
      left: 16,
      top: 12,
      textStyle: { color: '#e2e8f0', fontSize: 14 },
    },
    color: COLOR_PALETTE,
    tooltip: {
      trigger: 'item',
      formatter: (params) =>
        `${params.name}<br/>${formatChartNumericDisplay(params.value)} (${params.percent}%)`,
    },
    legend: {
      type: 'scroll',
      bottom: 8,
      left: 16,
      right: 16,
      textStyle: { color: '#cbd5e1', fontSize: 11 },
      pageIconColor: '#7dd3fc',
      pageIconInactiveColor: 'rgba(125, 211, 252, 0.35)',
      pageTextStyle: { color: '#94a3b8' },
    },
    graphic: data.length ? [] : createEmptyText(emptyText),
    series: [
      {
        name: title,
        type: 'pie',
        showEmptyCircle: false,
        radius: ['42%', '68%'],
        center: ['50%', '50%'],
        minAngle: 2,
        avoidLabelOverlap: true,
        label: {
          color: '#cbd5e1',
          formatter: '{b}\n{d}%',
        },
        labelLine: {
          lineStyle: { color: 'rgba(203, 213, 225, 0.45)' },
        },
        data,
      },
    ],
  })

  const createGasHeatmapOption = (heatmap) => ({
    title: {
      text: '探测点-气体平均质量分数热力图',
      left: 16,
      top: 12,
      textStyle: { color: '#e2e8f0', fontSize: 14 },
    },
    tooltip: {
      position: 'top',
      formatter: (params) => {
        const [gasIndex, pointIndex, value] = params.data || []
        return `${heatmap.pointNames[pointIndex] || ''}<br/>${heatmap.gasNames[gasIndex] || ''}: ${formatChartNumericDisplay(value)}`
      },
    },
    grid: {
      left: 96,
      right: 72,
      top: 76,
      bottom: 92,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: heatmap.gasNames,
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: {
        color: '#94a3b8',
        hideOverlap: true,
        interval: 0,
        margin: 10,
        rotate: 30,
      },
    },
    yAxis: {
      type: 'category',
      data: heatmap.pointNames,
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#94a3b8' },
    },
    visualMap: {
      min: 0,
      max: heatmap.max > 0 ? heatmap.max : 1,
      dimension: 2,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 20,
      textStyle: { color: '#cbd5e1' },
      inRange: { color: ['#0f172a', '#0891b2', '#f59e0b', '#ef4444'] },
    },
    graphic: heatmap.data.length ? [] : createEmptyText('暂无热力矩阵数据'),
    series: [
      {
        name: '时段均值',
        type: 'heatmap',
        data: heatmap.data,
        label: {
          show: true,
          color: '#e2e8f0',
          formatter: (params) => formatChartNumericDisplay(params.value?.[2]),
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  })

  const createPointSpatialOption = (data) => {
    const max = data.reduce(
      (current, item) => Math.max(current, Number(item.value?.[2]) || 0),
      0,
    )
    const bounds = state.geometryBounds.value || {}
    const getFiniteBound = (key, fallback) => {
      const value = Number(bounds[key])
      return Number.isFinite(value) ? value : fallback
    }

    return {
      title: {
        text: '掩埋空间·探测点平面分布（气体时间均值）',
        left: 16,
        top: 12,
        textStyle: { color: '#e2e8f0', fontSize: 14 },
      },
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          const [x, y, value, z] = params.value || []
          const zText =
            z === null || z === undefined ? '—' : formatChartNumericDisplay(z)
          return `${params.name}<br/>X: ${formatChartNumericDisplay(x)}<br/>Y: ${formatChartNumericDisplay(y)}<br/>Z: ${zText}<br/>质量分数均值: ${formatChartNumericDisplay(value)}`
        },
      },
      grid: {
        left: 64,
        right: 72,
        top: 72,
        bottom: 48,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        name: 'X',
        min: getFiniteBound('xmin', 'dataMin'),
        max: getFiniteBound('xmax', 'dataMax'),
        nameTextStyle: { color: '#94a3b8' },
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', hideOverlap: true, margin: 10 },
        splitLine: { lineStyle: { color: '#334155', opacity: 0.3 } },
      },
      yAxis: {
        type: 'value',
        name: 'Y',
        min: getFiniteBound('ymin', 'dataMin'),
        max: getFiniteBound('ymax', 'dataMax'),
        nameTextStyle: { color: '#94a3b8' },
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#334155', opacity: 0.3 } },
      },
      visualMap: {
        min: 0,
        max: max > 0 ? max : 1,
        dimension: 2,
        right: 12,
        top: 56,
        textStyle: { color: '#cbd5e1' },
        inRange: { color: ['#22d3ee', '#f59e0b', '#ef4444'] },
      },
      graphic: data.length ? [] : createEmptyText('暂无探测点分布数据'),
      series: [
        {
          name: '气体均值',
          type: 'scatter',
          data,
          symbolSize: (value) => {
            const current = Number(value?.[2]) || 0
            if (max <= 0) return 14
            return Math.max(12, Math.min(44, 12 + (current / max) * 32))
          },
          itemStyle: {
            borderColor: '#e2e8f0',
            borderWidth: 1,
            shadowBlur: 12,
            shadowColor: 'rgba(34, 211, 238, 0.35)',
          },
          label: {
            show: true,
            formatter: '{b}',
            position: 'top',
            color: '#cbd5e1',
          },
        },
      ],
    }
  }

  const createEnvRadarOption = (data) => ({
    title: {
      text: '掩埋空间·环境与电磁波探测综合',
      left: 16,
      top: 12,
      textStyle: { color: '#e2e8f0', fontSize: 14 },
    },
    color: COLOR_PALETTE,
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const raw = params.data?.raw || []
        return `${params.name}<br/>风速: ${formatChartNumericDisplay(raw[0])}m/s<br/>温度: ${formatChartNumericDisplay(raw[1])}°C<br/>湿度: ${formatChartNumericDisplay(raw[2])}%<br/>气压: ${formatChartNumericDisplay(raw[3])}kPa<br/>气体质量分数均值: ${formatChartNumericDisplay(raw[4])}<br/>电磁波衰减均值: ${formatChartNumericDisplay(raw[5])}<br/>电磁波强度均值: ${formatChartNumericDisplay(raw[6])}`
      },
    },
    legend: {
      type: 'scroll',
      bottom: 8,
      left: 16,
      right: 16,
      textStyle: { color: '#cbd5e1', fontSize: 11 },
      pageIconColor: '#7dd3fc',
      pageIconInactiveColor: 'rgba(125, 211, 252, 0.35)',
      pageTextStyle: { color: '#94a3b8' },
    },
    radar: {
      center: ['50%', '52%'],
      radius: '58%',
      indicator: [
        { name: '风速', max: 100 },
        { name: '温度', max: 100 },
        { name: '湿度', max: 100 },
        { name: '气压', max: 100 },
        { name: '气体质量分数', max: 100 },
        { name: '电磁波衰减均值', max: 100 },
        { name: '电磁波强度均值', max: 100 },
      ],
      axisName: { color: '#cbd5e1' },
      splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.28)' } },
      splitArea: {
        areaStyle: {
          color: ['rgba(15, 23, 42, 0.32)', 'rgba(15, 23, 42, 0.12)'],
        },
      },
      axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.32)' } },
    },
    graphic: data.length ? [] : createEmptyText('暂无雷达图数据'),
    series: [
      {
        name: '探测状态',
        type: 'radar',
        data,
        areaStyle: { opacity: 0.12 },
      },
    ],
  })

  const initOverviewCharts = (selectedPointIds = [], selectedGasIds = []) => {
    overviewLineConfigs.forEach((cfg) => {
      const el = refs[cfg.refKey]?.value
      if (el && !charts[cfg.chartKey].value) {
        charts[cfg.chartKey].value = echarts.init(el)
      }
    })

    overviewPieConfigs.forEach((cfg) => {
      const el = refs[cfg.refKey]?.value
      if (el && !charts[cfg.chartKey].value) {
        charts[cfg.chartKey].value = echarts.init(el)
      }
    })

    overviewAnalyticConfigs.forEach((cfg) => {
      const el = refs[cfg.refKey]?.value
      if (el && !charts[cfg.chartKey].value) {
        charts[cfg.chartKey].value = echarts.init(el)
      }
    })

    updateOverviewCharts(selectedPointIds, selectedGasIds)
    handleResize()
  }

  const updateOverviewCharts = (selectedPointIds = [], selectedGasIds = []) => {
    const pointIds = getOverviewPointIds(selectedPointIds)
    const gasIds = getOverviewGasIds(selectedGasIds)

    overviewLineConfigs.forEach((cfg) => {
      const chart = charts[cfg.chartKey].value
      if (!chart) return

      const waveGated =
        cfg.simulateRadarWave &&
        state.waveOverviewRevealAllowed &&
        !state.waveOverviewRevealAllowed.value
      if (waveGated) {
        chart.showLoading('default', overviewLoadingOption)
        return
      }

      const series = cfg.simulateRadarWave
        ? buildRadarWaveSimSeries(cfg.simulateRadarWave, pointIds)
        : getDialogSeries(cfg.dataKey, pointIds, gasIds)
      if (cfg.simulateRadarWave) chart.hideLoading()
      chart.setOption(createOverviewLineOption(cfg, series), true)
    })

    charts.overviewGasSnapshot.value?.setOption(
      createPieOption(
        '当前时刻·气体组分',
        getGasSnapshotPieData(pointIds, gasIds),
        '暂无当前时刻组分数据',
      ),
      true,
    )
    charts.overviewPointGasTotal.value?.setOption(
      createPieOption(
        '各探测点·时段内气体累计量',
        getPointGasTotalPieData(pointIds, gasIds),
        '暂无探测点累计数据',
      ),
      true,
    )
    charts.overviewGasHeatmap.value?.setOption(
      createGasHeatmapOption(getGasHeatmapData(pointIds, gasIds)),
      true,
    )
    charts.overviewPointSpatial.value?.setOption(
      createPointSpatialOption(getPointSpatialData(pointIds, gasIds)),
      true,
    )
    charts.overviewEnvRadar.value?.setOption(
      createEnvRadarOption(getEnvRadarData(pointIds, gasIds)),
      true,
    )

    overviewChartKeys.forEach((key) => charts[key].value?.resize())
  }

  const disposeOverviewCharts = () => {
    overviewChartKeys.forEach((key) => {
      charts[key].value?.dispose()
      charts[key].value = null
    })
  }

  const handleResize = () =>
    Object.values(charts).forEach((c) => c.value?.resize())
  onMounted(() => window.addEventListener('resize', handleResize))
  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    Object.values(charts).forEach((c) => c.value?.dispose())
  })

  return {
    charts,
    initCharts,
    initDialogChart,
    updateDialogChart,
    initOverviewCharts,
    updateOverviewCharts,
    setOverviewChartsLoading,
    disposeOverviewCharts,
    updateEnvCharts,
    updateGasMassFractionChart,
    handleResize,
  }
}
