import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

export function useParameterPresets(options) {
  const { form } = options

  const selectedPreset = ref('')
  const customPresets = ref([])
  const deletedBuiltinPresetKeys = ref([])

  const builtinPresets = {
    default: {
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
    },
    gale: {
      temperature: 15,
      humidity: 40,
      pressure: 100.5,
      windSpeed: 15,
      windDirectionX: 1,
      windDirectionY: 0,
      windDirectionZ: 0,
      windDirection: 'northwest',
    },
    storm: {
      temperature: 10,
      humidity: 90,
      pressure: 98.5,
      windSpeed: 25,
      windDirectionX: 1,
      windDirectionY: 0,
      windDirectionZ: 0,
      windDirection: 'south',
    },
  }

  const allPresets = computed(() => {
    const builtin = Object.entries(builtinPresets)
      .filter(([key]) => !deletedBuiltinPresetKeys.value.includes(key))
      .map(([key, val]) => ({
        key,
        name: `系统预设: ${key}`,
        isBuiltin: true,
        ...val,
      }))
    const custom = customPresets.value.map((p) => ({ ...p, isBuiltin: false }))
    return [...builtin, ...custom]
  })

  const loadCustomPresets = () => {
    try {
      const raw = localStorage.getItem('pixel_streaming_custom_presets')
      if (raw) customPresets.value = JSON.parse(raw)
      const deletedRaw = localStorage.getItem(
        'pixel_streaming_deleted_builtin_presets',
      )
      if (deletedRaw) deletedBuiltinPresetKeys.value = JSON.parse(deletedRaw)
    } catch (e) {
      console.error('Failed to load presets from localStorage', e)
    }
  }

  const saveCustomPresets = () => {
    localStorage.setItem(
      'pixel_streaming_custom_presets',
      JSON.stringify(customPresets.value),
    )
    localStorage.setItem(
      'pixel_streaming_deleted_builtin_presets',
      JSON.stringify(deletedBuiltinPresetKeys.value),
    )
  }

  const loadPreset = (presetKey) => {
    const target = allPresets.value.find((p) => p.key === presetKey)
    if (target) {
      if (
        target.windSpeed == null &&
        (target.inletWindSpeedX != null ||
          target.inletWindSpeedY != null ||
          target.inletWindSpeedZ != null)
      ) {
        const x = Number(target.inletWindSpeedX || 0)
        const y = Number(target.inletWindSpeedY || 0)
        const z = Number(target.inletWindSpeedZ || 0)
        const speed = Math.sqrt(x * x + y * y + z * z)
        form.windSpeed = Number(speed.toFixed(6))
        if (speed > 0) {
          form.windDirectionX = Number((x / speed).toFixed(6))
          form.windDirectionY = Number((y / speed).toFixed(6))
          form.windDirectionZ = Number((z / speed).toFixed(6))
        }
      }
      Object.entries(target).forEach(([k, v]) => {
        if (k in form && k !== 'key' && k !== 'name' && k !== 'isBuiltin') {
          form[k] = JSON.parse(JSON.stringify(v))
        }
      })
      ElMessage.success(`已加载预设: ${target.name}`)
    }
  }

  const handleSaveCurrentAsPreset = () => {
    ElMessageBox.prompt('请输入预设名称', '保存预设', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    }).then(({ value: name }) => {
      const newPreset = {
        key: 'custom_' + Date.now(),
        name,
        ...JSON.parse(JSON.stringify(form)),
      }
      customPresets.value.push(newPreset)
      saveCustomPresets()
      selectedPreset.value = newPreset.key
      ElMessage.success('预设保存成功')
    })
  }

  const handleDeletePreset = (presetKey) => {
    const target = allPresets.value.find((p) => p.key === presetKey)
    if (!target) return

    ElMessageBox.confirm(`确定要删除预设 "${target.name}" 吗？`, '警告', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }).then(() => {
      if (target.isBuiltin) {
        deletedBuiltinPresetKeys.value.push(presetKey)
      } else {
        customPresets.value = customPresets.value.filter(
          (p) => p.key !== presetKey,
        )
      }
      saveCustomPresets()
      if (selectedPreset.value === presetKey) selectedPreset.value = ''
      ElMessage.success('预设已删除')
    })
  }

  return {
    selectedPreset,
    allPresets,
    loadCustomPresets,
    loadPreset,
    handleSaveCurrentAsPreset,
    handleDeletePreset,
  }
}
