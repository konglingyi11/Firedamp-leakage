import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const LOCAL_MEETING_ROOM_GEOMETRY_MODEL_URL = '/huiyishi(1).glb'
const MEETING_ROOM_STANDING_IDLE_MODEL_URL = '/person.glb'
const MEETING_ROOM_HUMANBODY_SELECTION_NAME = 'human_release_source_1'
const MEETING_ROOM_STANDING_IDLE_UP_AXIS = 'z'
const MEETING_ROOM_HUMAN_MODEL_MAX_HEIGHT = 0.3
const MEETING_ROOM_STANDING_IDLE_TARGET_POSITION_CM = new THREE.Vector3(720, -280, -20)
const MEETING_ROOM_STANDING_IDLE_TARGET_POSITION =
  MEETING_ROOM_STANDING_IDLE_TARGET_POSITION_CM.clone().multiplyScalar(0.01)
const MEETING_ROOM_SPLAT_URL = '/splat/%E9%AB%98%E6%96%AF%E6%B3%BC%E6%BA%85.splat'
const MEETING_ROOM_SPLAT_SCALE = 1.2
const STANDARD_SPLAT_BYTES = 32
const MEETING_ROOM_SPLAT_REVEAL_POINT_COUNT = 5200
const MEETING_ROOM_SPLAT_REVEAL_DURATION = 1.05
const MEETING_ROOM_SPLAT_CLIP_PADDING = 0.35
const MEETING_ROOM_SURFACE_ROTATION_X = 0
const MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z = Math.PI
const MEETING_ROOM_OVERALL_ROTATION_Z = Math.PI
const MEETING_ROOM_FLOOR_ROTATION_Z = 0
const MEETING_ROOM_SPLAT_EXTRA_ROTATION_Z = Math.PI
const MEETING_ROOM_SPLAT_OBJECT_TRANSFORM = {
  rotationX: -Math.PI / 2 + MEETING_ROOM_SURFACE_ROTATION_X,
  rotationZ:
    MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z +
    MEETING_ROOM_OVERALL_ROTATION_Z +
    MEETING_ROOM_FLOOR_ROTATION_Z +
    MEETING_ROOM_SPLAT_EXTRA_ROTATION_Z,
  rotationOrder: 'ZXY',
  scale: 1,
}
const MEETING_ROOM_CAMERA_FORWARD = new THREE.Vector3(1, 0, 0)
const DEFAULT_CAMERA_UP = new THREE.Vector3(0, 1, 0)
const MEETING_ROOM_CAMERA_MIN_LOOK_DISTANCE = 0.001
const MEETING_ROOM_CAMERA_DEFAULT_FORWARD_OFFSET_RATIO = 0.24
const MEETING_ROOM_SPLAT_LAS_CLIP_BOX = new THREE.Box3(
  new THREE.Vector3(-6.0828962326049805, -5.386753082275391, -0.974),
  new THREE.Vector3(9.551666767120361, 6.93524691772461, 4.0360000000000005),
)
const MEETING_ROOM_SPLAT_BOX_EXTENTS = {
  widthLeft: 1.001,
  widthRight: 0.951,
  lengthBack: 1.2,
  lengthFront: 0.8,
  heightDown: 1.2,
  heightUp: 1.9,
}
const MEETING_ROOM_STANDING_IDLE_SPLAT_INSET_RATIO = 0.04

export {
  LOCAL_MEETING_ROOM_GEOMETRY_MODEL_URL,
  MEETING_ROOM_STANDING_IDLE_MODEL_URL,
  MEETING_ROOM_SURFACE_ROTATION_X,
  MEETING_ROOM_GEOMETRY_FLIP_ROTATION_Z,
  MEETING_ROOM_OVERALL_ROTATION_Z,
  MEETING_ROOM_FLOOR_ROTATION_Z,
}

