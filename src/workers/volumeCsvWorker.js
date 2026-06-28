// ─── 常量 ───────────────────────────────────────────────────────
const SIZE_SMALL = 50 * 1024 * 1024
const SIZE_MEDIUM = 500 * 1024 * 1024
const SIZE_LARGE = 2 * 1024 * 1024 * 1024

const HEADER_ALIASES = {
  x: ['x', 'X', 'coord_x', 'pos_x', 'px'],
  y: ['y', 'Y', 'coord_y', 'pos_y', 'py'],
  z: ['z', 'Z', 'coord_z', 'pos_z', 'pz'],
}

const ZH_GAS_TO_VAR = {
  空气: 'mass_fraction_of_air',
  空气质量分数: 'mass_fraction_of_air',
  甲苯: 'mass_fraction_of_c7h8',
  丙烯醇: 'mass_fraction_of_c3h5oh',
  苯酚: 'mass_fraction_of_c6h5oh',
  甲醇: 'mass_fraction_of_ch3oh',
  甲烷: 'mass_fraction_of_ch4',
  硫化氢: 'mass_fraction_of_h2s',
  乙醇: 'mass_fraction_of_c2h5oh',
  甲硫醇: 'mass_fraction_of_ch4s',
  一氧化碳: 'mass_fraction_of_co',
  二甲苯: 'mass_fraction_of_c8h10',
  异戊二烯: 'mass_fraction_of_c5h8',
  三甲胺: 'mass_fraction_of_c3h9n',
  苯: 'mass_fraction_of_c6h6',
  氨气: 'mass_fraction_of_nh3',
  丙酮: 'mass_fraction_of_c3h6o',
  二氧化碳: 'mass_fraction_of_co2',
  水: 'mass_fraction_of_h2o',
}

// ─── 网格结构缓存（同 URL 不同 variable 复用） ──────────────────
const gridCache = new Map() // url -> { nx, ny, nz, xMap, yMap, zMap, indices, bounds }

// ─── 工具函数 ───────────────────────────────────────────────────
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function parseNumeric(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeName(value) {
  return String(value ?? '').trim()
}

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:()]/g, '')
}

// ─── CSV 行解析（只提取 x/y/z/value 四列，避免完整 split） ──────
function parseCsvLineFull(line) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else inQuotes = !inQuotes
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

// 只提取指定索引的列，索引为 -1 表示不需要该列
// targets: [xI, yI, zI, vI]，返回 [xVal, yVal, zIVal, vVal] 或 null
function parseFourColumns(line, xI, yI, zI, vI) {
  const result = [null, null, null, null]
  const targets = [xI, yI, zI, vI]
  const validTargets = targets.filter((t) => t >= 0)
  const maxTarget = validTargets.length > 0 ? Math.max(...validTargets) : -1
  if (maxTarget < 0) return result
  let colIdx = 0
  let start = 0
  let inQuotes = false

  for (let i = 0; i <= line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if ((char === ',' && !inQuotes) || i === line.length) {
      if (colIdx <= maxTarget) {
        const tIdx = targets.indexOf(colIdx)
        if (tIdx >= 0 && targets[tIdx] >= 0) {
          const raw = line.substring(start, i).trim()
          result[tIdx] = Number(raw)
        }
      }
      colIdx++
      start = i + 1
      if (colIdx > maxTarget) break
    }
  }
  return result
}

// ─── 列索引解析 ─────────────────────────────────────────────────
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

