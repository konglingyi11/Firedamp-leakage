import {
  THREE,
  clearGroup,
  createStructuredResourceLoader,
  toFiniteNumber,
} from './shared.js'
import { createSmokeTexture } from '@/utils/smokeSystem.js'

const DEFAULT_STREAMLINE_COLOR = '#ff3b30'
const STREAMLINE_RADIUS = 0.014
const DEFAULT_STREAMLINE_LINE_WIDTH = 0.38
const MIN_STREAMLINE_LINE_WIDTH = 0.01
const STREAMLINE_ARROW_LENGTH = 0.065
const STREAMLINE_ARROW_MIN_LENGTH = 0.042
const MAX_RENDERED_STREAMLINES = 240
const MAX_STREAMLINE_POINTS_PER_LINE = 512
const MAX_STREAMLINE_TUBULAR_SEGMENTS = 768
const STREAMLINE_OPACITY = 0.76
const STREAMLINE_PLAYBACK_OPACITY = 0.54
const STREAMLINE_ARROW_OPACITY = 0.92
const STREAMLINE_SMOKE_PARTICLES_PER_CURVE = 5
const STREAMLINE_SMOKE_MAX_PARTICLES = 720
const STREAMLINE_SMOKE_CURVE_SAMPLE_COUNT = 96
const STREAMLINE_SMOKE_TRAVEL_RATIO = 0.68
const STREAMLINE_SMOKE_END_DIFFUSION_LIFT = 0.04
const STREAMLINE_SMOKE_END_DIFFUSION_SPREAD = 0.06

