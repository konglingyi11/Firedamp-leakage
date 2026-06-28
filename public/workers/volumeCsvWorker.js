const DEFAULT_DIMS = 128
const MAX_DIMS = 160
const MIN_DIMS = 32

const SIZE_SMALL = 50 * 1024 * 1024
const SIZE_MEDIUM = 500 * 1024 * 1024
const SIZE_LARGE = 2 * 1024 * 1024 * 1024

const HEADER_ALIASES = {
  x: ['x', 'X', 'coord_x', 'pos_x', 'px'],
  y: ['y', 'Y', 'coord_y', 'pos_y', 'py'],
  z: ['z', 'Z', 'coord_z', 'pos_z', 'pz'],
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function parseCsvLine(line) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

function normalizeName(value) {
  return String(value ?? '').trim()
}

function findIndex(headers, aliases, fallbackName = '') {
  const normalizedHeaders = headers.map(normalizeName)
  const direct = normalizedHeaders.findIndex(
    (item) => item.toLowerCase() === normalizeName(fallbackName).toLowerCase(),
  )
  if (direct >= 0) return direct
  for (const alias of aliases) {
    const hit = normalizedHeaders.findIndex(
      (item) => item.toLowerCase() === alias.toLowerCase(),
    )
    if (hit >= 0) return hit
  }
  return -1
}

function inferDims(rowCount, requestedDims) {
  const explicit = Number(requestedDims)
  if (Number.isFinite(explicit) && explicit > 0) {
    return clamp(Math.round(explicit), MIN_DIMS, MAX_DIMS)
  }
  if (rowCount > 2_000_000) return 96
  if (rowCount > 800_000) return 112
  if (rowCount > 250_000) return 128
  return DEFAULT_DIMS
}

function parseNumeric(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function scanBounds(lines, indices) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
    minValue: Infinity,
    maxValue: -Infinity,
    rowCount: 0,
  }
  for (const line of lines) {
    if (!line) continue
    const cells = parseCsvLine(line)
    const x = parseNumeric(cells[indices.x])
    const y = parseNumeric(cells[indices.y])
    const z = parseNumeric(cells[indices.z])
    const value = parseNumeric(cells[indices.value])
    if (x == null || y == null || z == null || value == null) continue
    bounds.minX = Math.min(bounds.minX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.minZ = Math.min(bounds.minZ, z)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.maxY = Math.max(bounds.maxY, y)
    bounds.maxZ = Math.max(bounds.maxZ, z)
    bounds.minValue = Math.min(bounds.minValue, value)
    bounds.maxValue = Math.max(bounds.maxValue, value)
    bounds.rowCount += 1
  }
  return bounds
}

function voxelize(lines, indices, dims, bounds) {
  const voxelCount = dims * dims * dims
  const sums = new Float32Array(voxelCount)
  const counts = new Uint32Array(voxelCount)
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6)

  for (const line of lines) {
    if (!line) continue
    const cells = parseCsvLine(line)
    const x = parseNumeric(cells[indices.x])
    const y = parseNumeric(cells[indices.y])
    const z = parseNumeric(cells[indices.z])
    const value = parseNumeric(cells[indices.value])
    if (x == null || y == null || z == null || value == null) continue
    const ix = clamp(Math.floor(((x - bounds.minX) / spanX) * (dims - 1)), 0, dims - 1)
    const iy = clamp(Math.floor(((y - bounds.minY) / spanY) * (dims - 1)), 0, dims - 1)
    const iz = clamp(Math.floor(((z - bounds.minZ) / spanZ) * (dims - 1)), 0, dims - 1)
    const index = ix + iy * dims + iz * dims * dims
    sums[index] += value
    counts[index] += 1
  }

  const data = new Uint8Array(voxelCount)
  const minValue = Number.isFinite(bounds.minValue) ? bounds.minValue : 0
  const maxValue = Number.isFinite(bounds.maxValue) && bounds.maxValue !== minValue
    ? bounds.maxValue
    : minValue + 1
  for (let index = 0; index < voxelCount; index += 1) {
    if (counts[index] === 0) continue
    const avg = sums[index] / counts[index]
    const normalized = clamp((avg - minValue) / (maxValue - minValue), 0, 1)
    data[index] = Math.round(normalized * 255)
  }
  return data
}

async function getFileSize(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    const contentLength = response.headers.get('content-length')
    return contentLength ? parseInt(contentLength, 10) : null
  } catch {
    return null
  }
}

async function loadSmallFile(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)
  const text = await response.text()
  return text.split(/\r?\n/)
}