function detectColumnsLikeRaymarch(headers) {
  const safeHeaders = Array.isArray(headers) ? headers : []
  const normalizedHeaders = safeHeaders.map((h) => normalizeKey(h))
  const findAxisIndex = (aliases, fallback) => {
    const aliasKeys = aliases.map((a) => normalizeKey(a)).filter(Boolean)
    for (const key of aliasKeys) {
      const exact = normalizedHeaders.findIndex((h) => h === key)
      if (exact >= 0) return exact
    }
    for (const key of aliasKeys) {
      if (key.length < 2) continue
      const fuzzy = normalizedHeaders.findIndex((h) => h.includes(key))
      if (fuzzy >= 0) return fuzzy
    }
    return fallback
  }

  const x = findAxisIndex(['x', 'coord_x', 'coordinate_x', 'pos_x', 'px'], 0)
  const y = findAxisIndex(['y', 'coord_y', 'coordinate_y', 'pos_y', 'py'], 1)
  const z = findAxisIndex(['z', 'coord_z', 'coordinate_z', 'pos_z', 'pz'], 2)

  const excluded = new Set([x, y, z])
  const preferredValue = normalizedHeaders.findIndex((name, idx) => {
    if (excluded.has(idx)) return false
    return (
      name.includes('mass') ||
      name.includes('pressure') ||
      name.includes('temperature') ||
      name.includes('velocity') ||
      name.includes('vtkvalid')
    )
  })
  const fallbackValue = safeHeaders.findIndex((_, idx) => !excluded.has(idx))
  const value =
    preferredValue >= 0
      ? preferredValue
      : fallbackValue >= 0
        ? fallbackValue
        : Math.max(0, safeHeaders.length - 1)

  return { x, y, z, value }
}

function pushIfNotEmpty(target, value) {
  const v = String(value ?? '').trim()
  if (!v) return
  if (!target.includes(v)) target.push(v)
}

function extractVolumeVarIdFromText(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const lower = text.toLowerCase()

  const fromVolumeId = text.match(/^volume:[^:]+:(.+)$/i)
  if (fromVolumeId?.[1]) return String(fromVolumeId[1]).trim()

  const fromMassFraction = lower.match(
    /mass[_\s-]*fraction[_\s-]*of[_\s-]*([a-z0-9]+)/i,
  )
  if (fromMassFraction?.[1])
    return `mass_fraction_of_${fromMassFraction[1].toLowerCase()}`

  const fromFormula = lower.match(
    /\b(c\d+h\d+[a-z0-9]*|ch\d+[a-z0-9]*|nh3|co2|co|h2s|h2o)\b/i,
  )
  if (fromFormula?.[1])
    return `mass_fraction_of_${fromFormula[1].toLowerCase()}`

  const zhCandidate = text.replace(/^体渲染[-_]/, '').trim()
  if (ZH_GAS_TO_VAR[zhCandidate]) return ZH_GAS_TO_VAR[zhCandidate]

  return ''
}

function extractSpeciesToken(variable) {
  const id = extractVolumeVarIdFromText(variable)
  const m = String(id)
    .toLowerCase()
    .match(/^mass_fraction_of_([a-z0-9]+)/)
  return m?.[1] || ''
}

function resolveValueColumnIndex(headers, variable) {
  const candidates = []
  pushIfNotEmpty(candidates, variable)

  const parsedVars = []
  for (const c of candidates) {
    const parsed = extractVolumeVarIdFromText(c)
    if (parsed) parsedVars.push(parsed)
  }
  for (const pv of parsedVars) {
    pushIfNotEmpty(candidates, pv)
    pushIfNotEmpty(
      candidates,
      pv.replace(/^mass_fraction_of_/i, 'Mass_fraction_of_'),
    )
    pushIfNotEmpty(
      candidates,
      pv.replace(/^mass_fraction_of_/i, 'mass_fraction_of_'),
    )
  }

  const lowerCandidates = candidates.map((c) => c.toLowerCase())
  if (
    lowerCandidates.some((c) => c.includes('pressure') || c.includes('压力'))
  ) {
    pushIfNotEmpty(candidates, 'Pressure')
  }
  if (
    lowerCandidates.some((c) => c.includes('temperature') || c.includes('温度'))
  ) {
    pushIfNotEmpty(candidates, 'Temperature')
  }
  if (
    lowerCandidates.some(
      (c) => c.includes('velocitymagnitude') || c.includes('速度'),
    )
  ) {
    pushIfNotEmpty(candidates, 'VelocityMagnitude')
  }

  const normalizedHeaders = headers.map((h) => normalizeKey(h))

  const speciesToken = extractSpeciesToken(variable)
  if (speciesToken) {
    const bySpecies = normalizedHeaders.findIndex(
      (h) =>
        h.includes(speciesToken) && (h.includes('mass') || h.includes('fract')),
    )
    if (bySpecies >= 0) return bySpecies
  }

  for (const c of candidates) {
    const idx = findIndex(headers, [normalizeName(c)], c)
    if (idx >= 0) return idx
  }

  for (const c of candidates) {
    const key = normalizeKey(c)
    if (!key) continue
    const exact = normalizedHeaders.findIndex((h) => h === key)
    if (exact >= 0) return exact
    if (key.length >= 6) {
      const fuzzy = normalizedHeaders.findIndex(
        (h) => h.includes(key) || key.includes(h),
      )
      if (fuzzy >= 0) return fuzzy
    }
  }

  return -1
}