export function createStreamlineMode(options) {
  const {
    getDynamicGroup,
    getSceneMode,
    getVisualization,
    getActiveStreamlinePayload,
    getIsEnabled,
    getIsVisible,
    getCurrentTimeStep,
    getCurrentStepIndex,
    getIsPlaying,
    getActiveStreamlineLayer,
  } = options

  const fetchStructuredResource = createStructuredResourceLoader()
  let streamlineLines = []
  let streamlineSyncToken = 0
  let lastStreamlineSourceKey = ''
  let streamlineGroup = null
  let lastLineWidth = DEFAULT_STREAMLINE_LINE_WIDTH
  let lastStreamlineColor = DEFAULT_STREAMLINE_COLOR
  let pendingGeometryRebuildTimer = null
  const lineSetCache = new Map()
  const inflightLineSetRequests = new Map()
  const MAX_LINESET_CACHE_ENTRIES = 120
  const MAX_PREWARM_LINESETS = 120
  const PREWARM_CONCURRENCY = 2
  const PLAYBACK_MAX_RENDERED_STREAMLINES = 72
  const PLAYBACK_MAX_STREAMLINE_POINTS_PER_LINE = 128

  let streamlineCurves = []
  let smokeTexture = null
  let streamlineSmoke = null
  let prewarmToken = 0
  let lastPrewarmKey = ''

  class StreamlineSmokeParticles {
    constructor(curves, texture, parent, color) {
      this.curves = curves
      this.count = Math.min(
        STREAMLINE_SMOKE_MAX_PARTICLES,
        Math.max(0, curves.length * STREAMLINE_SMOKE_PARTICLES_PER_CURVE),
      )
      this.geometry = new THREE.BufferGeometry()
      this.positions = new Float32Array(this.count * 3)
      this.sizes = new Float32Array(this.count)
      this.alphas = new Float32Array(this.count)
      this.randoms = new Float32Array(this.count * 4)
      this.curveIndices = new Uint16Array(this.count)
      this.offsets = new Float32Array(this.count)
      this.speeds = new Float32Array(this.count)
      this.jitters = new Float32Array(this.count * 3)
      this.sampleCount = STREAMLINE_SMOKE_CURVE_SAMPLE_COUNT
      this.samplePositions = new Float32Array(curves.length * this.sampleCount * 3)
      this.sampleTangents = new Float32Array(curves.length * this.sampleCount * 3)
      this.precomputeCurveSamples()

      const baseColor = new THREE.Color(color || DEFAULT_STREAMLINE_COLOR)
      const colors = new Float32Array(this.count * 3)
      for (let i = 0; i < this.count; i += 1) {
        this.curveIndices[i] = i % curves.length
        this.offsets[i] = Math.random()
        this.speeds[i] = 0.035 + Math.random() * 0.05
        this.sizes[i] = 1.2 + Math.random() * 2.2
        this.alphas[i] = 0
        this.randoms[i * 4] = Math.random()
        this.randoms[i * 4 + 1] = Math.random()
        this.randoms[i * 4 + 2] = Math.random()
        this.randoms[i * 4 + 3] = Math.random()
        this.jitters[i * 3] = (Math.random() - 0.5) * 0.018
        this.jitters[i * 3 + 1] = (Math.random() - 0.5) * 0.018
        this.jitters[i * 3 + 2] = (Math.random() - 0.5) * 0.018
        const shade = 0.72 + Math.random() * 0.24
        colors[i * 3] = baseColor.r * 0.68 + shade * 0.28
        colors[i * 3 + 1] = baseColor.g * 0.68 + shade * 0.28
        colors[i * 3 + 2] = baseColor.b * 0.68 + shade * 0.28
      }

      this.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(this.positions, 3),
      )
      this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
      this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1))
      this.geometry.setAttribute('random', new THREE.BufferAttribute(this.randoms, 4))
      this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      this.uniforms = {
        uTime: { value: 0 },
        uTexture: { value: texture },
      }
      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
        vertexShader: `
          attribute float size;
          attribute float alpha;
          attribute vec4 random;
          attribute vec3 color;
          varying float vAlpha;
          varying vec4 vRandom;
          varying vec3 vColor;

          void main() {
            vAlpha = alpha;
            vRandom = random;
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = size * (220.0 / -mvPosition.z);
          }
        `,
        fragmentShader: `
          uniform sampler2D uTexture;
          uniform float uTime;
          varying float vAlpha;
          varying vec4 vRandom;
          varying vec3 vColor;

          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float angle = vRandom.w * 6.28318 + uTime * (0.12 + vRandom.x * 0.18);
            float c = cos(angle);
            float s = sin(angle);
            uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
            vec4 tex = texture2D(uTexture, uv);
            float density = pow(tex.a, 1.08);
            float alpha = density * vAlpha * 0.68;
            if (alpha < 0.006) discard;
            vec3 smokeColor = mix(vColor, vec3(1.0, 0.9, 0.72), density * 0.16);
            gl_FragColor = vec4(smokeColor, alpha);
          }
        `,
      })
      this.points = new THREE.Points(this.geometry, this.material)
      this.points.renderOrder = 560
      this.points.userData.isStreamlineSmoke = true
      parent.add(this.points)
    }

    precomputeCurveSamples() {
      for (let curveIndex = 0; curveIndex < this.curves.length; curveIndex += 1) {
        const curve = this.curves[curveIndex]
        if (!curve) continue
        for (let sampleIndex = 0; sampleIndex < this.sampleCount; sampleIndex += 1) {
          const t = sampleIndex / Math.max(1, this.sampleCount - 1)
          const point = curve.getPointAt(t)
          const tangent = curve.getTangentAt(Math.max(0.001, t)).normalize()
          const offset = (curveIndex * this.sampleCount + sampleIndex) * 3
          this.samplePositions[offset] = point.x
          this.samplePositions[offset + 1] = point.y
          this.samplePositions[offset + 2] = point.z
          this.sampleTangents[offset] = tangent.x
          this.sampleTangents[offset + 1] = tangent.y
          this.sampleTangents[offset + 2] = tangent.z
        }
      }
    }

    update(elapsed) {
      if (!this.curves.length) return
      this.uniforms.uTime.value = elapsed
      for (let i = 0; i < this.count; i += 1) {
        const curveIndex = this.curveIndices[i] % this.curves.length
        const phase = (this.offsets[i] + elapsed * this.speeds[i]) % 1
        const isDiffusingAtEnd = phase > STREAMLINE_SMOKE_TRAVEL_RATIO
        const progress = isDiffusingAtEnd
          ? 1
          : phase / STREAMLINE_SMOKE_TRAVEL_RATIO
        const diffusionProgress = isDiffusingAtEnd
          ? (phase - STREAMLINE_SMOKE_TRAVEL_RATIO) /
            (1 - STREAMLINE_SMOKE_TRAVEL_RATIO)
          : 0
        const sampleT = progress * (this.sampleCount - 1)
        const sampleIndex = Math.min(
          this.sampleCount - 2,
          Math.max(0, Math.floor(sampleT)),
        )
        const sampleMix = sampleT - sampleIndex
        const sampleOffset = (curveIndex * this.sampleCount + sampleIndex) * 3
        const nextSampleOffset = sampleOffset + 3
        const pointX =
          this.samplePositions[sampleOffset] +
          (this.samplePositions[nextSampleOffset] -
            this.samplePositions[sampleOffset]) *
            sampleMix
        const pointY =
          this.samplePositions[sampleOffset + 1] +
          (this.samplePositions[nextSampleOffset + 1] -
            this.samplePositions[sampleOffset + 1]) *
            sampleMix
        const pointZ =
          this.samplePositions[sampleOffset + 2] +
          (this.samplePositions[nextSampleOffset + 2] -
            this.samplePositions[sampleOffset + 2]) *
            sampleMix
        const tangentX =
          this.sampleTangents[sampleOffset] +
          (this.sampleTangents[nextSampleOffset] -
            this.sampleTangents[sampleOffset]) *
            sampleMix
        const tangentZ =
          this.sampleTangents[sampleOffset + 2] +
          (this.sampleTangents[nextSampleOffset + 2] -
            this.sampleTangents[sampleOffset + 2]) *
            sampleMix
        const lifeAlpha = isDiffusingAtEnd
          ? 1 - diffusionProgress
          : Math.min(1, progress / 0.16)
        const drift =
          Math.sin(elapsed * 0.85 + this.randoms[i * 4] * 6.28318) * 0.008
        const endSpread =
          diffusionProgress *
          STREAMLINE_SMOKE_END_DIFFUSION_SPREAD *
          (0.35 + this.randoms[i * 4 + 2])
        const endLift =
          diffusionProgress *
          STREAMLINE_SMOKE_END_DIFFUSION_LIFT *
          (0.45 + this.randoms[i * 4 + 3])
        this.positions[i * 3] =
          pointX +
          this.jitters[i * 3] +
          drift +
          (this.jitters[i * 3] - tangentX * 0.04) * endSpread
        this.positions[i * 3 + 1] =
          pointY +
          this.jitters[i * 3 + 1] +
          progress * 0.012 +
          endLift +
          this.jitters[i * 3 + 1] * endSpread
        this.positions[i * 3 + 2] =
          pointZ +
          this.jitters[i * 3 + 2] -
          drift * 0.6 +
          (this.jitters[i * 3 + 2] - tangentZ * 0.04) * endSpread
        this.sizes[i] =
          (1.2 + this.randoms[i * 4] * 2.2) *
          (isDiffusingAtEnd ? 1 + diffusionProgress * 1.55 : 1)
        this.alphas[i] =
          Math.max(0, Math.min(1, lifeAlpha)) *
          (0.42 + this.randoms[i * 4 + 1] * 0.42)
      }
      this.geometry.attributes.position.needsUpdate = true
      this.geometry.attributes.size.needsUpdate = true
      this.geometry.attributes.alpha.needsUpdate = true
    }

    dispose() {
      this.points?.removeFromParent?.()
      this.geometry.dispose()
      this.material.dispose()
    }
  }

  function rememberLineSets(cacheKey, lineSets) {
    if (!cacheKey) return lineSets
    if (lineSetCache.has(cacheKey)) {
      lineSetCache.delete(cacheKey)
    }
    lineSetCache.set(cacheKey, lineSets)
    if (lineSetCache.size > MAX_LINESET_CACHE_ENTRIES) {
      const oldestKey = lineSetCache.keys().next().value
      if (oldestKey) {
        lineSetCache.delete(oldestKey)
      }
    }
    return lineSets
  }

  function resolveStreamlineDataUrlAtIndex(payload, index) {
    if (!payload || typeof payload !== 'object') return ''
    const candidateLists = [
      payload.urls,
      payload.csv_urls,
      payload.streamline_urls,
      payload.frame_urls,
      payload.data_urls,
    ]
    for (const list of candidateLists) {
      if (Array.isArray(list) && list.length) {
        return String(list[index] || '').trim()
      }
    }
    return ''
  }

  function scheduleStreamlineCachePrewarm(payload) {
    if (!payload || typeof payload !== 'object') return
    const urls = [
      payload.urls,
      payload.csv_urls,
      payload.streamline_urls,
      payload.frame_urls,
      payload.data_urls,
    ].find((list) => Array.isArray(list) && list.length)
    if (!urls?.length) return

    const key = urls.join('|')
    if (key === lastPrewarmKey) return
    lastPrewarmKey = key
    const token = ++prewarmToken
    const limit = Math.min(urls.length, MAX_PREWARM_LINESETS)
    const queue = []
    const currentIndex = Math.max(0, Number(getCurrentStepIndex?.()) || 0)

    for (let offset = 0; offset < limit; offset += 1) {
      const index = (currentIndex + offset) % urls.length
      const url = resolveStreamlineDataUrlAtIndex(payload, index)
      if (url && !lineSetCache.has(url)) queue.push(url)
    }

    if (!queue.length) return

    const run = async () => {
      let cursor = 0
      const worker = async () => {
        while (cursor < queue.length && token === prewarmToken) {
          const url = queue[cursor]
          cursor += 1
          if (lineSetCache.has(url)) continue
          try {
            const raw = await fetchStructuredResource(url)
            rememberLineSets(url, normalizeStreamlineLineSets(raw))
          } catch (error) {
            console.warn('[Streamline] 流线帧预热失败:', url, error)
          }
        }
      }
      await Promise.all(
        Array.from(
          { length: Math.min(PREWARM_CONCURRENCY, queue.length) },
          () => worker(),
        ),
      )
    }

    setTimeout(() => {
      if (token === prewarmToken) void run()
    }, 0)
  }

  function clearRenderedStreamlines() {
    const dynamicGroup = getDynamicGroup?.()
    if (streamlineSmoke) {
      streamlineSmoke.dispose()
      streamlineSmoke = null
    }
    if (streamlineGroup) {
      streamlineGroup.removeFromParent?.()
      disposeObjectMaterials(streamlineGroup)
      streamlineGroup = null
    } else if (dynamicGroup) {
      clearGroup(dynamicGroup)
    }
    streamlineLines = []
    streamlineCurves = []
  }

  function isStreamlineSmokeEnabled() {
    const layer = getActiveStreamlineLayer?.()
    return Boolean(
      layer?.streamlineSmokeEnabled ||
        layer?.smokeEnabled ||
        getVisualization()?.streamline?.smoke_enabled,
    )
  }

  function isStreamlineLineVisible() {
    const layer = getActiveStreamlineLayer?.()
    return layer?.streamlineLineVisible !== false
  }

  function applyStreamlineLineVisibility() {
    if (!streamlineGroup) return
    const lineVisible = isStreamlineLineVisible()
    streamlineGroup.traverse?.((child) => {
      if (child === streamlineGroup || child.userData?.isStreamlineSmoke) return
      child.visible = lineVisible
    })
  }

  function syncStreamlineSmoke() {
    if (streamlineSmoke) {
      streamlineSmoke.dispose()
      streamlineSmoke = null
    }
    if (
      !isStreamlineSmokeEnabled() ||
      !streamlineGroup ||
      !streamlineCurves.length
    ) {
      applyStreamlineLineVisibility()
      return
    }
    if (!smokeTexture) smokeTexture = createSmokeTexture()
    const streamlineColor =
      getVisualization()?.streamline?.color || DEFAULT_STREAMLINE_COLOR
    streamlineSmoke = new StreamlineSmokeParticles(
      streamlineCurves,
      smokeTexture,
      streamlineGroup,
      streamlineColor,
    )
    applyStreamlineLineVisibility()
  }

  /** 与 ThreeVisualizationCanvas 监测点一致：接口为厘米，场景为米 */
  function streamlineRawCmToWorldMeters(point) {
    const toMeters = (value) => {
      const num = Number(value)
      return Number.isFinite(num) ? num / 100 : NaN
    }
    return new THREE.Vector3(
      toMeters(point?.[0]),
      toMeters(point?.[1]),
      toMeters(point?.[2]),
    )
  }

  function resampleStreamlinePoints(points) {
    if (
      !Array.isArray(points) ||
      points.length <= MAX_STREAMLINE_POINTS_PER_LINE
    ) {
      return points
    }
    const sampled = []
    const lastIndex = points.length - 1
    for (let i = 0; i < MAX_STREAMLINE_POINTS_PER_LINE; i += 1) {
      const sourceIndex = Math.round(
        (i / (MAX_STREAMLINE_POINTS_PER_LINE - 1)) * lastIndex,
      )
      sampled.push(points[sourceIndex])
    }
    return sampled
  }

  function resamplePointsToLimit(points, limit) {
    if (!Array.isArray(points) || points.length <= limit) return points
    const sampled = []
    const lastIndex = points.length - 1
    for (let i = 0; i < limit; i += 1) {
      const sourceIndex = Math.round((i / Math.max(limit - 1, 1)) * lastIndex)
      sampled.push(points[sourceIndex])
    }
    return sampled
  }

  function resolveTubularSegments(pointCount) {
    return Math.max(
      24,
      Math.min(MAX_STREAMLINE_TUBULAR_SEGMENTS, Math.round(pointCount * 3)),
    )
  }

  function createStreamlineArrow(
    curve,
    t,
    color,
    lineWidth,
    opacity = STREAMLINE_ARROW_OPACITY,
  ) {
    const arrowPos = curve.getPointAt(t)
    const arrowTangent = curve.getTangentAt(t).normalize()
    const arrowLen = Math.max(
      STREAMLINE_ARROW_MIN_LENGTH,
      STREAMLINE_ARROW_LENGTH * Math.sqrt(Math.max(lineWidth, 0.12)),
    )
    const coneLen = arrowLen * 0.52
    const coneRadius = arrowLen * 0.36
    const geometry = new THREE.ConeGeometry(coneRadius, coneLen, 12)
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
    })
    const cone = new THREE.Mesh(geometry, material)
    // 锥体默认沿 Y 轴，旋转使其与切线方向一致
    const axis = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(axis, arrowTangent)
    cone.quaternion.copy(quat)
    // 锥体中心放在曲线末端稍微靠前的位置（coneLen/2），使尖端恰好在末端
    cone.position.copy(arrowPos).addScaledVector(arrowTangent, coneLen / 2)
    cone.userData.isStreamlineArrow = true
    return cone
  }

  function makeStreamlineSeedKey(curve) {
    const point = curve.getPointAt(0)
    return [point.x, point.y, point.z]
      .map((value) => Number(value).toFixed(4))
      .join(',')
  }

  function addStreamlineDecorators(
    group,
    curve,
    color,
    lineWidth,
    renderedSeedKeys = null,
  ) {
    const seedKey = makeStreamlineSeedKey(curve)
    if (renderedSeedKeys?.has(seedKey)) return
    renderedSeedKeys?.add(seedKey)
    group.add(createStreamlineArrow(curve, 1.0, color, lineWidth))
  }

  function disposeObjectMaterials(object) {
    object.traverse?.((child) => {
      child.geometry?.dispose?.()
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.())
      } else {
        child.material?.dispose?.()
      }
    })
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

  function normalizeStreamlineLineSets(rawData) {
    if (!rawData) return []

    // 已经是点数组的数组格式
    if (Array.isArray(rawData)) {
      if (rawData.length && Array.isArray(rawData[0])) {
        return rawData
      }
      // 包含 points 属性的对象数组
      if (rawData.length && rawData[0]?.points) {
        return rawData
          .map((item) => item.points)
          .filter((item) => Array.isArray(item))
      }
      // PapaParse 解析后的对象数组（CSV 数据）
      if (rawData.length && typeof rawData[0] === 'object') {
        const groups = new Map()
        rawData.forEach((record, index) => {
          const lineId =
            record.streamline_id ??
            record.line_id ??
            record.seed_id ??
            record.path_id ??
            0
          if (!groups.has(lineId)) groups.set(lineId, [])
          groups.get(lineId).push({
            x: findRecordNumber(record, ['x', 'X']),
            y: findRecordNumber(record, ['y', 'Y']),
            z: findRecordNumber(record, ['z', 'Z']),
            order:
              findRecordNumber(record, [
                'point_index',
                'index',
                'step',
                'order',
              ]) ?? index,
          })
        })
        return Array.from(groups.values()).map((points) =>
          points
            .sort((a, b) => a.order - b.order)
            .map((point) => [point.x, point.y, point.z])
            .filter((point) => point.every((value) => value != null)),
        )
      }
    }

    // 嵌套结构
    if (rawData?.lines && Array.isArray(rawData.lines))
      return normalizeStreamlineLineSets(rawData.lines)
    if (rawData?.streamlines && Array.isArray(rawData.streamlines))
      return normalizeStreamlineLineSets(rawData.streamlines)
    if (rawData?.points && Array.isArray(rawData.points))
      return [rawData.points]

    return []
  }

  function buildStreamlineMeshes(lineSets) {
    const isPlaybackMode = Boolean(getIsPlaying?.())
    const validLineSets = Array.isArray(lineSets)
      ? lineSets.filter((line) => Array.isArray(line) && line.length >= 2)
      : []
    if (!validLineSets.length) return { group: null, lines: [] }
    const group = new THREE.Group()
    const meshes = []
    const curves = []
    const lineWidth = Math.max(
      MIN_STREAMLINE_LINE_WIDTH,
      Number(getVisualization()?.streamline?.line_width) ||
        DEFAULT_STREAMLINE_LINE_WIDTH,
    )
    const streamlineColor =
      getVisualization()?.streamline?.color || DEFAULT_STREAMLINE_COLOR
    const baseColor = new THREE.Color(streamlineColor)

    const maxRenderedStreamlines = isPlaybackMode
      ? PLAYBACK_MAX_RENDERED_STREAMLINES
      : MAX_RENDERED_STREAMLINES
    const lineStride = Math.max(
      1,
      Math.ceil(validLineSets.length / maxRenderedStreamlines),
    )
    const renderedLineSets = validLineSets.filter(
      (_, index) => index % lineStride === 0,
    )
    const renderedSeedKeys = new Set()
    if (lineStride > 1) {
      console.warn('[Streamline] 流线数量过多，已抽样渲染:', {
        original: validLineSets.length,
        rendered: renderedLineSets.length,
        lineStride,
      })
    }

    renderedLineSets.forEach((line, index) => {
      const pointLimit = isPlaybackMode
        ? PLAYBACK_MAX_STREAMLINE_POINTS_PER_LINE
        : MAX_STREAMLINE_POINTS_PER_LINE
      const points = resamplePointsToLimit(
        resampleStreamlinePoints(
          line
            .map((point) => streamlineRawCmToWorldMeters(point))
            .filter(
              (v) =>
                Number.isFinite(v.x) &&
                Number.isFinite(v.y) &&
                Number.isFinite(v.z),
            ),
        ),
        pointLimit,
      )
      if (points.length < 2) return
      const curve = new THREE.CatmullRomCurve3(points)
      curves.push(curve)
      const hsl = { h: 0, s: 0, l: 0 }
      baseColor.getHSL(hsl)

      let mesh = null
      if (isPlaybackMode) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points)
        const colors = new Float32Array(points.length * 3)
        for (let i = 0; i < points.length; i += 1) {
          const approxT = i / Math.max(points.length - 1, 1)
          const brightness = 1.18 - approxT * 0.52
          const c = new THREE.Color().setHSL(
            hsl.h,
            Math.min(hsl.s * 0.92, 1),
            hsl.l * brightness,
          )
          colors[i * 3] = c.r
          colors[i * 3 + 1] = c.g
          colors[i * 3 + 2] = c.b
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        const material = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: STREAMLINE_PLAYBACK_OPACITY,
          depthWrite: false,
          depthTest: true,
        })
        mesh = new THREE.Line(geometry, material)
      } else {
        const tubularSegments = resolveTubularSegments(points.length)
        const radialSegments = 8
        const geometry = new THREE.TubeGeometry(
          curve,
          tubularSegments,
          STREAMLINE_RADIUS * lineWidth,
          radialSegments,
          false,
        )
        const posAttr = geometry.getAttribute('position')
        const colors = new Float32Array(posAttr.count * 3)
        for (let i = 0; i < posAttr.count; i++) {
          const segIndex = Math.floor(i / (radialSegments + 1))
          const approxT = segIndex / tubularSegments
          const brightness = 1.18 - approxT * 0.52
          const c = new THREE.Color().setHSL(
            hsl.h,
            Math.min(hsl.s * 0.92, 1),
            hsl.l * brightness,
          )
          colors[i * 3] = c.r
          colors[i * 3 + 1] = c.g
          colors[i * 3 + 2] = c.b
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        const material = new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: STREAMLINE_OPACITY,
          depthWrite: true,
          depthTest: true,
          side: THREE.DoubleSide,
        })
        mesh = new THREE.Mesh(geometry, material)
      }
      mesh.renderOrder = 500
      mesh.userData.lineIndex = index
      group.add(mesh)
      meshes.push(mesh)

      // 末端添加箭头
      addStreamlineDecorators(
        group,
        curve,
        streamlineColor,
        lineWidth,
        renderedSeedKeys,
      )
    })
    if (!meshes.length) return { group: null, lines: [] }

    streamlineCurves = curves

    return { group, lines: meshes }
  }

  function buildFallback() {
    clearGroup(getDynamicGroup?.())
    streamlineLines = []
    streamlineGroup = null
    streamlineCurves = []

    const streamlineColor =
      getVisualization()?.streamline?.color || DEFAULT_STREAMLINE_COLOR
    const baseColor = new THREE.Color(streamlineColor)
    const lineWidth =
      Number(getVisualization()?.streamline?.line_width) ||
      DEFAULT_STREAMLINE_LINE_WIDTH
    const lineCount = Math.max(
      8,
      Math.min(36, Number(getVisualization()?.streamline?.seed_count) || 16),
    )
    const group = new THREE.Group()
    const curves = []
    const renderedSeedKeys = new Set()
    for (let index = 0; index < lineCount; index += 1) {
      const radius = 1.1 + (index % 6) * 0.28
      const points = []
      for (let step = 0; step <= 48; step += 1) {
        const t = step / 48
        const angle = t * Math.PI * 3.2 + index * 0.42
        points.push(
          new THREE.Vector3(
            Math.cos(angle) * radius * (0.55 + t * 0.5),
            (t - 0.5) * 4.2 + Math.sin(index * 0.6) * 0.2,
            Math.sin(angle) * radius,
          ),
        )
      }
      const curve = new THREE.CatmullRomCurve3(points)
      curves.push(curve)
      const geometry = new THREE.TubeGeometry(
        curve,
        120,
        STREAMLINE_RADIUS * lineWidth,
        8,
        false,
      )

      // 渐变色
      const posAttr = geometry.getAttribute('position')
      const colors = new Float32Array(posAttr.count * 3)
      const tubularSegments = 120
      const radialSegments = 8
      const hsl = { h: 0, s: 0, l: 0 }
      baseColor.getHSL(hsl)
      for (let i = 0; i < posAttr.count; i++) {
        const segIndex = Math.floor(i / (radialSegments + 1))
        const approxT = segIndex / tubularSegments
        const brightness = 1.18 - approxT * 0.52
        const c = new THREE.Color().setHSL(
          hsl.h,
          Math.min(hsl.s * 0.92, 1),
          hsl.l * brightness,
        )
        colors[i * 3] = c.r
        colors[i * 3 + 1] = c.g
        colors[i * 3 + 2] = c.b
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: STREAMLINE_OPACITY,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 500
      mesh.userData.lineIndex = index
      streamlineLines.push(mesh)
      group.add(mesh)

      addStreamlineDecorators(
        group,
        curve,
        streamlineColor,
        lineWidth,
        renderedSeedKeys,
      )
    }
    getDynamicGroup?.()?.add(group)
    streamlineGroup = group
    lastLineWidth = lineWidth
    lastStreamlineColor = streamlineColor

    const seedGeometry = new THREE.SphereGeometry(0.05, 16, 16)
    const seedMaterial = new THREE.MeshBasicMaterial({
      color: streamlineColor,
      transparent: true,
      opacity: 0.65,
    })
    for (let index = 0; index < Math.min(24, lineCount); index += 1) {
      const seed = new THREE.Mesh(seedGeometry, seedMaterial.clone())
      const angle = (index / Math.min(24, lineCount)) * Math.PI * 2
      seed.position.set(
        Math.cos(angle) * 1.4,
        -1.8 + (index % 4) * 0.25,
        Math.sin(angle) * 1.4,
      )
      group.add(seed)
    }
    streamlineCurves = curves
    syncStreamlineSmoke()
  }

  function resolveStreamlineDataUrl(payload, forceFirstFrame = false) {
    if (!payload) return ''
    const safeIndex = forceFirstFrame
      ? 0
      : (() => {
          const currentTimeStep = Number(getCurrentTimeStep?.())
          // 优先使用 csv_time_steps 数组查找索引（自动加载合并后的时间步列表）
          const timeStepArray = Array.isArray(payload.csv_time_steps)
            ? payload.csv_time_steps
            : Array.isArray(payload.time_step)
              ? payload.time_step
              : null
          const indexByTimeStep = Array.isArray(timeStepArray)
            ? timeStepArray.findIndex(
                (item) => Number(item) === currentTimeStep,
              )
            : -1
          if (indexByTimeStep >= 0) return indexByTimeStep
          // fallback：用时间轴滑块索引
          const stepIndex =
            typeof getCurrentStepIndex === 'function'
              ? getCurrentStepIndex()
              : null
          if (Number.isFinite(stepIndex) && stepIndex >= 0) return stepIndex
          return 0
        })()
    const candidateLists = [
      payload.urls,
      payload.csv_urls,
      payload.streamline_urls,
      payload.frame_urls,
      payload.data_urls,
    ]
    for (const list of candidateLists) {
      if (Array.isArray(list) && list.length) {
        return String(list[safeIndex] || list[0] || '').trim()
      }
    }
    if (typeof payload.url === 'string' && payload.url.trim())
      return payload.url.trim()
    if (typeof payload.csv_url === 'string' && payload.csv_url.trim())
      return payload.csv_url.trim()
    return ''
  }

  function resolveStreamlineSourceKey(payload) {
    if (!payload || typeof payload !== 'object') return ''
    const selectedUrl = resolveStreamlineDataUrl(payload)
    if (selectedUrl) return selectedUrl
    return `inline:${String(getCurrentTimeStep?.() ?? '')}:${String(
      getCurrentStepIndex?.() ?? '',
    )}`
  }

  async function loadDataFromPayload(payload, forceFirstFrame = false) {
    if (!payload) return []
    const dataUrl = resolveStreamlineDataUrl(payload, forceFirstFrame)
    if (dataUrl) {
      if (lineSetCache.has(dataUrl)) {
        return lineSetCache.get(dataUrl)
      }
      if (inflightLineSetRequests.has(dataUrl)) {
        return inflightLineSetRequests.get(dataUrl)
      }
      const request = (async () => {
        const raw = await fetchStructuredResource(dataUrl)
        return rememberLineSets(dataUrl, normalizeStreamlineLineSets(raw))
      })()
      inflightLineSetRequests.set(dataUrl, request)
      try {
        return await request
      } finally {
        inflightLineSetRequests.delete(dataUrl)
      }
    }
    return normalizeStreamlineLineSets(payload)
  }

  async function sync() {
    const dynamicGroup = getDynamicGroup?.()
    const isEnabled =
      typeof getIsEnabled === 'function'
        ? getIsEnabled()
        : getSceneMode() === 'streamline'
    const isVisible = typeof getIsVisible === 'function' ? getIsVisible() : true
    if (!dynamicGroup) return
    if (!isEnabled || !isVisible) {
      clearRenderedStreamlines()
      return
    }
    const payload = getActiveStreamlinePayload()
    const token = ++streamlineSyncToken
    if (!payload) {
      clearRenderedStreamlines()
      return
    }
    const streamlineSourceKey = resolveStreamlineSourceKey(payload)
    if (streamlineSourceKey) {
      lastStreamlineSourceKey = streamlineSourceKey
    }
    try {
      const lineSets = await loadDataFromPayload(payload)
      if (token !== streamlineSyncToken) {
        return
      }
      clearRenderedStreamlines()
      const { group, lines } = buildStreamlineMeshes(lineSets)
      if (token !== streamlineSyncToken) {
        if (group) {
          disposeObjectMaterials(group)
        }
        return
      }
      if (group && lines.length) {
        streamlineLines = lines
        streamlineGroup = group
        lastLineWidth = Math.max(
          MIN_STREAMLINE_LINE_WIDTH,
          Number(getVisualization()?.streamline?.line_width) ||
            DEFAULT_STREAMLINE_LINE_WIDTH,
        )
        lastStreamlineColor =
          getVisualization()?.streamline?.color || DEFAULT_STREAMLINE_COLOR
        dynamicGroup.add(group)
        syncStreamlineSmoke()
        scheduleStreamlineCachePrewarm(payload)
        return
      }
    } catch (error) {
      console.warn(
        'Failed to render streamline payload in ThreeVisualizationCanvas:',
        error,
      )
    }
  }

  /**
   * 用已有曲线重建管道几何体（线宽变化时调用，无需重新加载数据）
   */
  function rebuildStreamlineGeometry() {
    if (!streamlineCurves.length || !streamlineGroup) return
    const lineWidth = lastLineWidth
    const streamlineColor =
      getVisualization()?.streamline?.color || DEFAULT_STREAMLINE_COLOR
    const baseColor = new THREE.Color(streamlineColor)
    const hsl = { h: 0, s: 0, l: 0 }
    baseColor.getHSL(hsl)

    // 清除旧的管道和箭头
    const toRemove = []
    streamlineGroup.children.forEach((child) => {
      toRemove.push(child)
    })
    toRemove.forEach((child) => {
      streamlineGroup.remove(child)
      disposeObjectMaterials(child)
    })

    const newMeshes = []
    const renderedSeedKeys = new Set()
    streamlineCurves.forEach((curve, index) => {
      const points = curve.points
      if (!points || points.length < 2) return

      const tubularSegments = resolveTubularSegments(points.length)
      const radialSegments = 8
      const geometry = new THREE.TubeGeometry(
        curve,
        tubularSegments,
        STREAMLINE_RADIUS * lineWidth,
        radialSegments,
        false,
      )

      // 渐变色
      const posAttr = geometry.getAttribute('position')
      const colors = new Float32Array(posAttr.count * 3)
      for (let i = 0; i < posAttr.count; i++) {
        const segIndex = Math.floor(i / (radialSegments + 1))
        const approxT = segIndex / tubularSegments
        const brightness = 1.18 - approxT * 0.52
        const c = new THREE.Color().setHSL(
          hsl.h,
          Math.min(hsl.s * 0.92, 1),
          hsl.l * brightness,
        )
        colors[i * 3] = c.r
        colors[i * 3 + 1] = c.g
        colors[i * 3 + 2] = c.b
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: STREAMLINE_OPACITY,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 500
      mesh.userData.lineIndex = index
      streamlineGroup.add(mesh)
      newMeshes.push(mesh)

      addStreamlineDecorators(
        streamlineGroup,
        curve,
        streamlineColor,
        lineWidth,
        renderedSeedKeys,
      )
    })

    streamlineLines = newMeshes
    syncStreamlineSmoke()
  }

  function updateStreamlineMaterials() {
    if (!streamlineGroup) return
    const newWidth = Math.max(
      MIN_STREAMLINE_LINE_WIDTH,
      Number(getVisualization()?.streamline?.line_width) ||
        DEFAULT_STREAMLINE_LINE_WIDTH,
    )
    const newColor =
      getVisualization()?.streamline?.color || DEFAULT_STREAMLINE_COLOR
    const widthChanged = newWidth !== lastLineWidth
    const colorChanged = newColor !== lastStreamlineColor
    if (!widthChanged && !colorChanged) return
    if (pendingGeometryRebuildTimer) {
      clearTimeout(pendingGeometryRebuildTimer)
      pendingGeometryRebuildTimer = null
    }
    // 线宽变化需要重建几何体（TubeGeometry 半径是几何属性，不能通过缩放修改）
    if (widthChanged && streamlineCurves.length > 0) {
      lastLineWidth = newWidth
      pendingGeometryRebuildTimer = setTimeout(() => {
        pendingGeometryRebuildTimer = null
        rebuildStreamlineGeometry()
      }, 120)
    }
    if (!colorChanged) return
    lastStreamlineColor = newColor
    const baseColor = new THREE.Color(newColor)
    const hsl = { h: 0, s: 0, l: 0 }
    baseColor.getHSL(hsl)
    streamlineLines.forEach((line) => {
      if (line.material) {
        // 更新渐变色顶点颜色
        if (line.geometry?.getAttribute('color')) {
          const colorAttr = line.geometry.getAttribute('color')
          const tubularSegments = Math.floor(colorAttr.count / 9) || 120
          const radialSegments = 8
          for (let i = 0; i < colorAttr.count; i++) {
            const segIndex = Math.floor(i / (radialSegments + 1))
            const approxT = segIndex / tubularSegments
            const brightness = 1.18 - approxT * 0.52
            const c = new THREE.Color().setHSL(
              hsl.h,
              Math.min(hsl.s * 0.92, 1),
              hsl.l * brightness,
            )
            colorAttr.setXYZ(i, c.r, c.g, c.b)
          }
          colorAttr.needsUpdate = true
        }
        line.material.needsUpdate = true
      }
    })
    syncStreamlineSmoke()
  }

  function tick(elapsed) {
    streamlineSmoke?.update(Number(elapsed) || 0)
  }

  function dispose() {
    if (pendingGeometryRebuildTimer) {
      clearTimeout(pendingGeometryRebuildTimer)
      pendingGeometryRebuildTimer = null
    }
    clearRenderedStreamlines()
    if (smokeTexture) {
      smokeTexture.dispose()
      smokeTexture = null
    }
    prewarmToken += 1
    lastPrewarmKey = ''
    streamlineSyncToken += 1
    lastStreamlineSourceKey = ''
  }

  return {
    buildFallback,
    sync,
    tick,
    dispose,
    updateStreamlineMaterials,
  }
}