async function* streamReadLines(response, chunkSize = 64 * 1024) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let offset = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      if (buffer) yield buffer
      break
    }
    buffer += decoder.decode(value, { stream: true })
    offset += value.length
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      yield line
    }
    self.postMessage({ type: 'progress', offset, size: offset })
  }
  if (buffer) yield buffer
}

async function loadMediumFile(url, variable) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
  const totalSize = contentLength || null

  let headers = null
  const indices = {}
  let bounds = null
  let lineBuffer = []
  let linesParsed = 0
  const progressInterval = 50000

  for await (const line of streamReadLines(response)) {
    if (!headers) {
      headers = parseCsvLine(line).map(normalizeName)
      indices.x = findIndex(headers, HEADER_ALIASES.x, 'x')
      indices.y = findIndex(headers, HEADER_ALIASES.y, 'y')
      indices.z = findIndex(headers, HEADER_ALIASES.z, 'z')
      indices.value = findIndex(headers, [normalizeName(variable)], variable)
      if (indices.x < 0 || indices.y < 0 || indices.z < 0 || indices.value < 0) {
        throw new Error(`CSV missing required columns for variable "${variable}"`)
      }
      bounds = {
        minX: Infinity, minY: Infinity, minZ: Infinity,
        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        minValue: Infinity, maxValue: -Infinity, rowCount: 0,
      }
      self.postMessage({ type: 'progress', phase: 'scanning', offset: 0, size: totalSize })
      continue
    }

    lineBuffer.push(line)
    linesParsed++

    if (linesParsed % progressInterval === 0) {
      self.postMessage({ type: 'progress', phase: 'scanning', offset: linesParsed, size: totalSize, rows: linesParsed })
    }

    if (lineBuffer.length >= 10000) {
      const processedBounds = scanBounds(lineBuffer, indices)
      Object.assign(bounds, {
        minX: Math.min(bounds.minX, processedBounds.minX),
        minY: Math.min(bounds.minY, processedBounds.minY),
        minZ: Math.min(bounds.minZ, processedBounds.minZ),
        maxX: Math.max(bounds.maxX, processedBounds.maxX),
        maxY: Math.max(bounds.maxY, processedBounds.maxY),
        maxZ: Math.max(bounds.maxZ, processedBounds.maxZ),
        minValue: Math.min(bounds.minValue, processedBounds.minValue),
        maxValue: Math.max(bounds.maxValue, processedBounds.maxValue),
        rowCount: bounds.rowCount + processedBounds.rowCount,
      })
      lineBuffer = []
    }
  }

  if (lineBuffer.length > 0) {
    const processedBounds = scanBounds(lineBuffer, indices)
    Object.assign(bounds, {
      minX: Math.min(bounds.minX, processedBounds.minX),
      minY: Math.min(bounds.minY, processedBounds.minY),
      minZ: Math.min(bounds.minZ, processedBounds.minZ),
      maxX: Math.max(bounds.maxX, processedBounds.maxX),
      maxY: Math.max(bounds.maxY, processedBounds.maxY),
      maxZ: Math.max(bounds.maxZ, processedBounds.maxZ),
      minValue: Math.min(bounds.minValue, processedBounds.minValue),
      maxValue: Math.max(bounds.maxValue, processedBounds.maxValue),
      rowCount: bounds.rowCount + processedBounds.rowCount,
    })
  }

  return bounds
}

