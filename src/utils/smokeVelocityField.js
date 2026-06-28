import { decodeNormalizedUint16 } from '@/utils/normalizedUint16.js'
import { sampleVelocityVectorAtNormalizedPosition } from '@/utils/velocityTexture3d.js'
import { getVelocityFrameSet } from '@/utils/velocityFrames.js'

function joinBaseUrl(manifestUrl, file) {
  if (/^(https?:)?\/\//i.test(file) || file.startsWith('/')) return file
  return `${manifestUrl.replace(/[^/]*$/, '')}${file}`
}

function toFieldComponent(buffer, frame, total) {
  const valueType = String(frame.variable?.valueType || frame.variable?.value_type || 'uint16')
    .toLowerCase()
  if (valueType === 'float32') return new Float32Array(buffer).slice(0, total)
  if (valueType !== 'uint16') {
    throw new Error(`不支持的速度场 valueType: ${valueType}`)
  }
  return decodeNormalizedUint16(new Uint16Array(buffer), frame.valueRange, total)
}

function toScalarComponent(buffer, valueType, valueRange, total) {
  const type = String(valueType || 'uint16').toLowerCase()
  if (type === 'float32') return new Float32Array(buffer).slice(0, total)
  if (type !== 'uint16') {
    throw new Error(`不支持的标量场 valueType: ${type}`)
  }
  return decodeNormalizedUint16(new Uint16Array(buffer), valueRange, total)
}

function toFiniteVec3(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  return fallback.map((item, index) => {
    const n = Number(value[index])
    return Number.isFinite(n) ? n : item
  })
}

function parseDims(value, fallback) {
  if (typeof value === 'string') {
    const dims = value.split(',').map((item) => Number(item.trim()))
    return toFiniteVec3(dims, fallback).map((item) => Math.max(1, Math.round(item)))
  }
  return toFiniteVec3(value, fallback).map((item) => Math.max(1, Math.round(item)))
}

function inferCubeDims(byteLength, bytesPerValue = 2) {
  const count = Math.max(1, Math.floor(byteLength / bytesPerValue))
  const cube = Math.round(Math.cbrt(count))
  if (cube * cube * cube === count) return [cube, cube, cube]
  return [count, 1, 1]
}

function buildNonZeroVelocityMask(vx, vy, vz, total) {
  const mask = new Uint8Array(total)
  for (let i = 0; i < total; i += 1) {
    if (
      Math.abs(Number(vx?.[i]) || 0) > 1e-12 ||
      Math.abs(Number(vy?.[i]) || 0) > 1e-12 ||
      Math.abs(Number(vz?.[i]) || 0) > 1e-12
    ) {
      mask[i] = 1
    }
  }
  return mask
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_\-:()]+/g, '')
}

function getFile(entry) {
  return entry?.file || entry?.file_url || entry?.url || entry?.bin_url || ''
}

function findScalarVariable(manifest, scalar) {
  const variables = Array.isArray(manifest?.variables) ? manifest.variables : []
  const target = normalizeKey(scalar)
  return variables.find((variable) =>
    normalizeKey(variable?.slug) === target || normalizeKey(variable?.name) === target
  )
}

function getScalarFrame(variable, frameIndex) {
  const frames = Array.isArray(variable?.frames) ? variable.frames : []
  const index = Math.max(0, Math.min(frames.length - 1, Math.round(Number(frameIndex) || 0)))
  const frame = frames.length ? frames[index] : null
  const file = getFile(frame) || getFile(variable)
  if (!file) throw new Error(`${variable?.slug || variable?.name || '标量变量'} 缺少 bin 文件`)
  return {
    file,
    time: frame?.time,
    valueRange: variable.originalValueRange || variable.original_value_range || [0, 1],
    valueType: variable.valueType || variable.value_type || 'uint16',
  }
}