export function createMeetingRoomMode({
  getGltfModels,
  getModelGroup,
  getCamera,
  getControls,
  getRenderer,
  getCurrentTask,
  getVisualization,
  getRuntimeState,
  syncVisibleLayerIdsFromProps,
  GLTF_MODEL_CONFIGS,
  buildTaskModelTargetBounds,
  applyModelBaseTransform,
  scaleModelToTargetBounds,
  resolveGLTFModelTransformOptions,
  disposeModelObject,
  addFrameCallback,
  removeFrameCallback,
}) {
  // 状态变量
  let meetingRoomSplatObject = null
  let meetingRoomSplatObjectUrl = ''
  let meetingRoomSplatLoadToken = 0
  let meetingRoomSplatClipUniforms = null
  let meetingRoomSplatClipBaseBox = null
  let meetingRoomSplatRevealState = null
  let meetingRoomCameraPoseInitialized = false
  let meetingRoomStandingIdleDebugGroup = null
  let meetingRoomSplatDebugGroup = null
  let meetingRoomHumanBodyBoxPromise = null
  let meetingRoomHumanBodyCachedBox = null

  function isMeetingRoomTask(task = getCurrentTask()) {
    return String(task?.name || '').trim() === '会议室'
  }

  function normalizeMeetingRoomHumanBodyToken(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
  }

  function findMeetingRoomHumanBodyObject(geometryModel) {
    if (!geometryModel) return null
    const targetToken = normalizeMeetingRoomHumanBodyToken(MEETING_ROOM_HUMANBODY_SELECTION_NAME)
    let target = null
    geometryModel.traverse((child) => {
      if (target || !child) return
      const candidates = [
        child.userData?.geometrySelectionName,
        child.name,
        child.parent?.name,
        child.geometry?.name,
      ]
      const matches = candidates.some((name) =>
        normalizeMeetingRoomHumanBodyToken(name).includes(targetToken),
      )
      if (!matches) return
      const box = new THREE.Box3().setFromObject(child)
      if (!box.isEmpty()) target = child
    })
    return target
  }

  function getMeetingRoomHumanBodyBoxFromScene() {
    const geometryModel = getGltfModels().get('geometry')
    if (!geometryModel) return null
    geometryModel.updateMatrixWorld(true)
    const humanBodyObject = findMeetingRoomHumanBodyObject(geometryModel)
    if (!humanBodyObject) return null
    const box = new THREE.Box3().setFromObject(humanBodyObject)
    return box.isEmpty() ? null : box
  }

  function loadMeetingRoomHumanBodyBoxFromGeometryGlb() {
    if (meetingRoomHumanBodyCachedBox) {
      return Promise.resolve(meetingRoomHumanBodyCachedBox.clone())
    }
    if (meetingRoomHumanBodyBoxPromise) return meetingRoomHumanBodyBoxPromise

    meetingRoomHumanBodyBoxPromise = new Promise((resolve) => {
      const geometryConfig = GLTF_MODEL_CONFIGS.find((config) => config.key === 'geometry')
      const loader = new GLTFLoader()
      loader.load(
        LOCAL_MEETING_ROOM_GEOMETRY_MODEL_URL,
        (gltf) => {
          const model = gltf.scene
          applyModelBaseTransform(model, geometryConfig)
          const taskTargetBounds = buildTaskModelTargetBounds()
          if (geometryConfig?.scaleToBounds !== false && taskTargetBounds) {
            scaleModelToTargetBounds(
              model,
              taskTargetBounds,
              resolveGLTFModelTransformOptions(geometryConfig),
            )
          }
          model.updateMatrixWorld(true)
          const humanBodyObject = findMeetingRoomHumanBodyObject(model)
          const box = humanBodyObject
            ? new THREE.Box3().setFromObject(humanBodyObject)
            : null
          meetingRoomHumanBodyCachedBox = box && !box.isEmpty() ? box.clone() : null
          disposeModelObject(model)
          if (!meetingRoomHumanBodyCachedBox) {
            console.warn(
              `[MeetingRoomStandingIdle] 未在会议室 GLB 中找到 ${MEETING_ROOM_HUMANBODY_SELECTION_NAME}`,
            )
          }
          resolve(meetingRoomHumanBodyCachedBox?.clone() || null)
        },
        undefined,
        (error) => {
          console.warn('[MeetingRoomStandingIdle] 预读会议室几何 GLB 失败:', error)
          resolve(null)
        },
      )
    }).finally(() => {
      meetingRoomHumanBodyBoxPromise = null
    })

    return meetingRoomHumanBodyBoxPromise
  }

  function resetMeetingRoomHumanBodyCache() {
    meetingRoomHumanBodyBoxPromise = null
    meetingRoomHumanBodyCachedBox = null
  }

  function getBoxAxisSize(box, axis) {
    if (!box || !axis) return 0
    return box.max[axis] - box.min[axis]
  }

  function disposeMeetingRoomStandingIdleDebugGroup() {
    if (!meetingRoomStandingIdleDebugGroup) return
    meetingRoomStandingIdleDebugGroup.traverse((child) => {
      child.geometry?.dispose?.()
      child.material?.dispose?.()
    })
    meetingRoomStandingIdleDebugGroup.removeFromParent()
    meetingRoomStandingIdleDebugGroup = null
  }

  function disposeMeetingRoomSplatDebugGroup() {
    if (!meetingRoomSplatDebugGroup) return
    meetingRoomSplatDebugGroup.traverse((child) => {
      child.geometry?.dispose?.()
      child.material?.dispose?.()
    })
    meetingRoomSplatDebugGroup.removeFromParent()
    meetingRoomSplatDebugGroup = null
  }

  function isMeetingRoomSplatDebugBoxVisible() {
    return getVisualization()?.meeting_room_gaussian_box_visible !== false
  }

  function createMeetingRoomDebugBox(box, color) {
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
    const edges = new THREE.EdgesGeometry(geometry)
    geometry.dispose()
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    )
    line.position.copy(center)
    line.renderOrder = 1200
    return line
  }

  function updateMeetingRoomSplatDebugGroup() {
    const modelGroup = getModelGroup()
    if (!modelGroup) return
    disposeMeetingRoomSplatDebugGroup()
    if (!isMeetingRoomSplatDebugBoxVisible()) return
    const splatBox = getMeetingRoomSplatWorldClipBox()
    if (!splatBox || splatBox.isEmpty()) return

    const group = new THREE.Group()
    group.name = 'MeetingRoomSplatDebugBox'
    group.userData.layerKind = 'meetingRoomSplatDebug'
    group.renderOrder = 1210
    const boxLine = createMeetingRoomDebugBox(splatBox, 0x40ff6a)
    boxLine.renderOrder = 1210
    group.add(boxLine)
    meetingRoomSplatDebugGroup = group
    modelGroup.add(group)
  }

  function updateMeetingRoomStandingIdleDebugGroup(targetBox, standingBox) {
    const modelGroup = getModelGroup()
    if (!modelGroup || !targetBox || !standingBox) return
    disposeMeetingRoomStandingIdleDebugGroup()

    const group = new THREE.Group()
    group.name = 'MeetingRoomStandingIdleDebug'
    group.userData.layerKind = 'meetingRoomStandingIdleDebug'
    group.renderOrder = 1200
    group.add(createMeetingRoomDebugBox(targetBox, 0x00f5ff))
    group.add(createMeetingRoomDebugBox(standingBox, 0xff2f92))

    const targetCenter = targetBox.getCenter(new THREE.Vector3())
    const targetSize = targetBox.getSize(new THREE.Vector3())
    const markerRadius = Math.max(0.04, Math.min(targetSize.x, targetSize.y, targetSize.z) * 0.08)
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius, 24, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff35a,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    marker.position.copy(targetCenter)
    marker.renderOrder = 1201
    group.add(marker)

    meetingRoomStandingIdleDebugGroup = group
    modelGroup.add(group)
  }

  function buildInsetBox(box, ratio) {
    if (!box || box.isEmpty()) return null
    const insetBox = box.clone()
    const size = insetBox.getSize(new THREE.Vector3())
    for (const axis of ['x', 'y', 'z']) {
      const inset = size[axis] * ratio
      if (Number.isFinite(inset) && inset > 0 && size[axis] > inset * 2) {
        insetBox.min[axis] += inset
        insetBox.max[axis] -= inset
      }
    }
    return insetBox
  }

  function moveModelBoxInsideContainer(model, containerBox) {
    if (!model || !containerBox || containerBox.isEmpty()) return
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    if (box.isEmpty()) return

    const delta = new THREE.Vector3()
    for (const axis of ['x', 'y', 'z']) {
      if (box.min[axis] < containerBox.min[axis]) {
        delta[axis] = containerBox.min[axis] - box.min[axis]
      } else if (box.max[axis] > containerBox.max[axis]) {
        delta[axis] = containerBox.max[axis] - box.max[axis]
      }
    }
    if (delta.lengthSq() > 0) {
      model.position.add(delta)
      model.updateMatrixWorld(true)
    }
  }

  function keepMeetingRoomStandingIdleInsideSplat(model) {
    const splatBox = getMeetingRoomSplatWorldClipBox()
    if (!model || !splatBox || splatBox.isEmpty()) return null
    return splatBox
  }

  function alignMeetingRoomStandingIdleModelToBox(targetBox) {
    const standingModel = getGltfModels().get('meetingRoomStandingIdle')
    if (!isMeetingRoomTask() || !standingModel || !targetBox || targetBox.isEmpty()) return false

    if (!standingModel.userData.meetingRoomBaseScale) {
      standingModel.userData.meetingRoomBaseScale = standingModel.scale.clone()
    }
    if (!standingModel.userData.meetingRoomBasePosition) {
      standingModel.userData.meetingRoomBasePosition = standingModel.position.clone()
    }

    standingModel.scale.copy(standingModel.userData.meetingRoomBaseScale)
    standingModel.position.copy(standingModel.userData.meetingRoomBasePosition)
    standingModel.updateMatrixWorld(true)

    const standingBox = new THREE.Box3().setFromObject(standingModel)
    const upAxis = MEETING_ROOM_STANDING_IDLE_UP_AXIS
    const targetHeight = getBoxAxisSize(targetBox, upAxis)
    const standingHeight = getBoxAxisSize(standingBox, upAxis)
    const limitedTargetHeight =
      Number.isFinite(targetHeight) && targetHeight > 0
        ? Math.min(targetHeight, MEETING_ROOM_HUMAN_MODEL_MAX_HEIGHT)
        : targetHeight
    if (
      Number.isFinite(limitedTargetHeight) &&
      Number.isFinite(standingHeight) &&
      limitedTargetHeight > 0 &&
      standingHeight > 0
    ) {
      const scale = limitedTargetHeight / standingHeight
      standingModel.scale.multiplyScalar(scale)
      standingModel.updateMatrixWorld(true)
    }

    const alignedBox = new THREE.Box3().setFromObject(standingModel)
    const alignedCenter = alignedBox.getCenter(new THREE.Vector3())
    const targetPosition = MEETING_ROOM_STANDING_IDLE_TARGET_POSITION
    const delta = new THREE.Vector3(
      targetPosition.x - alignedCenter.x,
      targetPosition.y - alignedCenter.y,
      targetPosition.z - alignedCenter.z,
    )
    delta[upAxis] = targetPosition[upAxis] - alignedBox.min[upAxis]
    standingModel.position.add(delta)
    standingModel.updateMatrixWorld(true)
    const splatBox = keepMeetingRoomStandingIdleInsideSplat(standingModel)
    const finalStandingBox = new THREE.Box3().setFromObject(standingModel)
    disposeMeetingRoomStandingIdleDebugGroup()
    console.log('[MeetingRoomStandingIdle] 已对齐站立人物模型:', {
      targetName: MEETING_ROOM_HUMANBODY_SELECTION_NAME,
      targetPositionCm: MEETING_ROOM_STANDING_IDLE_TARGET_POSITION_CM.toArray(),
      targetPosition: targetPosition.toArray(),
      targetBox: {
        min: targetBox.min.toArray(),
        max: targetBox.max.toArray(),
      },
      standingBox: {
        min: finalStandingBox.min.toArray(),
        max: finalStandingBox.max.toArray(),
      },
      splatBox: splatBox
        ? {
            min: splatBox.min.toArray(),
            max: splatBox.max.toArray(),
          }
        : null,
    })
    return true
  }

  function alignMeetingRoomStandingIdleModelToHumanBody() {
    const targetBox = getMeetingRoomHumanBodyBoxFromScene()
    if (targetBox) return alignMeetingRoomStandingIdleModelToBox(targetBox)

    if (!isMeetingRoomTask() || !getGltfModels().get('meetingRoomStandingIdle')) return false
    loadMeetingRoomHumanBodyBoxFromGeometryGlb().then((loadedBox) => {
      if (loadedBox) alignMeetingRoomStandingIdleModelToBox(loadedBox)
    })
    return false
  }

  function getMeetingRoomSplatDisplaySize(box) {
    return box.getSize(new THREE.Vector3())
  }

  function getMeetingRoomSplatClipLocalBounds(box) {
    const size = getMeetingRoomSplatDisplaySize(box)
    const halfSize = size.multiplyScalar(0.5)
    return {
      min: new THREE.Vector3(
        -halfSize.x * MEETING_ROOM_SPLAT_BOX_EXTENTS.widthLeft,
        -halfSize.y * MEETING_ROOM_SPLAT_BOX_EXTENTS.lengthBack,
        -halfSize.z * MEETING_ROOM_SPLAT_BOX_EXTENTS.heightDown,
      ),
      max: new THREE.Vector3(
        halfSize.x * MEETING_ROOM_SPLAT_BOX_EXTENTS.widthRight,
        halfSize.y * MEETING_ROOM_SPLAT_BOX_EXTENTS.lengthFront,
        halfSize.z * MEETING_ROOM_SPLAT_BOX_EXTENTS.heightUp,
      ),
    }
  }

  function buildMeetingRoomSplatObjectMatrix(box = meetingRoomSplatClipBaseBox || MEETING_ROOM_SPLAT_LAS_CLIP_BOX) {
    const center = box.getCenter(new THREE.Vector3())
    const centerMatrix = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z)
    if (meetingRoomSplatObject) {
      meetingRoomSplatObject.updateWorldMatrix(true, false)
      return meetingRoomSplatObject.matrixWorld.clone().multiply(centerMatrix)
    }
    return new THREE.Matrix4()
      .compose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.rotationX,
            0,
            MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.rotationZ,
            MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.rotationOrder,
          ),
        ),
        new THREE.Vector3(
          MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.scale,
          MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.scale,
          MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.scale,
        ),
      )
      .multiply(centerMatrix)
  }

  function boxFromTransformedBounds(min, max, matrix) {
    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          point.set(x, y, z).applyMatrix4(matrix)
          box.expandByPoint(point)
        }
      }
    }
    return box
  }

  function getMeetingRoomSplatWorldClipBox() {
    if (!meetingRoomSplatClipBaseBox) return null
    const { min, max } = getMeetingRoomSplatClipLocalBounds(meetingRoomSplatClipBaseBox)
    const matrix = buildMeetingRoomSplatObjectMatrix(meetingRoomSplatClipBaseBox)
    return boxFromTransformedBounds(min, max, matrix)
  }

  function alignMeetingRoomSplatRightFaceToGeometry() {
    if (!meetingRoomSplatObject || !meetingRoomSplatClipBaseBox) return false
    meetingRoomSplatObject.updateMatrixWorld(true)
    const splatBox = getMeetingRoomSplatWorldClipBox()
    if (!splatBox || splatBox.isEmpty()) return false

    const taskTargetBounds = buildTaskModelTargetBounds()
    let targetBox = null
    if (taskTargetBounds) {
      targetBox = new THREE.Box3(
        new THREE.Vector3(...taskTargetBounds.min),
        new THREE.Vector3(...taskTargetBounds.max),
      )
    } else {
      const geometryModel = getGltfModels().get('geometry')
      if (!geometryModel) return false
      geometryModel.updateMatrixWorld(true)
      targetBox = new THREE.Box3().setFromObject(geometryModel)
    }
    if (!targetBox || targetBox.isEmpty()) return false

    const targetCenter = targetBox.getCenter(new THREE.Vector3())
    const splatCenter = splatBox.getCenter(new THREE.Vector3())
    const delta = new THREE.Vector3(
      targetCenter.x - splatCenter.x,
      targetCenter.y - splatCenter.y,
      targetBox.min.z - splatBox.min.z,
    )
    if (
      !Number.isFinite(delta.x) ||
      !Number.isFinite(delta.y) ||
      !Number.isFinite(delta.z) ||
      delta.lengthSq() < 1e-8
    ) {
      return false
    }

    meetingRoomSplatObject.position.add(delta)
    meetingRoomSplatObject.updateMatrixWorld(true)
    updateMeetingRoomSplatClipUniforms()
    updateMeetingRoomSplatDebugGroup()
    return true
  }

  function isMeetingRoomRealModelLayerVisible(task = getCurrentTask()) {
    syncVisibleLayerIdsFromProps()
    const taskId = task?.id || 'default'
    return isMeetingRoomTask(task) && getRuntimeState().value.visibleLayerIds.has(`realModel:${taskId}`)
  }

  function getMeetingRoomCameraBounds() {
    if (!isMeetingRoomRealModelLayerVisible()) return null
    const box = getMeetingRoomSplatWorldClipBox()
    if (!box || box.isEmpty()) return null
    return box
  }

  function clampVectorToBox(vector, box) {
    vector.x = Math.max(box.min.x, Math.min(box.max.x, vector.x))
    vector.y = Math.max(box.min.y, Math.min(box.max.y, vector.y))
    vector.z = Math.max(box.min.z, Math.min(box.max.z, vector.z))
  }

  function getMeetingRoomCameraLookDistance(box) {
    const size = box.getSize(new THREE.Vector3())
    return Math.max(size.x * 0.25, MEETING_ROOM_CAMERA_MIN_LOOK_DISTANCE)
  }

  function alignMeetingRoomCameraForwardToYozPlane(box) {
    const camera = getCamera()
    const controls = getControls()
    const distance = getMeetingRoomCameraLookDistance(box)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const forwardOffset = Math.max(0, size.x * MEETING_ROOM_CAMERA_DEFAULT_FORWARD_OFFSET_RATIO)
    camera.position.set(box.min.x + forwardOffset, center.y, center.z)
    controls.target.copy(camera.position).addScaledVector(MEETING_ROOM_CAMERA_FORWARD, distance)
  }

  function constrainMeetingRoomCameraFrame() {
    const camera = getCamera()
    const controls = getControls()
    if (!camera || !controls) return
    const box = getMeetingRoomCameraBounds()
    if (!box) {
      meetingRoomCameraPoseInitialized = false
      camera.up.copy(DEFAULT_CAMERA_UP)
      return
    }

    if (!meetingRoomCameraPoseInitialized) {
      alignMeetingRoomCameraForwardToYozPlane(box)
      camera.up.copy(DEFAULT_CAMERA_UP)
      camera.lookAt(controls.target)
      meetingRoomCameraPoseInitialized = true
    }

    const previousPosition = camera.position.clone()
    clampVectorToBox(camera.position, box)
    const cameraDelta = camera.position.clone().sub(previousPosition)
    if (cameraDelta.lengthSq() > 1e-10) {
      controls.target.add(cameraDelta)
    }
    controls.update?.()
  }

  function filterStandardSplatBufferToBox(buffer, clipBox) {
    const sourceCount = Math.floor(buffer.byteLength / STANDARD_SPLAT_BYTES)
    const sourceView = new DataView(buffer)
    const filteredBox = new THREE.Box3()
    const point = new THREE.Vector3()
    let count = 0

    for (let i = 0; i < sourceCount; i += 1) {
      const base = i * STANDARD_SPLAT_BYTES
      point.set(
        sourceView.getFloat32(base, true),
        sourceView.getFloat32(base + 4, true),
        sourceView.getFloat32(base + 8, true),
      )
      if (
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.z) &&
        clipBox.containsPoint(point)
      ) {
        filteredBox.expandByPoint(point)
        count += 1
      }
    }

    return { count, box: filteredBox }
  }

  function disposeMeetingRoomSplatRevealEffect() {
    if (!meetingRoomSplatRevealState) return
    removeFrameCallback(tickMeetingRoomSplatRevealEffect)
    const points = meetingRoomSplatRevealState.points
    points?.parent?.remove(points)
    points?.geometry?.dispose?.()
    points?.material?.dispose?.()
    meetingRoomSplatRevealState = null
  }

  function createMeetingRoomSplatRevealEffect(buffer, clipBox, object = meetingRoomSplatObject) {
    disposeMeetingRoomSplatRevealEffect()
    const modelGroup = getModelGroup()
    if (!modelGroup || !buffer || !object) return

    const sourceCount = Math.floor(buffer.byteLength / STANDARD_SPLAT_BYTES)
    if (!sourceCount) return

    const sourceView = new DataView(buffer)
    const stride = Math.max(1, Math.floor(sourceCount / MEETING_ROOM_SPLAT_REVEAL_POINT_COUNT))
    const positions = []
    const randoms = []
    const point = new THREE.Vector3()
    const localPoint = new THREE.Vector3()

    object.updateMatrixWorld(true)
    modelGroup.updateMatrixWorld(true)
    for (
      let sourceIndex = 0;
      sourceIndex < sourceCount && positions.length / 3 < MEETING_ROOM_SPLAT_REVEAL_POINT_COUNT;
      sourceIndex += stride
    ) {
      const base = sourceIndex * STANDARD_SPLAT_BYTES
      point.set(
        sourceView.getFloat32(base, true),
        sourceView.getFloat32(base + 4, true),
        sourceView.getFloat32(base + 8, true),
      )
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z) ||
        !clipBox.containsPoint(point)
      ) {
        continue
      }

      localPoint.copy(point).applyMatrix4(object.matrixWorld)
      modelGroup.worldToLocal(localPoint)
      const random = Math.abs(
        (Math.sin((sourceIndex + 1) * 12.9898) * 43758.5453) % 1,
      )
      positions.push(localPoint.x, localPoint.y, localPoint.z)
      randoms.push(random)
    }

    if (!positions.length) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(randoms, 1))
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uPixelRatio: {
          value: Math.min(2, getRenderer()?.getPixelRatio?.() || window.devicePixelRatio || 1),
        },
        uColorA: { value: new THREE.Color('#5ef6ff') },
        uColorB: { value: new THREE.Color('#ffe9a8') },
      },
      vertexShader: `
        attribute float aRandom;
        varying float vRandom;
        uniform float uProgress;
        uniform float uPixelRatio;

        void main() {
          vRandom = aRandom;
          float burst = sin(uProgress * 3.14159265);
          vec3 drift = normalize(position + vec3(0.001)) * burst * (0.035 + aRandom * 0.11);
          vec4 mvPosition = modelViewMatrix * vec4(position + drift, 1.0);
          float size = mix(10.0, 2.8, uProgress) * (0.65 + aRandom * 0.75);
          gl_PointSize = size * uPixelRatio / max(0.45, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vRandom;
        uniform float uProgress;
        uniform vec3 uColorA;
        uniform vec3 uColorB;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float dist = length(uv);
          float disc = 1.0 - smoothstep(0.12, 0.5, dist);
          float core = 1.0 - smoothstep(0.0, 0.18, dist);
          float envelope = smoothstep(0.0, 0.16, uProgress) * (1.0 - smoothstep(0.58, 1.0, uProgress));
          vec3 color = mix(uColorA, uColorB, vRandom * 0.65) + core * 0.65;
          gl_FragColor = vec4(color, disc * envelope * 0.92);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, material)
    points.name = '__meetingRoomSplatRevealPoints'
    points.frustumCulled = false
    modelGroup.add(points)
    meetingRoomSplatRevealState = {
      points,
      startTime: null,
      duration: MEETING_ROOM_SPLAT_REVEAL_DURATION,
    }
    addFrameCallback(tickMeetingRoomSplatRevealEffect)
  }

  function tickMeetingRoomSplatRevealEffect(elapsed) {
    const state = meetingRoomSplatRevealState
    if (!state?.points?.material?.uniforms) return
    if (state.startTime == null) state.startTime = elapsed
    const progress = THREE.MathUtils.clamp(
      (elapsed - state.startTime) / Math.max(0.05, state.duration),
      0,
      1,
    )
    state.points.material.uniforms.uProgress.value = progress
    if (progress >= 1) {
      disposeMeetingRoomSplatRevealEffect()
    }
  }

  function updateMeetingRoomSplatClipUniforms() {
    if (!meetingRoomSplatClipUniforms || !meetingRoomSplatClipBaseBox) return

    const { min, max } = getMeetingRoomSplatClipLocalBounds(meetingRoomSplatClipBaseBox)
    meetingRoomSplatClipUniforms.clipBoxEnabled.value = 1
    meetingRoomSplatClipUniforms.clipBoxWorldInverse.value
      .copy(buildMeetingRoomSplatObjectMatrix(meetingRoomSplatClipBaseBox))
      .invert()
    meetingRoomSplatClipUniforms.clipBoxMin.value.set(
      min.x - MEETING_ROOM_SPLAT_CLIP_PADDING,
      min.y - MEETING_ROOM_SPLAT_CLIP_PADDING,
      min.z - MEETING_ROOM_SPLAT_CLIP_PADDING,
    )
    meetingRoomSplatClipUniforms.clipBoxMax.value.set(
      max.x + MEETING_ROOM_SPLAT_CLIP_PADDING,
      max.y + MEETING_ROOM_SPLAT_CLIP_PADDING,
      max.z + MEETING_ROOM_SPLAT_CLIP_PADDING,
    )
    if (meetingRoomSplatObject?.viewer?.splatMesh?.material) {
      meetingRoomSplatObject.viewer.splatMesh.material.uniformsNeedUpdate = true
    }
  }

  function resolveMeetingRoomGaussianScale() {
    const raw = Number(getVisualization()?.meeting_room_gaussian_scale)
    if (!Number.isFinite(raw) || raw <= 0) return 1
    return Math.max(0.2, Math.min(3, raw))
  }

  function applyMeetingRoomGaussianScale() {
    const scale = MEETING_ROOM_SPLAT_SCALE * resolveMeetingRoomGaussianScale()
    meetingRoomSplatObject?.viewer?.splatMesh?.setSplatScale?.(scale)
    applyMeetingRoomSplatObjectTransform()
  }

  function disableMeetingRoomSplatFrustumCulling(object = meetingRoomSplatObject) {
    if (!object) return
    object.frustumCulled = false
    object.traverse?.((child) => {
      child.frustumCulled = false
    })
    if (object.viewer?.splatMesh) {
      object.viewer.splatMesh.frustumCulled = false
    }
  }

  function applyMeetingRoomSplatObjectTransform(object = meetingRoomSplatObject) {
    if (!object) return
    disableMeetingRoomSplatFrustumCulling(object)
    object.rotation.set(
      MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.rotationX,
      0,
      MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.rotationZ,
      MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.rotationOrder,
    )
    object.scale.setScalar(MEETING_ROOM_SPLAT_OBJECT_TRANSFORM.scale)
    object.updateMatrixWorld(true)
    object.viewer?.splatMesh?.updateMatrixWorld?.(true)
    object.viewer?.splatMesh?.updateTransforms?.()
  }

  function patchMeetingRoomSplatClipMaterial(material) {
    if (!material || material.userData?.meetingRoomBoxClipPatched) return

    material.userData.meetingRoomBoxClipPatched = true
    material.onBeforeCompile = (shader) => {
      shader.uniforms.clipBoxEnabled = { value: 1 }
      shader.uniforms.clipBoxWorldInverse = { value: new THREE.Matrix4() }
      shader.uniforms.clipBoxMin = { value: new THREE.Vector3() }
      shader.uniforms.clipBoxMax = { value: new THREE.Vector3() }
      meetingRoomSplatClipUniforms = shader.uniforms

      shader.vertexShader = shader.vertexShader
        .replace(
          'varying vec2 vPosition;',
          `varying vec2 vPosition;
        uniform mat4 clipBoxWorldInverse;
        varying vec3 vClipBoxLocalPosition;`,
        )
        .replace(
          'gl_Position = quadPos;',
          `gl_Position = quadPos;
            vec4 clipViewPosition = inverse(projectionMatrix) * quadPos;
            clipViewPosition /= clipViewPosition.w;
            vec4 clipWorldPosition = inverse(viewMatrix) * clipViewPosition;
            vClipBoxLocalPosition = (clipBoxWorldInverse * clipWorldPosition).xyz;`,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          'varying vec2 vPosition;',
          `varying vec2 vPosition;
            uniform int clipBoxEnabled;
            uniform vec3 clipBoxMin;
            uniform vec3 clipBoxMax;
            varying vec3 vClipBoxLocalPosition;`,
        )
        .replace(
          'float A = dot(vPosition, vPosition);',
          `if (clipBoxEnabled == 1) {
                    if (
                        vClipBoxLocalPosition.x < clipBoxMin.x ||
                        vClipBoxLocalPosition.y < clipBoxMin.y ||
                        vClipBoxLocalPosition.z < clipBoxMin.z ||
                        vClipBoxLocalPosition.x > clipBoxMax.x ||
                        vClipBoxLocalPosition.y > clipBoxMax.y ||
                        vClipBoxLocalPosition.z > clipBoxMax.z
                    ) discard;
                }
                float A = dot(vPosition, vPosition);`,
        )

      updateMeetingRoomSplatClipUniforms()
    }
    material.needsUpdate = true
  }

  function disposeMeetingRoomSplat() {
    meetingRoomSplatLoadToken += 1
    disposeMeetingRoomSplatRevealEffect()
    disposeMeetingRoomSplatDebugGroup()
    if (meetingRoomSplatObject) {
      getModelGroup()?.remove(meetingRoomSplatObject)
      meetingRoomSplatObject.dispose?.()
      meetingRoomSplatObject = null
    }
    if (meetingRoomSplatObjectUrl) {
      URL.revokeObjectURL(meetingRoomSplatObjectUrl)
      meetingRoomSplatObjectUrl = ''
    }
    meetingRoomSplatClipUniforms = null
    meetingRoomSplatClipBaseBox = null
  }

  async function syncMeetingRoomSplatForTask(task = getCurrentTask()) {
    if (!isMeetingRoomRealModelLayerVisible(task)) {
      disposeMeetingRoomSplat()
      return
    }
    const modelGroup = getModelGroup()
    if (!modelGroup || meetingRoomSplatObject) return

    const currentToken = ++meetingRoomSplatLoadToken
    try {
      const response = await fetch(MEETING_ROOM_SPLAT_URL)
      if (!response.ok) {
        throw new Error(`会议室 3DGS 加载失败: ${response.status} ${response.statusText}`)
      }
      const buffer = await response.arrayBuffer()
      if (currentToken !== meetingRoomSplatLoadToken) return

      const filteredStats = filterStandardSplatBufferToBox(buffer, MEETING_ROOM_SPLAT_LAS_CLIP_BOX)
      if (!filteredStats.count || filteredStats.box.isEmpty()) {
        throw new Error('会议室 3DGS 在裁剪包围盒内没有可显示点')
      }
      meetingRoomSplatClipBaseBox = filteredStats.box.clone()
      meetingRoomSplatObjectUrl = URL.createObjectURL(
        new Blob([buffer], { type: 'application/octet-stream' }),
      )

      const object = new GaussianSplats3D.DropInViewer({
        gpuAcceleratedSort: false,
        sharedMemoryForWorkers: false,
        integerBasedSort: false,
        halfPrecisionCovariancesOnGPU: false,
        sphericalHarmonicsDegree: 0,
        kernel2DSize: 0.05,
        maxScreenSpaceSplatSize: 512,
        sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
        splatRenderMode: GaussianSplats3D.SplatRenderMode.ThreeD,
        logLevel: GaussianSplats3D.LogLevel.None,
      })
      object.name = 'MeetingRoomSplat'
      object.userData.layerKind = 'meetingRoomSplat'
      object.userData.isGaussianSplatModel = true

      await object.addSplatScene(meetingRoomSplatObjectUrl, {
        format: GaussianSplats3D.SceneFormat.Splat,
        progressiveLoad: false,
        showLoadingUI: false,
        splatAlphaRemovalThreshold: 5,
      })
      if (currentToken !== meetingRoomSplatLoadToken) {
        object.dispose?.()
        return
      }

      applyMeetingRoomSplatObjectTransform(object)
      meetingRoomSplatClipUniforms = null

      meetingRoomSplatObject = object
      applyMeetingRoomGaussianScale()
      modelGroup.add(object)
      alignMeetingRoomSplatRightFaceToGeometry()
      createMeetingRoomSplatRevealEffect(buffer, MEETING_ROOM_SPLAT_LAS_CLIP_BOX, object)
      updateMeetingRoomSplatDebugGroup()
      alignMeetingRoomStandingIdleModelToHumanBody()
      console.log('[ThreeCanvas] 会议室 3DGS 已加载:', {
        splatCount: Math.floor(buffer.byteLength / STANDARD_SPLAT_BYTES),
        visibleSplatCount: Math.floor(buffer.byteLength / STANDARD_SPLAT_BYTES),
        clippedCount: filteredStats.count,
        clippedBounds: {
          min: filteredStats.box.min.toArray(),
          max: filteredStats.box.max.toArray(),
        },
      })
    } catch (error) {
      if (currentToken === meetingRoomSplatLoadToken) {
        disposeMeetingRoomSplat()
        console.error('[ThreeCanvas] 会议室 3DGS 加载失败:', error)
      }
    }
  }

  return {
    isMeetingRoomTask,
    syncMeetingRoomSplatForTask,
    disposeMeetingRoomSplat,
    disposeMeetingRoomStandingIdleDebugGroup,
    disposeMeetingRoomSplatDebugGroup,
    updateMeetingRoomSplatDebugGroup,
    alignMeetingRoomSplatRightFaceToGeometry,
    alignMeetingRoomStandingIdleModelToHumanBody,
    applyMeetingRoomGaussianScale,
    resetMeetingRoomHumanBodyCache,
  }
}
