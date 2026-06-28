import {
  THREE,
  clearGroup,
  createStructuredResourceLoader,
  normalizeUrl,
  toFiniteNumber,
  toFloat32Array,
} from './shared'
import {
  normalizeColorStops,
} from '../../../utils/volumeColorStops'
import {
  resolveEffectiveVolumeUrl,
  resolveVolumeFrameIndexFromPayload,
} from '../../../utils/volumeFrameUrl'
import { buildVolumeDatasetPreloadPlan, collectVolumeDatasetPreloadFrames } from '../../../utils/volumeLayerPreload'
import { resolveRenderPixelRatio } from '../renderQuality'
import { isRadarMockVolumeVariableId, extractRadarMockVolumeBandId } from '@/utils/mockRadarVolume3d.js'
import { RADAR_VOLUME_WAVE_GLSL_CHUNK } from '@/utils/radarVolumeRaymarchThree.js'
import {
  findCatalogColormapEntry,
  pickLocalCatalogColormapForRadarVolume,
  resolveColormapColors,
} from '@/utils/volumeColormap.js'
import { radarFrequencyLabel } from '@/constants/radarFrequencies.js'

let _webgl2Available = null
const directManifestJsonCache = new Map()
const directManifestJsonPendingCache = new Map()
const directBinArrayBufferCache = new Map()
const directBinArrayBufferPendingCache = new Map()
const MAX_DIRECT_BIN_ARRAY_BUFFER_CACHE_FRAMES = 40

/** 与 ThreeVisualizationCanvas 中人物 GLB 的 config.key 一致 */
const PERSON_GLTF_MODEL_KEYS = new Set(['personGeometry', 'personReal'])

function touchCacheEntry(cache, key) {
  if (!cache.has(key)) return
  const value = cache.get(key)
  cache.delete(key)
  cache.set(key, value)
}

function pruneCacheToFrameLimit(cache, maxFrames, onRemove = null) {
  while (cache.size > maxFrames) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) return
    const oldestValue = cache.get(oldestKey)
    onRemove?.(oldestValue, oldestKey)
    cache.delete(oldestKey)
  }
}

function isWebGL2Available() {
  if (_webgl2Available !== null) return _webgl2Available
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    _webgl2Available = !!gl
    // 立即释放探测上下文，避免占用 WebGL 上下文配额
    const loseCtx = gl?.getExtension('WEBGL_lose_context')
    loseCtx?.loseContext()
    return _webgl2Available
  } catch (e) {
    _webgl2Available = false
    return false
  }
}