function sampleScalarAtNormalizedPosition(field, position) {
  if (!field?.values) return { value: 0 }
  const nx = Math.max(1, Math.round(Number(field.dims?.[0]) || 1))
  const ny = Math.max(1, Math.round(Number(field.dims?.[1]) || 1))
  const nz = Math.max(1, Math.round(Number(field.dims?.[2]) || 1))
  const axis = (value, count) => {
    const f = Math.max(0, Math.min(count - 1, (Number(value) + 0.5) * count - 0.5))
    const lo = Math.floor(f)
    const hi = Math.min(count - 1, lo + 1)
    return { lo, hi, t: hi === lo ? 0 : f - lo }
  }
  const sx = axis(position?.[0] ?? 0, nx)
  const sy = axis(position?.[1] ?? 0, ny)
  const sz = axis(position?.[2] ?? 0, nz)
  const index = (x, y, z) => x + nx * (y + ny * z)
  const read = (x, y, z) => Number(field.values[index(x, y, z)]) || 0
  const lerp = (a, b, t) => a + (b - a) * t
  const c000 = read(sx.lo, sy.lo, sz.lo)
  const c100 = read(sx.hi, sy.lo, sz.lo)
  const c010 = read(sx.lo, sy.hi, sz.lo)
  const c110 = read(sx.hi, sy.hi, sz.lo)
  const c001 = read(sx.lo, sy.lo, sz.hi)
  const c101 = read(sx.hi, sy.lo, sz.hi)
  const c011 = read(sx.lo, sy.hi, sz.hi)
  const c111 = read(sx.hi, sy.hi, sz.hi)
  return {
    value: lerp(
      lerp(lerp(c000, c100, sx.t), lerp(c010, c110, sx.t), sy.t),
      lerp(lerp(c001, c101, sx.t), lerp(c011, c111, sx.t), sy.t),
      sz.t,
    ),
  }
}

export async function loadSmokeVelocityFieldFromManifestUrl(manifestUrl, frameIndex = 0) {
  const url = String(manifestUrl || '').trim()
  if (!url) throw new Error('manifest URL 为空')

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`manifest 加载失败: ${response.status}`)

  const manifest = await response.json()
  const dims = toFiniteVec3(manifest.dimensions || manifest.dims, [64, 64, 64])
    .map((value) => Math.max(1, Math.round(value)))
  const total = dims[0] * dims[1] * dims[2]
  const frameSet = getVelocityFrameSet(manifest, frameIndex)

  const buffers = await Promise.all(
    frameSet.map((frame) => fetch(joinBaseUrl(url, frame.file)).then((res) => {
      if (!res.ok) throw new Error(`${frame.file} 加载失败: ${res.status}`)
      return res.arrayBuffer()
    })),
  )

  const vx = toFieldComponent(buffers[0], frameSet[0], total)
  const vy = toFieldComponent(buffers[1], frameSet[1], total)
  const vz = toFieldComponent(buffers[2], frameSet[2], total)
  const field = {
    dims,
    vx,
    vy,
    vz,
    nonZeroMask: buildNonZeroVelocityMask(vx, vy, vz, total),
  }

  return {
    manifest,
    frameIndex,
    frameTime: frameSet[0].time ?? manifest.frameTimes?.[frameIndex] ?? null,
    field,
    sample(position) {
      return sampleVelocityVectorAtNormalizedPosition(field, position)
    },
  }
}