async function loadLargeFileChunked(url, variable, dims, onProgress) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
  const totalSize = contentLength || null

  const voxelCount = dims * dims * dims
  const sums = new Float32Array(voxelCount)
  const counts = new Uint32Array(voxelCount)

  const bounds = {
    minX: Infinity, minY: Infinity, minZ: Infinity,
    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    minValue: Infinity, maxValue: -Infinity, rowCount: 0,
  }

  let headers = null
  const indices = {}
  let lineBuffer = []
  let bytesRead = 0
  let lastProgressReport = 0

  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6)

  for await (const line of streamReadLines(response)) {
    if (!headers) {
      headers = parseCsvLine(line).map(normalizeName)
      indices.x = findIndex(headers, HEADER_ALIASES.x, 'x')
      indices.y = findIndex(headers, HEADER_ALIASES.y, 'y')
      indices.z = findIndex(headers, HEADER_ALIASES.z, 'z')
      indices.value = findIndex(headers, [normalizeName(variable)], variable)
      if (indices.x < 0 || indices.y < 0 || indices.z < 0 || indices.value < 0) {
        throw new Error(`CSV missing required columns for variable "${variable}"`)
      }
      self.postMessage({ type: 'progress', phase: 'loading', offset: 0, size: totalSize, rows: 0 })
      continue
    }

    lineBuffer.push(line)
    bytesRead += line.length + 1

    const now = Date.now()
    if (now - lastProgressReport > 200) {
      self.postMessage({
        type: 'progress',
        phase: 'loading',
        offset: bytesRead,
        size: totalSize,
        rows: bounds.rowCount,
      })
      lastProgressReport = now
    }

    if (lineBuffer.length >= 20000) {
      for (const line of lineBuffer) {
        const cells = parseCsvLine(line)
        const x = parseNumeric(cells[indices.x])
        const y = parseNumeric(cells[indices.y])
        const z = parseNumeric(cells[indices.z])
        const value = parseNumeric(cells[indices.value])
        if (x == null || y == null || z == null || value == null) continue
        bounds.minX = Math.min(bounds.minX, x)
        bounds.minY = Math.min(bounds.minY, y)
        bounds.minZ = Math.min(bounds.minZ, z)
        bounds.maxX = Math.max(bounds.maxX, x)
        bounds.maxY = Math.max(bounds.maxY, y)
        bounds.maxZ = Math.max(bounds.maxZ, z)
        bounds.minValue = Math.min(bounds.minValue, value)
        bounds.maxValue = Math.max(bounds.maxValue, value)
        bounds.rowCount++
      }
      lineBuffer = []
    }
  }

  for (const line of lineBuffer) {
    const cells = parseCsvLine(line)
    const x = parseNumeric(cells[indices.x])
    const y = parseNumeric(cells[indices.y])
    const z = parseNumeric(cells[indices.z])
    const value = parseNumeric(cells[indices.value])
    if (x == null || y == null || z == null || value == null) continue
    bounds.minX = Math.min(bounds.minX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.minZ = Math.min(bounds.minZ, z)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.maxY = Math.max(bounds.maxY, y)
    bounds.maxZ = Math.max(bounds.maxZ, z)
    bounds.minValue = Math.min(bounds.minValue, value)
    bounds.maxValue = Math.max(bounds.maxValue, value)
    bounds.rowCount++
  }

  const voxelSpanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const voxelSpanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const voxelSpanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6)

  const secondPassReader = await fetch(url)
  let pass = 2
  lineBuffer = []
  let voxelized = 0

  for await (const line of streamReadLines(secondPassReader)) {
    if (!headers) {
      headers = parseCsvLine(line).map(normalizeName)
      continue
    }

    lineBuffer.push(line)

    if (lineBuffer.length >= 20000) {
      for (const line of lineBuffer) {
        const cells = parseCsvLine(line)
        const x = parseNumeric(cells[indices.x])
        const y = parseNumeric(cells[indices.y])
        const z = parseNumeric(cells[indices.z])
        const value = parseNumeric(cells[indices.value])
        if (x == null || y == null || z == null || value == null) continue
        const ix = clamp(Math.floor(((x - bounds.minX) / voxelSpanX) * (dims - 1)), 0, dims - 1)
        const iy = clamp(Math.floor(((y - bounds.minY) / voxelSpanY) * (dims - 1)), 0, dims - 1)
        const iz = clamp(Math.floor(((z - bounds.minZ) / voxelSpanZ) * (dims - 1)), 0, dims - 1)
        const index = ix + iy * dims + iz * dims * dims
        sums[index] += value
        counts[index] += 1
        voxelized++
      }
      lineBuffer = []
      self.postMessage({
        type: 'progress',
        phase: 'voxelizing',
        offset: voxelized,
        size: bounds.rowCount,
        pass,
      })
    }
  }

  for (const line of lineBuffer) {
    const cells = parseCsvLine(line)
    const x = parseNumeric(cells[indices.x])
    const y = parseNumeric(cells[indices.y])
    const z = parseNumeric(cells[indices.z])
    const value = parseNumeric(cells[indices.value])
    if (x == null || y == null || z == null || value == null) continue
    const ix = clamp(Math.floor(((x - bounds.minX) / voxelSpanX) * (dims - 1)), 0, dims - 1)
    const iy = clamp(Math.floor(((y - bounds.minY) / voxelSpanY) * (dims - 1)), 0, dims - 1)
    const iz = clamp(Math.floor(((z - bounds.minZ) / voxelSpanZ) * (dims - 1)), 0, dims - 1)
    const index = ix + iy * dims + iz * dims * dims
    sums[index] += value
    counts[index] += 1
  }

  const data = new Uint8Array(voxelCount)
  const minValue = Number.isFinite(bounds.minValue) ? bounds.minValue : 0
  const maxValue = Number.isFinite(bounds.maxValue) && bounds.maxValue !== minValue
    ? bounds.maxValue
    : minValue + 1
  for (let index = 0; index < voxelCount; index += 1) {
    if (counts[index] === 0) continue
    const avg = sums[index] / counts[index]
    const normalized = clamp((avg - minValue) / (maxValue - minValue), 0, 1)
    data[index] = Math.round(normalized * 255)
  }

  return { data, bounds }
}