function resolveColumnIndices(headers, variable) {
  const detected = detectColumnsLikeRaymarch(headers)
  const xIndex = findIndex(headers, HEADER_ALIASES.x, 'x')
  const yIndex = findIndex(headers, HEADER_ALIASES.y, 'y')
  const zIndex = findIndex(headers, HEADER_ALIASES.z, 'z')
  let valueIndex = resolveValueColumnIndex(headers, variable)

  const fallbackX = xIndex >= 0 ? xIndex : detected.x
  const fallbackY = yIndex >= 0 ? yIndex : detected.y
  const fallbackZ = zIndex >= 0 ? zIndex : detected.z

  if (valueIndex < 0) valueIndex = detected.value
  if (valueIndex < 0 && Array.isArray(headers) && headers.length) {
    const reserved = new Set([fallbackX, fallbackY, fallbackZ])
    for (let i = 0; i < headers.length; i++) {
      if (!reserved.has(i)) {
        valueIndex = i
        break
      }
    }
    if (valueIndex < 0) valueIndex = headers.length - 1
  }

  return { x: fallbackX, y: fallbackY, z: fallbackZ, value: valueIndex }
}

// ─── 规则网格推断 ───────────────────────────────────────────────
// 从前若干行推断 nx/ny/nz 和 spacing，如果 CSV 是按规则顺序导出的
function tryInferRegularGrid(sampleRows, indices, totalRows) {
  // sampleRows: [{ x, y, z, value }, ...]，至少需要 ny*2 + 1 行
  if (sampleRows.length < 4) return null

  const xs = new Set()
  const ys = new Set()
  const zs = new Set()
  let nx = 0,
    ny = 0,
    nz = 0

  // 推断 nx：连续相同 y,z 的 x 值数量
  const firstY = sampleRows[0].y
  const firstZ = sampleRows[0].z
  for (let i = 0; i < sampleRows.length; i++) {
    const r = sampleRows[i]
    if (r.y !== firstY || r.z !== firstZ) break
    nx++
    xs.add(r.x)
  }

  // 推断 ny：连续相同 z 的行数 / nx
  let sameZCount = 0
  for (let i = 0; i < sampleRows.length; i++) {
    if (sampleRows[i].z !== firstZ) break
    sameZCount++
  }
  if (nx > 0) ny = sameZCount / nx
  if (ny <= 0 || !Number.isInteger(ny)) return null

  // 推断 nz
  if (nx * ny > 0) {
    nz = totalRows / (nx * ny)
  }
  if (nz <= 0 || !Number.isInteger(nz)) return null

  // 验证
  if (nx * ny * nz !== totalRows) return null

  // 构建 xMap/yMap/zMap（利用规则网格的有序性，避免排序）
  const xv = [...xs].sort((a, b) => a - b)
  const yvSet = new Set()
  const zvSet = new Set()
  for (let i = 0; i < sampleRows.length; i++) {
    yvSet.add(sampleRows[i].y)
    zvSet.add(sampleRows[i].z)
  }
  const yv = [...yvSet].sort((a, b) => a - b)
  const zv = [...zvSet].sort((a, b) => a - b)

  const xMap = new Map(xv.map((v, i) => [v, i]))
  const yMap = new Map(yv.map((v, i) => [v, i]))
  const zMap = new Map(zv.map((v, i) => [v, i]))

  return { nx, ny, nz, xMap, yMap, zMap, inferred: true }
}

