import { THREE, clearGroup } from './shared'
import {
  collectRadarWaveObstacleUvSegments,
  worldPointToPlaneUv01,
} from '@/utils/radarSliceAlphaMask.js'
import {
  RADAR_PLANE_WAVE_VERTEX_SHADER,
  RADAR_PLANE_WAVE_FRAGMENT_SHADER,
} from '@/utils/radarPlaneWaveShader.js'

function parsePlaneSelection(layer) {
  const id = String(layer?.id || '')
  const parts = id.split(':')
  if (parts[0] === 'radar_wave') {
    return {
      plane: parts[2] || 'xy',
      coordinate: Number(parts[3]),
    }
  }
  if (
    parts[0] === 'vector' ||
    parts[0] === 'cloud' ||
    parts[0] === 'contour' ||
    parts[0] === 'radar_cloud' ||
    parts[0] === 'radar_wavefront_cloud' ||
    parts[0] === 'radar_wavefront' ||
    parts[0] === 'radar_heatmap'
  ) {
    return {
      plane: parts[2] || 'xy',
      coordinate: Number(parts[3]),
    }
  }
  return {
    plane: 'xy',
    coordinate: 0,
  }
}

function isRadarPlaneLayerKind(kind) {
  return (
    kind === 'radar_cloud' ||
    kind === 'radar_wavefront_cloud' ||
    kind === 'radar_wavefront' ||
    kind === 'radar_heatmap'
  )
}

function shouldRotateRadarCloudTexture(kind) {
  return kind === 'radar_cloud' || kind === 'radar_wavefront_cloud'
}

function setPlaneTransform(
  group,
  plane,
  coordinateMeters,
  centerMeters = { x: 0, y: 0, z: 0 },
) {
  const basisMatrix = new THREE.Matrix4()
  if (plane === 'xz') {
    basisMatrix.makeBasis(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    )
    group.setRotationFromMatrix(basisMatrix)
    group.position.set(centerMeters.x, coordinateMeters, centerMeters.z)
  } else if (plane === 'yz') {
    basisMatrix.makeBasis(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
    )
    group.setRotationFromMatrix(basisMatrix)
    group.position.set(coordinateMeters, centerMeters.y, centerMeters.z)
  } else {
    basisMatrix.makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    )
    group.setRotationFromMatrix(basisMatrix)
    group.position.set(centerMeters.x, centerMeters.y, coordinateMeters)
  }
}

/**
 * @param {{ kind?: string }} [opts]
 * 雷达云图为连续栅格占位图：线性滤波避免视口缩放时严重块状马赛克；等值线/SVG 仍用最近邻保持边缘锐利。
 */
function configureTexture(texture, renderer, opts = {}) {
  const kind = String(opts.kind || '').toLowerCase()
  const smoothSampling = isRadarPlaneLayerKind(kind)

  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = smoothSampling ? THREE.LinearFilter : THREE.NearestFilter
  texture.magFilter = smoothSampling ? THREE.LinearFilter : THREE.NearestFilter
  /* 雷达云图为 Canvas PNG 不透明图：premultiply 易与 MeshBasicMaterial+alphaTest 叠出暗/透错误；等值线图仍按需预乘 */
  texture.premultiplyAlpha = !isRadarPlaneLayerKind(kind)
  texture.anisotropy = renderer?.capabilities.getMaxAnisotropy?.() || 1

  /* 雷达云图：按平面物理长宽比与图片长宽比对齐 UV（cover，铺满平面并保持像素比例，多出的边裁掉） */
  if (isRadarPlaneLayerKind(kind)) {
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.repeat.set(1, 1)
    texture.offset.set(0, 0)
    texture.center.set(0.5, 0.5)
    texture.rotation = shouldRotateRadarCloudTexture(kind) ? -Math.PI / 2 : 0
    const pw = Number(opts.planeWidthM)
    const ph = Number(opts.planeHeightM)
    const img = texture.image
    const iw = img?.naturalWidth || img?.width
    const ih = img?.naturalHeight || img?.height
    if (
      Number.isFinite(pw) &&
      Number.isFinite(ph) &&
      pw > 1e-9 &&
      ph > 1e-9 &&
      iw > 0 &&
      ih > 0
    ) {
      const pa = pw / ph
      const ia = shouldRotateRadarCloudTexture(kind) ? ih / iw : iw / ih
      const arTol = 0.002
      if (ia > pa * (1 + arTol)) {
        const k = pa / ia
        texture.repeat.set(k, 1)
        texture.offset.set((1 - k) / 2, 0)
      } else if (ia * (1 + arTol) < pa) {
        const k = ia / pa
        texture.repeat.set(1, k)
        texture.offset.set(0, (1 - k) / 2)
      }
    }
  }

  texture.needsUpdate = true
}

