import { computed } from 'vue'

const MODEL_DISPLAY_MODES = [
  { value: 'solid', label: '实体' },
  { value: 'wireframe', label: '线框' },
  { value: 'edges', label: '边线' },
]

export function useModelOpacitySettings({ visualization }) {
  const modelOpacityPercent = computed(() =>
    Math.round(
      Math.max(
        0,
        Math.min(1, Number(visualization.value?.model_opacity) || 0.35),
      ) * 100,
    ),
  )

  const realModelOpacityPercent = computed(() =>
    Math.round(
      Math.max(
        0,
        Math.min(1, Number(visualization.value?.real_model_opacity) || 1),
      ) * 100,
    ),
  )

  const meetingRoomGaussianScaleValue = computed(() =>
    Number.isFinite(Number(visualization.value?.meeting_room_gaussian_scale))
      ? Number(visualization.value.meeting_room_gaussian_scale).toFixed(2)
      : '1.00',
  )

  const personModelOpacityPercent = computed(() =>
    Math.round(
      Math.max(
        0,
        Math.min(
          1,
          Number.isFinite(Number(visualization.value?.person_model_opacity))
            ? Number(visualization.value?.person_model_opacity)
            : 1,
        ),
      ) * 100,
    ),
  )

  const personRealModelOpacityPercent = computed(() =>
    Math.round(
      Math.max(
        0,
        Math.min(
          1,
          Number.isFinite(Number(visualization.value?.person_real_model_opacity))
            ? Number(visualization.value?.person_real_model_opacity)
            : 1,
        ),
      ) * 100,
    ),
  )

  function resolveModelLayerOpacityPercent(layer) {
    return layer?.kind === 'realModel'
      ? realModelOpacityPercent.value
      : modelOpacityPercent.value
  }

  function ensureRealModelOpacityValue() {
    if (!Number.isFinite(Number(visualization.value.real_model_opacity))) {
      visualization.value.real_model_opacity = 1
    }
    if (!Number.isFinite(Number(visualization.value.meeting_room_gaussian_scale))) {
      visualization.value.meeting_room_gaussian_scale = 1
    }
    if (typeof visualization.value.meeting_room_gaussian_box_visible !== 'boolean') {
      visualization.value.meeting_room_gaussian_box_visible = true
    }
  }

  function ensurePersonModelOpacityValue() {
    if (!Number.isFinite(Number(visualization.value.person_model_opacity))) {
      visualization.value.person_model_opacity = 1
    }
    if (!Number.isFinite(Number(visualization.value.person_real_model_opacity))) {
      visualization.value.person_real_model_opacity = 1
    }
  }

  function ensureModelDissolveSettings() {
    if (!visualization.value.model_dissolve || typeof visualization.value.model_dissolve !== 'object') {
      visualization.value.model_dissolve = {}
    }
    const settings = visualization.value.model_dissolve
    if (typeof settings.enabled !== 'boolean') settings.enabled = true
    if (!Number.isFinite(Number(settings.duration))) settings.duration = 1.5
    if (!Number.isFinite(Number(settings.edge_width))) settings.edge_width = 0.045
    if (!Number.isFinite(Number(settings.particle_strength))) settings.particle_strength = 1.2
    if (typeof settings.color !== 'string' || !settings.color) settings.color = '#72ff66'
  }

  function ensureModelOpacityValues(layer) {
    if (layer?.kind === 'realModel') {
      ensureRealModelOpacityValue()
    }
    ensurePersonModelOpacityValue()
    ensureModelDissolveSettings()
  }

  return {
    modelOpacityPercent,
    realModelOpacityPercent,
    meetingRoomGaussianScaleValue,
    personModelOpacityPercent,
    personRealModelOpacityPercent,
    resolveModelLayerOpacityPercent,
    ensureRealModelOpacityValue,
    ensurePersonModelOpacityValue,
    ensureModelOpacityValues,
    ensureModelDissolveSettings,
    modelDisplayModes: MODEL_DISPLAY_MODES,
  }
}
