import { THREE, clearGroup } from './shared'

/**
 * 创建几何包围盒可视化
 * @param {Object} options
 * @param {THREE.Group} options.dynamicGroup - 场景中的动态组
 * @param {Function} options.getGeometryBounds - 获取几何包围盒数据的函数
 * @param {Function} options.getVisibleLayers - 获取可见图层的函数
 */
export function createBoundsMode(options) {
  const { getDynamicGroup, getGeometryBounds, getVisibleLayers } = options

  let boundsGroup = null
  let boundsData = null
  let boundsAnimationFrame = null
  let boundsAnimationState = {
    from: 0,
    to: 0,
    progress: 0,
    targetVisible: false,
    startTime: 0,
  }

  const BOUNDS_ANIMATION_DURATION = 520
  const BOUNDS_COLOR = '#0f172a'
  const BOUNDS_GLOW_COLOR = '#1e293b'

  function easeBoundsProgress(t) {
    return t * t * (3 - 2 * t)
  }

  function applyBoundsVisualProgress(progress) {
    if (!boundsGroup) return
    const clamped = Math.max(0, Math.min(1, progress))
    const parts = boundsGroup.userData?.boundsParts
    if (!parts) return

    parts.lineMaterials?.forEach((material) => {
      material.opacity = 0.95 * clamped
      material.needsUpdate = true
    })
    parts.glowMaterials?.forEach((material, index) => {
      const entryFlash = Math.sin(clamped * Math.PI)
      const layerFade = 1 - index * 0.18
      material.opacity = (0.16 * clamped + 0.34 * entryFlash) * layerFade
      material.needsUpdate = true
    })
    parts.cornerMaterials?.forEach((material) => {
      material.opacity = 0.9 * clamped
      material.needsUpdate = true
    })

    const entryFlash = Math.sin(clamped * Math.PI)
    const cornerScale = 0.72 + clamped * 0.58 + entryFlash * 0.42
    parts.corners?.forEach((corner) => {
      corner.scale.setScalar(cornerScale)
    })
    parts.wireframe?.scale.setScalar(0.82 + clamped * 0.18 + entryFlash * 0.08)
    parts.glowWireframes?.forEach((wireframe, index) => {
      wireframe.scale.setScalar(
        0.92 + clamped * 0.1 + entryFlash * (0.18 + index * 0.08),
      )
    })
  }

  function stopBoundsAnimation() {
    if (boundsAnimationFrame != null) {
      cancelAnimationFrame(boundsAnimationFrame)
      boundsAnimationFrame = null
    }
  }

  function animateBoundsFrame(now) {
    const elapsed = now - boundsAnimationState.startTime
    const t = Math.max(0, Math.min(1, elapsed / BOUNDS_ANIMATION_DURATION))
    const eased = easeBoundsProgress(t)
    boundsAnimationState.progress =
      boundsAnimationState.from +
      (boundsAnimationState.to - boundsAnimationState.from) * eased
    applyBoundsVisualProgress(boundsAnimationState.progress)

    if (t < 1) {
      boundsAnimationFrame = requestAnimationFrame(animateBoundsFrame)
      return
    }

    boundsAnimationState.progress = boundsAnimationState.to
    applyBoundsVisualProgress(boundsAnimationState.progress)
    if (!boundsAnimationState.targetVisible && boundsGroup) {
      boundsGroup.visible = false
    }
    boundsAnimationFrame = null
  }

  function setBoundsVisible(visible) {
    if (!boundsGroup) return
    const target = visible ? 1 : 0
    if (
      boundsAnimationState.targetVisible === visible &&
      Math.abs(boundsAnimationState.to - target) < 0.001
    ) {
      boundsGroup.visible = visible || boundsAnimationState.progress > 0.001
      return
    }

    stopBoundsAnimation()
    boundsAnimationState = {
      from: boundsAnimationState.progress,
      to: target,
      progress: boundsAnimationState.progress,
      targetVisible: visible,
      startTime: performance.now(),
    }
    boundsGroup.visible = true
    boundsAnimationFrame = requestAnimationFrame(animateBoundsFrame)
  }

  function normalizeBounds(rawBounds) {
    const bounds = rawBounds?.data || rawBounds
    if (!bounds || typeof bounds !== 'object') return null

    if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
      return {
        min: bounds.min.map((value) => Number(value)),
        max: bounds.max.map((value) => Number(value)),
      }
    }

    const min = [
      bounds.xmin ?? bounds.x_min,
      bounds.ymin ?? bounds.y_min,
      bounds.zmin ?? bounds.z_min,
    ].map((value) => Number(value))

    const max = [
      bounds.xmax ?? bounds.x_max,
      bounds.ymax ?? bounds.y_max,
      bounds.zmax ?? bounds.z_max,
    ].map((value) => Number(value))

    if (
      min.every((value) => Number.isFinite(value)) &&
      max.every((value) => Number.isFinite(value))
    ) {
      return { min, max }
    }

    return null
  }

  function createBoundsBox(bounds) {
    // bounds 格式: { min: [x, y, z], max: [x, y, z] } (单位: cm)
    const min = bounds.min || [0, 0, 0]
    const max = bounds.max || [100, 100, 100]

    console.log('[Bounds] 原始包围盒数据 (cm):', { min, max })

    // 转换为 meters
    const minX = min[0] / 100
    const minY = min[1] / 100
    const minZ = min[2] / 100
    const maxX = max[0] / 100
    const maxY = max[1] / 100
    const maxZ = max[2] / 100

    const width = maxX - minX
    const height = maxY - minY
    const depth = maxZ - minZ

    console.log('[Bounds] 计算结果 (m):', {
      size: { width, height, depth },
      center: {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2,
      },
    })

    const group = new THREE.Group()

    // 创建线框包围盒
    const boxGeometry = new THREE.BoxGeometry(width, height, depth)
    const edges = new THREE.EdgesGeometry(boxGeometry)
    const lineMaterial = new THREE.LineBasicMaterial({
      color: BOUNDS_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    })
    const wireframe = new THREE.LineSegments(edges, lineMaterial)
    wireframe.renderOrder = 1000

    // 设置位置（包围盒中心）
    wireframe.position.set(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    )

    group.add(wireframe)

    const glowWireframes = []
    const glowMaterials = [0.42, 0.3].map((opacity) => (
      new THREE.LineBasicMaterial({
        color: BOUNDS_GLOW_COLOR,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      })
    ))
    glowMaterials.forEach((material, index) => {
      const glow = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeometry), material)
      glow.position.copy(wireframe.position)
      glow.renderOrder = 998 - index
      glowWireframes.push(glow)
      group.add(glow)
    })
    boxGeometry.dispose()

    // 添加角点标记
    const cornerGeometry = new THREE.SphereGeometry(0.065, 16, 16)
    const cornerMaterial = new THREE.MeshBasicMaterial({
      color: BOUNDS_GLOW_COLOR,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })

    const corners = [
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [minX, maxY, minZ],
      [maxX, maxY, minZ],
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [minX, maxY, maxZ],
      [maxX, maxY, maxZ],
    ]

    const cornersMeshes = []
    corners.forEach(([x, y, z]) => {
      const corner = new THREE.Mesh(cornerGeometry, cornerMaterial)
      corner.position.set(x, y, z)
      corner.renderOrder = 1001
      corner.scale.setScalar(0.58)
      cornersMeshes.push(corner)
      group.add(corner)
    })

    group.userData.boundsParts = {
      wireframe,
      glowWireframes,
      corners: cornersMeshes,
      lineMaterials: [lineMaterial],
      glowMaterials,
      cornerMaterials: [cornerMaterial],
    }
    group.visible = false
    applyBoundsVisualProgress(0)

    return group
  }

  function updateBoundsVisibility() {
    const dynamicGroup = getDynamicGroup?.()
    const visibleLayers = getVisibleLayers?.() || []
    const boundsLayer = visibleLayers.find((l) => l?.kind === 'bounds')
    const isDetached = boundsGroup && boundsGroup.parent !== dynamicGroup

    if (boundsLayer) {
      if ((isDetached || !boundsGroup) && boundsData && dynamicGroup) {
        if (boundsGroup) {
          clearGroup(boundsGroup)
        }
        boundsGroup = createBoundsBox(boundsData)
        dynamicGroup.add(boundsGroup)
      }
      if (boundsGroup) setBoundsVisible(boundsLayer.visible !== false)
    } else {
      // 如果没有 bounds 图层，隐藏包围盒
      if (boundsGroup) setBoundsVisible(false)
    }
  }

  async function loadBounds(taskId) {
    if (!taskId) return null

    try {
      const response = getGeometryBounds
        ? await getGeometryBounds(taskId)
        : await fetch(
            `/api/v1/post-processing/geometry-bounds?task_id=${taskId}`,
          )
      const data =
        typeof response?.json === 'function' ? await response.json() : response

      const bounds = normalizeBounds(data)
      if (bounds) {
        boundsData = bounds
        updateBoundsVisibility()

        // 返回原始数据，以便外部使用
        return data
      } else {
        console.warn('[Bounds] 几何包围盒数据格式不支持:', data)
        return null
      }
    } catch (error) {
      console.error('[Bounds] 加载几何包围盒失败:', error)
      return null
    }
  }

  function setBoundsData(bounds) {
    const dynamicGroup = getDynamicGroup?.()
    boundsData = normalizeBounds(bounds)
    // 重新创建包围盒
    if (boundsGroup) {
      boundsGroup.removeFromParent()
      clearGroup(boundsGroup)
      boundsGroup = null
    }
    if (boundsData && dynamicGroup) {
      boundsGroup = createBoundsBox(boundsData)
      dynamicGroup.add(boundsGroup)
      updateBoundsVisibility()
    }
  }

  function dispose() {
    stopBoundsAnimation()
    if (boundsGroup) {
      boundsGroup.removeFromParent()
      clearGroup(boundsGroup)
      boundsGroup = null
    }
    boundsData = null
    boundsAnimationState = {
      from: 0,
      to: 0,
      progress: 0,
      targetVisible: false,
      startTime: 0,
    }
  }

  return {
    loadBounds,
    setBoundsData,
    updateBoundsVisibility,
    dispose,
  }
}
