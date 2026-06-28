import { reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import modelApi from '@/api/model'
import taskApi from '@/api/task'
import ribbonApi from '@/api/ribbon'
import { ensureHex } from '@/utils/colormap'
import { resolveColormapColors } from '@/utils/volumeColormap'
import {
  boundaryTemperatureFromBackend,
  boundaryTemperatureToBackend,
} from '@/utils/boundaryTemperature.js'

const LEGACY_BOUNDARY_TYPE_MAP = {
  wall: 'wall',
  Wall: 'wall',
  PressureOutlet: 'pressure-outlet',
  'pressure-outlet': 'pressure-outlet',
  outlet: 'pressure-outlet',
  MassFlowInlet: 'mass-flow-inlet',
  'mass-flow-inlet': 'mass-flow-inlet',
  VelocityInlet: 'velocity-inlet',
  'velocity-inlet': 'velocity-inlet',
  inlet: 'velocity-inlet',
}

const BOUNDARY_FIELD_KEYS = [
  'temperature',
  'mass_flow_rate',
  'species_fractions',
  'velocity_x',
  'velocity_y',
  'velocity_z',
]

const normalizeBoundaryType = (type) =>
  LEGACY_BOUNDARY_TYPE_MAP[String(type ?? '').trim()] || 'wall'

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const normalizeSpeciesFractions = (value) => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {}
}

const createBoundaryDefaults = (type = 'wall') => {
  const normalizedType = normalizeBoundaryType(type)
  const defaults = {
    name: '',
    type: normalizedType,
    temperature: null,
  }

  if (normalizedType === 'mass-flow-inlet') {
    defaults.mass_flow_rate = 0
    defaults.species_fractions = {}
  }

  if (normalizedType === 'velocity-inlet') {
    defaults.velocity_x = 0
    defaults.velocity_y = 0
    defaults.velocity_z = 0
  }

  return defaults
}

const normalizeBoundaryConditionToForm = (item = {}) => {
  const type = normalizeBoundaryType(item?.type)
  const normalized = createBoundaryDefaults(type)

  normalized.name = String(item?.name ?? '')
  normalized.temperature = boundaryTemperatureFromBackend(item?.temperature)

  if (type === 'mass-flow-inlet') {
    normalized.mass_flow_rate = toFiniteNumber(item?.mass_flow_rate, 0)
    normalized.species_fractions = normalizeSpeciesFractions(
      item?.species_fractions,
    )
  }

  if (type === 'velocity-inlet') {
    const velocity = Array.isArray(item?.velocity) ? item.velocity : []
    normalized.velocity_x = toFiniteNumber(item?.velocity_x ?? velocity[0], 0)
    normalized.velocity_y = toFiniteNumber(item?.velocity_y ?? velocity[1], 0)
    normalized.velocity_z = toFiniteNumber(item?.velocity_z ?? velocity[2], 0)
  }

  return normalized
}

const buildBoundaryConditionForSubmit = (item = {}) => {
  const type = normalizeBoundaryType(item?.type)
  const result = {
    name: String(item?.name ?? '').trim(),
    type,
  }
  const temperatureK = boundaryTemperatureToBackend(item?.temperature)
  if (temperatureK != null) {
    result.temperature = temperatureK
  }

  if (type === 'mass-flow-inlet') {
    result.mass_flow_rate = toFiniteNumber(item?.mass_flow_rate, 0)
    result.species_fractions = normalizeSpeciesFractions(item?.species_fractions)
  }

  if (type === 'velocity-inlet') {
    result.velocity_x = toFiniteNumber(item?.velocity_x, 0)
    result.velocity_y = toFiniteNumber(item?.velocity_y, 0)
    result.velocity_z = toFiniteNumber(item?.velocity_z, 0)
  }

  return result
}

const stripBoundaryTypeFields = (item = {}) => {
  const cleaned = { ...item }
  BOUNDARY_FIELD_KEYS.forEach((key) => {
    delete cleaned[key]
  })
  delete cleaned.velocity
  delete cleaned.pressure
  delete cleaned.species_fraction_ids
  return cleaned
}