async function loadHugeFileLOD(url, variable, targetDims) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
  const totalSize = contentLength || null

  self.postMessage({ type: 'progress', phase: 'detecting_bounds', offset: 0, size: totalSize })

  const lodLevels = [
    { dims: Math.max(16, Math.min(32, Math.round(targetDims * 0.25))), label: 'LOD0 (25%)' },
    { dims: Math.max(32, Math.min(64, Math.round(targetDims * 0.5))), label: 'LOD1 (50%)' },
    { dims: targetDims, label: 'LOD2 (100%)' },
  ]

  const lodResults = []
  let headers = null
  const indices = {}

  for (let pass = 0; pass < lodLevels.length; pass++) {
    const lod = lodLevels[pass]
    self.postMessage({ type: 'progress', phase: `building_${lod.label}`, offset: 0, size: totalSize })

    const voxelCount = lod.dims * lod.dims * lod.dims
    const sums = new Float32Array(voxelCount)
    const counts = new Uint32Array(voxelCount)

    const bounds = {
      minX: Infinity, minY: Infinity, minZ: Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
      minValue: Infinity, maxValue: -Infinity, rowCount: 0,
    }

    const secondPass = await fetch(url)
    let lineBuffer = []
    let processedRows = 0
    const sampleRate = lod.dims / targetDims

    for await (const line of streamReadLines(secondPass)) {
      if (!headers) {
        headers = parseCsvLine(line).map(normalizeName)
        indices.x = findIndex(headers, HEADER_ALIASES.x, 'x')
        indices.y = findIndex(headers, HEADER_ALIASES.y, 'y')
        indices.z = findIndex(headers, HEADER_ALIASES.z, 'z')
        indices.value = findIndex(headers, [normalizeName(variable)], variable)
        if (indices.x < 0 || indices.y < 0 || indices.z < 0 || indices.value < 0) {
          throw new Error(`CSV missing required columns`)
        }
        continue
      }

      lineBuffer.push(line)

      if (lineBuffer.length >= 10000) {
        for (const line of lineBuffer) {
          const cells = parseCsvLine(line)
          const x = parseNumeric(cells[indices.x])
          const y = parseNumeric(cells[indices.y])
          const z = parseNumeric(cells[indices.z])
          const value = parseNumeric(cells[indices.value])
          if (x == null || y == null || z == null || value == null) continue

          if (pass === 0) {
            bounds.minX = Math.min(bounds.minX, x)
            bounds.minY = Math.min(bounds.minY, y)
            bounds.minZ = Math.min(bounds.minZ, z)
            bounds.maxX = Math.max(bounds.maxX, x)
            bounds.maxY = Math.max(bounds.maxY, y)
            bounds.maxZ = Math.max(bounds.maxZ, z)
            bounds.minValue = Math.min(bounds.minValue, value)
            bounds.maxValue = Math.max(bounds.maxValue, value)
            bounds.rowCount++
          }

          if (processedRows % Math.max(1, Math.round(1 / sampleRate)) === 0) {
            const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
            const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
            const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6)
            const ix = clamp(Math.floor(((x - bounds.minX) / spanX) * (lod.dims - 1)), 0, lod.dims - 1)
            const iy = clamp(Math.floor(((y - bounds.minY) / spanY) * (lod.dims - 1)), 0, lod.dims - 1)
            const iz = clamp(Math.floor(((z - bounds.minZ) / spanZ) * (lod.dims - 1)), 0, lod.dims - 1)
            const index = ix + iy * lod.dims + iz * lod.dims * lod.dims
            sums[index] += value
            counts[index] += 1
          }
          processedRows++
        }
        lineBuffer = []
        self.postMessage({
          type: 'progress',
          phase: lod.label,
          offset: processedRows,
          size: bounds.rowCount || totalSize,
          lod: pass,
        })
      }
    }

    for (const line of lineBuffer) {
      const cells = parseCsvLine(line)
      const x = parseNumeric(cells[indices.x])
      const y = parseNumeric(cells[indices.y])
      const z = parseNumeric(cells[indices.z])
      const value = parseNumeric(cells[indices.value])
      if (x == null || y == null || z == null || value == null) continue
      if (pass === 0) {
        bounds.minX = Math.min(bounds.minX, x)
        bounds.minY = Math.min(bounds.minY, y)
        bounds.minZ = Math.min(bounds.minZ, z)
        bounds.maxX = Math.max(bounds.maxX, x)
        bounds.maxY = Math.max(bounds.maxY, y)
        bounds.maxZ = Math.max(bounds.maxZ, z)
        bounds.minValue = Math.min(bounds.minValue, value)
        bounds.maxValue = Math.max(bounds.maxValue, value)
        bounds.rowCount++
      }
    }

    const data = new Uint8Array(voxelCount)
    const minValue = Number.isFinite(bounds.minValue) ? bounds.minValue : 0
    const maxValue = Number.isFinite(bounds.maxValue) && bounds.maxValue !== minValue
      ? bounds.maxValue
      : minValue + 1
    for (let index = 0; index < voxelCount; index += 1) {
      if (counts[index] === 0) continue
      const avg = sums[index] / counts[index]
      const normalized = clamp((avg - minValue) / (maxValue - minValue), 0, 1)
      data[index] = Math.round(normalized * 255)
    }

    lodResults.push({ dims: lod.dims, data, bounds })

    if (pass === 0) {
      self.postMessage({ type: 'lod_ready', level: 0, dims: lod.dims, bounds })
    }
  }

  return {
    dims: targetDims,
    data: lodResults[lodResults.length - 1].data,
    bounds: lodResults[0].bounds,
    lodLevels: lodResults,
    variable,
  }
}