// ─── 流式读取 ──────────────────────────────────────────────────
async function* streamReadLines(response, phase = '', jobId = '') {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let offset = 0
  const contentLength = Number.parseInt(
    response.headers.get('content-length') || '',
    10,
  )
  const size =
    Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null

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
    if (phase) {
      self.postMessage({ type: 'progress', id: jobId, phase, offset, size })
    }
  }
  if (buffer) yield buffer
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

// ─── 阶段1：轻量扫描（只读 header + 采样行，确定列索引和网格结构）──
async function scanHeaderAndSample(url, variable, jobId = '') {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)

  let headers = null
  let indices = null
  const sampleRows = [] // 只保留前 N 行的 x/y/z/value 用于推断网格
  const MAX_SAMPLE = 5000
  let totalRows = 0
  let sampleValueMin = Infinity
  let sampleValueMax = -Infinity

  for await (const rawLine of streamReadLines(response, 'detecting', jobId)) {
    const line = rawLine.trim()
    if (!line) continue

    if (!headers) {
      const cells = parseCsvLineFull(line)
      const hasHeader = cells.some((cell) => Number.isNaN(Number(cell.trim())))
      if (hasHeader) {
        headers = cells.map(normalizeName)
        indices = resolveColumnIndices(headers, variable)
        if (
          indices.x < 0 ||
          indices.y < 0 ||
          indices.z < 0 ||
          indices.value < 0
        ) {
          throw new Error(
            `CSV missing required columns for variable "${variable}". headers(sample): ${headers.slice(0, 16).join(', ')}`,
          )
        }
        continue
      } else {
        // 无表头，把第一行当数据
        headers = cells.map((_, i) => `col_${i}`)
        indices = resolveColumnIndices(headers, variable)
      }
    }

    // 只取4列
    const [x, y, z, value] = parseFourColumns(
      line,
      indices.x,
      indices.y,
      indices.z,
      indices.value,
    )
    if (
      x == null ||
      y == null ||
      z == null ||
      value == null ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(value)
    )
      continue

    totalRows++
    if (sampleRows.length < MAX_SAMPLE) {
      sampleRows.push({ x, y, z, value })
    }
    if (value < sampleValueMin) sampleValueMin = value
    if (value > sampleValueMax) sampleValueMax = value
  }

  return {
    headers,
    indices,
    sampleRows,
    totalRows,
    sampleValueRange: [
      Number.isFinite(sampleValueMin) ? sampleValueMin : 0,
      Number.isFinite(sampleValueMax) ? sampleValueMax : 0,
    ],
  }
}

