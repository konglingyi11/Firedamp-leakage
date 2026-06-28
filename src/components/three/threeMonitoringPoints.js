import * as THREE from 'three'
import { scenePointMetersToMonitoringPoint } from '@/utils/monitoringPointDrag'
import { computeMonitoringCameraFocus } from '@/utils/monitoringCamera'

const MONITORING_POINT_RADIUS = 0.045
const MONITORING_POINT_RING_INNER_RADIUS = 0.058
const MONITORING_POINT_RING_OUTER_RADIUS = 0.072
const MONITORING_LABEL_WIDTH = 0.56
const MONITORING_LABEL_HEIGHT = 0.16
const MONITORING_LABEL_Z = 0.14
const MONITORING_LABEL_LINE_TOP_Z =
  MONITORING_LABEL_Z - MONITORING_LABEL_HEIGHT / 2 - 0.01

export function createMonitoringPoints({
  getMonitoringPointsGroup,
  getRaycaster,
  getCamera,
  getControls,
  hostRef,
  setRaycasterFromClient,
  collectPointPlacementTargets,
  normalizeModelBounds,
  geometryBounds,
  pendingPointMove,
  emit,
}) {
  // 状态变量
  let monitoringPoints = []
  let selectedMonitoringPointId = null
  let isAddingPoint = false
  let isDraggingPoint = false
  let suppressNextPointClick = false
  let draggedPointId = null
  let draggedPointPlane = null
  let draggedPointOffsetMeters = null
  let draggedPointOriginal = null

  function monitoringPointPositionMeters(point) {
    const toMeters = (value) => {
      const num = Number(value)
      return Number.isFinite(num) ? num / 100 : 0
    }
    return new THREE.Vector3(
      toMeters(point?.x),
      toMeters(point?.y),
      toMeters(point?.z),
    )
  }

  function findMonitoringPointGroup(object) {
    let current = object
    while (current) {
      if (current.userData?.isPointGroup) return current
      current = current.parent
    }
    return null
  }

  function pickMonitoringPointGroup() {
    const raycaster = getRaycaster()
    const monitoringPointsGroup = getMonitoringPointsGroup()
    if (!raycaster || !monitoringPointsGroup) return null
    const hits = raycaster.intersectObjects(monitoringPointsGroup.children, true)
    const pointHit = hits.find(
      (hit) =>
        hit.object?.userData?.isMonitoringPoint ||
        hit.object?.userData?.isPointLabel,
    )
    return findMonitoringPointGroup(pointHit?.object)
  }

  function isObjectVisibleInScene(object) {
    let current = object
    while (current) {
      if (current.visible === false) return false
      current = current.parent
    }
    return true
  }

  function resolveMonitoringPointFromCurrentRay() {
    const raycaster = getRaycaster()
    if (!raycaster) return null
    const targets = collectPointPlacementTargets()
    const hits = targets.length
      ? raycaster.intersectObjects(targets, true).filter((hit) => {
          const object = hit.object
          if (!isObjectVisibleInScene(object)) return false
          if (object.userData?.isMonitoringPoint || object.userData?.isPointLabel) {
            return false
          }
          return true
        })
      : []
    const scenePoint = hits[0]?.point?.clone?.() || new THREE.Vector3()

    if (!hits.length) {
      const controls = getControls()
      const fallbackZ = controls?.target?.z ?? 0
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -fallbackZ)
      const hit = raycaster.ray.intersectPlane(plane, scenePoint)
      if (!hit) return null
    }

    return scenePointMetersToMonitoringPoint(
      {},
      scenePoint,
      normalizeModelBounds(geometryBounds.value),
    )
  }

  function pointDragPlane(point) {
    const camera = getCamera()
    const normal = new THREE.Vector3()
    camera.getWorldDirection(normal)
    return new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      monitoringPointPositionMeters(point),
    )
  }

  function updateDraggedMonitoringPointFromRay() {
    if (!isDraggingPoint || !draggedPointId || !draggedPointPlane) return false
    const point = monitoringPoints.find((item) => item.id === draggedPointId)
    if (!point) return false

    const raycaster = getRaycaster()
    const target = new THREE.Vector3()
    const hit = raycaster.ray.intersectPlane(draggedPointPlane, target)
    if (!hit) return false
    if (draggedPointOffsetMeters) {
      target.add(draggedPointOffsetMeters)
    }

    Object.assign(
      point,
      scenePointMetersToMonitoringPoint(
        point,
        target,
        normalizeModelBounds(geometryBounds.value),
      ),
    )
    const monitoringPointsGroup = getMonitoringPointsGroup()
    const visual = monitoringPointsGroup.children.find(
      (child) => child.userData?.pointId === draggedPointId,
    )
    if (visual) {
      visual.position.copy(monitoringPointPositionMeters(point))
      visual.userData.pointData = point
    }
    return true
  }

  function updateMonitoringPointVisualPosition(point) {
    const monitoringPointsGroup = getMonitoringPointsGroup()
    if (!point || !monitoringPointsGroup) return
    const visual = monitoringPointsGroup.children.find(
      (child) => child.userData?.pointId === point.id,
    )
    if (visual) {
      visual.position.copy(monitoringPointPositionMeters(point))
      visual.userData.pointData = point
    }
  }

  function getPointScreenPosition(point) {
    const camera = getCamera()
    if (!point || !camera || !hostRef.value) return null
    const rect = hostRef.value.getBoundingClientRect()
    const projected = monitoringPointPositionMeters(point).project(camera)
    const x = ((projected.x + 1) / 2) * rect.width
    const y = ((1 - projected.y) / 2) * rect.height
    return {
      x: Math.max(12, Math.min(rect.width - 220, x + 18)),
      y: Math.max(12, Math.min(rect.height - 12, y - 8)),
    }
  }

  function hasMonitoringPointPositionChanged(point, original) {
    if (!point || !original) return false
    return ['x', 'y', 'z'].some(
      (axis) => Math.abs(Number(point[axis]) - Number(original[axis])) > 0.001,
    )
  }

  function finishMonitoringPointDrag() {
    if (!isDraggingPoint) return
    const point = monitoringPoints.find((item) => item.id === draggedPointId)
    isDraggingPoint = false
    suppressNextPointClick = true
    draggedPointId = null
    draggedPointPlane = null
    draggedPointOffsetMeters = null
    const controls = getControls()
    if (controls) {
      controls.enabled = true
    }
    if (hostRef.value) {
      hostRef.value.style.cursor = isAddingPoint ? 'crosshair' : 'default'
    }
    if (
      point &&
      draggedPointOriginal &&
      hasMonitoringPointPositionChanged(point, draggedPointOriginal)
    ) {
      pendingPointMove.value = {
        point: { ...point },
        original: { ...draggedPointOriginal },
        screen: getPointScreenPosition(point),
      }
    }
    draggedPointOriginal = null
  }

  function confirmPendingPointMove() {
    const pending = pendingPointMove.value
    if (!pending?.point) return
    pendingPointMove.value = null
    emit('update-point', { ...pending.point })
  }

  function cancelPendingPointMove() {
    const pending = pendingPointMove.value
    if (!pending?.original) {
      pendingPointMove.value = null
      return
    }
    const point = monitoringPoints.find((item) => item.id === pending.original.id)
    if (point) {
      Object.assign(point, pending.original)
      updateMonitoringPointVisualPosition(point)
    }
    pendingPointMove.value = null
  }

  // 创建监测点可视化
  function createMonitoringPointVisual(point) {
    const group = new THREE.Group()
    const isSelected = point.id === selectedMonitoringPointId
    const pointColor = isSelected ? '#ff6b6b' : '#4ecdc4'

    // 3D 球体核心
    const coreGeometry = new THREE.SphereGeometry(MONITORING_POINT_RADIUS, 20, 20)
    const coreMaterial = new THREE.MeshPhongMaterial({
      color: pointColor,
      emissive: pointColor,
      emissiveIntensity: 0.3,
      shininess: 80,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    core.renderOrder = 999
    core.userData = { isMonitoringPoint: true, pointId: point.id }
    group.add(core)

    // 外圈光环（选中时显示）
    const ringGeometry = new THREE.RingGeometry(
      MONITORING_POINT_RING_INNER_RADIUS,
      MONITORING_POINT_RING_OUTER_RADIUS,
      32,
    )
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthTest: false,
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.renderOrder = 999
    ring.userData = { isOuterRing: true, pointId: point.id }
    group.add(ring)

    // 垂直向上的轴线（从球体顶部到标签底部）
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, MONITORING_POINT_RADIUS),
      new THREE.Vector3(0, 0, MONITORING_LABEL_LINE_TOP_Z),
    ])
    const lineMaterial = new THREE.LineBasicMaterial({
      color: pointColor,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    })
    const line = new THREE.Line(lineGeometry, lineMaterial)
    line.renderOrder = 999
    line.userData = { isPointLine: true, pointId: point.id }
    group.add(line)

    // 点的标签（在球体正上方，底部紧贴球体顶部）
    const label = createMonitoringPointLabel(
      point.name || `点${point.id}`,
      pointColor,
    )
    label.position.set(0, 0, MONITORING_LABEL_Z)
    label.userData = { isPointLabel: true, pointId: point.id }
    group.add(label)

    // 面板和接口坐标使用 cm，Three.js 场景统一使用 m。
    group.position.copy(monitoringPointPositionMeters(point))

    group.userData = { isPointGroup: true, pointId: point.id, pointData: point }
    return group
  }

  // 创建监测点标签
  function createMonitoringPointLabel(text, color) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 72
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height

    const radius = 18
    const inset = 4
    ctx.beginPath()
    ctx.moveTo(radius + inset, inset)
    ctx.lineTo(width - radius - inset, inset)
    ctx.quadraticCurveTo(width - inset, inset, width - inset, radius + inset)
    ctx.lineTo(width - inset, height - radius - inset)
    ctx.quadraticCurveTo(
      width - inset,
      height - inset,
      width - radius - inset,
      height - inset,
    )
    ctx.lineTo(radius + inset, height - inset)
    ctx.quadraticCurveTo(inset, height - inset, inset, height - radius - inset)
    ctx.lineTo(inset, radius + inset)
    ctx.quadraticCurveTo(inset, inset, radius + inset, inset)
    ctx.fillStyle = 'rgba(4, 20, 28, 0.72)'
    ctx.fill()

    // 绘制边框
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.stroke()

    // 绘制文本
    ctx.font = '600 28px Arial, "Microsoft YaHei", sans-serif'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, width / 2, height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      fog: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(MONITORING_LABEL_WIDTH, MONITORING_LABEL_HEIGHT, 1)
    sprite.renderOrder = 999

    return sprite
  }

  // 添加监测点
  function addMonitoringPoint(pointData) {
    const point = {
      id: pointData.id || `point_${Date.now()}`,
      name: pointData.name || `监测点 ${monitoringPoints.length + 1}`,
      x: pointData.x || 0,
      y: pointData.y || 0,
      z: pointData.z || 0,
    }

    monitoringPoints.push(point)

    const visual = createMonitoringPointVisual(point)
    const monitoringPointsGroup = getMonitoringPointsGroup()
    monitoringPointsGroup.add(visual)

    // 通知父组件
    emit('add-point', point)

    return point
  }

  // 更新监测点
  function updateMonitoringPoint(pointId, updates) {
    const point = monitoringPoints.find((p) => p.id === pointId)
    if (!point) return

    Object.assign(point, updates)

    // 更新可视化
    const monitoringPointsGroup = getMonitoringPointsGroup()
    const visual = monitoringPointsGroup.children.find(
      (child) => child.userData?.pointId === pointId,
    )
    if (visual) {
      visual.position.copy(monitoringPointPositionMeters(point))

      // 更新标签
      const label = visual.children.find((child) => child.userData?.isPointLabel)
      if (label && updates.name) {
        const isSelected = pointId === selectedMonitoringPointId
        const newLabel = createMonitoringPointLabel(
          updates.name,
          isSelected ? '#ff6b6b' : '#4ecdc4',
        )
        newLabel.position.copy(label.position)
        newLabel.userData = label.userData
        visual.remove(label)
        visual.add(newLabel)
      }
    }

    // 通知父组件
    emit('update-point', { ...point, ...updates })
  }

  // 删除监测点
  function deleteMonitoringPoint(pointId) {
    const idx = monitoringPoints.findIndex((p) => p.id === pointId)
    if (idx === -1) return

    const point = monitoringPoints[idx]
    monitoringPoints.splice(idx, 1)

    // 删除可视化
    const monitoringPointsGroup = getMonitoringPointsGroup()
    const visual = monitoringPointsGroup.children.find(
      (child) => child.userData?.pointId === pointId,
    )
    if (visual) {
      monitoringPointsGroup.remove(visual)
    }

    if (selectedMonitoringPointId === pointId) {
      selectedMonitoringPointId = null
    }

    // 通知父组件
    emit('delete-point', point)
  }

  // 选择监测点
  function selectMonitoringPoint(pointId, options = {}) {
    selectedMonitoringPointId = pointId

    // 更新所有点的视觉状态
    const monitoringPointsGroup = getMonitoringPointsGroup()
    monitoringPointsGroup.children.forEach((group) => {
      const core = group.children.find(
        (child) => child.userData?.isMonitoringPoint,
      )
      const outerRing = group.children.find(
        (child) => child.userData?.isOuterRing,
      )
      const label = group.children.find((child) => child.userData?.isPointLabel)

      const isSelected = group.userData?.pointId === pointId

      if (core) {
        core.material.color.set(isSelected ? '#ff6b6b' : '#4ecdc4')
      }
      if (outerRing) {
        outerRing.material.opacity = isSelected ? 1 : 0
      }
      if (label) {
        const point = monitoringPoints.find(
          (p) => p.id === group.userData?.pointId,
        )
        if (point) {
          const newLabel = createMonitoringPointLabel(
            point.name,
            isSelected ? '#ff6b6b' : '#4ecdc4',
          )
          newLabel.position.copy(label.position)
          newLabel.userData = label.userData
          group.remove(label)
          group.add(newLabel)
        }
      }
    })

    // 通知父组件聚焦该点
    const point = monitoringPoints.find((p) => p.id === pointId)
    if (point && options.emitFocus !== false) {
      emit('focus-point', point)
    }
  }

  function focusCameraOnMonitoringPoint(point) {
    const camera = getCamera()
    const controls = getControls()
    if (!camera || !controls || !point) return
    const target = monitoringPointPositionMeters(point)
    const maxBoundsSize = normalizeModelBounds(geometryBounds.value)
    const fallbackDistance = maxBoundsSize
      ? Math.max(
          2,
          Math.max(
            maxBoundsSize.max[0] - maxBoundsSize.min[0],
            maxBoundsSize.max[1] - maxBoundsSize.min[1],
            maxBoundsSize.max[2] - maxBoundsSize.min[2],
          ) / 100,
        )
      : 6
    const focus = computeMonitoringCameraFocus({
      cameraPosition: camera.position.toArray(),
      controlsTarget: controls.target.toArray(),
      point: target.toArray(),
      fallbackDistance,
    })
    camera.position.fromArray(focus.position)
    controls.target.fromArray(focus.target)
    camera.lookAt(controls.target)
    camera.updateProjectionMatrix?.()
    controls.update?.()
  }

  function focusMonitoringPoint(pointOrId) {
    const point =
      typeof pointOrId === 'object'
        ? pointOrId
        : monitoringPoints.find((item) => String(item.id) === String(pointOrId))
    if (!point) return
    if (point.id != null) {
      selectMonitoringPoint(point.id, { emitFocus: false })
    }
    focusCameraOnMonitoringPoint(point)
  }

  function renderMonitoringPointVisuals() {
    const monitoringPointsGroup = getMonitoringPointsGroup()
    if (!monitoringPointsGroup) return
    while (monitoringPointsGroup.children.length > 0) {
      monitoringPointsGroup.remove(monitoringPointsGroup.children[0])
    }
    monitoringPoints.forEach((point) => {
      if (point.visible === false) return
      const visual = createMonitoringPointVisual(point)
      monitoringPointsGroup.add(visual)
    })
  }

  // 设置添加点模式
  function setAddingPointMode(enabled) {
    isAddingPoint = enabled
    if (hostRef.value) {
      hostRef.value.style.cursor = enabled ? 'crosshair' : 'default'
    }
  }

  // 获取监测点列表（供父组件调用）
  function getMonitoringPoints() {
    return [...monitoringPoints]
  }

  // 从父组件同步监测点数据
  function syncMonitoringPoints(points) {
    pendingPointMove.value = null
    monitoringPoints.length = 0

    ;(Array.isArray(points) ? points : []).forEach((point) => {
      monitoringPoints.push({ ...point })
    })
    renderMonitoringPointVisuals()
  }

  // 开始拖拽监测点（供 onMouseDown 调用）
  // 前置条件：raycaster 已通过 setRaycasterFromClient 设置
  // 返回 true 表示成功开始拖拽，false 表示未命中监测点
  function beginMonitoringPointDrag() {
    const pointGroup = pickMonitoringPointGroup()
    const pointId = pointGroup?.userData?.pointId
    const point = monitoringPoints.find((item) => item.id === pointId)
    if (!point) return false

    cancelPendingPointMove()
    selectMonitoringPoint(point.id, { emitFocus: false })
    isDraggingPoint = true
    draggedPointId = point.id
    draggedPointPlane = pointDragPlane(point)
    draggedPointOriginal = { ...point }
    const raycaster = getRaycaster()
    const target = new THREE.Vector3()
    const hit = raycaster?.ray.intersectPlane(draggedPointPlane, target)
    draggedPointOffsetMeters = hit
      ? monitoringPointPositionMeters(point).sub(target)
      : new THREE.Vector3()
    return true
  }

  // 消费 suppressNextPointClick 标志（供 onMouseClick 调用）
  // 返回 true 表示应跳过本次点击
  function consumeSuppressNextPointClick() {
    if (suppressNextPointClick) {
      suppressNextPointClick = false
      return true
    }
    return false
  }

  // 释放监测点模块状态
  function disposeMonitoringPoints() {
    monitoringPoints = []
    selectedMonitoringPointId = null
    isAddingPoint = false
    isDraggingPoint = false
    suppressNextPointClick = false
    draggedPointId = null
    draggedPointPlane = null
    draggedPointOffsetMeters = null
    draggedPointOriginal = null
  }

  return {
    addMonitoringPoint,
    updateMonitoringPoint,
    deleteMonitoringPoint,
    selectMonitoringPoint,
    focusMonitoringPoint,
    renderMonitoringPointVisuals,
    setAddingPointMode,
    getMonitoringPoints,
    syncMonitoringPoints,
    pickMonitoringPointGroup,
    resolveMonitoringPointFromCurrentRay,
    updateDraggedMonitoringPointFromRay,
    finishMonitoringPointDrag,
    confirmPendingPointMove,
    cancelPendingPointMove,
    beginMonitoringPointDrag,
    consumeSuppressNextPointClick,
    isAddingPointMode: () => isAddingPoint,
    isDraggingPoint: () => isDraggingPoint,
    disposeMonitoringPoints,
  }
}