self.onmessage = async (event) => {
  const { id, url, variable, dims, strategy: forceStrategy } = event.data || {}

  const strategies = {
    auto: 'auto',
    direct: 'direct',
    streaming: 'streaming',
    chunked: 'chunked',
    lod: 'lod',
  }

  try {
    const fileSize = await getFileSize(url)
    let strategy = forceStrategy || 'auto'

    if (strategy === 'auto' && fileSize) {
      if (fileSize < SIZE_SMALL) strategy = 'direct'
      else if (fileSize < SIZE_MEDIUM) strategy = 'streaming'
      else if (fileSize < SIZE_LARGE) strategy = 'chunked'
      else strategy = 'lod'
    }

    self.postMessage({
      type: 'strategy_selected',
      strategy,
      fileSize,
      estimatedRows: fileSize ? Math.round(fileSize / 50) : null,
    })

    let result

    if (strategy === 'direct') {
      self.postMessage({ type: 'progress', phase: 'loading', offset: 0, size: fileSize || null })
      const lines = await loadSmallFile(url)
      if (lines.length < 2) throw new Error('CSV has no data rows')

      const headers = parseCsvLine(lines[0]).map(normalizeName)
      const indices = {
        x: findIndex(headers, HEADER_ALIASES.x, 'x'),
        y: findIndex(headers, HEADER_ALIASES.y, 'y'),
        z: findIndex(headers, HEADER_ALIASES.z, 'z'),
        value: findIndex(headers, [normalizeName(variable)], variable),
      }
      if (indices.x < 0 || indices.y < 0 || indices.z < 0 || indices.value < 0) {
        throw new Error(`CSV missing required columns for variable "${variable}"`)
      }

      const bounds = scanBounds(lines.slice(1), indices)
      if (bounds.rowCount === 0) throw new Error('CSV contains no valid xyz/value rows')

      const resolvedDims = inferDims(bounds.rowCount, dims)
      const data = voxelize(lines.slice(1), indices, resolvedDims, bounds)

      self.postMessage({ type: 'progress', phase: 'voxelizing', offset: 50, size: 100 })
      result = { dims: resolvedDims, data, bounds, variable }
    } else if (strategy === 'streaming') {
      const bounds = await loadMediumFile(url, variable)
      if (bounds.rowCount === 0) throw new Error('CSV contains no valid xyz/value rows')

      const resolvedDims = inferDims(bounds.rowCount, dims)
      const data = voxelize([], indices, resolvedDims, bounds)

      self.postMessage({ type: 'progress', phase: 'complete', offset: 100, size: 100 })
      result = { dims: resolvedDims, data, bounds, variable }
    } else if (strategy === 'chunked') {
      const resolvedDims = inferDims(1_000_000, dims)
      const { data, bounds } = await loadLargeFileChunked(url, variable, resolvedDims)
      result = { dims: resolvedDims, data, bounds, variable }
    } else {
      const resolvedDims = inferDims(500_000, dims)
      result = await loadHugeFileLOD(url, variable, resolvedDims)
    }

    self.postMessage(
      { type: 'complete', id, ok: true, result, strategy },
      [result.data.buffer],
    )
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error?.message || 'Unknown worker error',
    })
  }
}