function configurePlaneMaterialForOverlay(material, hasTexture = false) {
  material.depthWrite = false
  material.depthTest = true // 启用深度测试，但禁用深度写入
  material.transparent = true
  material.needsUpdate = true
}

function getLayerKind(layer) {
  return String(layer?.kind || '').toLowerCase()
}

function getOverlayRenderOrderByKind(layer) {
  const kind = getLayerKind(layer)
  if (kind === 'vector') return 300
  if (kind === 'radar_wave') return 240
  if (kind === 'contour' || isRadarPlaneLayerKind(kind)) return 220
  if (kind === 'cloud') return 200
  return 180
}

function applyLayerOverlayStyle(entry) {
  if (!entry?.planeMesh?.material) return
  const kind = getLayerKind(entry.layer)
  const isVectorLayer = kind === 'vector'
  const material = entry.planeMesh.material

  // 矢量层关闭深度测试，保证叠加在云图/等值线之上
  material.depthWrite = false
  material.depthTest = !isVectorLayer ? true : false
  material.transparent = true
  material.needsUpdate = true

  entry.planeMesh.renderOrder = getOverlayRenderOrderByKind(entry.layer)
}

export function createPlaneMode(options) {
  const {
    getDynamicGroup,
    getSceneMode,
    getVisualization,
    getVisibleLayers,
    getTextureUrlForLayer,
    getRenderer,
    getPhysicalWidth,
    getPhysicalHeight,
    getActiveLayer,
    getSelectedPlane,
    getPlaneCoordinate,
    getGhostPlaneEnabled,
    getGeometricCenter,
    getGeometryBounds,
    getMeshesForRadarSliceMask,
    getIsPlaying,
    getRadarWaveTime,
  } = options

  const textureLoader = new THREE.TextureLoader()
  textureLoader.crossOrigin = 'anonymous'

  const planeEntries = new Map()
  let ghostPlaneEntry = null
  let forceGhostPreview = false

  function normalizeBounds(rawBounds) {
    const bounds = rawBounds?.data || rawBounds
    if (!bounds || typeof bounds !== 'object') return null

    const minX = Number(bounds.xmin ?? bounds.x_min)
    const maxX = Number(bounds.xmax ?? bounds.x_max)
    const minY = Number(bounds.ymin ?? bounds.y_min)
    const maxY = Number(bounds.ymax ?? bounds.y_max)
    const minZ = Number(bounds.zmin ?? bounds.z_min)
    const maxZ = Number(bounds.zmax ?? bounds.z_max)

    if (
      [minX, maxX, minY, maxY, minZ, maxZ].every((value) =>
        Number.isFinite(value),
      )
    ) {
      return { minX, maxX, minY, maxY, minZ, maxZ }
    }

    return null
  }

  function resolvePlaneCoordinateMeters(plane, coordinate) {
    const coordinateMeters = (Number(coordinate) || 0) / 100
    return coordinateMeters
  }

  function normalizeCenter(rawCenter) {
    if (!Array.isArray(rawCenter) || rawCenter.length < 3) return null
    const [x, y, z] = rawCenter.map((value) => Number(value) / 100)
    if (![x, y, z].every((value) => Number.isFinite(value))) return null
    return { x, y, z }
  }

  function resolveBoundsCenter(bounds) {
    if (!bounds) return null
    return {
      x: (bounds.minX + bounds.maxX) / 200,
      y: (bounds.minY + bounds.maxY) / 200,
      z: (bounds.minZ + bounds.maxZ) / 200,
    }
  }

  function resolvePlaneCenter(layer = null) {
    const boundsCenter = resolveBoundsCenter(
      normalizeBounds(getGeometryBounds?.()),
    )
    if (boundsCenter) {
      return boundsCenter
    }

    const frameCenter = normalizeCenter(
      layer?.images?.[0]?.data?.geometric_center ??
        layer?.images?.[0]?.data?.geometricCenter,
    )
    if (frameCenter) {
      return frameCenter
    }

    const propCenter = normalizeCenter(getGeometricCenter?.())
    if (propCenter) return propCenter

    return { x: 0, y: 0, z: 0 }
  }

  function disposeTexture(texture) {
    texture?.dispose?.()
  }

  function disposeEntry(entry) {
    if (!entry) return
    disposeTexture(entry.currentTexture)
    entry.currentTexture = null
    entry.pendingTextureUrl = ''
    entry.lastTextureUrl = ''
    entry.textureRequestId += 1
    if (entry.planeMesh?.material?.isShaderMaterial) {
      entry.planeMesh.material.dispose()
    }
  }

  function removeEntry(entry) {
    if (!entry) return
    disposeEntry(entry)
    entry.group?.removeFromParent?.()
    if (entry.group) {
      clearGroup(entry.group)
    }
  }

  function resolveLayerPhysicalDimension(layer, axis) {
    if (!layer) return null
    const directValue =
      axis === 'width' ? layer.physicalWidth : layer.physicalHeight
    const directNum = Number(directValue)
    if (Number.isFinite(directNum) && directNum > 0) return directNum

    const firstFrame = Array.isArray(layer.images) ? layer.images[0] : null
    const frameValue =
      axis === 'width'
        ? (firstFrame?.data?.physical_width ?? firstFrame?.data?.physicalWidth)
        : (firstFrame?.data?.physical_height ??
          firstFrame?.data?.physicalHeight)
    const frameNum = Number(frameValue)
    return Number.isFinite(frameNum) && frameNum > 0 ? frameNum : null
  }

  function resolvePlaneSize(layer = null) {
    const plane = String(
      parsePlaneSelection(layer || getActiveLayer?.() || {}).plane || 'xy',
    ).toLowerCase()

    // 优先使用包围盒数据以确保所有可视化类型对齐
    const bounds = normalizeBounds(getGeometryBounds?.())
    if (bounds) {
      if (plane === 'xz') {
        return {
          physicalWidth: bounds.maxX - bounds.minX,
          physicalHeight: bounds.maxZ - bounds.minZ,
          planeWidth: (bounds.maxX - bounds.minX) / 100,
          planeHeight: (bounds.maxZ - bounds.minZ) / 100,
        }
      }
      if (plane === 'yz') {
        return {
          physicalWidth: bounds.maxY - bounds.minY,
          physicalHeight: bounds.maxZ - bounds.minZ,
          planeWidth: (bounds.maxY - bounds.minY) / 100,
          planeHeight: (bounds.maxZ - bounds.minZ) / 100,
        }
      }
      return {
        physicalWidth: bounds.maxX - bounds.minX,
        physicalHeight: bounds.maxY - bounds.minY,
        planeWidth: (bounds.maxX - bounds.minX) / 100,
        planeHeight: (bounds.maxY - bounds.minY) / 100,
      }
    }

    // 回退：使用图层数据
    const physicalWidth = layer
      ? resolveLayerPhysicalDimension(layer, 'width')
      : getPhysicalWidth?.(null)
    const physicalHeight = layer
      ? resolveLayerPhysicalDimension(layer, 'height')
      : getPhysicalHeight?.(null)

    if (
      Number.isFinite(Number(physicalWidth)) &&
      Number.isFinite(Number(physicalHeight)) &&
      Number(physicalWidth) > 0 &&
      Number(physicalHeight) > 0
    ) {
      return {
        physicalWidth: Number(physicalWidth),
        physicalHeight: Number(physicalHeight),
        planeWidth: Number(physicalWidth) / 100,
        planeHeight: Number(physicalHeight) / 100,
      }
    }

    // 最终回退值
    return {
      physicalWidth: 620,
      physicalHeight: 620,
      planeWidth: 6.2,
      planeHeight: 6.2,
    }
  }

  function replacePlaneGeometry(mesh, width, height) {
    if (!mesh) return
    const geometry = new THREE.PlaneGeometry(width, height)
    mesh.geometry?.dispose?.()
    mesh.geometry = geometry
  }

  function updateEntryGeometry(entry, layer = null) {
    if (!entry) return
    const kind = getLayerKind(layer || entry.layer)
    if (kind === 'radar_wave') {
      entry.radarWaveObstaclesSynced = false
    }
    const { planeWidth, planeHeight } = resolvePlaneSize(layer || entry.layer)
    replacePlaneGeometry(entry.planeMesh, planeWidth, planeHeight)
    replacePlaneGeometry(
      entry.planeFrame,
      planeWidth * 1.01,
      planeHeight * 1.01,
    )
    if (isRadarPlaneLayerKind(kind) && entry.currentTexture) {
      configureTexture(entry.currentTexture, getRenderer?.(), {
        kind,
        planeWidthM: planeWidth,
        planeHeightM: planeHeight,
      })
    }
  }

  function logPlaneLayerMetrics(layers) {
    if (!Array.isArray(layers) || !layers.length) {
      return
    }

    const summary = layers.map((layer) => {
      const selection = parsePlaneSelection(layer)
      const size = resolvePlaneSize(layer)
      return {
        id: String(layer?.id || ''),
        kind: String(layer?.kind || ''),
        plane: selection.plane,
        coordinateCm: Number(selection.coordinate) || 0,
        centerX: Number(resolvePlaneCenter(layer).x.toFixed(3)),
        centerY: Number(resolvePlaneCenter(layer).y.toFixed(3)),
        centerZ: Number(resolvePlaneCenter(layer).z.toFixed(3)),
        layerPhysicalWidth: Number(
          layer?.physicalWidth ?? layer?.images?.[0]?.data?.physical_width ?? 0,
        ),
        layerPhysicalHeight: Number(
          layer?.physicalHeight ??
            layer?.images?.[0]?.data?.physical_height ??
            0,
        ),
        widthM: Number(size.planeWidth?.toFixed?.(3) ?? size.planeWidth),
        heightM: Number(size.planeHeight?.toFixed?.(3) ?? size.planeHeight),
        widthCm: Number((size.planeWidth * 100).toFixed(1)),
        heightCm: Number((size.planeHeight * 100).toFixed(1)),
      }
    })

    console.table(summary)
  }

  function createGhostPlane() {
    const activeLayer = getActiveLayer?.() || null
    const { planeWidth, planeHeight } = resolvePlaneSize(activeLayer)

    const group = new THREE.Group()

    // 虚拟平面 - 半透明蓝色
    const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight)
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: '#00d4ff',
      transparent: true,
      opacity: 0.08,
      alphaTest: 0.001,
      depthWrite: false, // 禁用深度写入，让后面的物体可以透过
      depthTest: true, // 启用深度测试
      side: THREE.DoubleSide,
    })
    planeMaterial.toneMapped = false
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.renderOrder = 0
    group.add(planeMesh)

    // 虚拟平面边框 - 虚线效果
    const frameGeometry = new THREE.PlaneGeometry(
      planeWidth * 1.005,
      planeHeight * 1.005,
    )
    const frameMaterial = new THREE.MeshBasicMaterial({
      color: '#00d4ff',
      wireframe: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false, // 禁用深度写入
      depthTest: true, // 启用深度测试
    })
    const planeFrame = new THREE.Mesh(frameGeometry, frameMaterial)
    planeFrame.position.z = -0.005
    planeFrame.renderOrder = 1
    group.add(planeFrame)

    // 中心点标记
    const centerGeometry = new THREE.RingGeometry(0.08, 0.12, 32)
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: '#00d4ff',
      transparent: true,
      opacity: 0.6,
      depthWrite: false, // 禁用深度写入
      depthTest: true, // 启用深度测试
      side: THREE.DoubleSide,
    })
    const centerMarker = new THREE.Mesh(centerGeometry, centerMaterial)
    centerMarker.position.z = 0.01
    centerMarker.renderOrder = 2
    group.add(centerMarker)

    // 坐标轴标记
    const axisLength = Math.min(planeWidth, planeHeight) * 0.15
    const axisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(axisLength, 0, 0),
    ])
    const xAxisMaterial = new THREE.LineBasicMaterial({
      color: '#ff4444',
      transparent: true,
      opacity: 0.5,
    })
    const xAxis = new THREE.Line(axisGeometry, xAxisMaterial)
    group.add(xAxis)

    const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, axisLength, 0),
    ])
    const yAxisMaterial = new THREE.LineBasicMaterial({
      color: '#44ff44',
      transparent: true,
      opacity: 0.5,
    })
    const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial)
    group.add(yAxis)

    const plane = getSelectedPlane?.() || 'xy'
    const coordinate = getPlaneCoordinate?.() || 0
    setPlaneTransform(
      group,
      plane,
      resolvePlaneCoordinateMeters(plane, coordinate),
      resolvePlaneCenter(activeLayer),
    )
    getDynamicGroup?.()?.add(group)

    return {
      group,
      planeMesh,
      planeFrame,
      centerMarker,
    }
  }

  function updateGhostPlane() {
    const ghostEnabled = getGhostPlaneEnabled?.() !== false
    if (!ghostEnabled) {
      removeGhostPlane()
      return
    }

    const plane = getSelectedPlane?.() || 'xy'
    const coordinate = getPlaneCoordinate?.() || 0
    const hasVisibleDataPlane =
      planeEntries.size > 0 &&
      Array.from(planeEntries.values()).some((e) => e.group.visible)

    // 如果有可见的数据平面，默认隐藏虚拟平面；预览模式下仍显示引导平面
    if (hasVisibleDataPlane && !forceGhostPreview) {
      if (ghostPlaneEntry) {
        ghostPlaneEntry.group.visible = false
      }
      return
    }

    // 没有数据平面时，显示/更新虚拟平面
    if (!ghostPlaneEntry) {
      ghostPlaneEntry = createGhostPlane()
    } else {
      updateEntryGeometry(ghostPlaneEntry, getActiveLayer?.() || null)
      // 更新位置和旋转
      setPlaneTransform(
        ghostPlaneEntry.group,
        plane,
        Number(coordinate) / 100,
        resolvePlaneCenter(getActiveLayer?.() || null),
      )
      ghostPlaneEntry.group.visible = true
    }
  }

  function removeGhostPlane() {
    if (ghostPlaneEntry) {
      ghostPlaneEntry.group?.removeFromParent?.()
      clearGroup(ghostPlaneEntry.group)
      ghostPlaneEntry = null
    }
  }

  function makeRadarWavePlaneMaterial() {
    const uLines = []
    for (let i = 0; i < 8; i++) {
      uLines.push(new THREE.Vector4(0, 0, 0, 0))
    }
    return new THREE.ShaderMaterial({
      uniforms: {
        uRadarWaveTime: { value: 0 },
        uSource: { value: new THREE.Vector2(0.5, 0.5) },
        uLines: { value: uLines },
        uLineCount: { value: 0 },
      },
      vertexShader: RADAR_PLANE_WAVE_VERTEX_SHADER,
      fragmentShader: RADAR_PLANE_WAVE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    })
  }

  function syncRadarWaveObstaclesAndSource(entry) {
    const mesh = entry.planeMesh
    const mat = mesh?.material
    if (!mat?.uniforms) return
    const meshes = getMeshesForRadarSliceMask?.() || []
    if (meshes.length && !entry.radarWaveObstaclesSynced) {
      const { segments, lineCount } = collectRadarWaveObstacleUvSegments(
        mesh,
        meshes,
        24,
      )
      for (let i = 0; i < 8; i++) {
        const seg = segments[i]
        if (seg) {
          mat.uniforms.uLines.value[i].set(seg[0], seg[1], seg[2], seg[3])
        } else {
          mat.uniforms.uLines.value[i].set(0, 0, 0, 0)
        }
      }
      mat.uniforms.uLineCount.value = Math.min(8, lineCount)
      entry.radarWaveObstaclesSynced = true
    }
    const origin = new THREE.Vector3(0, 0, 0)
    const uv = worldPointToPlaneUv01(origin, mesh)
    mat.uniforms.uSource.value.set(
      THREE.MathUtils.clamp(uv.u, 0.02, 0.98),
      THREE.MathUtils.clamp(uv.v, 0.02, 0.98),
    )
    mat.uniforms.uRadarWaveTime.value =
      Number(getRadarWaveTime?.() ?? 0) || 0
  }

  function syncRadarWaveTime(entry, elapsed = 0) {
    const mat = entry?.planeMesh?.material
    if (!mat?.uniforms?.uRadarWaveTime) return
    const timelineTime = Number(getRadarWaveTime?.() ?? 0) || 0
    const liveTime =
      getIsPlaying?.() && Number.isFinite(elapsed) ? elapsed : 0
    mat.uniforms.uRadarWaveTime.value = timelineTime + liveTime * 0.9
  }

  function makeRadarWavePlaneEntry(layer) {
    const { planeWidth, planeHeight } = resolvePlaneSize(layer)

    const group = new THREE.Group()
    const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight)
    const planeMaterial = makeRadarWavePlaneMaterial()
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.renderOrder = getOverlayRenderOrderByKind(layer)
    group.add(planeMesh)

    const frameGeometry = new THREE.PlaneGeometry(
      planeWidth * 1.01,
      planeHeight * 1.01,
    )
    const frameMaterial = new THREE.MeshBasicMaterial({
      color: '#5ee0ff',
      wireframe: true,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      depthTest: true,
    })
    const planeFrame = new THREE.Mesh(frameGeometry, frameMaterial)
    planeFrame.position.z = -0.01
    planeFrame.renderOrder = Math.max(0, planeMesh.renderOrder - 1)
    group.add(planeFrame)

    const { plane, coordinate } = parsePlaneSelection(layer)
    setPlaneTransform(
      group,
      plane,
      resolvePlaneCoordinateMeters(plane, coordinate),
      resolvePlaneCenter(layer),
    )
    getDynamicGroup?.()?.add(group)

    return {
      id: String(layer.id),
      layer,
      group,
      planeMesh,
      planeFrame,
      ringPulse: null,
      currentTexture: null,
      lastTextureUrl: '',
      pendingTextureUrl: '',
      textureRequestId: 0,
      radarWaveObstaclesSynced: false,
    }
  }

  function makePlaneEntry(layer) {
    if (getLayerKind(layer) === 'radar_wave') {
      return makeRadarWavePlaneEntry(layer)
    }
    const { planeWidth, planeHeight } = resolvePlaneSize(layer)

    const group = new THREE.Group()
    const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight)
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: '#d8f2ff',
      transparent: true,
      opacity: 0.18,
      alphaTest: 0.001,
      depthWrite: false, // 禁用深度写入，让后面的物体可以透过
      depthTest: true, // 启用深度测试
      side: THREE.DoubleSide,
    })
    planeMaterial.toneMapped = false
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    // 设置渲染顺序，确保平面按添加顺序渲染
    planeMesh.renderOrder = 1
    group.add(planeMesh)

    const frameGeometry = new THREE.PlaneGeometry(
      planeWidth * 1.01,
      planeHeight * 1.01,
    )
    const frameMaterial = new THREE.MeshBasicMaterial({
      color: '#3abaf4',
      wireframe: true,
      transparent: true,
      opacity: 0.16,
      depthWrite: false, // 禁用深度写入
      depthTest: true, // 启用深度测试
    })
    const planeFrame = new THREE.Mesh(frameGeometry, frameMaterial)
    planeFrame.position.z = -0.01
    planeFrame.renderOrder = 2
    group.add(planeFrame)

    let ringPulse = null
    if (getSceneMode() !== 'vector') {
      const glowGeometry = new THREE.RingGeometry(2.5, 2.7, 96)
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: '#35b8ff',
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
      })
      ringPulse = new THREE.Mesh(glowGeometry, glowMaterial)
      ringPulse.rotation.x = Math.PI
      ringPulse.position.z = -0.03
      group.add(ringPulse)
    }

    const { plane, coordinate } = parsePlaneSelection(layer)
    setPlaneTransform(
      group,
      plane,
      resolvePlaneCoordinateMeters(plane, coordinate),
      resolvePlaneCenter(layer),
    )
    getDynamicGroup?.()?.add(group)

    return {
      id: String(layer.id),
      layer,
      group,
      planeMesh,
      planeFrame,
      ringPulse,
      currentTexture: null,
      lastTextureUrl: '',
      pendingTextureUrl: '',
      textureRequestId: 0,
    }
  }

  function buildScene() {
    const dynamicGroup = getDynamicGroup?.()
    if (!dynamicGroup) {
      console.warn(
        '[PlaneMode] buildScene called but dynamicGroup is not ready',
      )
      return
    }

    const visibleLayers = Array.isArray(getVisibleLayers?.())
      ? getVisibleLayers()
      : []
    const nextIds = new Set()

    visibleLayers.forEach((layer) => {
      if (!layer?.id) return
      const id = String(layer.id)
      const textureUrl = getTextureUrlForLayer?.(layer) || ''
      const isRadarWave = getLayerKind(layer) === 'radar_wave'
      nextIds.add(id)
      const existing = planeEntries.get(id)
      if (existing) {
        existing.layer = layer
        applyLayerOverlayStyle(existing)
        updateEntryGeometry(existing, layer)
        const { plane, coordinate } = parsePlaneSelection(layer)
        setPlaneTransform(
          existing.group,
          plane,
          resolvePlaneCoordinateMeters(plane, coordinate),
          resolvePlaneCenter(layer),
        )
        const willBeVisible = Boolean(
          textureUrl || existing.currentTexture || isRadarWave,
        )
        if (existing.group.visible !== willBeVisible) {
        }
        existing.group.visible = willBeVisible
        return
      }
      if (!textureUrl && !isRadarWave) return
      const entry = makePlaneEntry(layer)
      applyLayerOverlayStyle(entry)
      planeEntries.set(entry.id, entry)
    })

    Array.from(planeEntries.entries()).forEach(([id, entry]) => {
      if (nextIds.has(id)) return

      removeEntry(entry)
      planeEntries.delete(id)
    })

    // 更新虚拟平面状态
    updateGhostPlane()
    logPlaneLayerMetrics(visibleLayers)
  }

  function resetEntryToPlaceholder(entry) {
    entry.pendingTextureUrl = ''
    entry.textureRequestId += 1
    if (entry.currentTexture) {
      disposeTexture(entry.currentTexture)
      entry.currentTexture = null
    }
    entry.planeMesh.material.map = null
    entry.planeMesh.material.color.set('#d8f2ff')
    entry.planeMesh.material.opacity = 0.18
    // 保持叠加模式设置
    configurePlaneMaterialForOverlay(entry.planeMesh.material)
    applyLayerOverlayStyle(entry)
    entry.lastTextureUrl = ''
    entry.group.children.forEach((child) => {
      if (child !== entry.planeMesh) child.visible = true
    })
  }

  function syncTexture() {
    planeEntries.forEach((entry) => {
      if (!entry.planeMesh) return
      const { plane, coordinate } = parsePlaneSelection(entry.layer)
      setPlaneTransform(
        entry.group,
        plane,
        (Number(coordinate) || 0) / 100,
        resolvePlaneCenter(entry.layer),
      )

      if (getLayerKind(entry.layer) === 'radar_wave') {
        syncRadarWaveObstaclesAndSource(entry)
        entry.group.visible = true
        return
      }

      const url = getTextureUrlForLayer?.(entry.layer) || ''
      if (!url) {
        entry.group.visible = Boolean(entry.currentTexture)
        return
      }

      entry.group.visible = true

      if (entry.lastTextureUrl === url || entry.pendingTextureUrl === url)
        return

      entry.pendingTextureUrl = url
      const requestId = ++entry.textureRequestId
      textureLoader.load(
        url,
        (texture) => {
          if (
            !entry.planeMesh ||
            requestId !== entry.textureRequestId ||
            entry.pendingTextureUrl !== url
          ) {
            disposeTexture(texture)
            return
          }
          const displayTexture = texture
          const { planeWidth, planeHeight } = resolvePlaneSize(entry.layer)

          configureTexture(displayTexture, getRenderer?.(), {
            kind: entry.layer?.kind,
            planeWidthM: planeWidth,
            planeHeightM: planeHeight,
          })
          disposeTexture(entry.currentTexture)
          entry.currentTexture = displayTexture
          entry.planeMesh.material.map = displayTexture
          entry.planeMesh.material.color.set('#ffffff')
          entry.planeMesh.material.opacity = 1
          entry.planeMesh.material.alphaTest =
            isRadarPlaneLayerKind(String(entry.layer?.kind || '').toLowerCase())
              ? 0
              : 0.001
          // 配置材质为叠加模式
          configurePlaneMaterialForOverlay(entry.planeMesh.material)
          applyLayerOverlayStyle(entry)
          entry.lastTextureUrl = url
          entry.pendingTextureUrl = ''
          entry.group.children.forEach((child) => {
            if (child !== entry.planeMesh) child.visible = false
          })
        },
        undefined,
        () => {
          if (requestId === entry.textureRequestId) {
            entry.pendingTextureUrl = ''
          }
          entry.lastTextureUrl = ''
        },
      )
    })
  }

  function tick(elapsed) {
    planeEntries.forEach((entry) => {
      if (getLayerKind(entry.layer) === 'radar_wave') {
        syncRadarWaveTime(entry, elapsed)
      }
      if (!entry.ringPulse) return
      const scale = 1 + Math.sin(elapsed * 1.4) * 0.025
      entry.ringPulse.scale.setScalar(scale)
      entry.ringPulse.material.opacity =
        0.14 + (Math.sin(elapsed * 1.8) + 1) * 0.03
    })
  }

  function previewGhostPlane(active = true) {
    forceGhostPreview = Boolean(active)
    updateGhostPlane()
  }

  function dispose() {
    planeEntries.forEach((entry) => removeEntry(entry))
    planeEntries.clear()
    removeGhostPlane()
  }

  return {
    buildScene,
    syncTexture,
    tick,
    previewGhostPlane,
    dispose,
  }
}
