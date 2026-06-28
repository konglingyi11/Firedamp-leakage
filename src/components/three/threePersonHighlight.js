import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const PERSON_MODEL_KEYS = new Set(['meetingRoomStandingIdle', 'personGeometry', 'personReal'])

// 部位分色表：部位前缀 → 颜色
const SKELETON_PART_COLORS = {
  head:      0xff4444, // 红
  spine:     0xffaa00, // 橙
  leftArm:   0x00ccff, // 青
  rightArm:  0x00ff88, // 绿
  leftLeg:   0xaa66ff, // 紫
  rightLeg:  0xffff00, // 黄
  hips:      0xff6699, // 粉
}

export function createPersonHighlight({
  getGltfModels,
  getModelGroup,
  getScene,
  getVisualization,
  disposeModelObject,
  focusCameraOnObject,
  ensureGLTFModelLoaded,
  findGLTFModelKeyForObject,
  resolveOpacityForModelKey,
  createPersonInfoPopup,
  disposePersonInfoPopup,
  applyModelBaseTransform,
  personModelTransform,
}) {
  let personModelObject = null
  let personModelLoadKey = 0
  let personModelVisible = false
  let highlightedPersonMaterials = new Map()
  let personScanOverlay = null
  let skeletonGroup = null
  let skeletonOverlayModel = null
  let skeletonOverlayLoadKey = 0

  function findExistingPersonModel() {
    const gltfModels = getGltfModels()
    for (const [key, model] of gltfModels.entries()) {
      if (PERSON_MODEL_KEYS.has(key) && model) return model
    }
    return null
  }

  function setPersonModelVisible(visible) {
    personModelVisible = visible
    const modelGroup = getModelGroup()

    // 优先控制已加载的人物模型
    const existing = findExistingPersonModel()
    if (existing) {
      existing.visible = visible
      personModelObject = existing
      return
    }

    // 已通过本按钮加载过的模型
    if (personModelObject) {
      personModelObject.visible = visible
      return
    }

    if (!visible) return

    // 场景中没有人物模型，加载一个新的
    const loadKey = ++personModelLoadKey
    const loader = new GLTFLoader()
    loader.load('/person.glb', (gltf) => {
      if (loadKey !== personModelLoadKey) {
        disposeModelObject(gltf.scene)
        return
      }
      const model = gltf.scene
      model.userData.gltfModelKey = 'personModel'
      model.userData.layerKind = 'personModel'
      applyModelBaseTransform(model, personModelTransform)
      if (gltf.animations?.length) {
        const clip = gltf.animations[0]
        const mixer = new THREE.AnimationMixer(model)
        const action = mixer.clipAction(clip)
        action.play()
        const frameTime = Number(personModelTransform?.animationFrameTime) || 0
        mixer.setTime(Math.max(0, Math.min(frameTime, clip.duration || 0)))
        action.paused = true
      }
      model.visible = personModelVisible
      modelGroup.add(model)
      personModelObject = model
    })
  }

  function isPersonModelVisible() {
    return personModelVisible
  }

  function resolveModelOpacity() {
    const raw = Number(getVisualization()?.model_opacity)
    if (!Number.isFinite(raw)) return 0.35
    return Math.max(0.05, Math.min(1, raw))
  }

  function clampPersonModelOpacity(value, fallback = 1) {
    const raw = Number(value)
    if (!Number.isFinite(raw)) return fallback
    return Math.max(0, Math.min(1, raw))
  }

  function resolveConfiguredModelOpacity(config) {
    const visualization = getVisualization()
    if (config?.key === 'personGeometry') {
      return clampPersonModelOpacity(visualization?.person_model_opacity)
    }
    if (config?.key === 'personReal') {
      return clampPersonModelOpacity(visualization?.person_real_model_opacity)
    }
    if (config?.key === 'real' || config?.useRealModelOpacity) {
      const raw = Number(visualization?.real_model_opacity)
      if (Number.isFinite(raw)) {
        return Math.max(0.05, Math.min(1, raw))
      }
      return 1
    }
    const raw = Number(config?.opacity)
    if (Number.isFinite(raw)) {
      return Math.max(0.05, Math.min(1, raw))
    }
    return resolveModelOpacity()
  }

  function clearPersonModelHighlight() {
    disposePersonInfoPopup()
    disposePersonScanOverlay()
    for (const [material, original] of highlightedPersonMaterials.entries()) {
      if (!material) continue
      if (material.color && original.color) {
        material.color.copy(original.color)
      }
      if (material.emissive && original.emissive) {
        material.emissive.copy(original.emissive)
      }
      if ('emissiveIntensity' in material) {
        material.emissiveIntensity = original.emissiveIntensity
      }
      material.needsUpdate = true
    }
    highlightedPersonMaterials.clear()
  }

  function disposePersonScanOverlay() {
    if (!personScanOverlay) return
    personScanOverlay.parent?.remove(personScanOverlay)
    personScanOverlay.traverse((child) => {
      if (child.userData?.isPersonScanOverlayEdges && child.geometry) {
        child.geometry.dispose()
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material?.dispose?.())
        } else {
          child.material.dispose?.()
        }
      }
    })
    personScanOverlay = null
  }

  /** 体数据与人物 AABB 相交时的描边（挂在各 mesh 子节点，随骨骼/位姿更新） */
  function disposePersonVolumeIntersectEdges() {
    const gltfModels = getGltfModels()
    for (const model of gltfModels.values()) {
      if (!model) continue
      model.traverse((child) => {
        if (!child?.isMesh) return
        const toRemove = []
        for (let i = 0; i < child.children.length; i += 1) {
          const c = child.children[i]
          if (c?.userData?.isPersonVolumeIntersectOutline) toRemove.push(c)
        }
        for (const c of toRemove) {
          child.remove(c)
          c.geometry?.dispose?.()
          const m = c.material
          if (Array.isArray(m)) m.forEach((mat) => mat?.dispose?.())
          else m?.dispose?.()
        }
      })
    }
  }

  function attachPersonVolumeIntersectEdges(model) {
    if (!model) return
    const edgeColor = 0xffdd44
    model.traverse((child) => {
      if (!child?.isMesh || !child.geometry) return
      const edgesGeometry = new THREE.EdgesGeometry(child.geometry, 16)
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      })
      const lines = new THREE.LineSegments(edgesGeometry, edgeMaterial)
      lines.name = '__personVolumeIntersectOutline'
      lines.userData.isPersonVolumeIntersectOutline = true
      lines.renderOrder = 1005
      child.add(lines)
    })
  }

  function setVolumePersonIntersectHighlight(on, { personModelKey } = {}) {
    const gltfModels = getGltfModels()
    if (!on) {
      disposePersonVolumeIntersectEdges()
      return
    }
    const key = String(personModelKey || '')
    const model =
      (key && gltfModels.get(key)) || getPersonModelForHighlight()
    if (!model?.parent) return
    disposePersonVolumeIntersectEdges()
    attachPersonVolumeIntersectEdges(model)
  }

  function getPersonModelForHighlight() {
    const gltfModels = getGltfModels()
    const personReal = gltfModels.get('personReal') || null
    const personGeometry = gltfModels.get('personGeometry') || null
    return [personReal, personGeometry].find((model) => model?.visible) || personReal || personGeometry
  }

  // --- Skeleton overlay (火柴人) ---

  function classifyBone(name) {
    if (!name) return 'spine'
    const n = name.toLowerCase()
    if (n.includes('head') || n.includes('neck')) return 'head'
    if (n.includes('leftshoulder') || n.includes('leftarm') || n.includes('leftforearm') || n.includes('lefthand')) return 'leftArm'
    if (n.includes('rightshoulder') || n.includes('rightarm') || n.includes('rightforearm') || n.includes('righthand')) return 'rightArm'
    if (n.includes('leftupleg') || n.includes('leftleg') || n.includes('leftfoot') || n.includes('lefttoe')) return 'leftLeg'
    if (n.includes('rightupleg') || n.includes('rightleg') || n.includes('rightfoot') || n.includes('righttoe')) return 'rightLeg'
    if (n.includes('hips')) return 'hips'
    return 'spine'
  }

  function buildSkeletonStickman(root) {
    // 按部位收集骨骼线段
    const partSegments = {} // partName → [vec3, vec3, ...]
    const tmpP = new THREE.Vector3()
    const tmpC = new THREE.Vector3()

    function isBoneNode(node) {
      return node.isBone || (node.name && /^mixamorig:/i.test(node.name)) || node.type === 'Bone'
    }

    function collect(node) {
      if (!isBoneNode(node)) { for (const c of node.children) collect(c); return }
      if (node.parent && isBoneNode(node.parent)) {
        node.parent.getWorldPosition(tmpP)
        node.getWorldPosition(tmpC)
        root.worldToLocal(tmpP)
        root.worldToLocal(tmpC)
        const part = classifyBone(node.name)
        if (!partSegments[part]) partSegments[part] = []
        partSegments[part].push(tmpP.clone(), tmpC.clone())
      }
      for (const c of node.children) collect(c)
    }
    collect(root)

    const group = new THREE.Group()
    group.userData.isSkeletonOverlay = true

    // 每个部位一组 LineSegments
    for (const [part, pts] of Object.entries(partSegments)) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({
        color: SKELETON_PART_COLORS[part] || 0xffffff,
        linewidth: 2,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      })
      const line = new THREE.LineSegments(geo, mat)
      line.frustumCulled = false
      line.renderOrder = 9999
      group.add(line)
    }

    // 头部圆球：找到 Head 节点位置
    let headPos = null
    let headRadius = 0.12
    root.traverse((node) => {
      if (node.name === 'mixamorig:Head' && !headPos) {
        headPos = new THREE.Vector3()
        node.getWorldPosition(headPos)
        root.worldToLocal(headPos)
        // 用 Head 到 Neck 的距离来估算头部大小
        const neck = node.children?.find(c => c.name === 'mixamorig:HeadTop_End') || node.parent
        if (neck) {
          const neckPos = new THREE.Vector3()
          neck.getWorldPosition(neckPos)
          root.worldToLocal(neckPos)
          headRadius = Math.max(headPos.distanceTo(neckPos) * 2.5, 0.15)
        }
      }
    })
    if (headPos) {
      const headGeo = new THREE.SphereGeometry(headRadius, 16, 12)
      const headMat = new THREE.MeshBasicMaterial({
        color: SKELETON_PART_COLORS.head,
        depthTest: false,
        transparent: true,
        opacity: 0.6,
      })
      const headMesh = new THREE.Mesh(headGeo, headMat)
      headMesh.position.copy(headPos)
      headMesh.renderOrder = 9999
      group.add(headMesh)
    }

    return group
  }

  function setPersonSkeletonVisible(visible) {
    const scene = getScene()
    if (!scene) return
    const gltfModels = getGltfModels()
    const modelGroup = getModelGroup()

    // 清理旧的骨架 overlay
    if (skeletonGroup) {
      skeletonGroup.parent?.remove(skeletonGroup)
      skeletonGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
      skeletonGroup = null
    }
    if (skeletonOverlayModel) {
      modelGroup?.remove(skeletonOverlayModel)
      disposeModelObject(skeletonOverlayModel)
      skeletonOverlayModel = null
    }
    skeletonOverlayLoadKey++

    if (!visible) return

    // First try: 从已加载的模型中查找骨骼并绘制
    let foundBones = false
    for (const [key, model] of gltfModels.entries()) {
      if (!model || !model.visible) continue
      model.updateMatrixWorld(true)

      let hasBones = false
      model.traverse((child) => {
        if (child.isBone || (child.name && /^mixamorig:/i.test(child.name))) hasBones = true
      })

      if (hasBones) {
        foundBones = true
        skeletonGroup = buildSkeletonStickman(model)
        model.add(skeletonGroup)
        break
      }
    }

    // Second try: 加载 person.glb 透明 overlay
    if (!foundBones) {
      const loadKey = skeletonOverlayLoadKey
      const loader = new GLTFLoader()
      loader.load('/person.glb', (gltf) => {
        if (loadKey !== skeletonOverlayLoadKey) {
          disposeModelObject(gltf.scene)
          return
        }
        const overlay = gltf.scene
        overlay.userData.gltfModelKey = 'skeletonOverlay'
        overlay.userData.layerKind = 'model'

        overlay.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              const mats = Array.isArray(child.material) ? child.material : [child.material]
              mats.forEach((m) => {
                m.transparent = true
                m.opacity = 0.06
                m.depthWrite = false
                m.depthTest = false
              })
            }
            child.castShadow = false
            child.receiveShadow = false
            child.renderOrder = 9998
          }
        })

        overlay.position.set(2.4, -1.1, -1)
        overlay.rotation.set(Math.PI / 2, Math.PI, 0)
        overlay.scale.setScalar(1)
        overlay.updateMatrixWorld(true)

        const stickman = buildSkeletonStickman(overlay)
        overlay.add(stickman)

        skeletonOverlayModel = overlay
        modelGroup.add(overlay)
      })
    }
  }

  function resolveOpacityForModelObject(object) {
    const key = findGLTFModelKeyForObject(object)
    if (key) return resolveOpacityForModelKey(key)
    return 1
  }

  function updatePersonScanOverlayOpacity() {
    if (!personScanOverlay) return
    const sourceOpacity = resolveOpacityForModelKey(
      personScanOverlay.userData.sourceModelKey,
      clampPersonModelOpacity(personScanOverlay.userData.sourceOpacity, 1),
    )
    personScanOverlay.userData.sourceOpacity = sourceOpacity
    personScanOverlay.traverse((child) => {
      const material = child?.material
      if (!material) return
      const materials = Array.isArray(material) ? material : [material]
      materials.forEach((item) => {
        if (!item) return
        if (child.userData?.isPersonScanOverlayEdges) {
          item.opacity = 0.55 * sourceOpacity
        } else if (child.userData?.isPersonScanOverlayMesh) {
          item.opacity = 0.82 * sourceOpacity
        }
        item.visible = item.opacity > 0
        item.needsUpdate = true
      })
    })
  }

  function createPersonScanOverlay(model) {
    disposePersonScanOverlay()
    if (!model?.parent) return null

    const sourceOpacity = resolveOpacityForModelObject(model)
    const sourceModelKey = findGLTFModelKeyForObject(model)
    const overlay = model.clone(true)
    overlay.name = '__personScanOverlay'
    overlay.userData.isPersonScanOverlay = true
    overlay.userData.sourceOpacity = sourceOpacity
    overlay.userData.sourceModelKey = sourceModelKey
    overlay.renderOrder = 2200
    overlay.traverse((child) => {
      child.renderOrder = 2200
      child.frustumCulled = false
      if (!child?.isMesh || !child.geometry) return
      child.userData.isPersonScanOverlayMesh = true

      child.material = new THREE.MeshBasicMaterial({
        color: 0x00f3ff,
        transparent: true,
        opacity: 0.82 * sourceOpacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        wireframe: true,
        blending: THREE.AdditiveBlending,
      })

      const edgesGeometry = new THREE.EdgesGeometry(child.geometry, 18)
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x7df9ff,
        transparent: true,
        opacity: 0.55 * sourceOpacity,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const edges = new THREE.LineSegments(edgesGeometry, edgeMaterial)
      edges.name = '__personScanOverlayEdges'
      edges.userData.isPersonScanOverlayEdges = true
      edges.renderOrder = 1201
      child.add(edges)
    })
    overlay.visible = false
    model.parent.add(overlay)
    personScanOverlay = overlay
    return overlay
  }

  function setPersonScanOverlayVisible(visible) {
    if (!personScanOverlay) return false
    personScanOverlay.visible = Boolean(visible)
    return true
  }

  function applyPersonModelMaterialHighlight(model) {
    if (!model) return 0
    let highlightedCount = 0
    const highlightColor = new THREE.Color(0x00f3ff)
    model.traverse((child) => {
      if (!child?.isMesh || !child.material) return
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material]
      for (const material of materials) {
        if (!material || highlightedPersonMaterials.has(material)) continue
        highlightedPersonMaterials.set(material, {
          color: material.color?.clone?.() || null,
          emissive: material.emissive?.clone?.() || null,
          emissiveIntensity: material.emissiveIntensity,
        })
        if (material.color) {
          material.color.lerp(highlightColor, 0.18)
        }
        if (material.emissive) {
          material.emissive.copy(highlightColor)
          material.emissiveIntensity = Math.max(
            Number(material.emissiveIntensity) || 0,
            0.9,
          )
        }
        material.needsUpdate = true
        highlightedCount += 1
      }
    })
    return highlightedCount
  }

  function highlightPersonModel(options = {}) {
    const model = getPersonModelForHighlight()
    if (!model) {
      ensureGLTFModelLoaded()?.then(() => highlightPersonModel(options))
      return false
    }

    clearPersonModelHighlight()
    const highlightedCount = applyPersonModelMaterialHighlight(model)
    createPersonScanOverlay(model)
    setPersonScanOverlayVisible(true)
    if (options.personInfo) {
      createPersonInfoPopup(model, options.personInfo)
    }
    if (options.focus) {
      focusCameraOnObject(model)
    }
    return highlightedCount > 0
  }

  function resolveAnimationTrackNodeName(trackName) {
    const raw = String(trackName || '')
    const propertyStart = raw.search(/\.(position|quaternion|scale|rotation|morphTargetInfluences)\b/)
    const path = propertyStart >= 0 ? raw.slice(0, propertyStart) : raw
    const lastSegment = path.split('/').filter(Boolean).pop() || path
    return lastSegment.replace(/^\[[^\]]+\]/, '').trim()
  }

  function findAnimatedTargetObject(model) {
    if (!model) return null
    const animations = Array.isArray(model.userData?.gltfAnimations)
      ? model.userData.gltfAnimations
      : []
    const nodeNames = []
    for (const clip of animations) {
      for (const track of clip?.tracks || []) {
        const name = resolveAnimationTrackNodeName(track?.name)
        if (name) nodeNames.push(name)
      }
    }
    const uniqueNames = [...new Set(nodeNames)]
    const animatedNodes = []
    for (const name of uniqueNames) {
      const node = model.getObjectByName(name)
      if (node) animatedNodes.push(node)
    }
    let target = animatedNodes.find((node) => node?.isMesh) || null
    if (!target && animatedNodes.length) {
      const animatedNodeSet = new Set(animatedNodes)
      model.traverse((child) => {
        if (target || !child?.isSkinnedMesh) return
        const bones = child.skeleton?.bones || []
        if (bones.some((bone) => animatedNodeSet.has(bone))) {
          target = child
        }
      })
    }
    if (!target && animatedNodes.length) {
      target = animatedNodes[0]
    }
    if (!target && animations.length) {
      model.traverse((child) => {
        if (!target && (child?.isSkinnedMesh || child?.isMesh)) target = child
      })
    }
    if (!target) return null
    if (target.isMesh) return target
    let mesh = null
    target.traverse((child) => {
      if (!mesh && child?.isMesh) mesh = child
    })
    return mesh || target
  }

  function getAnimatedModelTargetForHighlight() {
    const gltfModels = getGltfModels()
    const preferredKeys = ['real', 'geometry']
    for (const key of preferredKeys) {
      const model = gltfModels.get(key)
      const target = findAnimatedTargetObject(model)
      if (target) return target
    }
    return null
  }

  function highlightAnimatedModelTarget(options = {}) {
    const target = getAnimatedModelTargetForHighlight()
    if (!target) {
      ensureGLTFModelLoaded()?.then(() => highlightAnimatedModelTarget(options))
      return false
    }

    clearPersonModelHighlight()
    const highlightedCount = applyPersonModelMaterialHighlight(target)
    console.log(
      `[GLTF 动画目标] 高亮对象=${target.name || target.type || 'unnamed'} mesh=${Boolean(target.isMesh)} skinned=${Boolean(target.isSkinnedMesh)} materials=${highlightedCount}`,
    )
    createPersonScanOverlay(target)
    setPersonScanOverlayVisible(true)
    if (options.personInfo) {
      createPersonInfoPopup(target, options.personInfo)
    }
    if (options.focus) {
      focusCameraOnObject(target)
    }
    return highlightedCount > 0
  }

  /** 清理指定模型上挂载的骨骼叠加层（供 disposeModelObject 调用） */
  function disposeSkeletonForModel(model) {
    if (!model) return
    if (skeletonGroup && skeletonGroup.parent === model) {
      skeletonGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
      model.remove(skeletonGroup)
      skeletonGroup = null
    }
    if (skeletonOverlayModel === model) {
      skeletonOverlayModel = null
    }
  }

  /** 完整释放人员高亮模块状态（onUnmount / clearGLTFModel 调用） */
  function disposePersonHighlight() {
    clearPersonModelHighlight()
    const modelGroup = getModelGroup()
    if (skeletonGroup) {
      skeletonGroup.parent?.remove(skeletonGroup)
      skeletonGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
      skeletonGroup = null
    }
    if (skeletonOverlayModel) {
      modelGroup?.remove(skeletonOverlayModel)
      disposeModelObject(skeletonOverlayModel)
      skeletonOverlayModel = null
    }
    skeletonOverlayLoadKey++
    if (personModelObject) {
      modelGroup?.remove(personModelObject)
      disposeModelObject(personModelObject)
      personModelObject = null
    }
    personModelLoadKey++
  }

  return {
    findExistingPersonModel,
    setPersonModelVisible,
    isPersonModelVisible,
    clampPersonModelOpacity,
    resolveConfiguredModelOpacity,
    clearPersonModelHighlight,
    disposePersonScanOverlay,
    disposePersonVolumeIntersectEdges,
    attachPersonVolumeIntersectEdges,
    setVolumePersonIntersectHighlight,
    getPersonModelForHighlight,
    classifyBone,
    buildSkeletonStickman,
    setPersonSkeletonVisible,
    updatePersonScanOverlayOpacity,
    createPersonScanOverlay,
    setPersonScanOverlayVisible,
    applyPersonModelMaterialHighlight,
    highlightPersonModel,
    resolveAnimationTrackNodeName,
    findAnimatedTargetObject,
    getAnimatedModelTargetForHighlight,
    highlightAnimatedModelTarget,
    disposeSkeletonForModel,
    disposePersonHighlight,
  }
}