// ─── 阶段2：两遍扫描（流式，不保存 rows 中间态） ───────────────
async function twoPassVoxelize(
  jobId,
  url,
  variable,
  indices,
  gridInfo,
  globalValueRange,
  sampleValueRange = null,
  onProgress,
  streaming = false,
) {
  const { nx, ny, nz, xMap, yMap, zMap, inferred } = gridInfo
  const voxelCount = nx * ny * nz
  const PARTIAL_CHUNK_SIZE = 3000

  // ── Pass 1: 统计值域（仅局部值域模式需要） ──
  self.postMessage({
    type: 'progress',
    id: jobId,
    phase: 'scanning',
    offset: 0,
    size: null,
  })

  let localVMin = Infinity,
    localVMax = -Infinity
  let rowCount = 0
  let firstDataRow = true

  // 只有局部值域模式才需要扫描数据值域
  const needValueScan = !globalValueRange

  if (needValueScan) {
    const response1 = await fetch(url)
    if (!response1.ok) throw new Error(`Failed to fetch ${url}`)

    for await (const rawLine of streamReadLines(response1, 'scanning', jobId)) {
      const line = rawLine.trim()
      if (!line) continue
      if (firstDataRow) {
        const cells = parseCsvLineFull(line)
        if (cells.some((c) => Number.isNaN(Number(c.trim())))) {
          firstDataRow = false
          continue
        }
        firstDataRow = false
      }

      const value = parseFourColumns(line, -1, -1, -1, indices.value)[3]
      if (value == null || !Number.isFinite(value)) continue

      // 局部值域时跳过0值统计（0代表无数据区域）
      if (value === 0) continue

      if (value < localVMin) localVMin = value
      if (value > localVMax) localVMax = value
      rowCount++
    }

    // 全零值回退
    if (!Number.isFinite(localVMin) || !Number.isFinite(localVMax)) {
      localVMin = 0
      localVMax = 0
    }
  }

  // 确定最终归一化值域
  let useGlobalRange = false
  let normVMin, normVMax

  if (
    globalValueRange &&
    Number.isFinite(globalValueRange[0]) &&
    Number.isFinite(globalValueRange[1])
  ) {
    normVMin = globalValueRange[0]
    normVMax = globalValueRange[1]

    // 使用阶段1采样值域判断是否已经是 [0,1] 归一化数据，避免额外 probe 请求
    if (!needValueScan && Array.isArray(sampleValueRange)) {
      localVMin = Number.isFinite(sampleValueRange[0]) ? sampleValueRange[0] : 0
      localVMax = Number.isFinite(sampleValueRange[1]) ? sampleValueRange[1] : 0
    }

    const dataIn01 =
      localVMin >= 0 && localVMax <= 1 && localVMax - localVMin > 0
    const globalExceedsRange = normVMin > 1 || normVMax > 1 || normVMin < -1

    if (dataIn01 && globalExceedsRange) {
      console.log('[VolumeWorker] 数据已被后端归一化到 [0,1]，直接使用原始值', {
        dataMin: localVMin,
        dataMax: localVMax,
        globalMin: normVMin,
        globalMax: normVMax,
      })
      normVMin = 0
      normVMax = 1
    }
    useGlobalRange = true
  } else {
    // 局部独立值域
    if (!Number.isFinite(localVMin) || !Number.isFinite(localVMax)) {
      normVMin = 0
      normVMax = 1
    } else if (Math.abs(localVMax - localVMin) < 1e-12) {
      // 常量场
      normVMin = localVMin
      normVMax = localVMin + 1
    } else {
      normVMin = localVMin
      normVMax = localVMax
    }
  }

  const valueRange = Math.max(normVMax - normVMin, 1e-8)

  // ── Pass 2: 直接写 Float32Array ──
  self.postMessage({
    type: 'progress',
    id: jobId,
    phase: 'voxelizing',
    offset: 0,
    size: null,
  })

  const voxelData = new Float32Array(voxelCount)
  const response2 = await fetch(url)
  if (!response2.ok) throw new Error(`Failed to fetch ${url}`)

  firstDataRow = true
  let voxelized = 0
  let lastProgressTime = Date.now()
  let lastPartialTime = 0
  let skippedCoords = 0
  let skippedInvalid = 0
  let validRows = 0

  for await (const rawLine of streamReadLines(response2)) {
    const line = rawLine.trim()
    if (!line) continue
    if (firstDataRow) {
      const cells = parseCsvLineFull(line)
      if (cells.some((c) => Number.isNaN(Number(c.trim())))) {
        firstDataRow = false
        continue
      }
      firstDataRow = false
    }

    const [x, y, z, value] = parseFourColumns(
      line,
      indices.x,
      indices.y,
      indices.z,
      indices.value,
    )
    if (
      x == null ||
      y == null ||
      z == null ||
      value == null ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(value)
    ) {
      skippedInvalid++
      if (skippedInvalid <= 3) {
        console.log('[Worker] 跳过无效行:', {
          x,
          y,
          z,
          value,
          line: line.substring(0, 100),
        })
      }
      continue
    }

    // 映射到网格索引
    let ix, iy, iz
    if (inferred) {
      ix = xMap.get(x)
      iy = yMap.get(y)
      iz = zMap.get(z)
      if (ix == null || iy == null || iz == null) {
        skippedCoords++
        if (skippedCoords <= 5) {
          console.log('[Worker] 坐标映射失败:', {
            x,
            y,
            z,
            ix,
            iy,
            iz,
            hasX: xMap.has(x),
            hasY: yMap.has(y),
            hasZ: zMap.has(z),
          })
        }
        continue
      }
    } else {
      ix = xMap.get(x)
      iy = yMap.get(y)
      iz = zMap.get(z)
      if (ix == null || iy == null || iz == null) {
        skippedCoords++
        if (skippedCoords <= 5) {
          console.log('[Worker] 坐标映射失败:', {
            x,
            y,
            z,
            ix,
            iy,
            iz,
            hasX: xMap.has(x),
            hasY: yMap.has(y),
            hasZ: zMap.has(z),
          })
        }
        continue
      }
    }

    const idx = ix + nx * (iy + ny * iz)

    // 归一化
    if (!useGlobalRange && value === 0) {
      // 局部值域：0 值区域保持 0（代表无数据）
      voxelData[idx] = 0
    } else {
      voxelData[idx] = clamp((value - normVMin) / valueRange, 0, 1)
    }

    voxelized++
    validRows++
    const now = Date.now()
    if (now - lastProgressTime > 200) {
      self.postMessage({
        type: 'progress',
        id: jobId,
        phase: 'voxelizing',
        offset: voxelized,
        size: rowCount,
      })
      lastProgressTime = now
    }

    // 流式模式：发送 partial 结果
    if (streaming && voxelized % PARTIAL_CHUNK_SIZE === 0 && now - (lastPartialTime || now) > 30) {
      const partialData = new Float32Array(voxelData)
      self.postMessage({
        type: 'partial',
        id: jobId,
        phase: 'voxelizing',
        offset: voxelized,
        size: rowCount,
        dims: [nx, ny, nz],
        valueRange: [normVMin, normVMax],
        filledCount: voxelized,
      }, [partialData.buffer])
      lastPartialTime = now
    }
  }

  console.log('[Worker] Pass 2 统计:', {
    validRows,
    skippedCoords,
    skippedInvalid,
    totalExpected: nx * ny * nz,
    gridDims: { nx, ny, nz },
    xMapSize: xMap.size,
    yMapSize: yMap.size,
    zMapSize: zMap.size,
  })

  self.postMessage({
    type: 'progress',
    id: jobId,
    phase: 'complete',
    offset: 100,
    size: 100,
  })

  console.log('[Worker] 返回结果:', {
    dims: [nx, ny, nz],
    rowCount: validRows,
    valueRange: [normVMin, normVMax],
    dataLength: voxelData.length,
    nonZeroCount: voxelData.filter((v) => v > 0).length,
    sampleValues: [
      voxelData[0],
      voxelData[1],
      voxelData[2],
      voxelData[voxelData.length - 1],
    ],
  })

  return {
    voxelData,
    dims: [nx, ny, nz],
    rowCount: validRows,
    valueRange: [normVMin, normVMax],
  }
}

