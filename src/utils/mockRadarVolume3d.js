/**
 * 主页面「体渲染 × 雷达类型」占位：与 /test-leida 三维体相同的标量场、直方图拉伸与默认体种子，
 * 生成为 Fluent 管线兼容的 manifest + uint16 VTK 序 bin blob。
 */

import {
  DEFAULT_RADAR_FREQUENCY,
  RADAR_FREQUENCY_OPTIONS,
  normalizeRadarFrequencies,
} from '@/constants/radarFrequencies.js'
import {
  RADAR_POLAR_LU_MAX,
  RADAR_POLAR_LU_MIN,
  bandRadialScale,
} from '@/utils/radarPolarLuminanceMock.js'
import {
  TEST_LEIDA_DEFAULT_VOLUME_SEED,
  fillRadarVolumeNormalizedGridVtkIxIyIz,
  histogramContrastStretchVoxel,
} from '@/utils/radarVolumeScalarMock.js'

export const RADAR_MOCK_VOLUME_VARIABLE_ID = 'RadarMockVolume3D'
export const RADAR_MOCK_VOLUME_VARIABLE_PREFIX = `${RADAR_MOCK_VOLUME_VARIABLE_ID}:`

/** 与同测试页 PPI / 体 VTK 取值一致，用于色标注解 */
export const RADAR_VOLUME_LUM_MIN = RADAR_POLAR_LU_MIN
export const RADAR_VOLUME_LUM_MAX = RADAR_POLAR_LU_MAX

export function buildRadarMockVolumeVariableId(bandId) {
  const picked = pickPrimaryRadarBandId([bandId])
  return `${RADAR_MOCK_VOLUME_VARIABLE_PREFIX}${picked}`
}

export function isRadarMockVolumeVariableId(value) {
  const text = String(value ?? '').trim()
  return (
    text === RADAR_MOCK_VOLUME_VARIABLE_ID ||
    text.startsWith(RADAR_MOCK_VOLUME_VARIABLE_PREFIX)
  )
}

export function extractRadarMockVolumeBandId(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text === RADAR_MOCK_VOLUME_VARIABLE_ID) return null
  if (!text.startsWith(RADAR_MOCK_VOLUME_VARIABLE_PREFIX)) return null
  const bandId = text.slice(RADAR_MOCK_VOLUME_VARIABLE_PREFIX.length).trim()
  return bandId || null
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

function floatsToVTKUint16LE(floatNormalized, vminLu, vmaxLu) {
  const n = floatNormalized.length
  const vtk = new Uint16Array(n)
  const spanLu = Math.max(vmaxLu - vminLu, 1e-6)
  for (let i = 0; i < n; i += 1) {
    const fn = clamp01(floatNormalized[i])
    if (fn < 0.02) {
      vtk[i] = 0
      continue
    }
    const lum = vminLu + fn * spanLu
    const t = (lum - vminLu) / spanLu
    const q = clamp01(t)
    vtk[i] = Math.max(
      1,
      Math.min(65535, Math.round(1 + q * (65535 - 1))),
    )
  }
  return vtk.buffer.slice(vtk.byteOffset, vtk.byteOffset + vtk.byteLength)
}

function cubeGridDimsFromVisualization(vol) {
  const raw = Number(vol?.volume_resolution ?? 48)
  const base = Number.isFinite(raw) ? raw : 48
  const n = Math.min(96, Math.max(24, Math.round(base)))
  return { nx: n, ny: n, nz: n }
}

function pickPrimaryRadarBandId(bandIds) {
  const ids = normalizeRadarFrequencies(bandIds)
  if (ids.length) return ids[0]
  const first = RADAR_FREQUENCY_OPTIONS[0]
  return first?.id ?? DEFAULT_RADAR_FREQUENCY
}

/**
 * @returns {{ val_min:number, val_max:number, vmin:number, vmax:number, datasets: object[] }}
 */
export function buildRadarVolumeMockApiChunk({
  visualization,
  taskId: _taskId,
  timeSteps,
  radarBandId = null,
}) {
  const bands = normalizeRadarFrequencies(
    visualization?.radar_frequencies ?? visualization?.radar_frequency ?? [],
  )
  const bandId = pickPrimaryRadarBandId(radarBandId != null ? [radarBandId] : bands)
  const variableId = buildRadarMockVolumeVariableId(bandId)
  const bs = bandRadialScale(bandId)
  const dims = cubeGridDimsFromVisualization(visualization)
  const { nx, ny, nz } = dims
  const extentCm = 9000
  const origin = [-extentCm / 2, -extentCm / 2, -extentCm / 2]
  const g1 = Math.max(1, nx - 1)
  const spacing = [extentCm / g1, extentCm / g1, extentCm / g1]

  const scratch = new Float32Array(nx * ny * nz)

  const manifestBase = {
    description: 'Synthetic radar volume (test-leida compatible scalar field)',
    dimensions: [nx, ny, nz],
    origin,
    spacing,
    arrayOrder: 'C',
    layout: 'voxel[x,y,z]',
    variables: [
      {
        name: variableId,
        slug: `radarmockvolume3d-${String(bandId).replace(/[^a-z0-9]+/gi, '-')}`,
        file: 'radar_mock_volume.bin',
        valueType: 'uint16',
        normalized: false,
        originalValueRange: [RADAR_VOLUME_LUM_MIN, RADAR_VOLUME_LUM_MAX],
      },
    ],
  }

  const volumeNoiseSeed = TEST_LEIDA_DEFAULT_VOLUME_SEED >>> 0

  const datasets = (Array.isArray(timeSteps) ? timeSteps : [])
    .map((t) => Number(t))
    .filter((x) => Number.isFinite(x))
    .map((step) => {
      const safeStep = Number(step)
      const stepSeed = (
        (volumeNoiseSeed + Math.imul(Number.isFinite(safeStep) ? safeStep : 0, 1103515245)) >>>
        0
      )
      fillRadarVolumeNormalizedGridVtkIxIyIz(
        nx,
        ny,
        nz,
        bs,
        stepSeed,
        scratch,
      )
      histogramContrastStretchVoxel(scratch)
      const binBuf = floatsToVTKUint16LE(
        scratch,
        RADAR_VOLUME_LUM_MIN,
        RADAR_VOLUME_LUM_MAX,
      )
      const binBlob = new Blob([binBuf], { type: 'application/octet-stream' })
      const binUrl = URL.createObjectURL(binBlob)
      const manifest = { ...manifestBase, time_step: step }
      const manBlob = new Blob([JSON.stringify(manifest)], {
        type: 'application/json',
      })
      const manifestUrl = URL.createObjectURL(manBlob)
      return {
        time_step: step,
        manifest_url: manifestUrl,
        dimensions: [nx, ny, nz],
        origin,
        spacing,
        bin_urls: {
          [variableId]: binUrl,
        },
        variables: manifestBase.variables.map((row) => ({ ...row })),
      }
    })

  return {
    val_min: RADAR_VOLUME_LUM_MIN,
    val_max: RADAR_VOLUME_LUM_MAX,
    vmin: RADAR_VOLUME_LUM_MIN,
    vmax: RADAR_VOLUME_LUM_MAX,
    datasets,
    variable: variableId,
  }
}