export function createVolumeMode(options) {
  const {
    getDynamicGroup,
    getSceneMode,
    getIsEnabled,
    getVisualization,
    getCurrentTimeStep,
    getCurrentStepIndex,
    getIsPlaying,
    getActiveVolumePayload,
    getVisibleVolumeLayers,
    getVolumePayloadForLayer,
    getRenderer,
    getCamera,
    getModelGroup,
    getSelectedLayer,
    getGeometryBounds,
    getCurrentTask,
    workerUrl,
    requestSync,
    getColorMapCatalog,
    onWorkerProgress,
    onVolumeTransformReady,
    /** 体包围盒与人物模型包围盒首次相交时回调（用于弹窗等） */
    onVolumePersonSpaceIntersect,
    /** 体-人物 AABB 相交时高亮人物描边（true/false） */
    setVolumePersonIntersectHighlight,
  } = options

  const fetchStructuredResource = createStructuredResourceLoader()
  const volumeVoxelCache = new Map()
  const volumeVoxelPendingCache = new Map()
  // 归一化逻辑版本号，变更时自动使旧缓存失效
  const NORMALIZE_VERSION = 7
  const directVolumeCache = new Map()
  const MAX_DIRECT_VOLUME_CACHE_FRAMES = 40
  let effectiveDirectVolumeCacheMax = MAX_DIRECT_VOLUME_CACHE_FRAMES
  let effectiveDirectBinCacheMax = MAX_DIRECT_BIN_ARRAY_BUFFER_CACHE_FRAMES
  /** 上一帧体-人物 AABB 是否相交（边沿触发弹窗） */
  let lastVolumePersonAabbIntersect = false
  /** 人物描边开关去抖（避免每帧重复挂接） */
  let lastVolumeIntersectOutlineOn = false
  let lastVolumeIntersectOutlineKey = ''
  // 缓存的 manifest bounds（用于直接 manifest 加载模式）
  let cachedManifestBounds = null
  let lastLoggedTimelineBinKey = ''

  function logTimelineBinUrl(binUrl, meta = {}) {
    const cleanBinUrl = String(binUrl || '').trim()
    if (!cleanBinUrl) return
    const currentTimeStep = getCurrentTimeStep?.()
    const currentStepIndex =
      typeof getCurrentStepIndex === 'function' ? getCurrentStepIndex() : null
    const frameIndex = Number.isFinite(meta.frameIndex) ? meta.frameIndex : null
    const variable = meta.variable ?? ''
    const logKey = `${currentTimeStep}::${currentStepIndex}::${variable}::${frameIndex}::${cleanBinUrl}`
    if (logKey === lastLoggedTimelineBinKey) return
    lastLoggedTimelineBinKey = logKey
    console.log('[VolumeTimeline] 加载 bin URL:', {
      timeStep: currentTimeStep,
      stepIndex: currentStepIndex,
      frameIndex,
      variable,
      binUrl: cleanBinUrl,
    })
  }

  function configureVolumeTexture(texture, data) {
    if (!texture) return texture
    texture.format = THREE.RedFormat
    texture.type = data instanceof Float32Array ? THREE.FloatType : THREE.UnsignedByteType
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.wrapR = THREE.ClampToEdgeWrapping
    texture.unpackAlignment = 1
    texture.needsUpdate = true
    return texture
  }

  /** 占位：不参与 ESS；采样为 1，避免禁用时仍绑定无效纹理 */
  let dummyOccMaxTexture = null
  function getDummyOccMaxTexture() {
    if (!dummyOccMaxTexture) {
      const d = new Float32Array([1])
      dummyOccMaxTexture = new THREE.Data3DTexture(d, 1, 1, 1)
      dummyOccMaxTexture.format = THREE.RedFormat
      dummyOccMaxTexture.type = THREE.FloatType
      dummyOccMaxTexture.minFilter = THREE.NearestFilter
      dummyOccMaxTexture.magFilter = THREE.NearestFilter
      dummyOccMaxTexture.wrapS = THREE.ClampToEdgeWrapping
      dummyOccMaxTexture.wrapT = THREE.ClampToEdgeWrapping
      dummyOccMaxTexture.wrapR = THREE.ClampToEdgeWrapping
      dummyOccMaxTexture.unpackAlignment = 1
      dummyOccMaxTexture.needsUpdate = true
    }
    return dummyOccMaxTexture
  }

  /**
   * 将体数据按 block³ 取最大值降采样，用于片段着色器保守判断「大块是否近似空」。
   * 索引与 Three.js Data3DTexture 一致：ix + nx * (iy + ny * iz)
   */
  function buildOccupancyMaxData(data, nx, ny, nz, block = 2) {
    if (!data?.length || nx <= 0 || ny <= 0 || nz <= 0) return null
    const ox = Math.max(1, Math.ceil(nx / block))
    const oy = Math.max(1, Math.ceil(ny / block))
    const oz = Math.max(1, Math.ceil(nz / block))
    const out = new Float32Array(ox * oy * oz)
    for (let bz = 0; bz < oz; bz++) {
      for (let by = 0; by < oy; by++) {
        for (let bx = 0; bx < ox; bx++) {
          let mx = 0
          for (let dz = 0; dz < block; dz++) {
            const iz = bz * block + dz
            if (iz >= nz) continue
            for (let dy = 0; dy < block; dy++) {
              const iy = by * block + dy
              if (iy >= ny) continue
              for (let dx = 0; dx < block; dx++) {
                const ix = bx * block + dx
                if (ix >= nx) continue
                const idx = ix + nx * (iy + ny * iz)
                const v = Number(data[idx])
                if (v > mx) mx = v
              }
            }
          }
          const oi = bx + ox * (by + oy * bz)
          out[oi] = mx
        }
      }
    }
    return { data: out, dims: [ox, oy, oz] }
  }

  function createOccupancyData3DTexture(volumeData, nx, ny, nz) {
    const built = buildOccupancyMaxData(volumeData, nx, ny, nz, 2)
    if (!built) return null
    const tex = new THREE.Data3DTexture(
      built.data,
      built.dims[0],
      built.dims[1],
      built.dims[2],
    )
    tex.format = THREE.RedFormat
    tex.type = THREE.FloatType
    tex.minFilter = THREE.NearestFilter
    tex.magFilter = THREE.NearestFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.wrapR = THREE.ClampToEdgeWrapping
    tex.unpackAlignment = 1
    tex.needsUpdate = true
    return tex
  }

  function shouldReorderManifestVoxelsForTexture(manifest) {
    const layout = String(manifest?.layout || '').replace(/\s+/g, '').toLowerCase()
    const arrayOrder = String(manifest?.arrayOrder || '').trim().toUpperCase()
    return layout === 'voxel[x,y,z]' || arrayOrder === 'C'
  }

  function reorderManifestVoxelsForData3DTexture(data, manifest) {
    const dims = manifest?.dimensions || manifest?.dims || []
    const nx = Number(dims[0])
    const ny = Number(dims[1])
    const nz = Number(dims[2])
    if (
      !shouldReorderManifestVoxelsForTexture(manifest) ||
      !Number.isFinite(nx) ||
      !Number.isFinite(ny) ||
      !Number.isFinite(nz) ||
      nx <= 0 ||
      ny <= 0 ||
      nz <= 0 ||
      data.length !== nx * ny * nz
    ) {
      return data
    }

    const reordered = new data.constructor(data.length)
    for (let ix = 0; ix < nx; ix += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let iz = 0; iz < nz; iz += 1) {
          const sourceIndex = ix * ny * nz + iy * nz + iz
          const textureIndex = ix + nx * (iy + ny * iz)
          reordered[textureIndex] = data[sourceIndex]
        }
      }
    }
    return reordered
  }

  function getResourceCacheKey(url) {
    const cleanUrl = String(url || '').trim()
    return cleanUrl ? normalizeUrl(cleanUrl) || cleanUrl : ''
  }

  async function fetchCachedManifestJson(manifestUrl, fallbackData = null) {
    const cacheKey = getResourceCacheKey(manifestUrl)
    if (!cacheKey) throw new Error('manifest URL 为空')
    if (fallbackData) {
      if (!directManifestJsonCache.has(cacheKey)) {
        directManifestJsonCache.set(cacheKey, fallbackData)
      }
      return directManifestJsonCache.get(cacheKey)
    }
    if (directManifestJsonCache.has(cacheKey)) {
      console.log('[DirectManifest] manifest 缓存命中:', cacheKey)
      return directManifestJsonCache.get(cacheKey)
    }
    if (directManifestJsonPendingCache.has(cacheKey)) {
      console.log('[DirectManifest] manifest 等待进行中的请求:', cacheKey)
      return directManifestJsonPendingCache.get(cacheKey)
    }

    const request = (async () => {
      const manifestRes = await fetch(manifestUrl)
      if (!manifestRes.ok) {
        throw new Error(`manifest 加载失败: ${manifestRes.status}`)
      }
      const manifest = await manifestRes.json()
      directManifestJsonCache.set(cacheKey, manifest)
      return manifest
    })()
    directManifestJsonPendingCache.set(cacheKey, request)
    try {
      return await request
    } finally {
      directManifestJsonPendingCache.delete(cacheKey)
    }
  }

  async function fetchCachedBinArrayBuffer(binUrl) {
    const cacheKey = getResourceCacheKey(binUrl)
    if (!cacheKey) throw new Error('bin URL 为空')
    if (directBinArrayBufferCache.has(cacheKey)) {
      console.log('[DirectManifest] bin 缓存命中:', cacheKey)
      touchCacheEntry(directBinArrayBufferCache, cacheKey)
      return directBinArrayBufferCache.get(cacheKey)
    }
    if (directBinArrayBufferPendingCache.has(cacheKey)) {
      console.log('[DirectManifest] bin 等待进行中的请求:', cacheKey)
      return directBinArrayBufferPendingCache.get(cacheKey)
    }

    const request = (async () => {
      const binRes = await fetch(binUrl)
      if (!binRes.ok) throw new Error(`bin 加载失败: ${binRes.status}`)
      const binBuf = await binRes.arrayBuffer()
      directBinArrayBufferCache.set(cacheKey, binBuf)
      pruneCacheToFrameLimit(
        directBinArrayBufferCache,
        effectiveDirectBinCacheMax,
      )
      return binBuf
    })()
    directBinArrayBufferPendingCache.set(cacheKey, request)
    try {
      return await request
    } finally {
      directBinArrayBufferPendingCache.delete(cacheKey)
    }
  }

  function collectNormalizedVolumeStats(data) {
    let normalizedMax = 0
    let normalizedAboveTiny = 0
    let normalizedAboveVisible = 0
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i]
      if (value > normalizedMax) normalizedMax = value
      if (value > 0.0015) normalizedAboveTiny += 1
      if (value > 0.02) normalizedAboveVisible += 1
    }
    return {
      normalizedMax,
      normalizedAboveTiny,
      normalizedAboveVisible,
      visibleRatio:
        data.length > 0 ? normalizedAboveVisible / data.length : 0,
    }
  }

  function expandSparseNormalizedVolume(data, dims, radius) {
    const nx = Math.round(Number(dims?.[0]) || 0)
    const ny = Math.round(Number(dims?.[1]) || 0)
    const nz = Math.round(Number(dims?.[2]) || 0)
    const safeRadius = Math.max(0, Math.min(4, Math.round(Number(radius) || 0)))
    if (
      safeRadius <= 0 ||
      nx <= 0 ||
      ny <= 0 ||
      nz <= 0 ||
      data.length !== nx * ny * nz
    ) {
      return data
    }

    const expanded = new data.constructor(data)
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          const sourceIndex = ix + nx * (iy + ny * iz)
          const sourceValue = data[sourceIndex]
          if (!Number.isFinite(sourceValue) || sourceValue <= 0.02) continue

          for (let dz = -safeRadius; dz <= safeRadius; dz += 1) {
            const z = iz + dz
            if (z < 0 || z >= nz) continue
            for (let dy = -safeRadius; dy <= safeRadius; dy += 1) {
              const y = iy + dy
              if (y < 0 || y >= ny) continue
              for (let dx = -safeRadius; dx <= safeRadius; dx += 1) {
                const x = ix + dx
                if (x < 0 || x >= nx) continue
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
                if (dist > safeRadius + 0.001) continue
                const falloff = 1 - dist / (safeRadius + 1)
                const nextValue = sourceValue * Math.max(0.25, falloff)
                const targetIndex = x + nx * (y + ny * z)
                if (nextValue > expanded[targetIndex]) {
                  expanded[targetIndex] = nextValue
                }
              }
            }
          }
        }
      }
    }
    return expanded
  }

  /**
   * 直接加载 manifest.json + bin 文件（不经过 Python API）
   * @param {string} manifestUrl - manifest.json 的 URL
   * @param {string} variable - 变量名
   * @param {Function} onProgress - 进度回调
   */
  async function loadDirectManifestBin(manifestUrl, variable, onProgress, options = {}) {
    const manifestData = options?.manifestData || null
    const directBinUrl = typeof options?.binUrl === 'string' ? options.binUrl.trim() : ''
    // 把 frameIndex 加入缓存键，确保不同时间步的帧有独立的缓存条目
    const frameIndex = typeof options?.frameIndex === 'number' ? options.frameIndex : 0
    const cacheKey = `manifest::v${NORMALIZE_VERSION}::${manifestUrl}::${variable}::${directBinUrl || 'auto'}::f${frameIndex}`
    if (directBinUrl) {
      logTimelineBinUrl(directBinUrl, { variable, frameIndex })
    }
    if (directVolumeCache.has(cacheKey)) {
      console.log('[DirectManifest] 缓存命中, frameIndex:', frameIndex)
      touchCacheEntry(directVolumeCache, cacheKey)
      return directVolumeCache.get(cacheKey)
    }

    onProgress?.({
      variable,
      url: manifestUrl,
      type: 'progress',
      phase: 'manifest',
      offset: 10,
      text: '加载 manifest.json…',
    })

    // 1. 加载 manifest.json
    const manifest = await fetchCachedManifestJson(manifestUrl, manifestData)

    // 2. 找到变量信息（过滤掉 ghost 变量）
    const normalizeVariableKey = (value) =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_\-:()]+/g, '')
    const resolveVariableFileUrl = (variableInfo) =>
      String(
        variableInfo?.file_url ??
          variableInfo?.bin_url ??
          variableInfo?.file ??
          variableInfo?.url ??
          variableInfo?.data_url ??
          variableInfo?.volume_url ??
          '',
      ).trim()
    const targetVariable = normalizeVariableKey(variable)
    let varInfo = (manifest.variables || [])
      .filter(v => v.slug && v.slug !== 'vtkghosttype')
      .find((v) => {
        const slug = normalizeVariableKey(v?.slug)
        const name = normalizeVariableKey(v?.name)
        return (
          (targetVariable && slug === targetVariable) ||
          (targetVariable && name === targetVariable)
        )
      })
    
    // 当提供了 directBinUrl 时，即使 manifest 中没有找到变量，也继续执行
    if (!varInfo && directBinUrl) {
      console.log('[DirectManifest] 使用 directBinUrl，跳过 manifest 变量查找:', directBinUrl)
      varInfo = {
        file: directBinUrl.split('/').pop() || 'volume.bin',
        slug: variable,
        name: variable
      }
    } else if (!varInfo) {
      throw new Error(`manifest 中未找到变量: ${variable}`)
    }

    onProgress?.({
      variable,
      url: manifestUrl,
      type: 'progress',
      phase: 'load',
      offset: 30,
      text: `加载 bin: ${varInfo.file}…`,
    })

    const resolveManifestRelativeUrl = (url) => {
      const cleanUrl = String(url || '').trim()
      if (!cleanUrl) return ''
      try {
        return new URL(cleanUrl, manifestUrl).toString()
      } catch {
        const baseUrl = manifestUrl.replace(/[^/]*$/, '')
        return `${baseUrl}${cleanUrl}`
      }
    }

    // 3. 构建 bin URL（与 manifest 同目录）
    const baseUrl = manifestUrl.replace(/[^/]*$/, '')
    const binUrl = directBinUrl
      ? resolveManifestRelativeUrl(directBinUrl)
      : resolveManifestRelativeUrl(resolveVariableFileUrl(varInfo))
    logTimelineBinUrl(binUrl, { variable, frameIndex })
    if (!binUrl) {
      throw new Error(`manifest 中未找到变量 bin URL: ${variable}`)
    }

    // 4. 加载 bin 文件
    const binBuf = await fetchCachedBinArrayBuffer(binUrl)
    const rawUint16 = new Uint16Array(binBuf)
    const dims = manifest.dimensions || manifest.dims || [100, 100, 100]
    const expectedVoxelCount = Math.max(
      0,
      Math.round(Number(dims[0]) || 0) *
        Math.round(Number(dims[1]) || 0) *
        Math.round(Number(dims[2]) || 0),
    )
    let uint16 = rawUint16
    if (expectedVoxelCount > 0 && rawUint16.length !== expectedVoxelCount) {
      uint16 = new Uint16Array(expectedVoxelCount)
      uint16.set(
        rawUint16.subarray(0, Math.min(rawUint16.length, expectedVoxelCount)),
      )
    }
    if (expectedVoxelCount > 0 && rawUint16.length !== expectedVoxelCount) {
      console.warn('[DirectManifest] bin 长度与 dimensions 不一致:', {
        variable,
        binUrl,
        byteLength: binBuf.byteLength,
        uint16Length: rawUint16.length,
        expectedVoxelCount,
        dims,
      })
    }

    const originalRange = Array.isArray(varInfo.original_value_range)
      ? varInfo.original_value_range
      : Array.isArray(varInfo.originalValueRange)
        ? varInfo.originalValueRange
        : []

    // 5. 归一化到 [0,1]。与 /test-bin 保持一致：非零 raw 值先按当前帧 rawMin/rawMax
    // 映射到原始物理值域；色带最大/最小值再由 uDisplayMin/uDisplayMax 进入 raymarch。
    let rawMin = Infinity, rawMax = -Infinity
    let nonZeroCount = 0
    for (let i = 0; i < uint16.length; i++) {
      const v = uint16[i]
      if (v !== 0) {
        nonZeroCount += 1
        if (v < rawMin) rawMin = v
        if (v > rawMax) rawMax = v
      }
    }
    if (nonZeroCount === 0) {
      console.warn('[DirectManifest] bin 全为 0，raymarch 没有可见体素:', {
        variable,
        binUrl,
        voxelCount: uint16.length,
      })
      rawMin = 0
      rawMax = 0
    }
    const isConstantNonZero = nonZeroCount > 0 && rawMax === rawMin
    if (isConstantNonZero) {
      console.warn('[DirectManifest] bin 非零值为常量，按 mask 显示:', {
        variable,
        binUrl,
        value: rawMin,
        nonZeroCount,
        voxelCount: uint16.length,
      })
    }
    const displayMin =
      Number.isFinite(Number(originalRange[0])) ? Number(originalRange[0]) : rawMin
    const displayMax =
      Number.isFinite(Number(originalRange[1])) ? Number(originalRange[1]) : rawMax
    const range = Math.max(rawMax - rawMin, 1)
    let floatData = new Float32Array(uint16.length)
    for (let j = 0; j < uint16.length; j++) {
      if (nonZeroCount === 0) {
        floatData[j] = 0
      } else {
        floatData[j] = isConstantNonZero
          ? (uint16[j] === 0 ? 0 : 1)
          : (uint16[j] - rawMin) / range
      }
    }

    floatData = reorderManifestVoxelsForData3DTexture(floatData, manifest)

    let displayEnhancement = null
    let normalizedStats = collectNormalizedVolumeStats(floatData)
    const skipRadarMockSparseEnhance = isRadarMockVolumeVariableId(variable)
    if (
      !skipRadarMockSparseEnhance &&
      normalizedStats.normalizedAboveVisible > 0 &&
      normalizedStats.visibleRatio < 0.0005
    ) {
      const radius =
        normalizedStats.visibleRatio < 0.00005
          ? 8
          : normalizedStats.visibleRatio < 0.0002
            ? 5
            : 3
      const beforeStats = normalizedStats
      floatData = expandSparseNormalizedVolume(floatData, dims, radius)
      normalizedStats = collectNormalizedVolumeStats(floatData)
      displayEnhancement = {
        type: 'sparse-volume-expansion',
        radius,
        visibleBefore: beforeStats.normalizedAboveVisible,
        visibleAfter: normalizedStats.normalizedAboveVisible,
        visibleRatioBefore: beforeStats.visibleRatio,
        visibleRatioAfter: normalizedStats.visibleRatio,
      }
      console.warn('[DirectManifest] 稀疏体数据已做显示增强:', {
        variable,
        ...displayEnhancement,
      })
    }

    console.log('[DirectManifest] 体素统计:', {
      variable,
      dims,
      expectedVoxelCount,
      dataLength: floatData.length,
      rawMin,
      rawMax,
      nonZeroCount,
      nonZeroRatio:
        floatData.length > 0 ? nonZeroCount / floatData.length : 0,
      normalizedMax: normalizedStats.normalizedMax,
      normalizedAboveTiny: normalizedStats.normalizedAboveTiny,
      normalizedAboveVisible: normalizedStats.normalizedAboveVisible,
      visibleRatio: normalizedStats.visibleRatio,
      displayEnhancement,
    })

    const bounds = {
      minValue: displayMin,
      maxValue: displayMax,
      rowCount: uint16.length,
      nonZeroCount,
      spacing: manifest.spacing || [1, 1, 1],
      origin: manifest.origin || [0, 0, 0],
      displayEnhancement,
    }

    onProgress?.({
      variable,
      url: manifestUrl,
      type: 'progress',
      phase: 'complete',
      offset: 100,
      text: '完成',
    })

    const result = {
      data: floatData,
      dims,
      valueRange: [displayMin, displayMax],
      bounds,
      displayEnhancement,
    }
    directVolumeCache.set(cacheKey, result)
    pruneCacheToFrameLimit(
      directVolumeCache,
      effectiveDirectVolumeCacheMax,
      (value) => {
        value?.texture?.dispose?.()
      },
    )

    // 缓存 manifest bounds，供 resolveVolumeTransform 使用
    const manifestBounds = computeManifestBounds(manifest)
    cachedManifestBounds = manifestBounds

    return result
  }

  /**
   * 从 manifest 计算包围盒（与 TestBinVolumeView 一致：cm→m，除以100）
   */
  function computeManifestBounds(manifest) {
    if (!manifest) return null
    const dims = manifest.dimensions || manifest.dims || [100, 100, 100]
    const origin = manifest.origin || [0, 0, 0]
    const spacing = manifest.spacing || [1, 1, 1]
    const nx = dims[0], ny = dims[1], nz = dims[2]
    const min = [
      (Number(origin[0])) / 100,
      (Number(origin[1])) / 100,
      (Number(origin[2])) / 100,
    ]
    const max = [
      (Number(origin[0]) + (nx - 1) * Number(spacing[0])) / 100,
      (Number(origin[1]) + (ny - 1) * Number(spacing[1])) / 100,
      (Number(origin[2]) + (nz - 1) * Number(spacing[2])) / 100,
    ]
    return { min, max }
  }

  // 移除体渲染图层数量限制，允许无限制的 raymarch 体渲染
  // const MAX_RAYMARCH_VOLUMES = 4

  const volumeMeshes = new Map()
  const volumeStagingMeshes = new Map()
  let volumeWire = null
  let volumeWorker = null
  let volumeSyncToken = 0
  let workerMessageId = 0
  let volumeHighQualityTimer = 0
  let isVolumeInteracting = false
  let useLowQualityRaymarch = false
  let lastVolumePixelRatio = 0
  let lastVolumeSourceKey = ''
  const lastVolumeSourceKeysByLayer = new Map()
  let lastVolumeTimeStep = null
  let pendingVolumeKey = null
  const PREVIEW_RESOLUTION = 32

  // 双 texture 缓存池：frameIndex -> Data3DTexture
  const volumeTextureCache = new Map()
  const VOLUME_TEXTURE_CACHE_MAX = 40
  let effectiveVolumeTextureCacheMax = VOLUME_TEXTURE_CACHE_MAX
  const PLAYBACK_BLEND_MS = 100
  const VOLUME_DATASET_PRELOAD_WINDOW_RADIUS = 6
  const VOLUME_DATASET_PRELOAD_MAX_FRAMES = 32
  const VOLUME_DATASET_PRELOAD_CONCURRENCY = 1
  let volumeDatasetPreloadToken = 0

  function disposeVolumeTextureCacheEntry(entry) {
    entry?.texture?.dispose?.()
    entry?.occupancyTexture?.dispose?.()
  }

  function isCachedVolumeTexture(texture) {
    if (!texture) return false
    for (const entry of volumeTextureCache.values()) {
      if (entry?.texture === texture || entry?.occupancyTexture === texture) {
        return true
      }
    }
    return false
  }

  function pruneVolumeTextureCache() {
    if (volumeTextureCache.size <= effectiveVolumeTextureCacheMax) return
    const keys = Array.from(volumeTextureCache.keys())
    const toRemove = keys.slice(0, keys.length - effectiveVolumeTextureCacheMax)
    toRemove.forEach((key) => {
      disposeVolumeTextureCacheEntry(volumeTextureCache.get(key))
      volumeTextureCache.delete(key)
    })
    console.log('[VolumeCache] LRU 清理，移除', toRemove.length, '帧纹理')
  }

  function getVolumeTextureCacheKey(layerKey, frameIndex) {
    return `${String(layerKey)}::${frameIndex}`
  }

  function getCachedVolumeFrameResources(layerKey, frameIndex) {
    return volumeTextureCache.get(getVolumeTextureCacheKey(layerKey, frameIndex)) || null
  }

  function cacheVolumeFrameResources(layerKey, frameIndex, resources) {
    if (!resources?.texture) return resources
    const cacheKey = getVolumeTextureCacheKey(layerKey, frameIndex)
    const existing = volumeTextureCache.get(cacheKey)
    if (existing && existing !== resources) {
      disposeVolumeTextureCacheEntry(existing)
    }
    volumeTextureCache.set(cacheKey, resources)
    pruneVolumeTextureCache()
    return resources
  }

  function createVolumeFrameResourcesFromVoxelResult(
    voxelResult,
    frameIndex,
    source = 'manifest-playback',
  ) {
    if (!voxelResult?.data?.length) return null
    const dims = Array.isArray(voxelResult.dims)
      ? voxelResult.dims
      : [voxelResult.dims, voxelResult.dims, voxelResult.dims]
    const valueRange = voxelResult.valueRange || [
      voxelResult.bounds?.minValue,
      voxelResult.bounds?.maxValue,
    ]
    const texture = configureVolumeTexture(
      new THREE.Data3DTexture(voxelResult.data, dims[0], dims[1], dims[2]),
      voxelResult.data,
    )
    const occupancyTexture = createOccupancyData3DTexture(
      voxelResult.data,
      dims[0],
      dims[1],
      dims[2],
    )

    return {
      texture,
      occupancyTexture,
      frameIndex,
      meta: {
        dims,
        rowCount: voxelResult?.bounds?.rowCount,
        valueRange,
        source,
        displayEnhancement: voxelResult?.displayEnhancement || null,
      },
    }
  }

  function warmVolumeFrameResources(resources) {
    const renderer = getRenderer?.()
    if (!renderer || typeof renderer.initTexture !== 'function') return
    try {
      if (resources?.texture) renderer.initTexture(resources.texture)
      if (resources?.occupancyTexture) {
        renderer.initTexture(resources.occupancyTexture)
      }
    } catch (error) {
      console.warn('[VolumeCache] GPU 纹理预热失败:', error)
    }
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3)
  }

  function cancelVolumeBlendAnimation(mesh) {
    if (!mesh?.userData?.volumeBlendFrameId) return
    cancelAnimationFrame(mesh.userData.volumeBlendFrameId)
    mesh.userData.volumeBlendFrameId = 0
  }

  function animateBlendFactor(mesh, fromFrameIndex, toFrameIndex, duration = 400) {
    if (!mesh?.material?.uniforms) return
    cancelVolumeBlendAnimation(mesh)
    const uniforms = mesh.material.uniforms
    const start = performance.now()

    uniforms.uBlendFactor.value = 0.0

    function step() {
      const elapsed = performance.now() - start
      const t = Math.min(elapsed / duration, 1.0)
      uniforms.uBlendFactor.value = easeOutCubic(t)

      if (t < 1.0) {
        mesh.userData.volumeBlendFrameId = requestAnimationFrame(step)
      } else {
        mesh.userData.volumeBlendFrameId = 0
        uniforms.uVolumePrev.value = uniforms.uVolumeNext.value
        uniforms.uBlendFactor.value = 0.0
        mesh.userData.volumePrev = uniforms.uVolumePrev.value
        mesh.userData.volumeNext = uniforms.uVolumeNext.value
        mesh.userData.volumeFrameIndex = toFrameIndex
      }
    }

    mesh.userData.volumeBlendFrameId = requestAnimationFrame(step)
  }

  function applyVolumeFrameResourcesToMesh(
    mesh,
    resources,
    frameIndex,
    { blendMs = PLAYBACK_BLEND_MS } = {},
  ) {
    if (!mesh?.material?.uniforms || !resources?.texture) return false
    const uniforms = mesh.material.uniforms
    const fromFrameIndex = mesh.userData.volumeFrameIndex
    if (fromFrameIndex === frameIndex && !mesh.userData.isPreview) {
      return true
    }

    if (mesh.userData.fullResLoading) {
      mesh.userData.fullResLoading = 'cancelled'
    }
    mesh.userData.isPreview = false

    const nextTexture = resources.texture
    const prevTexture = uniforms.uVolumeNext.value || uniforms.uVolumePrev.value
    uniforms.uVolumePrev.value = prevTexture
    uniforms.uVolumeNext.value = nextTexture
    uniforms.uBlendFactor.value = 0.0
    mesh.userData.volumePrev = prevTexture
    mesh.userData.volumeNext = nextTexture

    if (resources.meta && mesh.userData.volumeMeta) {
      mesh.userData.volumeMeta = {
        ...mesh.userData.volumeMeta,
        ...resources.meta,
      }
    }
    updateDisplayRangeForMesh(mesh)
    updateTransferStopsForMesh(mesh)

    if (resources.occupancyTexture && uniforms.uOccMax) {
      if (mesh.userData.volumeOccOwned && !isCachedVolumeTexture(uniforms.uOccMax.value)) {
        uniforms.uOccMax.value.dispose()
      }
      uniforms.uOccMax.value = resources.occupancyTexture
      uniforms.uOccEnabled.value = 1.0
      mesh.userData.volumeOccOwned = isCachedVolumeTexture(resources.occupancyTexture)
    }

    if (blendMs > 0 && fromFrameIndex != null && fromFrameIndex !== frameIndex) {
      animateBlendFactor(mesh, fromFrameIndex, frameIndex, blendMs)
    } else {
      uniforms.uVolumePrev.value = nextTexture
      uniforms.uVolumeNext.value = nextTexture
      uniforms.uBlendFactor.value = 0.0
      mesh.userData.volumePrev = nextTexture
      mesh.userData.volumeNext = nextTexture
      mesh.userData.volumeFrameIndex = frameIndex
    }
    return true
  }

  async function loadVolumeFrameResources(payload, transform) {
    const volumeUrl = resolveVolumeDataUrl(payload)
    const currentFrameIndex = resolveVolumeFrameIndex(payload)
    const framePayload = Array.isArray(payload?.volume_dataset_frames)
      ? payload.volume_dataset_frames[currentFrameIndex] ||
        payload.volume_dataset_frames[0]
      : null
    const manifestUrl = framePayload?.manifest_url || payload?.manifest_url
    const frameBinUrl =
      typeof framePayload?.bin_url === 'string' ? framePayload.bin_url.trim() : ''
    const payloadBinUrl =
      typeof payload?.bin_url === 'string' ? payload.bin_url.trim() : ''
    const effectiveUrl = resolveEffectiveVolumeUrl(volumeUrl, payload)
    const effectiveBinUrl =
      frameBinUrl ||
      payloadBinUrl ||
      (manifestUrl && /\.bin(?:[?#].*)?$/i.test(String(effectiveUrl || ''))
        ? String(effectiveUrl).trim()
        : '')

    if (!effectiveUrl && !manifestUrl) return null

    const globalValueRange = extractGlobalValueRange(payload)
    const varName = String(payload?.variable || '').trim()
    const manifestData = payload?.manifest_content || null

    let voxelResult
    if (manifestUrl) {
      voxelResult = await loadDirectManifestBin(
        manifestUrl,
        varName,
        onWorkerProgress,
        {
          manifestData,
          binUrl: effectiveBinUrl,
          frameIndex: currentFrameIndex,
        },
      )
    } else {
      voxelResult = await runVolumeWorker(payload, effectiveUrl, globalValueRange)
    }

    return createVolumeFrameResourcesFromVoxelResult(
      voxelResult,
      currentFrameIndex,
      manifestUrl ? 'manifest-playback' : 'worker-playback',
    )
  }

  function resolveVolumeMeshKey(layer, activePayload, index) {
    const baseLayerKey =
      layer?.id || activePayload?.id || activePayload?.variable || index
    const preferredKey = String(baseLayerKey)
    if (volumeMeshes.has(preferredKey)) return preferredKey
    const uniqueKey = `${preferredKey}:${index}`
    if (volumeMeshes.has(uniqueKey)) return uniqueKey
    const layerId = layer?.id != null ? String(layer.id) : ''
    if (layerId) {
      for (const [key, mesh] of volumeMeshes.entries()) {
        if (mesh.userData?.volumeMeta?.layerId === layerId) return key
      }
    }
    return preferredKey
  }

  async function syncPlaybackFrame(options = {}) {
    const isStale =
      typeof options.isStale === 'function' ? options.isStale : () => false
    const isEnabled =
      typeof getIsEnabled === 'function'
        ? getIsEnabled()
        : getSceneMode() === 'volume'
    if (!isEnabled || !getDynamicGroup?.()) return false
    if (getVolumeRenderMode() !== 'raymarch') return false

    const visibleLayers = Array.isArray(getVisibleVolumeLayers?.())
      ? getVisibleVolumeLayers().filter((layer) => layer?.visible !== false)
      : []
    if (!visibleLayers.length || volumeMeshes.size === 0) return false

    const payloadEntries = visibleLayers
      .map((layer) => ({
        layer,
        payload: getVolumePayloadForLayer?.(layer) || null,
      }))
      .filter((entry) => entry.payload)

    if (!payloadEntries.length) return false

    const frameUpdates = []
    for (let index = 0; index < payloadEntries.length; index += 1) {
      if (isStale()) return false
      const { layer, payload: activePayload } = payloadEntries[index]
      const layerKey = resolveVolumeMeshKey(layer, activePayload, index)
      const mesh = volumeMeshes.get(layerKey)
      if (!mesh) return false

      const frameIndex = resolveVolumeFrameIndex(activePayload)
      let resources = getCachedVolumeFrameResources(layerKey, frameIndex)
      if (!resources) {
        const transform = resolveVolumeTransform(activePayload)
        resources = await loadVolumeFrameResources(activePayload, transform)
        if (isStale()) return false
        if (!resources) return false
        cacheVolumeFrameResources(layerKey, frameIndex, resources)
      }

      frameUpdates.push({
        mesh,
        resources,
        frameIndex,
      })
    }

    if (isStale()) return false

    let updatedCount = 0
    for (const { mesh, resources, frameIndex } of frameUpdates) {
      if (
        applyVolumeFrameResourcesToMesh(mesh, resources, frameIndex, {
          blendMs: 0,
        })
      ) {
        updatedCount += 1
      }
    }

    lastVolumeTimeStep = getCurrentTimeStep?.()
    return updatedCount > 0
  }

  function hasVolumeMeshes() {
    return volumeMeshes.size > 0
  }

  function getVolumeRenderMode() {
    return getVisualization()?.volume_render_mode === 'particle'
      ? 'particle'
      : 'raymarch'
  }

  /** 预加载队列：存储待预加载的 CSV URL */
  const preloadQueue = new Set()
  let isPreloading = false

  /** 预加载单个 CSV（后台静默解析，不阻塞主流程） */
  async function preloadVolumeCsv(url, variable, globalValueRange = null) {
    const cleanUrl = normalizeUrl(url)

    // 计算 rangeKey（与 runVolumeWorker 一致）
    const rangeKey = globalValueRange
      ? `${globalValueRange[0]}:${globalValueRange[1]}`
      : 'local'
    const cacheKey = `v${NORMALIZE_VERSION}::${cleanUrl}::${variable}::${rangeKey}`

    console.log('[VolumePreload] 检查缓存:', {
      url: cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1),
      variable,
      rangeKey,
      cacheKey,
      cacheHit: volumeVoxelCache.has(cacheKey),
      pendingHit: volumeVoxelPendingCache.has(cacheKey),
    })

    // 已缓存或正在加载，跳过
    if (
      volumeVoxelCache.has(cacheKey) ||
      volumeVoxelPendingCache.has(cacheKey)
    ) {
      console.log('[VolumePreload] 已缓存或加载中，跳过')
      return
    }

    console.log('[VolumePreload] 开始预加载:', {
      url: cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1),
      variable,
      rangeKey,
    })

    try {
      await runVolumeWorker({ variable }, cleanUrl, globalValueRange)
      console.log('[VolumePreload] 预加载完成:', {
        url: cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1),
        variable,
      })
    } catch (error) {
      console.warn('[VolumePreload] 预加载失败:', {
        url: cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1),
        variable,
        error: error.message,
      })
    }
  }

  /** 批量预加载 CSV 列表（高并发处理） */
  async function processPreloadQueue() {
    if (isPreloading || preloadQueue.size === 0) return

    isPreloading = true
    const items = Array.from(preloadQueue)
    preloadQueue.clear()

    console.log('[VolumePreload] 开始批量预加载，共', items.length, '个文件')

    // 增加并发数到 8
    const batchSize = 8
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      await Promise.all(
        batch.map((item) =>
          preloadVolumeCsv(item.url, item.variable, item.globalValueRange).catch(
            (err) => {
              console.warn('[VolumePreload] 批次中某个失败:', err.message)
            },
          ),
        ),
      )
    }

    isPreloading = false
    console.log('[VolumePreload] 批量预加载完成')
  }

  async function preloadVolumeDatasetFrame(frame, fallbackVariable, options = {}) {
    return loadDirectManifestBin(
      frame.manifestUrl,
      frame.variable || fallbackVariable,
      onWorkerProgress,
      {
        manifestData: frame.manifestData,
        binUrl: frame.binUrl,
        frameIndex: frame.frameIndex,
      },
    ).then((voxelResult) => {
      const layerKey = String(options.layerKey || '').trim()
      if (layerKey && voxelResult?.data?.length) {
        const resources = createVolumeFrameResourcesFromVoxelResult(
          voxelResult,
          frame.frameIndex,
          'manifest-preload',
        )
        if (resources) {
          cacheVolumeFrameResources(layerKey, frame.frameIndex, resources)
          warmVolumeFrameResources(resources)
        }
      }
      return voxelResult
    }).catch((err) => {
      console.warn('[VolumePreload] manifest/bin 预加载失败:', {
        variable: frame.variable,
        timeStep: frame.timeStep,
        frameIndex: frame.frameIndex,
        error: err?.message || err,
      })
    })
  }

  async function preloadVolumeDatasetFrameBatch(
    frames,
    fallbackVariable,
    token,
    options = {},
  ) {
    if (!frames.length) return false
    for (let i = 0; i < frames.length; i += VOLUME_DATASET_PRELOAD_CONCURRENCY) {
      if (token !== volumeDatasetPreloadToken) return false
      const batch = frames.slice(i, i + VOLUME_DATASET_PRELOAD_CONCURRENCY)
      await Promise.all(
        batch.map((frame) =>
          preloadVolumeDatasetFrame(frame, fallbackVariable, options),
        ),
      )
    }
    return true
  }

  async function preloadVolumeDatasetFrames(payload, fallbackVariable, options = {}) {
    const variable = payload?.variable || fallbackVariable
    const payloadWithVar = { ...payload, variable }

    if (options.preloadAllFrames) {
      const allFrames = collectVolumeDatasetPreloadFrames(payloadWithVar)
      if (!allFrames.length) return false

      effectiveDirectVolumeCacheMax = Math.max(
        MAX_DIRECT_VOLUME_CACHE_FRAMES,
        allFrames.length,
      )
      effectiveDirectBinCacheMax = Math.max(
        MAX_DIRECT_BIN_ARRAY_BUFFER_CACHE_FRAMES,
        allFrames.length,
      )
      effectiveVolumeTextureCacheMax = Math.max(
        VOLUME_TEXTURE_CACHE_MAX,
        allFrames.length,
      )

      const token = ++volumeDatasetPreloadToken
      console.log('[VolumePreload] 开始全时间步预加载 manifest/bin/GPU texture:', {
        variable,
        frameCount: allFrames.length,
      })
      await preloadVolumeDatasetFrameBatch(allFrames, variable, token, {
        layerKey: options.layerKey,
      })
      console.log('[VolumePreload] 全时间步 manifest/bin/GPU texture 预加载完成:', {
        variable,
        frameCount: allFrames.length,
      })
      return true
    }

    const currentFrameIndex = resolveVolumeFrameIndex(payload)
    const plan = buildVolumeDatasetPreloadPlan(
      payloadWithVar,
      {
        currentFrameIndex,
        currentTimeStep: getCurrentTimeStep?.(),
        windowRadius: VOLUME_DATASET_PRELOAD_WINDOW_RADIUS,
        maxFrames: VOLUME_DATASET_PRELOAD_MAX_FRAMES,
      },
    )
    const frames = [...plan.immediateFrames, ...plan.backgroundFrames]
    if (!frames.length) return false

    const token = ++volumeDatasetPreloadToken
    console.log('[VolumePreload] 开始有界预加载 manifest/bin:', {
      variable,
      currentFrameIndex,
      immediateCount: plan.immediateFrames.length,
      backgroundCount: plan.backgroundFrames.length,
      frameCount: frames.length,
    })

    await preloadVolumeDatasetFrameBatch(
      plan.immediateFrames,
      variable,
      token,
      { layerKey: options.layerKey },
    )

    if (plan.backgroundFrames.length > 0 && token === volumeDatasetPreloadToken) {
      globalThis.setTimeout(() => {
        preloadVolumeDatasetFrameBatch(
          plan.backgroundFrames,
          variable,
          token,
          { layerKey: options.layerKey },
        ).then((completed) => {
          if (!completed) return
          console.log('[VolumePreload] 后台 manifest/bin 预加载完成:', {
            variable,
            frameCount: plan.backgroundFrames.length,
          })
        })
      }, 0)
    }
    console.log('[VolumePreload] 当前窗口 manifest/bin 预加载完成:', {
      variable,
      frameCount: plan.immediateFrames.length,
    })
    return true
  }

  /** 添加预加载任务（从外部调用） */
  async function schedulePreload(
    urls,
    variable,
    globalValueRange = null,
    payload = null,
    options = {},
  ) {
    if (payload) {
      const didPreloadDataset = await preloadVolumeDatasetFrames(
        payload,
        variable,
        options,
      )
      if (didPreloadDataset) return
    }

    const cleanUrls = (Array.isArray(urls) ? urls : [urls])
      .map((url) => String(url || '').trim())
      .filter(Boolean)
    if (!cleanUrls.length || !variable) return

    cleanUrls.forEach((url) => {
      preloadQueue.add({ url, variable, globalValueRange })
    })
    await processPreloadQueue()
  }

  function summarizePayload(payload) {
    if (!payload || typeof payload !== 'object') return null
    return {
      variable: payload.variable ?? null,
      keys: Object.keys(payload),
      csv_urls: Array.isArray(payload.csv_urls) ? payload.csv_urls.length : 0,
      urls_csv: Array.isArray(payload.urls_csv) ? payload.urls_csv.length : 0,
      urls: Array.isArray(payload.urls) ? payload.urls.length : 0,
      volume_urls: Array.isArray(payload.volume_urls)
        ? payload.volume_urls.length
        : 0,
      volume_frame_urls: Array.isArray(payload.volume_frame_urls)
        ? payload.volume_frame_urls.length
        : 0,
      data_urls: Array.isArray(payload.data_urls)
        ? payload.data_urls.length
        : 0,
      frame_urls: Array.isArray(payload.frame_urls)
        ? payload.frame_urls.length
        : 0,
      positions_urls: Array.isArray(payload.positions_urls)
        ? payload.positions_urls.length
        : 0,
      colors_urls: Array.isArray(payload.colors_urls)
        ? payload.colors_urls.length
        : 0,
      csv_url: payload.csv_url || null,
      url: payload.url || null,
      csv: payload.csv || null,
      positions_url: payload.positions_url || null,
      colors_url: payload.colors_url || null,
      time_step: payload.time_step ?? null,
    }
  }

  function getFallbackVolumeTransform() {
    return {
      size: new THREE.Vector3(4.6, 4.6, 4.6),
      center: new THREE.Vector3(0, 0, 0),
    }
  }

  function normalizeGeometryBounds(rawBounds) {
    const bounds = rawBounds?.data || rawBounds
    if (!bounds || typeof bounds !== 'object') return null
    let min = null
    let max = null
    if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
      min = bounds.min.map((value) => Number(value))
      max = bounds.max.map((value) => Number(value))
    } else {
      min = [
        bounds.xmin ?? bounds.x_min,
        bounds.ymin ?? bounds.y_min,
        bounds.zmin ?? bounds.z_min,
      ].map((value) => Number(value))
      max = [
        bounds.xmax ?? bounds.x_max,
        bounds.ymax ?? bounds.y_max,
        bounds.zmax ?? bounds.z_max,
      ].map((value) => Number(value))
    }
    if (
      !min.every((value) => Number.isFinite(value)) ||
      !max.every((value) => Number.isFinite(value))
    ) {
      return null
    }
    return { min, max }
  }

  function resolveVolumeTransform(payload) {
    // raymarch 临时与 test-bin 保持一致：体数据自己的 origin/spacing/dimensions 优先。
    const frames = payload?.volume_dataset_frames
    if (Array.isArray(frames) && frames.length > 0) {
      const firstFrame = frames[0]
      const dims = Array.isArray(firstFrame?.dimensions)
        ? firstFrame.dimensions.map((v) => Number(v))
        : null
      const origin = Array.isArray(firstFrame?.origin)
        ? firstFrame.origin.map((v) => Number(v))
        : [0, 0, 0]
      const spacing = Array.isArray(firstFrame?.spacing)
        ? firstFrame.spacing.map((v) => Number(v))
        : [1, 1, 1]
      if (dims && dims.length === 3 && dims.every((v) => Number.isFinite(v) && v > 0)) {
        // origin/spacing 单位为 cm，转换为 m（与其他分支一致）
        const nx = dims[0]
        const ny = dims[1]
        const nz = dims[2]
        const min = [
          Number(origin[0]) / 100,
          Number(origin[1]) / 100,
          Number(origin[2]) / 100,
        ]
        const max = [
          (Number(origin[0]) + (nx - 1) * Number(spacing[0])) / 100,
          (Number(origin[1]) + (ny - 1) * Number(spacing[1])) / 100,
          (Number(origin[2]) + (nz - 1) * Number(spacing[2])) / 100,
        ]
        const size = new THREE.Vector3(
          Math.max(max[0] - min[0], 1e-6),
          Math.max(max[1] - min[1], 1e-6),
          Math.max(max[2] - min[2], 1e-6),
        )
        const center = new THREE.Vector3(
          (min[0] + max[0]) / 2,
          (min[1] + max[1]) / 2,
          (min[2] + max[2]) / 2,
        )
        console.log('[Volume Transform] 使用 volume_dataset_frames bounds (cm):', {
          dims, origin, spacing,
          min, max,
          size: { x: size.x, y: size.y, z: size.z },
          center: { x: center.x, y: center.y, z: center.z },
        })
        return { size, center }
      }
    }

    const manifestUrl = payload?.manifest_url
    if (cachedManifestBounds && manifestUrl) {
      const { min, max } = cachedManifestBounds
      const size = new THREE.Vector3(
        Math.max(max[0] - min[0], 1e-6),
        Math.max(max[1] - min[1], 1e-6),
        Math.max(max[2] - min[2], 1e-6),
      )
      const center = new THREE.Vector3(
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      )
      console.log('[Volume Transform] geometry bounds 不可用，回退 manifest bounds:', {
        min,
        max,
        size,
        center,
      })
      return { size, center }
    }

    const normalized = normalizeGeometryBounds(getGeometryBounds?.())
    if (normalized) {
      const [minX, minY, minZ] = normalized.min.map((value) => value / 100)
      const [maxX, maxY, maxZ] = normalized.max.map((value) => value / 100)
      const size = new THREE.Vector3(
        Math.max(maxX - minX, 1e-6),
        Math.max(maxY - minY, 1e-6),
        Math.max(maxZ - minZ, 1e-6),
      )
      const center = new THREE.Vector3(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2,
      )

      console.log('[Volume Transform] 使用 geometry bounds (cm):', {
        min: normalized.min,
        max: normalized.max,
      })
      console.log('[Volume Transform] geometry -> 计算结果 (m):', {
        size: { x: size.x, y: size.y, z: size.z },
        center: { x: center.x, y: center.y, z: center.z },
      })
      return { size, center }
    }

    console.warn('[Volume Transform] geometry/manifest bounds 均不可用，使用回退值')
    return getFallbackVolumeTransform()
  }

  function applyVolumeTransform(object, transform, scaleMultiplier = 1) {
    if (!object || !transform) return
    object.scale.set(
      transform.size.x * scaleMultiplier,
      transform.size.y * scaleMultiplier,
      transform.size.z * scaleMultiplier,
    )
    object.position.copy(transform.center)

    console.log('[Volume Transform] 应用到对象:', {
      scale: {
        x: object.scale.x,
        y: object.scale.y,
        z: object.scale.z,
      },
      position: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
      },
      scaleMultiplier,
    })
  }

  function createVolumeWire(transform) {
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: '#7ddfff',
        transparent: true,
        opacity: 0.25,
      }),
    )
    applyVolumeTransform(wire, transform, 1.01)
    return wire
  }

  function disposeSingleVolumeMesh(mesh) {
    if (!mesh) return
    cancelVolumeBlendAnimation(mesh)
    // 取消正在进行的全分辨率加载
    if (mesh.userData?.fullResLoading) {
      mesh.userData.fullResLoading = 'cancelled'
    }
    getDynamicGroup?.()?.remove(mesh)
    const uniforms = mesh.material?.uniforms
    if (mesh.userData?.volumeOccOwned && uniforms?.uOccMax?.value) {
      if (!isCachedVolumeTexture(uniforms.uOccMax.value)) {
        uniforms.uOccMax.value.dispose()
      }
      mesh.userData.volumeOccOwned = false
    }
    if (!isCachedVolumeTexture(uniforms?.uVolumePrev?.value)) {
      uniforms?.uVolumePrev?.value?.dispose?.()
    }
    if (
      uniforms?.uVolumeNext?.value &&
      uniforms.uVolumeNext.value !== uniforms?.uVolumePrev?.value &&
      !isCachedVolumeTexture(uniforms.uVolumeNext.value)
    ) {
      uniforms.uVolumeNext.value.dispose?.()
    }
    uniforms?.uPalette?.value?.dispose?.()
    mesh.geometry?.dispose?.()
    mesh.material?.dispose?.()
  }

  function disposeAbortedMesh(mesh) {
    if (!mesh) return
    const uniforms = mesh.material?.uniforms
    if (mesh.userData?.volumeOccOwned && uniforms?.uOccMax?.value) {
      uniforms.uOccMax.value.dispose()
      mesh.userData.volumeOccOwned = false
    }
    uniforms?.uVolumePrev?.value?.dispose?.()
    uniforms?.uVolumeNext?.value?.dispose?.()
    uniforms?.uPalette?.value?.dispose?.()
    mesh.geometry?.dispose?.()
    mesh.material?.dispose?.()
  }

  function disposeVolumeMesh(layerId = null) {
    if (layerId == null) {
      volumeMeshes.forEach((mesh) => disposeSingleVolumeMesh(mesh))
      volumeMeshes.clear()
      lastVolumeSourceKeysByLayer.clear()
      return
    }
    const key = String(layerId)
    const mesh = volumeMeshes.get(key)
    if (!mesh) return
    disposeSingleVolumeMesh(mesh)
    volumeMeshes.delete(key)
    lastVolumeSourceKeysByLayer.delete(key)
  }

  function ensureVolumeWorker() {
    if (volumeWorker) return volumeWorker
    volumeWorker = new Worker(workerUrl, { type: 'module' })
    return volumeWorker
  }

  function resolveVolumeWorkerResolution() {
    const currentTask = getCurrentTask?.()
    const pregenConfig = currentTask?.pregen_config || currentTask?.params?.pregen_config
    const pregenResolution = Number(pregenConfig?.volume?.resolution || pregenConfig?.volume?.ratio)
    
    const requested = Math.max(
      32,
      Math.min(160, pregenResolution || Number(getVisualization()?.volume_resolution) || 128),
    )
    if (isVolumeInteracting) {
      return Math.max(48, Math.min(80, Math.round(requested * 0.5)))
    }
    return requested
  }

  function updateVolumePixelRatio({ active, lowQuality = false } = {}) {
    const renderer = getRenderer?.()
    if (!renderer || typeof renderer.setPixelRatio !== 'function') return
    const nextRatio = resolveRenderPixelRatio({
      devicePixelRatio: window.devicePixelRatio,
      isVolumeActive: active,
      lowQuality,
    })
    if (Math.abs(nextRatio - lastVolumePixelRatio) < 0.001) return
    renderer.setPixelRatio(nextRatio)
    lastVolumePixelRatio = nextRatio
  }

  function updateVolumePalettes() {
    volumeMeshes.forEach((mesh) => {
      const uniforms = mesh?.material?.uniforms
      if (!uniforms?.uPalette) return
      const variableId = mesh?.userData?.volumeMeta?.variable
      const cmapResult = resolveVolumeCmap(variableId)
      const nextPalette = buildPaletteTexture(
        cmapResult.name || 'coolwarm',
        cmapResult.colors || null,
      )
      const previousPalette = uniforms.uPalette.value
      uniforms.uPalette.value = nextPalette
      previousPalette?.dispose?.()
      updateTransferStopsForMesh(mesh)
    })
  }

  function findVisibleLayerById(layerId) {
    const target = String(layerId || '')
    if (!target) return null
    const layers = Array.isArray(getVisibleVolumeLayers?.())
      ? getVisibleVolumeLayers()
      : []
    return layers.find((layer) => String(layer?.id || '') === target) || null
  }

  function normalizeDisplayRangeForMesh(mesh) {
    const uniforms = mesh?.material?.uniforms
    const meta = mesh?.userData?.volumeMeta || {}
    if (!uniforms?.uDisplayMin || !uniforms?.uDisplayMax) return [0, 1]
    const baseRange = Array.isArray(meta.valueRange) ? meta.valueRange : [0, 1]
    const baseMin = Number(baseRange[0])
    const baseMax = Number(baseRange[1])
    const layer = findVisibleLayerById(meta.layerId)
    const displayMin = Number(layer?.display_vmin ?? layer?.displayVMin)
    const displayMax = Number(layer?.display_vmax ?? layer?.displayVMax)

    if (
      !Number.isFinite(baseMin) ||
      !Number.isFinite(baseMax) ||
      baseMax <= baseMin ||
      !Number.isFinite(displayMin) ||
      !Number.isFinite(displayMax) ||
      displayMax <= displayMin
    ) {
      return [0, 1]
    }

    const width = baseMax - baseMin
    return [
      Math.max(0, Math.min(1, (displayMin - baseMin) / width)),
      Math.max(0, Math.min(1, (displayMax - baseMin) / width)),
    ]
  }

  function updateVolumeDisplayRanges() {
    volumeMeshes.forEach((mesh) => {
      updateDisplayRangeForMesh(mesh)
      updateTransferStopsForMesh(mesh)
    })
  }

  function updateDisplayRangeForMesh(mesh) {
    const uniforms = mesh?.material?.uniforms
    if (!uniforms?.uDisplayMin || !uniforms?.uDisplayMax) return
    const [displayMin, displayMax] = normalizeDisplayRangeForMesh(mesh)
    uniforms.uDisplayMin.value = displayMin
    uniforms.uDisplayMax.value = Math.max(displayMin + 1e-6, displayMax)
  }

  function runVolumeWorker(payload, url, globalValueRange = null, forceResolution = null, onPartial = null) {
    const selectedLayer = getSelectedLayer?.() || null
    // 优先使用 metadata 变量名，value 列按该字段匹配
    const variable = String(
      payload?.variable || selectedLayer?.variable || '',
    ).trim()
    if (!variable) {
      return Promise.reject(new Error('Volume payload missing variable name'))
    }
    const resolution = forceResolution || resolveVolumeWorkerResolution()
    const cleanUrl = normalizeUrl(url)
    const rangeKey = globalValueRange
      ? `${globalValueRange[0]}:${globalValueRange[1]}`
      : 'local'
    // 缓存 key 包含分辨率，这样预览和全分辨率分别缓存
    const cacheKey = `v${NORMALIZE_VERSION}::${cleanUrl}::${variable}::${rangeKey}::r${resolution}`
    console.log('[VolumeCache] 检查缓存:', {
      cacheKey,
      cacheHit: volumeVoxelCache.has(cacheKey),
      pendingHit: volumeVoxelPendingCache.has(cacheKey),
      url: cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1),
      variable,
      rangeKey,
      resolution,
      isPreview: forceResolution !== null,
    })
    if (volumeVoxelCache.has(cacheKey)) {
      console.log('[VolumeCache] ✅ 缓存命中，直接返回')
      return Promise.resolve(volumeVoxelCache.get(cacheKey))
    }
    if (volumeVoxelPendingCache.has(cacheKey)) {
      console.log('[VolumeCache] ⏳ 请求中，返回 pending promise')
      return volumeVoxelPendingCache.get(cacheKey)
    }
    const worker = ensureVolumeWorker()
    const id = `volume-${Date.now()}-${++workerMessageId}`

    const pendingPromise = new Promise((resolve, reject) => {
      const settle = (fn, value) => {
        worker.removeEventListener('message', onMessage)
        fn(value)
      }
      const onMessage = (event) => {
        const { type, id: msgId, ok } = event.data || {}
        if (msgId !== id) return
        if (type === 'strategy_selected') {
        } else if (type === 'progress') {
          onWorkerProgress?.({
            id,
            variable,
            url: cleanUrl,
            ...event.data,
          })
        } else if (type === 'partial') {
          // 流式 partial 结果
          onPartial?.(event.data)
        } else if (type === 'lod_ready') {
        } else if (type === 'complete' && event.data.ok) {
          onWorkerProgress?.({
            id,
            variable,
            url: cleanUrl,
            type: 'progress',
            phase: 'complete',
            offset: 100,
            size: 100,
          })
          volumeVoxelCache.set(cacheKey, event.data.result)
          settle(resolve, event.data.result)
        } else if (type === 'complete' && !event.data.ok) {
          onWorkerProgress?.({
            id,
            variable,
            url: cleanUrl,
            type: 'error',
            error: event.data.error || 'Volume CSV worker failed',
          })
          settle(
            reject,
            new Error(event.data.error || 'Volume CSV worker failed'),
          )
        } else if (ok === false) {
          onWorkerProgress?.({
            id,
            variable,
            url: cleanUrl,
            type: 'error',
            error: event.data.error || 'Volume CSV worker failed',
          })
          settle(
            reject,
            new Error(event.data.error || 'Volume CSV worker failed'),
          )
        }
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage({
        id,
        url: normalizeUrl(url),
        variable,
        dims: resolution,
        globalValueRange: globalValueRange || null,
        streaming: onPartial !== null, // 启用流式模式
      })
    })
    volumeVoxelPendingCache.set(cacheKey, pendingPromise)
    return pendingPromise.finally(() => {
      if (volumeVoxelPendingCache.get(cacheKey) === pendingPromise) {
        volumeVoxelPendingCache.delete(cacheKey)
      }
    })
  }

  function resolvePaletteColors() {
    const colors =
      Array.isArray(getVisualization()?.manualColors) &&
      getVisualization()?.manualColors.length
        ? getVisualization().manualColors
        : ['#2e5bff', '#64d7ff', '#ff935c']
    return colors.map((item) => new THREE.Color(item))
  }

  function samplePalette(value, minValue, maxValue) {
    const palette = resolvePaletteColors()
    if (palette.length === 1) return palette[0].clone()
    const safeMin = Number.isFinite(minValue) ? minValue : 0
    const safeMax =
      Number.isFinite(maxValue) && maxValue !== safeMin ? maxValue : safeMin + 1
    const normalized = THREE.MathUtils.clamp(
      (value - safeMin) / (safeMax - safeMin),
      0,
      1,
    )
    const scaled = normalized * (palette.length - 1)
    const low = Math.floor(scaled)
    const high = Math.min(low + 1, palette.length - 1)
    const color = palette[low].clone()
    return color.lerp(palette[high], scaled - low)
  }

  const MAX_TRANSFER_STOPS = 8

  function resolveTransferStopsForLayer(mesh, layer) {
    const stops = Array.isArray(layer?.volume_color_stops)
      ? layer.volume_color_stops
      : []
    if (stops.length < 2) return []
    const meta = mesh?.userData?.volumeMeta || {}
    const baseRange = Array.isArray(meta.valueRange) ? meta.valueRange : [0, 1]
    const baseMin = Number(baseRange[0])
    const baseMax = Number(baseRange[1])
    const displayMin = Number(layer?.display_vmin ?? layer?.displayVMin)
    const displayMax = Number(layer?.display_vmax ?? layer?.displayVMax)
    const vmin = Number.isFinite(displayMin) ? displayMin : baseMin
    const vmax = Number.isFinite(displayMax) ? displayMax : baseMax
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) {
      return []
    }
    const normalized = normalizeColorStops(stops, { vmin, vmax })
    if (normalized.length < 2) return []
    return normalized.slice(0, MAX_TRANSFER_STOPS)
  }

  function updateTransferStopsForMesh(mesh) {
    const uniforms = mesh?.material?.uniforms
    if (!uniforms?.uTransferStopCount) return
    const layer = findVisibleLayerById(mesh?.userData?.volumeMeta?.layerId)
    const stops = resolveTransferStopsForLayer(mesh, layer)
    uniforms.uTransferStopCount.value = stops.length
    for (let i = 0; i < MAX_TRANSFER_STOPS; i += 1) {
      const stop = stops[i]
      uniforms.uTransferPositions.value[i] = stop?.position ?? 0
      uniforms.uTransferBands.value[i] = stop?.bandPosition ?? stop?.position ?? 0
    }
  }

  function buildPaletteTexture(cmapName = 'coolwarm', customColors = null) {
    const width = 256
    const data = new Uint8Array(width * 4)

    // 根据色带名称或自定义颜色数组获取关键色
    const cmapColors =
      Array.isArray(customColors) && customColors.length >= 2
        ? customColors
        : getColormapColors(cmapName)
    const keys = cmapColors.map((hex) => {
      const c = new THREE.Color(hex)
      return { r: c.r, g: c.g, b: c.b }
    })

    if (keys.length < 2) {
      // fallback: 单色或无效色带，用 coolwarm
      keys.length = 0
      keys.push(
        { r: 0.23, g: 0.3, b: 0.75 },
        { r: 0.94, g: 0.94, b: 0.94 },
        { r: 0.71, g: 0.02, b: 0.15 },
      )
    }

    for (let index = 0; index < width; index += 1) {
      const t = index / (width - 1)
      // 在关键色之间线性插值
      const segCount = keys.length - 1
      const scaledT = t * segCount
      const segIdx = Math.min(Math.floor(scaledT), segCount - 1)
      const localT = scaledT - segIdx
      const c0 = keys[segIdx]
      const c1 = keys[segIdx + 1]
      const r = c0.r + (c1.r - c0.r) * localT
      const g = c0.g + (c1.g - c0.g) * localT
      const b = c0.b + (c1.b - c0.b) * localT
      data[index * 4] = Math.round(r * 255)
      data[index * 4 + 1] = Math.round(g * 255)
      data[index * 4 + 2] = Math.round(b * 255)
      data[index * 4 + 3] = Math.round(255 * Math.pow(t, 0.55))
    }
    const texture = new THREE.DataTexture(
      data,
      width,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
  }

  /**
   * 根据变量 id 查找对应色带，返回 { name?: string, colors?: string[] }
   * - name: 内置色带名称（coolwarm, hot 等），由 getColormapColors 解析
   * - colors: 接口色带的颜色数组，直接用于 buildPaletteTexture
   */
  /** 从 gasCmaps 中查找色带方案，支持大小写不敏感匹配 */
  function lookupGasScheme(gasCmaps, variableId) {
    if (!gasCmaps || !variableId) return undefined
    // 1. 精确匹配
    if (
      gasCmaps[variableId] != null &&
      String(gasCmaps[variableId]).trim() !== ''
    ) {
      return gasCmaps[variableId]
    }
    // 2. 大小写不敏感匹配（gasCmaps key 可能是 Mass_fraction_of_h2o，variableId 可能是 mass_fraction_of_h2o）
    const lowerId = String(variableId).toLowerCase()
    for (const [key, value] of Object.entries(gasCmaps)) {
      if (
        String(key).toLowerCase() === lowerId &&
        value != null &&
        String(value).trim() !== ''
      ) {
        return value
      }
    }
    return undefined
  }

  function resolveVolumeCmap(variableId) {
    const viz = getVisualization?.()
    if (!viz) {
      console.warn('[VolumeCmap] getVisualization 返回空，使用默认 coolwarm')
      return { name: 'coolwarm' }
    }
    let gasScheme = lookupGasScheme(viz.gasCmaps, variableId)
    if (
      isRadarMockVolumeVariableId(variableId) &&
      (gasScheme == null || String(gasScheme).trim() === '')
    ) {
      const picked = pickLocalCatalogColormapForRadarVolume(
        viz,
        getColorMapCatalog?.(),
      )
      if (picked) gasScheme = picked
    }
    console.log('[VolumeCmap] resolveVolumeCmap 调用:', {
      variableId,
      gasScheme,
      gasCmaps: viz.gasCmaps,
      manualColors: viz.manualColors,
    })

    const catalog = getColorMapCatalog?.()
    const catalogColors = resolveColormapColors(
      gasScheme,
      viz.manualColors,
      catalog,
    )
    const catalogEntry = findCatalogColormapEntry(catalog, gasScheme)
    if (
      catalogEntry &&
      Array.isArray(catalogColors) &&
      catalogColors.length >= 2
    ) {
      console.log('[VolumeCmap] 命中后端色带:', {
        id: catalogEntry.id,
        name: catalogEntry.name,
        colors: catalogColors.length,
      })
      return { colors: catalogColors }
    }

    // 使用与 use3DVisualization 一致的映射逻辑
    const VOLUME_SCHEME_TO_CMAP = {
      default: 'coolwarm',
      thermal: 'hot',
      speed: 'viridis',
      multicolor: 'jet',
      grayscale: 'gray',
    }
    if (gasScheme && VOLUME_SCHEME_TO_CMAP[gasScheme]) {
      console.log(
        '[VolumeCmap] 命中预设方案映射:',
        gasScheme,
        '->',
        VOLUME_SCHEME_TO_CMAP[gasScheme],
      )
      return { name: VOLUME_SCHEME_TO_CMAP[gasScheme] }
    }
    // 如果 gasScheme 直接是内置色带名（如 coolwarm, viridis 等）
    if (gasScheme && getColormapColors(gasScheme).length >= 2) {
      console.log('[VolumeCmap] 命中内置色带名:', gasScheme)
      return { name: gasScheme }
    }
    // 尝试从接口色带目录查找（gasScheme 可能是接口色带 id）
    if (gasScheme) {
      console.log('[VolumeCmap] 尝试从色带目录查找:', {
        gasScheme,
        catalogLength: Array.isArray(catalog) ? catalog.length : '非数组',
        catalogItems: Array.isArray(catalog)
          ? catalog.map((x) => ({
              id: x?.id,
              idType: typeof x?.id,
              name: x?.name,
              hasColors: Array.isArray(x?.colors),
              colorsLen: Array.isArray(x?.colors) ? x.colors.length : 0,
            }))
          : [],
        gasSchemeType: typeof gasScheme,
      })
      if (Array.isArray(catalog)) {
        // 精确匹配
        const entry = findCatalogColormapEntry(catalog, gasScheme)
        // entry 找到但 colors 为空时，尝试通过 color_map_url 获取
        if (
          entry &&
          (!Array.isArray(entry.colors) || entry.colors.length < 2)
        ) {
          console.warn(
            '[VolumeCmap] 找到色带但 colors 为空, entry:',
            JSON.stringify(entry).substring(0, 200),
          )
        }
        console.warn('[VolumeCmap] 未在目录中找到匹配的色带 id:', gasScheme)
      } else {
        console.warn(
          '[VolumeCmap] colorMapCatalog 非数组:',
          typeof catalog,
          catalog,
        )
      }
    }
    // custom 色带：使用 manualColors
    if (
      gasScheme === 'custom' &&
      Array.isArray(viz.manualColors) &&
      viz.manualColors.length >= 2
    ) {
      console.log(
        '[VolumeCmap] 命中 custom 色带, manualColors 数:',
        viz.manualColors.length,
      )
      return { colors: viz.manualColors }
    }
    console.warn(
      '[VolumeCmap] 未匹配任何色带，回退到默认 coolwarm. gasScheme:',
      gasScheme,
    )
    return { name: 'coolwarm' }
  }

  /** 从 COLORMAP_PREVIEW 获取色带关键色 */
  function getColormapColors(name) {
    const COLORMAP_PREVIEW = {
      coolwarm: ['#3b4cc0', '#9ebeff', '#f0f0f0', '#ff9b87', '#b40426'],
      bwr: ['#0000ff', '#ffffff', '#ff0000'],
      seismic: ['#0000aa', '#ffffff', '#aa0000'],
      RdBu: ['#2166ac', '#f7f7f7', '#b2182b'],
      RdYlBu: ['#3288bd', '#ffffbf', '#d53e4f'],
      RdYlGn: ['#1a9850', '#ffffbf', '#d73027'],
      Spectral: ['#9e0142', '#ffffbf', '#5e4fa2'],
      PiYG: ['#c51b7d', '#f7f7f7', '#4d9221'],
      BrBG: ['#543005', '#f5f5f5', '#003c30'],
      viridis: ['#440154', '#31688e', '#35b779', '#fde725'],
      plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
      inferno: ['#000004', '#56106e', '#bb3754', '#f98e09', '#fcffa4'],
      magma: ['#000004', '#4b0c6b', '#932667', '#dd5182', '#fcfdbf'],
      cividis: ['#00224e', '#575d6d', '#89a1b2', '#c3e0f4', '#deebf7'],
      turbo: ['#30123b', '#4684f9', '#1ae4b6', '#a2fc3c', '#7a0403'],
      jet: ['#00007f', '#0000ff', '#00ffff', '#ffff00', '#ff0000'],
      hot: ['#0b0b0b', '#ff0000', '#ffff00', '#ffffff'],
      Blues: ['#f7fbff', '#c6dbef', '#2171b5', '#08306b'],
      Greens: ['#f7fcf5', '#74c476', '#238b45', '#00441b'],
      Oranges: ['#fff5eb', '#fd8d3c', '#e6550d', '#a63603'],
      Reds: ['#fff5f0', '#fb6a4a', '#cb181d', '#67000d'],
      gray: ['#000000', '#888888', '#ffffff'],
      cool: ['#00ffff', '#ff00ff'],
      spring: ['#ff00ff', '#ffff00'],
      autumn: ['#ff0000', '#ffff00'],
      winter: ['#0000ff', '#00ff00'],
      rainbow: [
        '#ff0000',
        '#ff7f00',
        '#ffff00',
        '#00ff00',
        '#0000ff',
        '#9400d3',
      ],
    }
    return COLORMAP_PREVIEW[name] || []
  }

  /** 内联构建 mock 体数据（不走 Worker，用于 sample 数据展示） */
  function buildSampleVolumeData(dims = 48) {
    const safeDims = Math.max(16, Math.min(72, Math.round(dims)))
    const voxelData = new Float32Array(safeDims * safeDims * safeDims)
    for (let iz = 0; iz < safeDims; iz++) {
      for (let iy = 0; iy < safeDims; iy++) {
        for (let ix = 0; ix < safeDims; ix++) {
          const x = (ix / Math.max(safeDims - 1, 1)) * 2 - 1
          const y = (iy / Math.max(safeDims - 1, 1)) * 2 - 1
          const z = (iz / Math.max(safeDims - 1, 1)) * 2 - 1
          const radius = Math.sqrt(x * x + y * y + z * z)
          const shell = Math.exp(-Math.pow((radius - 0.45) * 8.0, 2))
          const swirl = 0.5 + 0.5 * Math.sin(10.0 * x + 8.0 * y + 6.0 * z)
          const value = shell * (0.35 + 0.65 * swirl)
          const idx = ix + safeDims * (iy + safeDims * iz)
          voxelData[idx] = value
        }
      }
    }
    return { voxelData, dims: safeDims }
  }

  /**
   * 通过 Worker 解析 CSV 并创建 raymarch mesh
   * 统一入口：不再有主线程同步解析路径
   * 渐进式加载：先用低分辨率预览让用户立刻看到，再后台加载全分辨率
   * 支持流式纹理更新：全分辨率边加载边替换
   */
  async function createRaymarchMeshFromCsvUrl(volumeUrl, payload, transform) {
    // volumeUrl 已按当前时间轴解析；payload.volume_urls 仅作为回退。
    const csvUrls = payload?.volume_urls || []
    const effectiveUrl = resolveEffectiveVolumeUrl(volumeUrl, payload)
    // 计算当前帧索引，用于缓存键区分不同时间步
    const currentFrameIndex = resolveVolumeFrameIndex(payload)
    const framePayload = Array.isArray(payload?.volume_dataset_frames)
      ? payload.volume_dataset_frames[currentFrameIndex] ||
        payload.volume_dataset_frames[0]
      : null
    const manifestUrl = framePayload?.manifest_url || payload?.manifest_url
    const frameBinUrl =
      typeof framePayload?.bin_url === 'string'
        ? framePayload.bin_url.trim()
        : ''
    const payloadBinUrl =
      typeof payload?.bin_url === 'string' ? payload.bin_url.trim() : ''
    const effectiveBinUrl =
      frameBinUrl ||
      payloadBinUrl ||
      (manifestUrl && /\.bin(?:[?#].*)?$/i.test(String(effectiveUrl || ''))
        ? String(effectiveUrl).trim()
        : '')

    console.log('[DEBUG Raymarch] createRaymarchMeshFromCsvUrl 调用:', {
      volumeUrl: effectiveUrl
        ? effectiveUrl.substring(effectiveUrl.lastIndexOf('/') + 1)
        : '(empty)',
      csvCount: csvUrls.length,
      hasPayload: !!payload,
      variable: payload?.variable,
      manifestUrl: manifestUrl || null,
      binUrl: effectiveBinUrl || null,
      frameIndex: currentFrameIndex,
      hasTransform: !!transform,
    })

    if (!effectiveUrl && !manifestUrl) {
      console.warn('[DEBUG Raymarch] volumeUrl 为空，无法创建 raymarch')
      return null
    }

    const globalValueRange = extractGlobalValueRange(payload)
    let mesh = null
    let currentTexture = null
    let isCancelled = false
    let previewTexture = null
    let fullResTexture = null
    let fullResLoaded = false

    // 流式加载进度回调
    const onPartial = (partial) => {
      if (isCancelled || !mesh) return
      const { offset, size, dims, valueRange } = partial
      if (size > 0) {
        const progress = (offset / size * 100).toFixed(0)
        console.log(`[DEBUG Raymarch] 📦 全分辨率加载进度: ${progress}%, dims: ${dims?.join('x')}`)

        // 如果有 partial 数据，尝试创建并更新纹理
        if (partial.partialData && dims) {
          const tex = configureVolumeTexture(
            new THREE.Data3DTexture(partial.partialData, dims[0], dims[1], dims[2]),
            partial.partialData,
          )

          if (currentTexture && currentTexture !== fullResTexture) {
            currentTexture.dispose()
          }
          currentTexture = tex
          mesh.material.uniforms.uVolumePrev.value = tex
        }
      }
    }

    // 第一步：先用低分辨率预览，让用户立刻看到东西
    console.log('[DEBUG Raymarch] 步骤1: 加载低分辨率预览 (res=', PREVIEW_RESOLUTION, ')')
    try {
      // 优先直接加载 manifest.json + bin
      let voxelResult
      const varName = String(payload?.variable || '').trim()
      const manifestData = payload?.manifest_content || null
      const directBinUrl = effectiveBinUrl

      if (manifestUrl) {
        voxelResult = await loadDirectManifestBin(
          manifestUrl,
          varName,
          onWorkerProgress,
          {
            manifestData,
            binUrl: directBinUrl,
            frameIndex: currentFrameIndex,
          },
        )
      } else {
        voxelResult = await runVolumeWorker(payload, effectiveUrl, globalValueRange, PREVIEW_RESOLUTION)
      }

      if (!voxelResult?.data?.length) {
        console.warn('[DEBUG Raymarch] 预览数据为空')
        return null
      }

      const previewData = voxelResult.data
      const previewDims = Array.isArray(voxelResult.dims)
        ? voxelResult.dims
        : [voxelResult.dims, voxelResult.dims, voxelResult.dims]
      const previewValueRange = voxelResult.valueRange || [
        voxelResult.bounds?.minValue,
        voxelResult.bounds?.maxValue,
      ]

      console.log('[DEBUG Raymarch] 创建预览 mesh, dims:', previewDims)

      previewTexture = configureVolumeTexture(
        new THREE.Data3DTexture(previewData, previewDims[0], previewDims[1], previewDims[2]),
        previewData,
      )
      currentTexture = previewTexture

      const previewOccTex = createOccupancyData3DTexture(
        previewData,
        previewDims[0],
        previewDims[1],
        previewDims[2],
      )

      mesh = createVolumeRaymarchMeshFromTexture(
        previewTexture,
        payload,
        transform,
        {
          dims: previewDims,
          rowCount: voxelResult?.bounds?.rowCount,
          valueRange: previewValueRange,
          source: manifestUrl ? 'manifest-bin' : 'worker-preview',
          isPreview: !manifestUrl,
          displayEnhancement: voxelResult?.displayEnhancement,
          occupancyTexture: previewOccTex || undefined,
        },
      )

      if (!mesh) {
        console.warn('[DEBUG Raymarch] 预览 mesh 创建失败')
        return null
      }

      mesh.userData.isPreview = !manifestUrl
      mesh.userData.fullResUrl = effectiveUrl
      mesh.userData.fullResPayload = payload
      mesh.userData.fullResTransform = transform
      mesh.userData.fullResLoading = !manifestUrl
    } catch (previewError) {
      console.warn('[DEBUG Raymarch] 预览加载失败:', previewError.message)
      return null
    }

    // manifest/bin 首帧已是全分辨率，CSV 才走后台渐进加载
    if (!manifestUrl) {
    // 第二步：后台加载全分辨率，完成后替换。这里不能 await，
    // 否则预览 mesh 会等全分辨率完成后才加入场景。
    void (async () => {
      try {
        let fullResResult
        const varName = String(payload?.variable || '').trim()
        const manifestData = payload?.manifest_content || null
        const directBinUrl = effectiveBinUrl

        if (manifestUrl) {
          fullResResult = await loadDirectManifestBin(
            manifestUrl,
            varName,
            onWorkerProgress,
            {
              manifestData,
              binUrl: directBinUrl,
              frameIndex: currentFrameIndex,
            },
          )
        } else {
          fullResResult = await runVolumeWorker(payload, effectiveUrl, globalValueRange, null, onPartial)
        }

        if (
          isCancelled ||
          !mesh ||
          mesh.userData.fullResLoading === 'cancelled'
        ) {
          console.log('[DEBUG Raymarch] 已取消全分辨率加载')
          return
        }

        if (!fullResResult?.data?.length) {
          console.warn('[DEBUG Raymarch] 全分辨率数据为空，保持预览')
          return
        }

        console.log('[DEBUG Raymarch] 全分辨率加载完成，开始替换纹理')

        const fullResData = fullResResult.data
        const fullResDims = Array.isArray(fullResResult.dims)
          ? fullResResult.dims
          : [fullResResult.dims, fullResResult.dims, fullResResult.dims]
        const fullResValueRange = fullResResult.valueRange || [
          fullResResult.bounds?.minValue,
          fullResResult.bounds?.maxValue,
        ]

        // 创建全分辨率纹理
        fullResTexture = configureVolumeTexture(
          new THREE.Data3DTexture(fullResData, fullResDims[0], fullResDims[1], fullResDims[2]),
          fullResData,
        )

        // 替换 mesh 的纹理（双 texture 架构：prev = 当前帧，next = 下一帧）
        if (mesh.material.uniforms.uVolumePrev.value !== fullResTexture) {
          previewTexture?.dispose()
          mesh.material.uniforms.uVolumePrev.value = fullResTexture
          mesh.material.uniforms.uVolumeNext.value = fullResTexture
          mesh.userData.volumePrev = fullResTexture
          mesh.userData.volumeNext = fullResTexture
          currentTexture = fullResTexture
          mesh.userData.volumeMeta.dims = fullResDims
          mesh.userData.volumeMeta.valueRange = fullResValueRange
          mesh.userData.volumeMeta.source = 'worker-fullres'
          mesh.userData.volumeMeta.displayEnhancement =
            fullResResult?.displayEnhancement || null
          updateDisplayRangeForMesh(mesh)
          updateTransferStopsForMesh(mesh)
          if (mesh.material.uniforms.uSparseBoost) {
            mesh.material.uniforms.uSparseBoost.value = 2.4
          }
          mesh.userData.isPreview = false

          const fullOccTex = createOccupancyData3DTexture(
            fullResData,
            fullResDims[0],
            fullResDims[1],
            fullResDims[2],
          )
          if (fullOccTex && mesh.material.uniforms.uOccMax) {
            if (mesh.userData.volumeOccOwned) {
              mesh.material.uniforms.uOccMax.value.dispose()
            }
            mesh.material.uniforms.uOccMax.value = fullOccTex
            mesh.material.uniforms.uOccEnabled.value = 1.0
            mesh.userData.volumeOccOwned = true
          }
        }

        console.log('[DEBUG Raymarch] ✅ 全分辨率纹理已替换，dims:', fullResDims)
      } catch (fullResError) {
        console.warn('[DEBUG Raymarch] 全分辨率加载失败:', fullResError.message)
      } finally {
        if (mesh && mesh.userData.fullResLoading !== 'cancelled') {
          mesh.userData.fullResLoading = false
        }
      }
    })()
    }

    // 初始化双 texture 状态
    mesh.userData.volumePrev = currentTexture
    mesh.userData.volumeNext = currentTexture
    mesh.userData.volumeFrameIndex = currentFrameIndex
    mesh.material.uniforms.uVolumePrev.value = currentTexture
    mesh.material.uniforms.uVolumeNext.value = currentTexture
    mesh.material.uniforms.uBlendFactor.value = 0.0

    return mesh
  }

  async function createVolumeParticleMeshFromCsvUrl(volumeUrl, payload, transform) {
    const csvUrls = payload?.volume_urls || []
    const effectiveUrl = csvUrls[0] || volumeUrl
    const currentFrameIndex = resolveVolumeFrameIndex(payload)
    const framePayload = Array.isArray(payload?.volume_dataset_frames)
      ? payload.volume_dataset_frames[currentFrameIndex] ||
        payload.volume_dataset_frames[0]
      : null
    const manifestUrl = framePayload?.manifest_url || payload?.manifest_url
    const directBinUrl =
      (typeof framePayload?.bin_url === 'string' && framePayload.bin_url.trim()) ||
      (typeof payload?.bin_url === 'string' && payload.bin_url.trim()) ||
      (manifestUrl && /\.bin(?:[?#].*)?$/i.test(String(effectiveUrl || ''))
        ? String(effectiveUrl).trim()
        : '')
    if (!effectiveUrl && !manifestUrl) return null

    const globalValueRange = extractGlobalValueRange(payload)
    const varName = String(payload?.variable || '').trim()
    const manifestData = payload?.manifest_content || null
    const voxelResult = manifestUrl
      ? await loadDirectManifestBin(manifestUrl, varName, onWorkerProgress, {
          manifestData,
          binUrl: directBinUrl,
          frameIndex: currentFrameIndex,
        })
      : await runVolumeWorker(payload, effectiveUrl, globalValueRange)

    if (!voxelResult?.data?.length) return null
    const dims = Array.isArray(voxelResult.dims)
      ? voxelResult.dims
      : [voxelResult.dims, voxelResult.dims, voxelResult.dims]
    const valueRange = voxelResult.valueRange || [
      voxelResult.bounds?.minValue,
      voxelResult.bounds?.maxValue,
    ]
    return createVolumePointFallbackFromVoxels(
      voxelResult.data,
      dims,
      payload,
      transform,
      {
        dims,
        rowCount: voxelResult?.bounds?.rowCount,
        valueRange,
        source: 'particle-volume',
        displayEnhancement: voxelResult?.displayEnhancement,
      },
    )
  }

  function findRecordNumber(record, keys) {
    if (!record || typeof record !== 'object') return null
    for (const key of keys) {
      if (record[key] != null) {
        const value = toFiniteNumber(record[key])
        if (value != null) return value
      }
    }
    return null
  }

  function normalizeVolumePointData(
    rawData,
    rawColors = null,
    preferredVariable = '',
  ) {
    if (
      rawData instanceof Float32Array ||
      (Array.isArray(rawData) &&
        (rawData.length === 0 || typeof rawData[0] !== 'object'))
    ) {
      const positions = toFloat32Array(rawData)
      const colors = rawColors ? toFloat32Array(rawColors) : null
      return positions.length >= 3 ? { positions, colors } : null
    }

    if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
      if (
        Array.isArray(rawData.positions) ||
        rawData.positions instanceof Float32Array
      ) {
        return {
          positions: toFloat32Array(rawData.positions),
          colors: rawData.colors
            ? toFloat32Array(rawData.colors)
            : toFloat32Array(rawColors),
          values: rawData.values ? toFloat32Array(rawData.values) : null,
        }
      }
      if (Array.isArray(rawData.points)) {
        const positions = []
        const colors = []
        const values = []
        rawData.points.forEach((point) => {
          const x = findRecordNumber(point, ['x', 'X'])
          const y = findRecordNumber(point, ['y', 'Y'])
          const z = findRecordNumber(point, ['z', 'Z'])
          if (x == null || y == null || z == null) return
          positions.push(x, y, z)
          const r = findRecordNumber(point, ['r', 'R', 'red'])
          const g = findRecordNumber(point, ['g', 'G', 'green'])
          const b = findRecordNumber(point, ['b', 'B', 'blue'])
          if (r != null && g != null && b != null) {
            const scale = Math.max(r, g, b) > 1 ? 255 : 1
            colors.push(r / scale, g / scale, b / scale)
          }
          const value = findRecordNumber(point, [
            'value',
            'val',
            'scalar',
            'density',
          ])
          if (value != null) values.push(value)
        })
        return {
          positions: new Float32Array(positions),
          colors: colors.length ? new Float32Array(colors) : null,
          values: values.length ? new Float32Array(values) : null,
        }
      }
    }

    if (
      Array.isArray(rawData) &&
      rawData.length &&
      typeof rawData[0] === 'object'
    ) {
      const preferredKeyNormalized = String(preferredVariable || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_\-:()]/g, '')
      const rowKeys = Object.keys(rawData[0] || {})
      const normalizedRowKeys = rowKeys.map((k) =>
        String(k || '')
          .trim()
          .toLowerCase()
          .replace(/[\s_\-:()]/g, ''),
      )
      let preferredValueKey = null
      if (preferredKeyNormalized) {
        const exactIdx = normalizedRowKeys.findIndex(
          (k) => k === preferredKeyNormalized,
        )
        if (exactIdx >= 0) {
          preferredValueKey = rowKeys[exactIdx]
        } else if (preferredKeyNormalized.length >= 6) {
          const fuzzyIdx = normalizedRowKeys.findIndex(
            (k) =>
              k.includes(preferredKeyNormalized) ||
              preferredKeyNormalized.includes(k),
          )
          if (fuzzyIdx >= 0) preferredValueKey = rowKeys[fuzzyIdx]
        }
      }

      const positions = []
      const colors = []
      const values = []
      rawData.forEach((record) => {
        const x = findRecordNumber(record, ['x', 'X', 'px'])
        const y = findRecordNumber(record, ['y', 'Y', 'py'])
        const z = findRecordNumber(record, ['z', 'Z', 'pz'])
        if (x == null || y == null || z == null) return
        positions.push(x, y, z)
        const r = findRecordNumber(record, ['r', 'R', 'red'])
        const g = findRecordNumber(record, ['g', 'G', 'green'])
        const b = findRecordNumber(record, ['b', 'B', 'blue'])
        if (r != null && g != null && b != null) {
          const scale = Math.max(r, g, b) > 1 ? 255 : 1
          colors.push(r / scale, g / scale, b / scale)
        }
        const value = findRecordNumber(
          record,
          preferredValueKey
            ? [preferredValueKey, 'value', 'val', 'scalar', 'density']
            : ['value', 'val', 'scalar', 'density'],
        )
        if (value != null) values.push(value)
      })
      return {
        positions: new Float32Array(positions),
        colors: colors.length ? new Float32Array(colors) : null,
        values: values.length ? new Float32Array(values) : null,
      }
    }

    return null
  }

  function createVolumePoints(volumeData, payload, transform) {
    if (!volumeData?.positions?.length) return null
    const geometry = new THREE.BufferGeometry()
    const positions = volumeData.positions
    const count = Math.floor(positions.length / 3)
    if (!count) return null

    const bounds = {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    }
    for (let index = 0; index < count; index += 1) {
      const x = positions[index * 3]
      const y = positions[index * 3 + 1]
      const z = positions[index * 3 + 2]
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.minZ = Math.min(bounds.minZ, z)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
      bounds.maxZ = Math.max(bounds.maxZ, z)
    }
    const sizeX = Math.max(bounds.maxX - bounds.minX, 1e-6)
    const sizeY = Math.max(bounds.maxY - bounds.minY, 1e-6)
    const sizeZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6)
    const maxSize = Math.max(sizeX, sizeY, sizeZ)
    const normalizedPositions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      normalizedPositions[index * 3] =
        (positions[index * 3] - (bounds.minX + bounds.maxX) / 2) / maxSize
      normalizedPositions[index * 3 + 1] =
        (positions[index * 3 + 1] - (bounds.minY + bounds.maxY) / 2) / maxSize
      normalizedPositions[index * 3 + 2] =
        (positions[index * 3 + 2] - (bounds.minZ + bounds.maxZ) / 2) / maxSize
    }

    let colorArray = volumeData.colors
    if (
      (!colorArray || colorArray.length < count * 3) &&
      volumeData.values?.length
    ) {
      const minValue = Number(payload?.val_min ?? payload?.vmin)
      const maxValue = Number(payload?.val_max ?? payload?.vmax)
      colorArray = new Float32Array(count * 3)
      for (let index = 0; index < count; index += 1) {
        const color = samplePalette(
          volumeData.values[index],
          minValue,
          maxValue,
        )
        colorArray[index * 3] = color.r
        colorArray[index * 3 + 1] = color.g
        colorArray[index * 3 + 2] = color.b
      }
    }

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(normalizedPositions, 3),
    )
    if (colorArray?.length >= count * 3) {
      geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3))
    }

    const material = new THREE.PointsMaterial({
      size: 0.06,
      transparent: true,
      opacity: 0.72,
      vertexColors: Boolean(colorArray?.length >= count * 3),
      color:
        colorArray?.length >= count * 3
          ? '#ffffff'
          : lookupGasScheme(getVisualization()?.gasColors, payload?.variable) ||
            '#8fe8ff',
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    const points = new THREE.Points(geometry, material)
    applyVolumeTransform(points, transform, 1)
    return points
  }

  function createVolumePointFallbackFromVoxels(
    voxelData,
    dims,
    payload,
    transform,
    meta = {},
  ) {
    if (!voxelData?.length || !Array.isArray(dims) || dims.length < 3) {
      return null
    }

    const [nx, ny, nz] = dims.map((value) =>
      Math.max(1, Math.round(Number(value) || 1)),
    )
    const total = nx * ny * nz
    if (!total) return null

    const targetPoints = 55000
    const stride = Math.max(1, Math.ceil(Math.cbrt(total / targetPoints)))
    const threshold = 0.04
    const positions = []
    const colors = []
    const densities = []
    const seeds = []
    const hash01 = (value) => {
      const x = Math.sin(value * 12.9898) * 43758.5453
      return x - Math.floor(x)
    }

    for (let iz = 0; iz < nz; iz += stride) {
      for (let iy = 0; iy < ny; iy += stride) {
        for (let ix = 0; ix < nx; ix += stride) {
          const idx = ix + nx * (iy + ny * iz)
          const density = Number(voxelData[idx])
          if (!Number.isFinite(density) || density <= threshold) continue
          if (stride === 1 && density < 0.22 && hash01(idx + 17) > density * 2.8) {
            continue
          }

          const jitterScale = 0.42 * stride
          const jx = (hash01(idx + 1) - 0.5) * jitterScale
          const jy = (hash01(idx + 2) - 0.5) * jitterScale
          const jz = (hash01(idx + 3) - 0.5) * jitterScale
          const px = nx > 1 ? (ix + jx) / (nx - 1) - 0.5 : 0
          const py = ny > 1 ? (iy + jy) / (ny - 1) - 0.5 : 0
          const pz = nz > 1 ? (iz + jz) / (nz - 1) - 0.5 : 0
          positions.push(px, py, pz)

          const color = samplePalette(density, 0, 1)
          colors.push(color.r, color.g, color.b)
          densities.push(Math.min(Math.max(density, 0), 1))
          seeds.push(hash01(idx + 11), hash01(idx + 23), hash01(idx + 37))
        }
      }
    }

    if (!positions.length) return null

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    )
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('aDensity', new THREE.Float32BufferAttribute(densities, 1))
    geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 3))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uPointSize: { value: 1.9 },
        uOpacity: { value: 0.2 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPointSize;
        uniform float uOpacity;
        attribute float aDensity;
        attribute vec3 aSeed;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 drift = vec3(
            sin(uTime * 0.42 + aSeed.x * 6.2831),
            cos(uTime * 0.36 + aSeed.y * 6.2831),
            sin(uTime * 0.31 + aSeed.z * 6.2831)
          ) * (0.004 + (1.0 - aDensity) * 0.012);
          vec4 mvPosition = modelViewMatrix * vec4(position + drift, 1.0);
          float perspectiveScale = clamp(56.0 / max(-mvPosition.z, 0.1), 0.35, 16.0);
          gl_PointSize = clamp(
            uPointSize * (0.65 + aDensity * 1.55) * perspectiveScale,
            1.0,
            24.0
          );
          gl_Position = projectionMatrix * mvPosition;
          vColor = color;
          vAlpha = smoothstep(0.04, 0.95, aDensity) * uOpacity;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          float softness = exp(-r2 * 2.8);
          float edge = smoothstep(1.0, 0.18, r2);
          vec3 color = mix(vColor, vec3(0.94, 0.96, 0.9), 0.18 * softness);
          gl_FragColor = vec4(color, vAlpha * softness * edge);
        }
      `,
      vertexColors: true,
    })

    const points = new THREE.Points(geometry, material)
    applyVolumeTransform(points, transform, 1)
    points.userData.volumeMeta = {
      dims: meta?.dims || dims,
      variable: payload?.variable,
      rowCount: meta?.rowCount ?? null,
      valueRange: meta?.valueRange ?? [0, 1],
      source: meta?.source || 'worker-point-fallback',
    }
    return points
  }

  function createVolumeRaymarchMeshFromTexture(
    volumeTexture,
    payload,
    transform,
    meta = {},
  ) {
    console.log('[DEBUG Raymarch] 开始创建 raymarch mesh:', {
      hasTexture: !!volumeTexture,
      hasRenderer: !!getRenderer(),
      variable: payload?.variable,
      hasMeta: !!meta,
    })

    if (!volumeTexture || !getRenderer()) {
      console.warn('[DEBUG Raymarch] 缺少必要条件:', {
        hasTexture: !!volumeTexture,
        hasRenderer: !!getRenderer(),
      })
      return null
    }

    const renderer = getRenderer()
    const gl = renderer.getContext()
    const isWebGL2 =
      renderer.capabilities?.isWebGL2 === true ||
      (typeof WebGL2RenderingContext !== 'undefined' &&
        gl instanceof WebGL2RenderingContext)
    const isContextLost =
      typeof gl?.isContextLost === 'function' && gl.isContextLost()

    console.log('[DEBUG Raymarch] WebGL 检测:', {
      hasWebGL2RenderingContext: typeof WebGL2RenderingContext !== 'undefined',
      glInstanceOfWebGL2: gl instanceof WebGL2RenderingContext,
      rendererIsWebGL2: renderer.capabilities?.isWebGL2 === true,
      isContextLost,
      isWebGL2,
      renderer: !!renderer,
      gl: !!gl,
      glType: gl?.constructor?.name,
    })

    if (isContextLost) {
      console.warn('[DEBUG Raymarch] WebGL context 已丢失，跳过 mesh 创建')
      return null
    }

    if (!isWebGL2) {
      console.warn(
        '[DEBUG Raymarch] WebGL2 not available, falling back to point-based volume rendering',
        {
          rendererIsWebGL2: renderer.capabilities?.isWebGL2 === true,
          isWebGL2,
          renderer: !!renderer,
          gl: !!gl,
        },
      )
      return null
    }

    const cmapResult = resolveVolumeCmap(payload?.variable)
    const paletteTexture = buildPaletteTexture(
      cmapResult.name || 'coolwarm',
      cmapResult.colors || null,
    )
    const resolveRaymarchStepCount = () => {
      const raw = Number(getVisualization()?.volume_raymarch_steps)
      if (!Number.isFinite(raw)) return 160
      return Math.max(8, Math.min(256, Math.round(raw)))
    }
    const resolveRaymarchOpacityScale = () => {
      const raw = Number(getVisualization()?.volume_raymarch_opacity)
      if (!Number.isFinite(raw)) return 1
      return Math.max(0.05, Math.min(4, raw))
    }
    const stepCount = resolveRaymarchStepCount()
    const opacityScale = resolveRaymarchOpacityScale()
    const sparseBoost = 2.4
    const resolveEssStrength = () => {
      const raw = Number(getVisualization()?.volume_raymarch_ess)
      if (!Number.isFinite(raw)) return 0.55
      return Math.max(0, Math.min(1, raw))
    }
    const essStrength = resolveEssStrength()

    console.log('[DEBUG Raymarch] Raymarch 参数:', {
      stepCount,
      opacityScale,
      sparseBoost,
      essStrength,
      cmapName: cmapResult.name,
      hasCustomColors: !!cmapResult.colors,
    })

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uVolumePrev: { value: volumeTexture },
        uVolumeNext: { value: volumeTexture },
        uPalette: { value: paletteTexture },
        uSteps: { value: stepCount },
        uOpacityScale: { value: opacityScale },
        uSparseBoost: { value: sparseBoost },
        uModelInv: { value: new THREE.Matrix4() },
        uIsoEnabled: { value: 0.0 },
        uIsoValue: { value: 0.5 },
        uAlphaCurve: { value: 1.2 },
        uRimIntensity: { value: 0.28 },
        uRimColor: { value: new THREE.Color('#d0e8ff') },
        uTurbFreq: { value: 2.5 },
        uTurbAmp: { value: 0.0 },
        uTime: { value: 0.0 },
        uFlowSpeed: { value: 0.3 },
        uBlendFactor: { value: 0.0 },
        uDisplayMin: { value: 0.0 },
        uDisplayMax: { value: 1.0 },
        uTransferStopCount: { value: 0 },
        uTransferPositions: { value: new Array(MAX_TRANSFER_STOPS).fill(0) },
        uTransferBands: { value: new Array(MAX_TRANSFER_STOPS).fill(0) },
        uLowQuality: { value: 0.0 },
        uEssStrength: { value: essStrength },
        uOccMax: {
          value: meta?.occupancyTexture || getDummyOccMaxTexture(),
        },
        uOccEnabled: { value: meta?.occupancyTexture ? 1.0 : 0.0 },
        uRadarWaveTime: { value: 0.0 },
        uRadarWaveStrength: {
          value: isRadarMockVolumeVariableId(payload?.variable) ? 1.0 : 0.0,
        },
      },
      vertexShader: `
        out vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler3D uVolumePrev;
        uniform sampler3D uVolumeNext;
        uniform sampler2D uPalette;
        uniform float uSteps;
        uniform float uOpacityScale;
        uniform float uSparseBoost;
        uniform mat4 uModelInv;
        uniform float uIsoEnabled;
        uniform float uIsoValue;
        uniform float uAlphaCurve;
        uniform float uRimIntensity;
        uniform vec3 uRimColor;
        uniform float uTurbFreq;
        uniform float uTurbAmp;
        uniform float uTime;
        uniform float uFlowSpeed;
        uniform float uBlendFactor;
        uniform float uDisplayMin;
        uniform float uDisplayMax;
        uniform int uTransferStopCount;
        uniform float uTransferPositions[${MAX_TRANSFER_STOPS}];
        uniform float uTransferBands[${MAX_TRANSFER_STOPS}];
        uniform float uLowQuality;
        uniform float uEssStrength;
        uniform sampler3D uOccMax;
        uniform float uOccEnabled;
        ${RADAR_VOLUME_WAVE_GLSL_CHUNK}
        in vec3 vLocalPos;
        out vec4 out_FragColor;

        float mapToColorband(float value) {
          if (uTransferStopCount < 2) return value;
          if (value <= uTransferPositions[0]) return uTransferBands[0];
          for (int i = 1; i < ${MAX_TRANSFER_STOPS}; i++) {
            if (i >= uTransferStopCount) break;
            if (value <= uTransferPositions[i]) {
              float leftValue = uTransferPositions[i - 1];
              float rightValue = uTransferPositions[i];
              float width = max(rightValue - leftValue, 1e-6);
              float localT = clamp((value - leftValue) / width, 0.0, 1.0);
              return mix(uTransferBands[i - 1], uTransferBands[i], localT);
            }
          }
          return uTransferBands[uTransferStopCount - 1];
        }

        vec2 hitBox(vec3 orig, vec3 dir) {
          vec3 inv = 1.0 / dir;
          vec3 t0 = (vec3(-0.5) - orig) * inv;
          vec3 t1 = (vec3( 0.5) - orig) * inv;
          vec3 tMin = min(t0, t1);
          vec3 tMax = max(t0, t1);
          return vec2(max(max(tMin.x, tMin.y), tMin.z),
                      min(min(tMax.x, tMax.y), tMax.z));
        }

        float hash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

        float snoise(vec3 v) {
          const vec2 C = vec2(1.0/6.0, 1.0/3.0);
          const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i  = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute(permute(permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0))
                  + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                  + i.x + vec4(0.0, i1.x, i2.x, 1.0));
          float n_ = 0.142857142857;
          vec3 ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          vec4 x = x_ * ns.x + ns.yyyy;
          vec4 y = y_ * ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          vec4 s0 = floor(b0)*2.0 + 1.0;
          vec4 s1 = floor(b1)*2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
          vec3 p0 = vec3(a0.xy, h.x);
          vec3 p1 = vec3(a0.zw, h.y);
          vec3 p2 = vec3(a1.xy, h.z);
          vec3 p3 = vec3(a1.zw, h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
          p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
          vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
          m = m * m;
          return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }

        float hgPhase(float cosTheta, float g) {
          float g2 = g * g;
          return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
        }

        float sampleShadow(vec3 p, vec3 lightDir, float stepSize) {
          float shadowDensity = 0.0;
          float jitter = hash(p.xy + p.z) * 0.4 + 0.8;
          for (int s = 0; s < 6; s++) {
            if (uLowQuality > 0.5 && s >= 2) break;
            vec3 sp = p + lightDir * (float(s) * stepSize * jitter);
            if (any(lessThan(sp, vec3(-0.5))) || any(greaterThan(sp, vec3(0.5)))) break;
            float d = clamp(texture(uVolumePrev, sp + 0.5).r, 0.0, 1.0);
            shadowDensity += max(d - 0.02, 0.0);
          }
          return exp(-shadowDensity * 4.0);
        }

        void main() {
          vec3 ro = (uModelInv * vec4(cameraPosition, 1.0)).xyz;
          vec3 rd = normalize(vLocalPos - ro);
          vec2 b  = hitBox(ro, rd);
          if (b.x > b.y) discard;

          float t0 = max(b.x, 0.0);
          float dt  = (b.y - t0) / max(uSteps, 1.0);

          // ── Isosurface ──────────────────────────────────────────
          if (uIsoEnabled > 0.5) {
            float prev = 0.0;
            for (int i = 0; i < 256; i++) {
              if (float(i) >= uSteps) break;
              vec3 p = ro + rd * (t0 + dt * float(i));
              float d = clamp(texture(uVolumePrev, p + 0.5).r, 0.0, 1.0);
              d *= radarWaveModulate(p + 0.5, uRadarWaveTime);
              if (i > 0 && (prev - uIsoValue) * (d - uIsoValue) < 0.0) {
                float tL = t0 + dt * (float(i) - 1.0);
                float tH = t0 + dt * float(i);
                float dL = prev;
                for (int j = 0; j < 8; j++) {
                  float tm = (tL + tH) * 0.5;
                  float dm = clamp(texture(uVolumePrev, ro + rd * tm + 0.5).r, 0.0, 1.0);
                  dm *= radarWaveModulate(ro + rd * tm + 0.5, uRadarWaveTime);
                  if ((dm - uIsoValue) * (dL - uIsoValue) < 0.0) { tH = tm; }
                  else { tL = tm; dL = dm; }
                }
                float tHit = (tL + tH) * 0.5;
                vec3 pHit = ro + rd * tHit;
                float e = 0.005;
                float dx = clamp(texture(uVolumePrev, pHit + vec3(e,0,0) + 0.5).r, 0.0, 1.0)
                          - clamp(texture(uVolumePrev, pHit - vec3(e,0,0) + 0.5).r, 0.0, 1.0);
                float dy = clamp(texture(uVolumePrev, pHit + vec3(0,e,0) + 0.5).r, 0.0, 1.0)
                          - clamp(texture(uVolumePrev, pHit - vec3(0,e,0) + 0.5).r, 0.0, 1.0);
                float dz = clamp(texture(uVolumePrev, pHit + vec3(0,0,e) + 0.5).r, 0.0, 1.0)
                          - clamp(texture(uVolumePrev, pHit - vec3(0,0,e) + 0.5).r, 0.0, 1.0);
                vec3 n = normalize(vec3(dx, dy, dz));
                if (dot(n, rd) > 0.0) n = -n;
                vec3 ld = normalize(vec3(1.0, 2.0, 1.5));
                float diff = max(dot(n, ld), 0.0);
                vec3 hd = normalize(ld - rd);
                float spec = pow(max(dot(n, hd), 0.0), 32.0);
                float hitD = clamp(texture(uVolumePrev, pHit + 0.5).r, 0.0, 1.0);
                hitD *= radarWaveModulate(pHit + 0.5, uRadarWaveTime);
                hitD = clamp((hitD - uDisplayMin) / max(uDisplayMax - uDisplayMin, 1e-6), 0.0, 1.0);
                vec4 pal = texture(uPalette, vec2(mapToColorband(hitD), 0.5));
                out_FragColor = vec4(pal.rgb * (0.2 + diff * 0.65) + vec3(1.0) * spec * 0.3, 0.95);
                return;
              }
              prev = d;
            }
            discard;
          }

          // ── Volume rendering (Beer-Lambert + shadow + HG phase + rim) ──
          vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
          vec4 accum = vec4(0.0);
          float dtBase = dt;
          float tRay = t0 + (hash(gl_FragCoord.xy * 0.0151) - 0.5) * dtBase * 0.45;
          int sparseRun = 0;

          for (int iter = 0; iter < 320; iter++) {
            if (tRay > b.y) break;

            vec3 p = ro + rd * tRay;

            float occMaxV = 1.0;
            if (uOccEnabled > 0.5) {
              occMaxV = texture(uOccMax, p + 0.5).r;
            }

            float stepMul = 1.0;
            if (uEssStrength > 0.001 && accum.a < 0.1) {
              bool streak = sparseRun >= 2;
              bool occSparse = occMaxV < 0.0028;
              if (streak || occSparse) {
                float hi = 1.65;
                if (occSparse) {
                  hi = streak ? 2.28 : 2.12;
                }
                stepMul = mix(1.0, hi, uEssStrength);
              }
            }
            float dtSeg = dtBase * stepMul;

            if (uTurbAmp > 0.0 && uFlowSpeed > 0.0) {
              float baseFreq = uTurbFreq;
              float baseAmp = uTurbAmp;
              float spd = uFlowSpeed;
              p += snoise(p * baseFreq + vec3(uTime * 0.15 * spd, uTime * 0.08 * spd, 0.0)) * baseAmp * rd;
              p += snoise(p * 6.0 + vec3(uTime * 0.35 * spd, 0.0, uTime * 0.2 * spd)) * (baseAmp * 0.48) * rd;
            }

            float densityPrev = clamp(texture(uVolumePrev, p + 0.5).r, 0.0, 1.0);
            float densityNext = clamp(texture(uVolumeNext, p + 0.5).r, 0.0, 1.0);
            float density = mix(densityPrev, densityNext, uBlendFactor);
            density = clamp((density - uDisplayMin) / max(uDisplayMax - uDisplayMin, 1e-6), 0.0, 1.0);
            density = clamp(pow(max(density, 0.0), 0.52), 0.0, 1.0);
            density *= radarWaveModulate(p + 0.5, uRadarWaveTime);
            density = clamp(density, 0.0, 1.0);

            if (density < 0.002) sparseRun++;
            else sparseRun = 0;

            tRay += dtSeg;

            if (density < 0.002) continue;

            vec4 tf = texture(uPalette, vec2(mapToColorband(density), 0.5));

            tf.a = pow(tf.a, uAlphaCurve);

            float sigma = max(density - 0.006, 0.0) * uOpacityScale * uSparseBoost * 3.2;
            float stepAlpha = 1.0 - exp(-sigma * dtSeg * 55.0);

            float shadow = density > 0.015 ? sampleShadow(p, lightDir, dtSeg * 6.0) : 1.0;

            float cosTheta = dot(rd, lightDir);
            float phase = hgPhase(cosTheta, 0.25);

            vec3 stepColor = tf.rgb * (0.38 + 0.62 * shadow) * (0.45 + 0.55 * phase) * (0.55 + 0.7 * density);

            if (uLowQuality < 0.5 && density > 0.05 && uRimIntensity > 0.0) {
              float e = 0.008;
              float dx = clamp(texture(uVolumePrev, p + vec3(e,0,0) + 0.5).r, 0.0, 1.0)
                        - clamp(texture(uVolumePrev, p - vec3(e,0,0) + 0.5).r, 0.0, 1.0);
              float dy = clamp(texture(uVolumePrev, p + vec3(0,e,0) + 0.5).r, 0.0, 1.0)
                        - clamp(texture(uVolumePrev, p - vec3(0,e,0) + 0.5).r, 0.0, 1.0);
              float dz = clamp(texture(uVolumePrev, p + vec3(0,0,e) + 0.5).r, 0.0, 1.0)
                        - clamp(texture(uVolumePrev, p - vec3(0,0,e) + 0.5).r, 0.0, 1.0);
              vec3 grad = normalize(vec3(dx, dy, dz) + 1e-5);
              float fresnel = pow(1.0 - abs(dot(rd, grad)), 2.0);
              stepColor += uRimColor * fresnel * uRimIntensity * density;
            }

            accum.rgb += (1.0 - accum.a) * stepAlpha * stepColor;
            accum.a   += (1.0 - accum.a) * stepAlpha;
            if (accum.a > 0.97) break;
          }
          if (accum.a < 0.001) discard;
          out_FragColor = accum;
        }
      `,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    applyVolumeTransform(mesh, transform, 1)
    mesh.updateMatrixWorld(true)
    material.uniforms.uModelInv.value.copy(mesh.matrixWorld).invert()
    mesh.onBeforeRender = () => {
      mesh.updateMatrixWorld(true)
      material.uniforms.uModelInv.value.copy(mesh.matrixWorld).invert()
    }
    mesh.userData.volumeMeta = {
      dims: meta?.dims || null,
      variable: payload?.variable,
      rowCount: meta?.rowCount ?? null,
      valueColumn: meta?.valueColumn ?? null,
      valueRange: meta?.valueRange ?? null,
      source: meta?.source || 'texture',
      displayEnhancement: meta?.displayEnhancement || null,
    }
    mesh.userData.volumeOccOwned = Boolean(meta?.occupancyTexture)

    console.log('[DEBUG Raymarch] ✅ Raymarch mesh 创建成功!', {
      variable: payload?.variable,
      dims: meta?.dims,
      position: {
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
      },
      scale: {
        x: mesh.scale.x,
        y: mesh.scale.y,
        z: mesh.scale.z,
      },
      stepCount,
      opacityScale,
      sparseBoost,
    })

    return mesh
  }

  function resolveVolumeFrameIndex(payload, forceFirstFrame = false) {
    return resolveVolumeFrameIndexFromPayload(payload, {
      currentTimeStep: getCurrentTimeStep?.(),
      currentStepIndex:
        typeof getCurrentStepIndex === 'function' ? getCurrentStepIndex() : null,
      forceFirstFrame,
    })
  }

  function resolveVolumeSourceKey(payload) {
    if (
      !payload ||
      (typeof payload === 'object' && !Object.keys(payload).length)
    )
      return ''
    // datasets 规范化为 volume_dataset_frames 后的数组，每项含 bin_url
    if (Array.isArray(payload.volume_dataset_frames) && payload.volume_dataset_frames.length > 0) {
      const binUrls = payload.volume_dataset_frames
        .map((frame) => (frame && typeof frame === 'object' ? frame.bin_url : null))
        .filter((url) => typeof url === 'string' && url.trim())
      if (binUrls.length > 0) {
        return binUrls.map((url) => normalizeUrl(url)).join('|')
      }
      // 回退：取首个 manifest_url
      const firstManifest = payload.volume_dataset_frames[0]?.manifest_url
      if (typeof firstManifest === 'string' && firstManifest.trim()) {
        return normalizeUrl(firstManifest)
      }
    }
    const candidateLists = [
      payload.csv_urls,
      payload.urls_csv,
      payload.urls,
      payload.volume_urls,
      payload.volume_frame_urls,
      payload.data_urls,
      payload.frame_urls,
      payload.positions_urls,
      payload.colors_urls,
    ]
    for (const list of candidateLists) {
      if (Array.isArray(list) && list.length) {
        return list.map((item) => normalizeUrl(item)).join('|')
      }
    }
    if (
      typeof payload.positions_url === 'string' &&
      payload.positions_url.trim()
    ) {
      const colorKey =
        typeof payload.colors_url === 'string'
          ? `|${normalizeUrl(payload.colors_url)}`
          : ''
      return `${normalizeUrl(payload.positions_url)}${colorKey}`
    }
    if (typeof payload.csv_url === 'string' && payload.csv_url.trim()) {
      return normalizeUrl(payload.csv_url)
    }
    if (typeof payload.url === 'string' && payload.url.trim()) {
      return normalizeUrl(payload.url)
    }
    if (typeof payload.csv === 'string' && payload.csv.trim()) {
      return normalizeUrl(payload.csv)
    }
    return ''
  }

  async function loadVolumeDataFromPayload(payload, forceFirstFrame = false) {
    if (!payload) return null
    const safeIndex = resolveVolumeFrameIndex(payload, forceFirstFrame)

    // volume_dataset_frames：datasets 经 cacheVolumePayload 规范化后的格式
    if (Array.isArray(payload.volume_dataset_frames) && payload.volume_dataset_frames.length > 0) {
      const frame = payload.volume_dataset_frames[safeIndex] || payload.volume_dataset_frames[0]
      const binUrl = frame?.bin_url
      if (typeof binUrl === 'string' && binUrl.trim()) {
        logTimelineBinUrl(binUrl, {
          variable: payload?.variable,
          frameIndex: safeIndex,
        })
        const raw = await fetchStructuredResource(binUrl.trim())
        return normalizeVolumePointData(raw, null, payload?.variable)
      }
    }

    if (
      typeof payload.positions_url === 'string' &&
      payload.positions_url.trim()
    ) {
      const positionsRaw = await fetchStructuredResource(
        payload.positions_url.trim(),
      )
      const colorsRaw =
        typeof payload.colors_url === 'string' && payload.colors_url.trim()
          ? await fetchStructuredResource(payload.colors_url.trim())
          : null
      return normalizeVolumePointData(
        positionsRaw,
        colorsRaw,
        payload?.variable,
      )
    }

    if (
      Array.isArray(payload.positions_urls) &&
      payload.positions_urls.length
    ) {
      const positionsRaw = await fetchStructuredResource(
        payload.positions_urls[safeIndex] || payload.positions_urls[0],
      )
      const colorsRaw =
        Array.isArray(payload.colors_urls) && payload.colors_urls.length
          ? await fetchStructuredResource(
              payload.colors_urls[safeIndex] || payload.colors_urls[0],
            )
          : null
      return normalizeVolumePointData(
        positionsRaw,
        colorsRaw,
        payload?.variable,
      )
    }

    if (Array.isArray(payload.urls) && payload.urls.length) {
      const raw = await fetchStructuredResource(
        payload.urls[safeIndex] || payload.urls[0],
      )
      return normalizeVolumePointData(raw, null, payload?.variable)
    }

    const csvLikeLists = [
      payload.csv_urls,
      payload.urls_csv,
      payload.volume_urls,
      payload.volume_frame_urls,
      payload.data_urls,
      payload.frame_urls,
    ]
    for (const list of csvLikeLists) {
      if (Array.isArray(list) && list.length) {
        const raw = await fetchStructuredResource(list[safeIndex] || list[0])
        const normalized = normalizeVolumePointData(
          raw,
          null,
          payload?.variable,
        )
        if (normalized?.positions?.length) return normalized
      }
    }

    if (typeof payload.csv_url === 'string' && payload.csv_url.trim()) {
      const raw = await fetchStructuredResource(payload.csv_url.trim())
      const normalized = normalizeVolumePointData(raw, null, payload?.variable)
      if (normalized?.positions?.length) return normalized
    }
    if (typeof payload.url === 'string' && payload.url.trim()) {
      const raw = await fetchStructuredResource(payload.url.trim())
      const normalized = normalizeVolumePointData(raw, null, payload?.variable)
      if (normalized?.positions?.length) return normalized
    }
    if (typeof payload.csv === 'string' && payload.csv.trim()) {
      const raw = await fetchStructuredResource(payload.csv.trim())
      const normalized = normalizeVolumePointData(raw, null, payload?.variable)
      if (normalized?.positions?.length) return normalized
    }

    return normalizeVolumePointData(payload, null, payload?.variable)
  }

  function resolveVolumeDataUrl(payload, forceFirstFrame = false) {
    const safeIndex = resolveVolumeFrameIndex(payload, forceFirstFrame)
    // volume_dataset_frames 支持
    if (Array.isArray(payload?.volume_dataset_frames) && payload.volume_dataset_frames.length > 0) {
      const frame = payload.volume_dataset_frames[safeIndex] || payload.volume_dataset_frames[0]
      if (frame?.bin_url) return normalizeUrl(frame.bin_url)
      if (frame?.manifest_url) return normalizeUrl(frame.manifest_url)
    }
    const candidateLists = [
      payload?.csv_urls,
      payload?.urls_csv,
      payload?.urls,
      payload?.volume_urls,
      payload?.volume_frame_urls,
      payload?.data_urls,
      payload?.frame_urls,
    ]
    for (const list of candidateLists) {
      if (Array.isArray(list) && list.length) {
        const url = safeIndex < list.length ? list[safeIndex] : list[0]
        return normalizeUrl(url)
      }
    }
    if (typeof payload?.csv_url === 'string' && payload.csv_url.trim()) {
      return normalizeUrl(payload.csv_url)
    }
    if (typeof payload?.url === 'string' && payload.url.trim()) {
      return normalizeUrl(payload.url)
    }
    if (typeof payload?.csv === 'string' && payload.csv.trim()) {
      return normalizeUrl(payload.csv)
    }
    return ''
  }

  /** 清除解析结果缓存 */
  function clearInternalCaches() {
    volumeVoxelCache.clear()
    volumeVoxelPendingCache.clear()
  }

  /** 清除所有缓存，用于完全重置 */
  function clearAllCaches() {
    volumeVoxelCache.clear()
    volumeVoxelPendingCache.clear()
    directVolumeCache.clear()
    directManifestJsonCache.clear()
    directManifestJsonPendingCache.clear()
    directBinArrayBufferCache.clear()
    directBinArrayBufferPendingCache.clear()
    volumeTextureCache.forEach((entry) => disposeVolumeTextureCacheEntry(entry))
    volumeTextureCache.clear()
    effectiveVolumeTextureCacheMax = VOLUME_TEXTURE_CACHE_MAX
  }

  /** 从 payload 中提取全局值域范围（用于跨时间步一致的归一化）
   *  优先使用 payload.vmin/vmax（由 cacheVolumePayload 从 metadata 注入），
   *  然后尝试 metadata 的 variables 字段，
   *  最后回退到独立归一化（null）。
   */
  function extractGlobalValueRange(payload) {
    if (!payload) return null
    // 1. payload 中的 vmin/vmax（由 cacheVolumePayload 从 task metadata 注入）
    const vmin = Number(payload.vmin ?? payload.val_min)
    const vmax = Number(payload.vmax ?? payload.val_max)
    if (Number.isFinite(vmin) && Number.isFinite(vmax) && vmax > vmin) {
      console.log('[VolumeRange] 使用 payload 全局值域:', {
        variable: payload?.variable,
        vmin,
        vmax,
      })
      return [vmin, vmax]
    }
    // 2. payload 中可能嵌套 metadata.variables
    const variableName = String(payload?.variable || '').trim()
    if (payload?.metadata?.variables?.[variableName]) {
      const meta = payload.metadata.variables[variableName]
      const mvMin = Number(meta.vmin ?? meta.val_min)
      const mvMax = Number(meta.vmax ?? meta.val_max)
      if (Number.isFinite(mvMin) && Number.isFinite(mvMax) && mvMax > mvMin) {
        console.log('[VolumeRange] 使用 metadata.variables 全局值域:', {
          variable: variableName,
          vmin: mvMin,
          vmax: mvMax,
        })
        return [mvMin, mvMax]
      }
    }
    console.log('[VolumeRange] 无全局值域，使用独立归一化')
    return null
  }

  function buildFallback() {
    // Keep the current volume meshes visible while an async sync prepares
    // replacements. Callers that really need to clear the volume already do so
    // explicitly before invoking this fallback hook.
  }

  async function sync() {
    const isEnabled =
      typeof getIsEnabled === 'function'
        ? getIsEnabled()
        : getSceneMode() === 'volume'
    if (!isEnabled || !getDynamicGroup?.()) return
    let payload = getActiveVolumePayload()

    const isPlaying = typeof getIsPlaying === 'function' && getIsPlaying()
    if (isPlaying && volumeMeshes.size > 0 && getVolumeRenderMode() === 'raymarch') {
      const didUpdate = await syncPlaybackFrame({ isStale: () => false })
      if (didUpdate) return
      const nextSourceKey = resolveVolumeSourceKey(payload)
      if (nextSourceKey && nextSourceKey === lastVolumeSourceKey) {
        return
      }
    }

    console.log(
      '[VolumeSync] sync() called, payload:',
      summarizePayload(payload),
    )

    const token = ++volumeSyncToken
    const _currentTimeStep = getCurrentTimeStep?.()
    const _currentStepIndex =
      typeof getCurrentStepIndex === 'function' ? getCurrentStepIndex() : null
    const visibleLayers = Array.isArray(getVisibleVolumeLayers?.())
      ? getVisibleVolumeLayers().filter((layer) => layer?.visible !== false)
      : []

    console.log('[VolumeSync] 调用详情:', {
      token,
      visibleLayerCount: visibleLayers.length,
      currentTimeStep: _currentTimeStep,
      lastTimeStep: lastVolumeTimeStep,
      lastVolumeSourceKey,
      hasPayload: !!payload,
    })

    const testVolumeCsvUrl = String(
      getVisualization()?.testVolumeCsvUrl || '',
    ).trim()
    const useMockData = getVisualization()?.useMockVolumeData === true
    const activeLayer = getSelectedLayer?.() || null
    const hasVisibleVolumeLayer =
      activeLayer?.kind === 'volume' && activeLayer?.visible !== false
    if (
      !payload &&
      visibleLayers.length === 0 &&
      !useMockData &&
      !testVolumeCsvUrl
    ) {
      console.warn('[Volume] active payload is null', {
        selectedLayerId: getSelectedLayer?.()?.id,
      })
      // 没有数据时再清空
      disposeVolumeMesh()
      if (volumeWire) {
        getDynamicGroup?.()?.remove(volumeWire)
        volumeWire.geometry?.dispose?.()
        volumeWire.material?.dispose?.()
        volumeWire = null
      }
      clearGroup(getDynamicGroup?.())
      volumeWire = null
      buildFallback()
      return
    }
    if (!payload && testVolumeCsvUrl && hasVisibleVolumeLayer) {
      payload = {
        id: String(activeLayer?.id || '__test_volume_csv__'),
        variable: String(activeLayer?.variable || 'value'),
        csv_url: testVolumeCsvUrl,
      }
    } else if (!payload && testVolumeCsvUrl && !hasVisibleVolumeLayer) {
      disposeVolumeMesh()
      clearGroup(getDynamicGroup?.())
      buildFallback()
      return
    } else if (!payload && useMockData) {
      payload = {
        id: '__sample_volume__',
        variable: 'value',
      }
    }

    // 在 payload 确定后才计算 transform（支持 manifest bounds）
    const transform = resolveVolumeTransform(payload)

    const activePayloadLayerKey =
      getSelectedLayer?.()?.id ||
      payload?.layer_id ||
      payload?.id ||
      payload?.variable ||
      '__active_volume__'
    const activePayloadLayerKeyString = String(activePayloadLayerKey)
    const volumeSourceKey = resolveVolumeSourceKey(payload)
    const forceFirstFrame =
      Boolean(volumeSourceKey) &&
      volumeSourceKey !== lastVolumeSourceKeysByLayer.get(activePayloadLayerKeyString)
    if (volumeSourceKey) {
      lastVolumeSourceKeysByLayer.set(activePayloadLayerKeyString, volumeSourceKey)
      lastVolumeSourceKey = volumeSourceKey
    }

    // 检测时间步是否变化，用于决定是否需要刷新体渲染
    const timeStepChanged = _currentTimeStep !== lastVolumeTimeStep
    if (timeStepChanged) {
      console.log('[VolumeSync] 时间步变化:', {
        from: lastVolumeTimeStep,
        to: _currentTimeStep,
        stepIndex: _currentStepIndex,
        isPlaying,
      })
      lastVolumeTimeStep = _currentTimeStep
      // 播放时保留解析缓存，便于复用已加载帧
      if (!isPlaying) {
        volumeVoxelCache.clear()
        volumeVoxelPendingCache.clear()
      }
    }

    if (useMockData && !testVolumeCsvUrl) {
      try {
        const dims = Number(getVisualization()?.volume_resolution) || 48
        const { voxelData, dims: voxelDims } = buildSampleVolumeData(dims)
        const texture = configureVolumeTexture(
          new THREE.Data3DTexture(
            voxelData,
            voxelDims,
            voxelDims,
            voxelDims,
          ),
          voxelData,
        )

        const sampleOccTex = createOccupancyData3DTexture(
          voxelData,
          voxelDims,
          voxelDims,
          voxelDims,
        )

        const sampleMesh = createVolumeRaymarchMeshFromTexture(
          texture,
          payload,
          transform,
          {
            dims: [voxelDims, voxelDims, voxelDims],
            rowCount: voxelDims * voxelDims * voxelDims,
            valueRange: [0, 1],
            source: 'sample-csv',
            occupancyTexture: sampleOccTex || undefined,
          },
        )
        if (sampleMesh) {
          // 先清空旧对象，再添加新对象
          disposeVolumeMesh()
          if (volumeWire) {
            getDynamicGroup?.()?.remove(volumeWire)
            volumeWire.geometry?.dispose?.()
            volumeWire.material?.dispose?.()
            volumeWire = null
          }
          clearGroup(getDynamicGroup?.())
          volumeMeshes.set(
            String(payload?.id || '__sample_volume__'),
            sampleMesh,
          )
          getDynamicGroup?.()?.add(sampleMesh)
          onVolumeTransformReady?.(transform)

          return
        }
      } catch (mockError) {
        console.warn('[Volume] sample CSV raymarch failed', mockError)
      }
      if (!resolveVolumeSourceKey(payload)) {
        return
      }
    }

    const payloadEntries = visibleLayers.length
      ? visibleLayers
          .map((layer) => ({
            layer,
            payload: getVolumePayloadForLayer?.(layer) || null,
          }))
          .filter((entry) => entry.payload)
      : payload
        ? [{ layer: null, payload }]
        : []

    if (!payloadEntries.length && payload) {
      payloadEntries.push({ layer: null, payload })
    }
    if (!payloadEntries.length) {
      console.warn('[Volume] visible volume layer has no payload; keep current mesh', {
        visibleLayerCount: visibleLayers.length,
        selectedLayerId: getSelectedLayer?.()?.id,
      })
      return
    }

    // 先加载所有新数据到 newMeshes，加载完成后再统一替换
    const newMeshes = new Map()
    const resolveMeshKey = (baseKey, index) => {
      const preferredKey = String(baseKey || `volume-${index}`)
      if (!newMeshes.has(preferredKey)) return preferredKey
      const uniqueKey = `${preferredKey}:${index}`
      console.warn('[VolumeSync] duplicate volume layer key, using unique key:', {
        preferredKey,
        uniqueKey,
        index,
      })
      return uniqueKey
    }
    let renderedCount = 0
    for (let index = 0; index < payloadEntries.length; index += 1) {
      const entry = payloadEntries[index]
      const layer = entry.layer
        const activePayload = entry.payload
        const baseLayerKey =
          layer?.id ||
            activePayload?.id ||
            activePayload?.variable ||
          renderedCount
        const layerKey = resolveMeshKey(baseLayerKey, index)
        const volumeRenderMode = getVolumeRenderMode()
        try {
          const entrySourceKey = resolveVolumeSourceKey(activePayload)
          const entryLayerKey = String(baseLayerKey)
          const entryForceFirstFrame =
          Boolean(entrySourceKey) &&
          entrySourceKey !== lastVolumeSourceKeysByLayer.get(entryLayerKey)
        if (entrySourceKey) {
          lastVolumeSourceKeysByLayer.set(entryLayerKey, entrySourceKey)
          lastVolumeSourceKey = entrySourceKey
        }
        const forceEntryFirstFrame =
          visibleLayers.length > 0
            ? entryForceFirstFrame
            : entryForceFirstFrame || forceFirstFrame
        const volumeUrl = resolveVolumeDataUrl(
          activePayload,
          forceEntryFirstFrame,
        )
        const resolvedFrameIndex = resolveVolumeFrameIndex(
          activePayload,
          forceEntryFirstFrame,
        )
        const existingMesh = volumeMeshes.get(layerKey)
        if (
          existingMesh &&
          existingMesh.userData?.volumeSourceKey === entrySourceKey &&
          existingMesh.userData?.volumeFrameIndex === resolvedFrameIndex &&
          existingMesh.userData?.volumeRenderMode === volumeRenderMode &&
          !existingMesh.userData?.isPreview &&
          existingMesh.userData?.fullResLoading !== true
        ) {
          existingMesh.renderOrder = 100 + index
          updateDisplayRangeForMesh(existingMesh)
          updateTransferStopsForMesh(existingMesh)
          newMeshes.set(layerKey, existingMesh)
          renderedCount += 1
          continue
        }
        const hasVolumeDatasetFrames =
          Array.isArray(activePayload?.volume_dataset_frames) &&
          activePayload.volume_dataset_frames.length > 0

        console.log('[VolumeSync] entry processing:', {
          layerKey: baseLayerKey,
          frameIndex: resolvedFrameIndex,
          currentTimeStep: _currentTimeStep,
          currentStepIndex: _currentStepIndex,
          volumeUrl: volumeUrl
            ? volumeUrl.substring(volumeUrl.lastIndexOf('/') + 1)
            : '(empty)',
          forceFirstFrame: forceEntryFirstFrame,
          hasCsvUrls: Array.isArray(activePayload?.csv_urls)
            ? activePayload.csv_urls.length
            : 0,
          hasCsvUrl: !!activePayload?.csv_url,
          hasManifestUrl: !!activePayload?.manifest_url,
          hasBinUrl: !!activePayload?.bin_url,
          hasVolumeDatasetFrames,
          payloadKeys: Object.keys(activePayload || {}),
        })

        if (
          volumeUrl ||
          activePayload?.manifest_url ||
          hasVolumeDatasetFrames
        ) {
          try {
            console.log('[VolumeSync] 🎯 尝试创建 raymarch mesh:', {
              layerKey: baseLayerKey,
              volumeRenderMode,
              volumeUrl: volumeUrl
                ? volumeUrl.substring(volumeUrl.lastIndexOf('/') + 1)
                : hasVolumeDatasetFrames
                  ? '(dataset-frame)'
                  : '(manifest-only)',
              manifestUrl: activePayload?.manifest_url || null,
              binUrl: activePayload?.bin_url || null,
              variable: activePayload?.variable,
              transform: { size: transform?.size?.toArray?.(), center: transform?.center?.toArray?.() },
            })
            const raymarchMesh = await createRaymarchMeshFromCsvUrl(
              volumeUrl,
              activePayload,
              transform,
            )
            if (token !== volumeSyncToken) {
              console.log('[VolumeSync] ⚠️ 请求已过期，丢弃 raymarch mesh')
              disposeAbortedMesh(raymarchMesh)
              return
            }
            if (raymarchMesh) {
              console.log('[VolumeSync] ✅ Raymarch mesh 创建成功')
              if (raymarchMesh.userData?.volumeMeta) {
                raymarchMesh.userData.volumeMeta.layerId = String(
                  layer?.id || baseLayerKey,
                )
              }
              raymarchMesh.userData.volumeSourceKey = entrySourceKey
              raymarchMesh.userData.volumeRenderMode = volumeRenderMode
              raymarchMesh.userData.volumeFrameIndex = resolvedFrameIndex
              raymarchMesh.renderOrder = 100 + index
              updateDisplayRangeForMesh(raymarchMesh)
              updateTransferStopsForMesh(raymarchMesh)
              newMeshes.set(layerKey, raymarchMesh)
              renderedCount += 1
              continue
            } else {
              console.warn('[VolumeSync] ⚠️ Raymarch mesh 返回 null，降级到点云模式')
            }
          } catch (raymarchError) {
            console.warn(
              'Volume CSV raymarch fallback to point-based mode:',
              raymarchError,
            )
          }
        }
        if (
          (volumeUrl || activePayload?.manifest_url || hasVolumeDatasetFrames) &&
          volumeRenderMode === 'particle'
        ) {
          console.warn('[VolumeSync] raymarch 未生成，降级到 particle 体渲染:', {
            layerKey: baseLayerKey,
          })
          const particleMesh = await createVolumeParticleMeshFromCsvUrl(
            volumeUrl,
            activePayload,
            transform,
          )
          if (token !== volumeSyncToken) {
            disposeAbortedMesh(particleMesh)
            return
          }
          if (particleMesh) {
            if (particleMesh.userData?.volumeMeta) {
              particleMesh.userData.volumeMeta.layerId = String(
                layer?.id || baseLayerKey,
              )
            }
            particleMesh.userData.volumeSourceKey = entrySourceKey
            particleMesh.userData.volumeRenderMode = volumeRenderMode
            particleMesh.userData.volumeFrameIndex = resolvedFrameIndex
            particleMesh.renderOrder = 100 + index
            newMeshes.set(layerKey, particleMesh)
            renderedCount += 1
            continue
          }
        }
        const volumeData = await loadVolumeDataFromPayload(
          activePayload,
          forceEntryFirstFrame,
        )

        if (token !== volumeSyncToken) return
        const points = createVolumePoints(volumeData, activePayload, transform)
        if (token !== volumeSyncToken) {
          disposeAbortedMesh(points)
          return
        }
        if (points) {
          points.userData.volumeSourceKey = entrySourceKey
          points.userData.volumeRenderMode = volumeRenderMode
          points.userData.volumeFrameIndex = resolvedFrameIndex
          points.renderOrder = 100 + index
          newMeshes.set(layerKey, points)
          renderedCount += 1
        }
      } catch (error) {
        console.warn(
          'Failed to render volume payload in ThreeVisualizationCanvas:',
          error,
        )
      }
    }
    if (token !== volumeSyncToken) return

    // 双缓冲：保存旧 mesh 引用，先显示新 mesh，再延迟清理旧 mesh
    const oldMeshes = new Map(volumeMeshes)
    const oldWire = volumeWire

    // 清空 volumeMeshes 并重建
    volumeMeshes.clear()
    for (const [key, mesh] of newMeshes) {
      volumeMeshes.set(key, mesh)
    }

    // 双缓冲替换：新 mesh 全部就绪后再移除旧 mesh，避免新增图层或切时间步时闪烁。
    const dynamicGroup = getDynamicGroup?.()
    for (const [key, mesh] of newMeshes) {
      if (mesh?.parent !== dynamicGroup) {
        dynamicGroup?.add(mesh)
      }
    }
    if (newMeshes.size > 0) {
      onVolumeTransformReady?.(transform)
    }
    const reusedMeshes = new Set(newMeshes.values())
    oldMeshes.forEach((mesh) => {
      if (reusedMeshes.has(mesh)) return
      if (mesh?.parent === dynamicGroup) {
        dynamicGroup?.remove(mesh)
      }
    })
    if (oldWire?.parent === dynamicGroup) {
      dynamicGroup?.remove(oldWire)
    }

    // 延迟清理旧 mesh，给渲染器时间完成新 mesh 的首次渲染
    setTimeout(() => {
      oldMeshes.forEach((mesh) => {
        if (!reusedMeshes.has(mesh)) disposeSingleVolumeMesh(mesh)
      })
      if (oldWire) {
        oldWire.geometry?.dispose?.()
        oldWire.material?.dispose?.()
      }
    }, 16)

    console.log('[VolumeSync] replacing meshes:', {
      count: newMeshes.size,
      token,
      timeStep: _currentTimeStep,
      stepIndex: _currentStepIndex,
      entries: [...newMeshes.entries()].map(([k, m]) => {
        const tex = m?.material?.uniforms?.uVolumePrev?.value
        const texData = tex?.image?.data
        return {
          key: k,
          valueRange: m?.userData?.volumeMeta?.valueRange,
          hasTexture: !!tex,
          texDims: tex
            ? `${tex.image.width}x${tex.image.height}x${tex.image.depth}`
            : '-',
          texFirstVals: texData
            ? [texData[0], texData[1], texData[2], texData[3]]
            : '-',
          texLastVals: texData
            ? [
                texData[texData.length - 4],
                texData[texData.length - 3],
                texData[texData.length - 2],
                texData[texData.length - 1],
              ]
            : '-',
        }
      }),
    })

    if (newMeshes.size > 0) {
      console.log('[DEBUG Raymarch] ✅ Mesh 已添加到场景，count:', newMeshes.size)
    } else {
      console.warn('[DEBUG Raymarch] ⚠️ 没有 mesh 被添加到场景', {
        renderedCount,
        payloadCount: payloadEntries.length,
      })
    }

    if (!renderedCount) {
      buildFallback()
    }
  }

  function scheduleHighQualityVolumeRefresh() {
    if (volumeHighQualityTimer) {
      window.clearTimeout(volumeHighQualityTimer)
      volumeHighQualityTimer = 0
    }
    const isEnabled =
      typeof getIsEnabled === 'function'
        ? getIsEnabled()
        : getSceneMode() === 'volume'
    if (!isEnabled) return
    volumeHighQualityTimer = window.setTimeout(() => {
      volumeHighQualityTimer = 0
      useLowQualityRaymarch = false
      updateVolumePixelRatio({ active: true, lowQuality: false })
    }, 180)
  }

  function onControlStart() {
    const isEnabled =
      typeof getIsEnabled === 'function'
        ? getIsEnabled()
        : getSceneMode() === 'volume'
    if (!isEnabled) return
    isVolumeInteracting = true
    useLowQualityRaymarch = true
    updateVolumePixelRatio({ active: true, lowQuality: true })
    if (volumeHighQualityTimer) {
      window.clearTimeout(volumeHighQualityTimer)
      volumeHighQualityTimer = 0
    }
  }

  function onControlEnd() {
    const isEnabled =
      typeof getIsEnabled === 'function'
        ? getIsEnabled()
        : getSceneMode() === 'volume'
    if (!isEnabled) return
    isVolumeInteracting = false
    updateVolumePixelRatio({ active: true, lowQuality: false })
    scheduleHighQualityVolumeRefresh()
  }

  function onModeChange(mode) {
    if (mode !== 'volume') {
      lastVolumePersonAabbIntersect = false
      notifyVolumePersonIntersectOutline(false, '')
      isVolumeInteracting = false
      useLowQualityRaymarch = false
      updateVolumePixelRatio({ active: false })
      if (volumeHighQualityTimer) {
        window.clearTimeout(volumeHighQualityTimer)
        volumeHighQualityTimer = 0
      }
    }
  }

  function resolveVolumeIntersectLabelForUi(mesh) {
    const vid = mesh.userData?.volumeMeta?.variable
    if (!vid) return '体渲染区域'
    if (isRadarMockVolumeVariableId(vid)) {
      const band = extractRadarMockVolumeBandId(vid)
      if (band) {
        try {
          return `雷达体（${radarFrequencyLabel(band)}）`
        } catch {
          return `雷达体（${band}）`
        }
      }
      return '雷达体'
    }
    return `体数据（${vid}）`
  }

  function notifyVolumePersonIntersectOutline(intersecting, personModelKey = '') {
    if (typeof setVolumePersonIntersectHighlight !== 'function') return
    const key = intersecting ? String(personModelKey || '') : ''
    if (
      intersecting === lastVolumeIntersectOutlineOn &&
      (!intersecting || key === lastVolumeIntersectOutlineKey)
    ) {
      return
    }
    setVolumePersonIntersectHighlight(intersecting, { personModelKey: key })
    lastVolumeIntersectOutlineOn = intersecting
    lastVolumeIntersectOutlineKey = key
  }

  /** 雷达体与人物 AABB 相交；上升沿触发 onVolumePersonSpaceIntersect；相交期间人物描边（气体体不参与） */
  function checkVolumePersonAabbOverlap() {
    const hasPopup = typeof onVolumePersonSpaceIntersect === 'function'
    const hasOutline = typeof setVolumePersonIntersectHighlight === 'function'
    if (!hasPopup && !hasOutline) return

    const abort = () => {
      lastVolumePersonAabbIntersect = false
      notifyVolumePersonIntersectOutline(false, '')
    }

    if (getSceneMode?.() !== 'volume') {
      abort()
      return
    }
    if (!getIsEnabled?.()) {
      abort()
      return
    }
    if (!volumeMeshes.size) {
      abort()
      return
    }
    const modelGroup = getModelGroup?.()
    if (!modelGroup) {
      abort()
      return
    }
    const personRoots = []
    for (let i = 0; i < modelGroup.children.length; i += 1) {
      const child = modelGroup.children[i]
      const key = child.userData?.gltfModelKey
      if (!key || !PERSON_GLTF_MODEL_KEYS.has(key)) continue
      if (!child.visible) continue
      personRoots.push(child)
    }
    if (!personRoots.length) {
      abort()
      return
    }

    const volBox = new THREE.Box3()
    const personBox = new THREE.Box3()
    let intersecting = false
    let volumeLabel = ''
    let personModelKey = ''

    outer:
    for (const [, volumeMesh] of volumeMeshes) {
      if (!volumeMesh.visible) continue
      const vid = volumeMesh.userData?.volumeMeta?.variable
      // 空间交集提示/描边仅针对雷达体，气体体渲染不参与
      if (!isRadarMockVolumeVariableId(vid)) continue
      volBox.setFromObject(volumeMesh)
      const vLabel = resolveVolumeIntersectLabelForUi(volumeMesh)
      for (let j = 0; j < personRoots.length; j += 1) {
        const person = personRoots[j]
        personBox.setFromObject(person)
        if (volBox.intersectsBox(personBox)) {
          intersecting = true
          volumeLabel = vLabel
          personModelKey = String(person.userData.gltfModelKey || '')
          break outer
        }
      }
    }

    if (intersecting && !lastVolumePersonAabbIntersect && hasPopup) {
      onVolumePersonSpaceIntersect({
        volumeLabel,
        personModelKey,
      })
    }
    lastVolumePersonAabbIntersect = intersecting
    notifyVolumePersonIntersectOutline(intersecting, personModelKey)
  }

  function tick(elapsed) {
    if (!volumeMeshes.size) {
      lastVolumePersonAabbIntersect = false
      notifyVolumePersonIntersectOutline(false, '')
      return
    }
    const lowPixelRatio = isVolumeInteracting || useLowQualityRaymarch
    updateVolumePixelRatio({ active: true, lowQuality: lowPixelRatio })
    const camera = getCamera?.()
    const visibleLayers = getVisibleVolumeLayers?.() || []
    volumeMeshes.forEach((volumeMesh) => {
      volumeMesh.updateMatrixWorld(true)
      if (volumeMesh.material?.uniforms?.uModelInv?.value) {
        volumeMesh.material.uniforms.uModelInv.value
          .copy(volumeMesh.matrixWorld)
          .invert()
      }
      if (volumeMesh.material.uniforms?.uTime) {
        volumeMesh.material.uniforms.uTime.value = elapsed
      }
      if (
        volumeMesh.material.uniforms?.uRadarWaveTime &&
        volumeMesh.material.uniforms?.uRadarWaveStrength &&
        volumeMesh.material.uniforms.uRadarWaveStrength.value > 0.001
      ) {
        // 与 RippleReflectionView 体渲染一致：球面行波由全局时钟连续驱动（非时间轴步进冻结）
        volumeMesh.material.uniforms.uRadarWaveTime.value = elapsed
      }
      if (volumeMesh.material?.uniforms?.uSteps) {
        const rawSteps = Number(getVisualization()?.volume_raymarch_steps)
        const baseSteps = Number.isFinite(rawSteps)
          ? Math.max(8, Math.min(256, Math.round(rawSteps)))
          : 160
        volumeMesh.material.uniforms.uSteps.value = baseSteps
      }
      if (volumeMesh.material?.uniforms?.uLowQuality) {
        volumeMesh.material.uniforms.uLowQuality.value = 0.0
      }
      if (volumeMesh.material?.uniforms?.uOpacityScale) {
        const rawOpacity = Number(getVisualization()?.volume_raymarch_opacity)
        const nextOpacity = Number.isFinite(rawOpacity)
          ? Math.max(0.05, Math.min(4, rawOpacity))
          : 1
        volumeMesh.material.uniforms.uOpacityScale.value = nextOpacity
      }
      if (volumeMesh.material?.uniforms?.uEssStrength) {
        const rawEss = Number(getVisualization()?.volume_raymarch_ess)
        const nextEss = Number.isFinite(rawEss)
          ? Math.max(0, Math.min(1, rawEss))
          : 0.55
        volumeMesh.material.uniforms.uEssStrength.value = nextEss
      }
      if (volumeMesh.material) {
        const mat = volumeMesh.material
        // 遮挡模式默认开启；显式 seeThrough=true 时才让体渲染穿透模型。
        const layerId = volumeMesh.userData?.volumeMeta?.layerId
        const layer = visibleLayers.find((l) => String(l?.id) === String(layerId))
        const layerSeeThrough = layer?.seeThrough === true
        let nextDepthTest = true
        let nextSide = THREE.FrontSide
        if (layerSeeThrough) {
          nextDepthTest = false
          nextSide = THREE.BackSide
        } else if (camera) {
          const box = new THREE.Box3().setFromObject(volumeMesh)
          const cameraInside = box.containsPoint(camera.position)
          if (cameraInside) {
            nextDepthTest = false
            nextSide = THREE.BackSide
          }
        }
        if (mat.depthTest !== nextDepthTest || mat.side !== nextSide) {
          mat.depthTest = nextDepthTest
          mat.side = nextSide
          mat.needsUpdate = true
        }
      }
    })
    checkVolumePersonAabbOverlap()
  }

  function dispose() {
    notifyVolumePersonIntersectOutline(false, '')
    if (volumeHighQualityTimer) window.clearTimeout(volumeHighQualityTimer)
    volumeSyncToken += 1
    useLowQualityRaymarch = false
    disposeVolumeMesh()
    if (volumeWire) {
      getDynamicGroup?.()?.remove(volumeWire)
      volumeWire.geometry?.dispose?.()
      volumeWire.material?.dispose?.()
      volumeWire = null
    }
    volumeWorker?.terminate?.()
    volumeWorker = null
    volumeVoxelPendingCache.clear()
    volumeTextureCache.forEach((entry) => disposeVolumeTextureCacheEntry(entry))
    volumeTextureCache.clear()
  }

  function invalidateSync() {
    volumeSyncToken += 1
  }

  /** 设置等值面模式（启用/禁用） */
  function setIsosurfaceEnabled(enabled) {
    volumeMeshes.forEach((volumeMesh) => {
      if (volumeMesh.material?.uniforms?.uIsoEnabled) {
        volumeMesh.material.uniforms.uIsoEnabled.value = enabled ? 1.0 : 0.0
      }
    })
  }

  /** 设置等值面值（0~1 范围） */
  function setIsosurfaceValue(value) {
    const clamped = Math.max(0, Math.min(1, Number(value) || 0.5))
    volumeMeshes.forEach((volumeMesh) => {
      if (volumeMesh.material?.uniforms?.uIsoValue) {
        volumeMesh.material.uniforms.uIsoValue.value = clamped
      }
    })
  }

  /** 获取当前体渲染的值域范围 */
  function getVolumeValueRange() {
    for (const [, mesh] of volumeMeshes) {
      if (mesh.userData?.volumeMeta?.valueRange) {
        return mesh.userData.volumeMeta.valueRange
      }
    }
    return [0, 1]
  }

  return {
    buildFallback,
    sync,
    syncPlaybackFrame,
    hasVolumeMeshes,
    tick,
    updateVolumePalettes,
    updateVolumeDisplayRanges,
    onControlStart,
    onControlEnd,
    onModeChange,
    dispose,
    invalidateSync,
    setIsosurfaceEnabled,
    setIsosurfaceValue,
    getVolumeValueRange,
    clearInternalCaches,
    clearAllCaches,
    schedulePreload,
  }
}