export async function loadSmokeScalarField({
  manifestUrl,
  scalar,
  scalarUrl,
  frameIndex = 0,
  dims,
  valueType = 'uint16',
  valueRange = [0, 1],
}) {
  const resolvedScalarUrl = String(scalarUrl || '').trim()
  const resolvedManifestUrl = String(manifestUrl || '').trim()
  const resolvedScalar = String(scalar || '').trim()
  let sourceUrl = resolvedScalarUrl
  let fieldDims = parseDims(dims, [100, 100, 100])
  let frame = { valueType, valueRange, time: null }
  let manifest = null

  if (!sourceUrl && resolvedManifestUrl) {
    const response = await fetch(resolvedManifestUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`manifest 加载失败: ${response.status}`)
    manifest = await response.json()
    const variable = findScalarVariable(manifest, resolvedScalar)
    if (variable) {
      frame = getScalarFrame(variable, frameIndex)
      sourceUrl = joinBaseUrl(resolvedManifestUrl, frame.file)
      fieldDims = parseDims(manifest.dimensions || manifest.dims, fieldDims)
    }
  }

  if (!sourceUrl && resolvedScalar) {
    sourceUrl = resolvedScalar.startsWith('/') || /^(https?:)?\/\//i.test(resolvedScalar)
      ? resolvedScalar
      : `/test-data/${resolvedScalar}.bin`
  }
  if (!sourceUrl) throw new Error('未指定气体标量 bin')

  const response = await fetch(sourceUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${sourceUrl} 加载失败: ${response.status}`)
  const buffer = await response.arrayBuffer()
  if (!dims && !manifest) {
    fieldDims = inferCubeDims(buffer.byteLength, String(frame.valueType).toLowerCase() === 'float32' ? 4 : 2)
  }
  const total = fieldDims[0] * fieldDims[1] * fieldDims[2]
  const values = toScalarComponent(buffer, frame.valueType, frame.valueRange, total)
  const field = { dims: fieldDims, values }

  return {
    manifest,
    scalar: resolvedScalar || sourceUrl,
    sourceUrl,
    frameTime: frame.time,
    field,
    valueRange: frame.valueRange,
    valueType: frame.valueType,
    sample(position) {
      return sampleScalarAtNormalizedPosition(field, position)
    },
  }
}

export function buildSmokeGridParticleSeeds(scalarField, options = {}) {
  const field = scalarField?.field || scalarField
  const values = field?.values
  const dims = parseDims(field?.dims, [1, 1, 1])
  if (!values?.length) return []

  const nx = dims[0]
  const ny = dims[1]
  const nz = dims[2]
  const expected = nx * ny * nz
  const threshold = Number.isFinite(Number(options.threshold))
    ? Number(options.threshold)
    : 0
  const rangeMin = Number.isFinite(Number(options.min)) ? Number(options.min) : 0
  const rangeMax = Number.isFinite(Number(options.max)) && Number(options.max) > rangeMin
    ? Number(options.max)
    : 1
  const maxParticles = Math.max(0, Math.round(Number(options.maxParticles) || 0))
  const worldScale = Math.max(0.001, Number(options.worldScale) || 10)
  const emitter = Array.isArray(options.emitter) ? options.emitter : [0, -0.3, 0]
  const ex = Number(emitter[0]) || 0
  const ey = Number(emitter[1]) || 0
  const ez = Number(emitter[2]) || 0
  const total = Math.min(values.length, expected)
  const candidateCount = Array.from({ length: total }).reduce(
    (sum, _, index) => sum + (Number(values[index]) > threshold ? 1 : 0),
    0,
  )
  const stride = maxParticles > 0 && candidateCount > maxParticles
    ? Math.ceil(candidateCount / maxParticles)
    : 1
  const seeds = []
  let accepted = 0

  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const index = ix + nx * (iy + ny * iz)
        if (index >= total) continue
        const value = Number(values[index]) || 0
        if (value <= threshold) continue
        accepted += 1
        if ((accepted - 1) % stride !== 0) continue

        const fx = (ix + 0.5) / nx - 0.5
        const fy = (iy + 0.5) / ny - 0.5
        const fz = (iz + 0.5) / nz - 0.5
        const normalized = Math.max(0, Math.min(1, (value - rangeMin) / (rangeMax - rangeMin)))
        seeds.push({
          x: ex + fx * worldScale,
          y: ey + (fy + 0.5) * worldScale,
          z: ez + fz * worldScale,
          value: normalized,
        })
      }
    }
  }

  return seeds
}