export function useParameterForm(options) {
  const { props, emit, getContourRibbonCatalog } = options

  const normalizeColorList = (colors) =>
    Array.isArray(colors) ? colors.map(ensureHex).filter(Boolean) : []

  const isSameColorList = (left, right) => {
    const a = normalizeColorList(left)
    const b = normalizeColorList(right)
    if (a.length !== b.length) return false
    return a.every((color, index) => color === b[index])
  }

  const mapContourArrayToForm = async (contourList) => {
    const entries = Array.isArray(contourList) ? contourList : []
    if (!entries.length) {
      form.pregenContourVariableCmaps = {}
      return
    }

    try {
      const response = await ribbonApi.getRibbons({ page: 1, page_size: 200 })
      const catalog = response?.data?.items || response?.items || []
      const nextVariableCmaps = {}

      for (const item of entries) {
        const variable = String(item?.variable || '').trim()
        const colors = normalizeColorList(item?.custom_colors)
        if (!variable || !colors.length) continue

        const matchedRibbon = (Array.isArray(catalog) ? catalog : []).find(
          (ribbon) => isSameColorList(ribbon?.colors, colors),
        )
        if (matchedRibbon?.id) {
          nextVariableCmaps[variable] = matchedRibbon.id
        }
      }

      form.pregenContourVariableCmaps = nextVariableCmaps
      const firstMatched = Object.values(nextVariableCmaps)[0]
      if (firstMatched) {
        form.pregenContourCmap = firstMatched
      }
    } catch (error) {
      console.warn(
        'Failed to map contour color config from ribbon catalog',
        error,
      )
      form.pregenContourVariableCmaps = {}
    }
  }

  const loadContourConfigToForm = (contourConfig) => {
    if (!contourConfig) {
      form.pregenContourVariableCmaps = {}
      return
    }

    if (Array.isArray(contourConfig)) {
      form.pregenContourCustomColors = []
      void mapContourArrayToForm(contourConfig)
      return
    }

    form.pregenContourCmap = contourConfig.cmap ?? 'coolwarm'
    form.pregenContourCustomColors = normalizeColorList(
      contourConfig.custom_colors,
    )
    form.pregenContourVariableCmaps = {
      ...(contourConfig.variable_cmaps || contourConfig.gas_cmaps || {}),
    }
  }

  const buildContourSubmitConfigFromForm = async () => {
    let ribbonCatalog = getContourRibbonCatalog?.() ?? []
    if (!Array.isArray(ribbonCatalog) || ribbonCatalog.length === 0) {
      try {
        const response = await ribbonApi.getRibbons({ page: 1, page_size: 200 })
        ribbonCatalog = response?.data?.items || response?.items || []
      } catch (error) {
        console.warn('Failed to load ribbon catalog for contour submit', error)
        ribbonCatalog = []
      }
    }

    const variableCmaps = { ...(form.pregenContourVariableCmaps || {}) }
    const defaultCmap = form.pregenContourCmap || 'coolwarm'
    const manualColors = normalizeColorList(form.pregenContourCustomColors)
    const variables = Object.keys(variableCmaps).filter(Boolean)

    const entries = variables
      .map((variable) => {
        const cmapValue = variableCmaps[variable] || defaultCmap
        const customColors = resolveColormapColors(
          cmapValue,
          manualColors,
          ribbonCatalog,
        )
        if (!Array.isArray(customColors) || customColors.length === 0) {
          return null
        }
        return {
          variable,
          custom_colors: normalizeColorList(customColors),
        }
      })
      .filter(Boolean)

    if (entries.length > 0) return entries

    const originalContour =
      getPregenConfig(props.initialData?.params || props.initialData)?.contour ??
      props.initialData?.pregen_config?.contour
    return Array.isArray(originalContour) ? originalContour : []
  }

  const form = reactive({
    temperature: 25,
    humidity: 60,
    pressure: 101.325,
    windSpeed: 5,
    windDirectionX: 1,
    windDirectionY: 0,
    windDirectionZ: 0,
    windDirection: 'north',
    enablePregen: true,
    pregenPlaneSpacing: 10,
    pregenPointSpacing: 200,
    pregenContourCmap: 'coolwarm',
    pregenContourCustomColors: [],
    pregenContourVariableCmaps: {},
    pregenVectorColor: 'black',
    pregenVectorStreamlineColor: '',
    pregenVectorArrowColor: '',
    pregenVectorSeedColor: '',
    pregenVectorQualityPreset: '1k',
    pregenVectorTransparentBackground: true,
    pregenVectorGlyphDensity: 4,
    pregenVectorLineWidth: 1,
    pregenStreamlineSeedCount: 50,
    pregenStreamlinePointsPerStreamline: 30,
    pregenStreamlineCenter: null,
    pregenStreamlineRadius: null,
    pregenStreamlineMaximumStreamlineLength: null,
    pregenVolumeResolution: 64,
    pregenVolumeSamplingRatio: '',
    pregenVolumeTextureResolution: 64,
    pregenVolumeTextureSamplingRatio: 1,
    boundaryConditions: [
      createBoundaryDefaults('wall'),
    ],
  })

  const getPregenConfig = (params) =>
    params?.pregen_config ||
    props.initialData?.pregen_config ||
    props.initialData?.params?.pregen_config ||
    null

  const normalizeVelocityToForm = (velocity) => {
    const values = Array.isArray(velocity) ? velocity : [velocity, 0, 0]
    const x = Number(values[0] || 0)
    const y = Number(values[1] || 0)
    const z = Number(values[2] || 0)
    const speed = Math.sqrt(x * x + y * y + z * z)
    form.windSpeed = Number(speed.toFixed(6))
    if (speed > 0) {
      form.windDirectionX = Number((x / speed).toFixed(6))
      form.windDirectionY = Number((y / speed).toFixed(6))
      form.windDirectionZ = Number((z / speed).toFixed(6))
    }
  }

  const buildInletWindSpeedFromForm = () => {
    const speed = Number(form.windSpeed)
    if (!Number.isFinite(speed) || speed < 0) return null
    const x = Number(form.windDirectionX) || 0
    const y = Number(form.windDirectionY) || 0
    const z = Number(form.windDirectionZ) || 0
    return [
      Number((x * speed).toFixed(6)),
      Number((y * speed).toFixed(6)),
      Number((z * speed).toFixed(6)),
    ]
  }

  const normalizeBoundaryConditionsToForm = (boundaryConditions) => {
    const items = Array.isArray(boundaryConditions) ? boundaryConditions : []
    form.boundaryConditions = items.length
      ? items.map(normalizeBoundaryConditionToForm)
      : [createBoundaryDefaults('wall')]
  }

  const buildBoundaryConditionsFromForm = () =>
    (Array.isArray(form.boundaryConditions) ? form.boundaryConditions : [])
      .map(buildBoundaryConditionForSubmit)
      .filter((item) => item.name)

  const mapBackendParamsToForm = (params) => {
    if (!params) return
    if (params.operating_temperature != null) {
      const tempK = Number(params.operating_temperature)
      form.temperature =
        tempK > 200
          ? Number((tempK - 273.15).toFixed(2))
          : Number(tempK.toFixed(2))
    }
    if (params.operating_pressure != null) {
      let val = Number(params.operating_pressure)
      if (val > 2000) val = val / 1000
      form.pressure = Number(val.toFixed(3))
    }
    if (params.humidity != null) form.humidity = Number(params.humidity)

    if (params.inlet_wind_speed != null) {
      normalizeVelocityToForm(params.inlet_wind_speed)
    }

    const boundaryConditions =
      params.boundary_conditions || params.metadata?.boundary_conditions || []
    normalizeBoundaryConditionsToForm(boundaryConditions)
    if (boundaryConditions) {
      const inlet = boundaryConditions.find((bc) => bc.name === 'inlet')
      if (inlet?.velocity) {
        normalizeVelocityToForm(inlet.velocity)
      }
    }
    if (params.wind_direction) form.windDirection = params.wind_direction

    const pc = getPregenConfig(params)
    if (pc) {
      form.enablePregen = pc.enabled ?? true
      form.pregenPlaneSpacing = pc.plane_spacing ?? 0.01
      form.pregenPointSpacing = pc.point_spacing ?? 0.02
      loadContourConfigToForm(pc.contour)
      if (pc.vector) {
        Object.keys(pc.vector).forEach((k) => {
          const key =
            'pregenVector' +
            k.charAt(0).toUpperCase() +
            k.slice(1).replace(/_([a-z])/g, (g) => g[1].toUpperCase())
          if (key in form) {
            // 处理颜色属性，确保十六进制格式
            if (k.includes('color')) {
              const colorValue = pc.vector[k]
              if (colorValue) {
                // 确保颜色是十六进制格式
                const raw = String(colorValue ?? '')
                  .trim()
                  .toLowerCase()
                if (/^#[0-9a-f]{6}$/i.test(raw)) {
                  form[key] = raw
                } else if (/^#[0-9a-f]{3}$/i.test(raw)) {
                  form[key] =
                    `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
                } else {
                  // 如果不是十六进制，保持原值
                  form[key] = colorValue
                }
              } else {
                form[key] = ''
              }
            } else {
              form[key] = pc.vector[k]
            }
          }
        })
      }
      if (pc.streamline) {
        form.pregenStreamlineSeedCount = pc.streamline.seed_count ?? 50
        form.pregenStreamlinePointsPerStreamline =
          pc.streamline.points_per_streamline ?? 30
        if (pc.streamline.center != null) {
          form.pregenStreamlineCenter = pc.streamline.center
        }
        if (pc.streamline.radius != null) {
          form.pregenStreamlineRadius = pc.streamline.radius
        }
        if (pc.streamline.maximum_streamline_length != null) {
          form.pregenStreamlineMaximumStreamlineLength =
            pc.streamline.maximum_streamline_length
        }
      }
      if (pc.volume) {
        const resolution = Number(pc.volume.resolution)
        const samplingRatio = Number(pc.volume.sampling_ratio)
        if (Number.isFinite(resolution) && resolution > 0) {
          form.pregenVolumeResolution = resolution
          form.pregenVolumeSamplingRatio = ''
        } else if (Number.isFinite(samplingRatio) && samplingRatio > 0) {
          form.pregenVolumeResolution = ''
          form.pregenVolumeSamplingRatio = samplingRatio
        } else {
          form.pregenVolumeResolution = 64
          form.pregenVolumeSamplingRatio = ''
        }
      }
      if (pc.volume_texture) {
        if (pc.volume_texture.resolution != null) {
          form.pregenVolumeTextureResolution = pc.volume_texture.resolution
        }
        if (pc.volume_texture.sampling_ratio != null) {
          form.pregenVolumeTextureSamplingRatio =
            pc.volume_texture.sampling_ratio
        }
      }
    } else {
      form.pregenContourVariableCmaps = {}
    }
  }

  const fetchModelInfo = async (id) => {
    if (!id || props.taskId) return
    try {
      const res = await modelApi.getModelInfo(id)
      mapBackendParamsToForm(res)
    } catch (e) {
      console.error('Failed to fetch model info', e)
    }
  }

  const submitForm = async (silent = false) => {
    if (!props.taskId) {
      if (!silent) ElMessage.success('运行演示模式')
      return { ok: true }
    }
    try {
      const original = props.initialData?.params || props.initialData || {}
      const originalBcs = Array.isArray(original.boundary_conditions)
        ? JSON.parse(JSON.stringify(original.boundary_conditions))
        : []
      const bcs = buildBoundaryConditionsFromForm().map((bc) => {
        const originalBc = originalBcs.find((item) => item?.name === bc.name)
        return originalBc ? { ...stripBoundaryTypeFields(originalBc), ...bc } : bc
      })

      const contourConfig = await buildContourSubmitConfigFromForm()

      const volumeResolution = Number(form.pregenVolumeResolution)
      const volumeSamplingRatio = Number(form.pregenVolumeSamplingRatio)
      const volumeConfig = {}
      if (Number.isFinite(volumeResolution) && volumeResolution > 0) {
        volumeConfig.resolution = volumeResolution
      } else if (
        Number.isFinite(volumeSamplingRatio) &&
        volumeSamplingRatio > 0
      ) {
        volumeConfig.sampling_ratio = volumeSamplingRatio
      }

      const updateData = {
        params: {
          ...original,
          operating_pressure: form.pressure * 1000,
          operating_temperature: Number((form.temperature + 273.15).toFixed(2)),
          humidity: Number(form.humidity),
          inlet_wind_speed: buildInletWindSpeedFromForm(),
          ...(form.windDirection ? { wind_direction: form.windDirection } : {}),
          boundary_conditions: bcs,
        },
        pregen_config: {
          enabled: form.enablePregen,
          plane_spacing: form.pregenPlaneSpacing,
          point_spacing: form.pregenPointSpacing,
          contour: contourConfig,
          vector: {
            color: form.pregenVectorColor,
            quality_preset: form.pregenVectorQualityPreset,
            transparent_background: form.pregenVectorTransparentBackground,
            glyph_density: form.pregenVectorGlyphDensity,
            line_width: form.pregenVectorLineWidth,
            ...(form.pregenVectorStreamlineColor
              ? { streamline_color: form.pregenVectorStreamlineColor }
              : {}),
            ...(form.pregenVectorArrowColor
              ? { arrow_color: form.pregenVectorArrowColor }
              : {}),
            ...(form.pregenVectorSeedColor
              ? { seed_color: form.pregenVectorSeedColor }
              : {}),
          },
          streamline: {
            seed_count: form.pregenStreamlineSeedCount,
            points_per_streamline: form.pregenStreamlinePointsPerStreamline,
            ...(form.pregenStreamlineCenter != null
              ? { center: form.pregenStreamlineCenter }
              : {}),
            ...(form.pregenStreamlineRadius != null
              ? { radius: form.pregenStreamlineRadius }
              : {}),
            ...(form.pregenStreamlineMaximumStreamlineLength != null
              ? {
                  maximum_streamline_length:
                    form.pregenStreamlineMaximumStreamlineLength,
                }
              : {}),
          },
          volume: volumeConfig,
          volume_texture: {
            resolution: form.pregenVolumeTextureResolution,
            sampling_ratio: form.pregenVolumeTextureSamplingRatio,
          },
        },
      }
      await taskApi.updateTask(props.taskId, updateData)
      ElMessage.success(silent ? '参数已自动保存' : '任务参数保存成功')
      return { ok: true, updateData }
    } catch (e) {
      ElMessage.error('保存失败: ' + (e.message || '未知错误'))
      return { ok: false }
    }
  }

  return { form, fetchModelInfo, submitForm, mapBackendParamsToForm }
}