// ─── 主入口 ────────────────────────────────────────────────────
self.onmessage = async (event) => {
  const {
    id,
    url,
    variable,
    dims: requestedDims,
    globalValueRange,
    streaming = false,
  } = event.data || {}

  try {
    // ── 阶段1：轻量扫描 ──
    self.postMessage({
      type: 'progress',
      id,
      phase: 'detecting',
      offset: 0,
      size: null,
    })

    const { headers, indices, sampleRows, totalRows, sampleValueRange } =
      await scanHeaderAndSample(url, variable, id)

    if (totalRows === 0) {
      throw new Error(
        `CSV contains no valid xyz/value rows for variable "${variable || 'unknown'}"`,
      )
    }

    // ── 推断/复用网格结构 ──
    const cacheKey = url
    let gridInfo = gridCache.get(cacheKey)

    if (gridInfo && gridInfo.indices.value === indices.value) {
      // 缓存命中：同 URL 同 value 列，直接复用网格结构
      console.log(
        '[VolumeWorker] 网格结构缓存命中:',
        cacheKey.substring(cacheKey.lastIndexOf('/') + 1),
      )
    } else {
      // 尝试规则网格推断
      const inferred = tryInferRegularGrid(sampleRows, indices, totalRows)

      if (inferred) {
        console.log('[VolumeWorker] 规则网格推断成功:', {
          nx: inferred.nx,
          ny: inferred.ny,
          nz: inferred.nz,
        })
        gridInfo = {
          nx: inferred.nx,
          ny: inferred.ny,
          nz: inferred.nz,
          xMap: inferred.xMap,
          yMap: inferred.yMap,
          zMap: inferred.zMap,
          inferred: true,
          indices,
        }
      } else {
        // 退回 Set+sort 模式（利用 sampleRows 中已收集的坐标）
        console.log('[VolumeWorker] 规则网格推断失败，使用 Set+sort 模式')
        // 需要全量扫描收集唯一坐标
        const xs = new Set()
        const ys = new Set()
        const zs = new Set()
        // 先加上 sample 里的
        for (const r of sampleRows) {
          xs.add(r.x)
          ys.add(r.y)
          zs.add(r.z)
        }

        // 如果 sampleRows 不够（totalRows > sampleRows.length），需要再扫一遍收集坐标
        if (totalRows > sampleRows.length) {
          console.log('[Worker] 采样不足，全量扫描收集坐标...', {
            sampleRows: sampleRows.length,
            totalRows,
          })
          const coordResponse = await fetch(url)
          if (!coordResponse.ok) throw new Error(`Failed to fetch ${url}`)
          let firstDataRow = true
          let coordScanned = 0
          for await (const rawLine of streamReadLines(
            coordResponse,
            'grid',
            id,
          )) {
            const line = rawLine.trim()
            if (!line) continue
            if (firstDataRow) {
              const cells = parseCsvLineFull(line)
              if (cells.some((c) => Number.isNaN(Number(c.trim())))) {
                firstDataRow = false
                continue
              }
              firstDataRow = false
            }
            const [x, y, z] = parseFourColumns(
              line,
              indices.x,
              indices.y,
              indices.z,
              -1,
            )
            if (x != null && Number.isFinite(x)) xs.add(x)
            if (y != null && Number.isFinite(y)) ys.add(y)
            if (z != null && Number.isFinite(z)) zs.add(z)
            coordScanned++
          }
          console.log('[Worker] 坐标收集完成:', {
            coordScanned,
            xUnique: xs.size,
            yUnique: ys.size,
            zUnique: zs.size,
          })
        }

        const xv = [...xs].sort((a, b) => a - b)
        const yv = [...ys].sort((a, b) => a - b)
        const zv = [...zs].sort((a, b) => a - b)

        console.log('[Worker] Set+Sort 模式网格构建:', {
          xUnique: xv.length,
          yUnique: yv.length,
          zUnique: zv.length,
          xSample: xv.slice(0, 3),
          ySample: yv.slice(0, 3),
          zSample: zv.slice(0, 3),
        })

        gridInfo = {
          nx: xv.length,
          ny: yv.length,
          nz: zv.length,
          xMap: new Map(xv.map((v, i) => [v, i])),
          yMap: new Map(yv.map((v, i) => [v, i])),
          zMap: new Map(zv.map((v, i) => [v, i])),
          inferred: false,
          indices,
        }
      }

      gridCache.set(cacheKey, gridInfo)
    }

    console.log('[VolumeWorker] 网格维度:', {
      nx: gridInfo.nx,
      ny: gridInfo.ny,
      nz: gridInfo.nz,
      totalRows,
      inferred: gridInfo.inferred,
    })

    // ── 阶段2+3：两遍扫描 + 直接写 Float32Array ──
    const result = await twoPassVoxelize(
      id,
      url,
      variable,
      gridInfo.indices,
      gridInfo,
      globalValueRange || null,
      sampleValueRange,
      null, // onProgress - not used directly here
      streaming, // 流式模式
    )

    // ── 阶段4：返回 buffer ──
    const transferData = result.voxelData
    self.postMessage(
      {
        type: 'complete',
        id,
        ok: true,
        result: {
          dims: result.dims,
          data: transferData,
          bounds: {
            rowCount: result.rowCount,
            minValue: result.valueRange[0],
            maxValue: result.valueRange[1],
          },
          variable,
          valueRange: result.valueRange,
          inferred: gridInfo.inferred,
        },
      },
      [transferData.buffer],
    )
  } catch (error) {
    self.postMessage({
      type: 'complete',
      id,
      ok: false,
      error: error?.message || 'Unknown worker error',
    })
  }
}
