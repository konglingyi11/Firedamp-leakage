import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GasAccidentController, GasVisualAdapter } from '@/utils/gasAccident'
import { createSmokeTexture, SmokeSystem } from '@/utils/smokeSystem'
import { FlameEffect, ExplosionEffect } from '@/components/three/goafGasEffects.js'

/**
 * 采空区瓦斯泄漏可视化集成（可配置版）
 * 把 GasAccidentController、SmokeSystem、火焰、爆炸串起来，
 * 并暴露泄漏源位置 / 参数 / 火焰 / 爆炸的实时调节接口。
 */

const DEFAULT_PARAMS = {
  ventilationScenario: 'weak',
  leakRatePercent: 0.03,
  methaneLowerExplosiveLimit: 5,
  methaneUpperExplosiveLimit: 16,
  ignitionProtectionFailed: true,
  ignitionSparkStrength: 1.0,
  ignitionTemperatureC: 720,
  ignitionEnergyMj: 0.35,
  minIgnitionDelay: 6,
  sparkDuration: 1.2,
  explosionIntensity: 1.2,
  gasColor: '#9db3a8',
  gasOpacity: 0.08,
  gasParticleCount: 1400,
  surroundingLayersEnabled: false,
  // 围岩层所在的"左右"轴向：'auto'（取水平较短轴）| 'x' | 'z'
  // 不同模型朝向不同：3.glb 左右为 X，1.glb 左右可能为 Z，不对时手动指定。
  surroundingAxis: 'auto',
  collisionEnabled: true,
  flameEnabled: true,
  flameIntensity: 1.5,
  flameSize: 2.5,
  flameColor: '#ff6600',
  explosionEnabled: true,
  explosionColor: '#ffaa33',
  smokeSize: 1.0,
  smokeDensity: 0.35,
  smokeSpeed: 0.30,
  smokeOpacity: 1.0,
  /**
   * 围岩层空心区域配置：每个空洞从对应侧的实心块里挖掉一块。
   * center / size 均为 0-1 相对值，基于该侧整体块（煤+岩）的包围盒。
   * 顺序为 [lateral, faceAxis1, faceAxis2]（lateral 是左右方向，另两个是面内方向）。
   *   side: 'left' | 'right' | 'both' —— 在哪一侧挖
   *   center: [a, b, c] —— 空洞中心相对位置
   *   size: [a, b, c] —— 空洞相对大小
   * 默认为空数组：围岩层是完整实心长方体，需要空洞时自行配置。
   */
  surroundingHollows: [],
}

// 采空区两侧围岩层参数：煤层贴着模型侧壁，岩石层在煤层外侧
const COAL_COLOR = 0x0c0c0c // 煤层近黑
const ROCK_COLOR = 0x3a342c // 岩石层深灰褐
const COAL_THICKNESS_RATIO = 0.18 // 煤层厚度 = 模型 X 宽度 * 0.18
const ROCK_THICKNESS_RATIO = 0.30 // 岩石层厚度 = 模型 X 宽度 * 0.30
const SURROUNDING_NAME = '__goafSurrounding'

// 泄漏源标签样式（仿监测点标签）
const GAS_SOURCE_LABEL_WIDTH = 0.64
const GAS_SOURCE_LABEL_HEIGHT = 0.18
const GAS_SOURCE_LABEL_COLOR = '#ff7a45' // 橙红色，与监测点区分
const GAS_SOURCE_MARKER_COLOR = 0xff7a45
const GAS_SOURCE_MARKER_SIZE = 0.12
const GAS_SOURCE_LINE_COLOR = 0xff7a45

// 煤/岩贴图：围岩层和动态块共用同一份缓存
const COAL_TEXTURE_URL = '/采空区/煤炭.jpg'
const ROCK_TEXTURE_URL = '/采空区/石头.jpg'

// 煤/岩高模块模型：动态块优先使用这些 GLB，而不是 BoxGeometry
const COAL_BLOCK_MODEL_URL = '/采空区/4(1).glb'
const ROCK_BLOCK_MODEL_URL = '/采空区/5(1).glb'

let sharedTextureLoader = null
const blockTextureCache = new Map() // url -> THREE.Texture

let sharedBlockGltfLoader = null
let sharedBlockDracoLoader = null
const blockModelTemplates = new Map() // url -> { geometry, material, boundingBox }

function getBlockTextureLoader() {
  if (!sharedTextureLoader) {
    sharedTextureLoader = new THREE.TextureLoader()
  }
  return sharedTextureLoader
}

function loadBlockTexture(url) {
  if (!url) return null
  if (blockTextureCache.has(url)) return blockTextureCache.get(url)
  const texture = getBlockTextureLoader().load(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  blockTextureCache.set(url, texture)
  return texture
}

function getCoalTexture() {
  return loadBlockTexture(COAL_TEXTURE_URL)
}

function getRockTexture() {
  return loadBlockTexture(ROCK_TEXTURE_URL)
}

function getBlockGltfLoader() {
  if (!sharedBlockDracoLoader) {
    sharedBlockDracoLoader = new DRACOLoader()
    sharedBlockDracoLoader.setDecoderPath('/draco/gltf/')
  }
  if (!sharedBlockGltfLoader) {
    sharedBlockGltfLoader = new GLTFLoader()
    sharedBlockGltfLoader.setDRACOLoader(sharedBlockDracoLoader)
  }
  return sharedBlockGltfLoader
}

async function loadBlockModelTemplate(url) {
  if (!url) return null
  if (blockModelTemplates.has(url)) return blockModelTemplates.get(url)
  const template = await new Promise((resolve) => {
    getBlockGltfLoader().load(
      url,
      (gltf) => {
        let templateMesh = null
        gltf.scene.traverse((child) => {
          if (child.isMesh && !templateMesh) templateMesh = child
        })
        if (!templateMesh) {
          console.warn(`[GoafGas] 块模型没有 Mesh: ${url}`)
          resolve(null)
          return
        }
        resolve({
          geometry: templateMesh.geometry,
          material: templateMesh.material,
          boundingBox: new THREE.Box3().setFromObject(templateMesh),
        })
      },
      undefined,
      (err) => {
        console.error(`[GoafGas] 加载块模型失败: ${url}`, err)
        resolve(null)
      },
    )
  })
  blockModelTemplates.set(url, template)
  return template
}

function preloadBlockModelTemplates() {
  return Promise.all([
    loadBlockModelTemplate(COAL_BLOCK_MODEL_URL),
    loadBlockModelTemplate(ROCK_BLOCK_MODEL_URL),
  ])
}

function getBlockModelTemplate(type) {
  const url = type === 'rock' ? ROCK_BLOCK_MODEL_URL : COAL_BLOCK_MODEL_URL
  return blockModelTemplates.get(url) || null
}

/**
 * 为动态块创建几何体与材质。
 * 优先使用 GLB 模板模型（煤炭/石块高模），未加载成功时回退到 BoxGeometry + 贴图。
 *
 * @param {'coal'|'rock'} type
 * @param {number} w 块宽度
 * @param {number} h 块高度
 * @param {number} d 块深度
 * @param {[number, number]|null} [texOffset] 程序化 fallback 贴图 offset [u,v]
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material }}
 */
function createBlockGeometryAndMaterial(type, w, h, d, texOffset = null) {
  const template = getBlockModelTemplate(type)
  if (template) {
    const geometry = template.geometry.clone()
    const templateSize = new THREE.Vector3()
    template.boundingBox.getSize(templateSize)
    if (templateSize.x > 0 && templateSize.y > 0 && templateSize.z > 0) {
      geometry.scale(w / templateSize.x, h / templateSize.y, d / templateSize.z)
    } else {
      geometry.scale(w, h, d)
    }
    const material = template.material.clone()
    material.userData.isGltfTemplateMaterial = true
    return { geometry, material }
  }

  // fallback：带贴图的方块
  const geometry = new THREE.BoxGeometry(w, h, d)
  const material = new THREE.MeshStandardMaterial({
    color: type === 'rock' ? ROCK_COLOR : COAL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
  })
  const baseTexture = type === 'rock' ? getRockTexture() : getCoalTexture()
  if (baseTexture) {
    const texture = baseTexture.clone()
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    // 每 2 个世界单位重复一次纹理，避免大面拉伸、小面压缩
    texture.repeat.set(Math.max(w / 2, 0.01), Math.max(h / 2, 0.01))
    if (texOffset) texture.offset.set(texOffset[0] || 0, texOffset[1] || 0)
    material.map = texture
    material.color.set(0xffffff)
    material.needsUpdate = true
  }
  return { geometry, material }
}

/**
 * 安全释放一个动态块及其材质、纹理。
 * GLB 模板材质共享模板纹理，不释放 map；fallback 材质使用 clone 纹理，需要释放。
 */
function disposeBlockMesh(mesh) {
  if (!mesh) return
  mesh.geometry?.dispose?.()
  const material = mesh.material
  if (material) {
    if (!material.userData.isGltfTemplateMaterial) {
      material.map?.dispose?.()
    }
    material.dispose?.()
  }
}

/**
 * 创建泄漏源标签 Sprite（仿监测点标签样式）。
 * @param {string} text 标签文字
 * @param {string} color 边框/文字颜色
 * @returns {THREE.Sprite}
 */
function createGasSourceLabel(text, color) {
  const canvas = document.createElement('canvas')
  canvas.width = 288
  canvas.height = 80
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height

  const radius = 20
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
  ctx.font = '600 30px Arial, "Microsoft YaHei", sans-serif'
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
  sprite.scale.set(GAS_SOURCE_LABEL_WIDTH, GAS_SOURCE_LABEL_HEIGHT, 1)
  sprite.renderOrder = 999
  return sprite
}

/**
 * 创建泄漏源视觉标识（原点 + 连线 + 标签），仿监测点样式。
 * @param {Object} source 泄漏源数据
 * @param {number} index 泄漏源序号
 * @returns {THREE.Group}
 */
function createGasSourceVisual(source, index) {
  const group = new THREE.Group()
  group.userData = { isGasSourceVisual: true, sourceIndex: index }
  const labelHeight = (source.height || 0.5) + 0.3

  // 原点标记：小球
  const sphereGeo = new THREE.SphereGeometry(GAS_SOURCE_MARKER_SIZE, 16, 16)
  const sphereMat = new THREE.MeshBasicMaterial({
    color: GAS_SOURCE_MARKER_COLOR,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  })
  const sphere = new THREE.Mesh(sphereGeo, sphereMat)
  sphere.renderOrder = 999
  sphere.userData = { isGasSourceMarker: true, sourceIndex: index }
  group.add(sphere)

  // 连线：原点指向标签
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, labelHeight, 0),
  ])
  const lineMat = new THREE.LineBasicMaterial({
    color: GAS_SOURCE_LINE_COLOR,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  })
  const line = new THREE.Line(lineGeo, lineMat)
  line.renderOrder = 999
  line.userData = { isGasSourceVisual: true, sourceIndex: index }
  group.add(line)

  // 标签
  const label = createGasSourceLabel(`泄漏源 ${index + 1}`, GAS_SOURCE_LABEL_COLOR)
  label.position.y = labelHeight
  label.userData = { isGasSourceVisual: true, sourceIndex: index }
  group.add(label)

  return group
}

export function createGoafGasLeakSystem({
  scene: initialScene,
  modelGroup: initialModelGroup,
  rootGroup: initialRootGroup,
  getScene,
  getModelGroup,
  getRootGroup,
  getCamera,
  getActiveModelUrl,
  addFrameCallback,
  removeFrameCallback,
  getCurrentTask,
  onSourcesUpdated,
}) {
  // currentTask watcher 是 immediate，在 setup 阶段执行，
  // 此时 scene/modelGroup/rootGroup 尚未在 onMounted 中初始化（为 null）。
  // 用 getter 在每次 setup 时刷新内部引用，确保拿到最新的 three.js 对象。
  let scene = initialScene
  let modelGroup = initialModelGroup
  let rootGroup = initialRootGroup

  function refreshHandles() {
    if (typeof getScene === 'function') scene = getScene() ?? scene
    if (typeof getModelGroup === 'function') modelGroup = getModelGroup() ?? modelGroup
    if (typeof getRootGroup === 'function') rootGroup = getRootGroup() ?? rootGroup
  }

  // 泄漏源变化时通知外部（如 HomeView 刷新 UI 列表）。
  // setup() 在模型加载回调中异步执行，此时 HomeView 的 goafGasSources 仍为空，
  // 不主动通知则 UI 看不到任何可编辑的泄漏源。
  function notifySourcesUpdated() {
    if (typeof onSourcesUpdated === 'function') {
      try { onSourcesUpdated() } catch (e) { /* 忽略外部回调错误 */ }
    }
  }

  let controller = null
  let smokeSystem = null
  let gasGroup = null
  let gasSources = []
  let ignitionSource = null
  let frameCallback = null
  let lastElapsed = 0
  let isAutoIgnite = false
  let flameEffect = null
  let explosionEffect = null
  let ignitionBlockId = 0 // 点火时生成的煤炭块 id（自燃效果）
  let surroundingGroup = null // 采空区两侧煤层 + 岩石层
  let dynamicBlocksGroup = null // 运行时动态添加的煤/石块
  let gasSourcesLabelsGroup = null // 泄漏源标签组
  const dynamicBlocks = new Map() // id -> mesh
  let dynamicBlockIdSeq = 1
  let blockGlobalScale = 0.5 // 动态块整体缩放系数，默认 0.5（煤/石块高模较大）
  let currentParams = { ...DEFAULT_PARAMS }
  let isSettingUp = false
  let setupDebounceTimer = null

  // 泄漏源拖拽状态
  let isDraggingSource = false
  let draggedSourceIndex = -1
  let draggedSourcePlane = null
  let draggedSourceOffset = null
  let suppressNextSourceClick = false

  function getCameraForDrag() {
    return typeof getCamera === 'function' ? getCamera() : null
  }

  function getModelBounds() {
    const bounds = new THREE.Box3()
    if (!modelGroup) return bounds
    // 只计算当前可见的模型，避免隐藏模型（如切换显示的另一套）撑大 bounds，
    // 导致围岩层离可见模型过远。
    // 遍历 modelGroup 的顶层子对象（每个是整套 gltf 模型），只取可见的。
    let hasVisible = false
    for (const child of modelGroup.children) {
      if (child.name === SURROUNDING_NAME) continue // 跳过围岩层自身
      if (child.visible === false) continue
      const box = new THREE.Box3().setFromObject(child)
      if (!box.isEmpty()) {
        bounds.union(box)
        hasVisible = true
      }
    }
    if (!hasVisible) return bounds
    return bounds
  }

  /**
   * 在采空区模型左右两侧构建煤层与岩石层。
   * 煤层贴着模型侧壁，岩石层在煤层外侧；与模型等高、等深。
   * 内部可根据 currentParams.surroundingHollows 挖出空心区域（巷道/空腔）。
   * 这些层同时作为烟雾碰撞体，阻挡瓦斯气体外泄。
   */
  function buildSurroundingLayers() {
    if (surroundingGroup) {
      surroundingGroup.parent?.remove(surroundingGroup)
      disposeSurroundingGroup(surroundingGroup)
      surroundingGroup = null
    }
    if (!scene) return

    const bounds = getModelBounds()
    const size = bounds.getSize(new THREE.Vector3())
    if (!Number.isFinite(size.x) || size.x <= 0) return

    // 判断"左右"方向（lateral 轴）：不同模型朝向不同。
    // 1.glb / 1.gltf 左右为 Y 轴，3.glb / 3.gltf 左右为 X 轴。
    // 也可通过 surroundingAxis 参数手动覆盖（'x' | 'y' | 'z'），'auto' 则按模型 URL 判断。
    // 按文件名主名（去掉扩展名）匹配，.glb 和 .gltf 一视同仁。
    const modelUrl = (typeof getActiveModelUrl === 'function' ? getActiveModelUrl() : '') || ''
    const modelFileName = modelUrl.split('/').pop().split('?')[0].split('#')[0]
    const modelBaseName = modelFileName.replace(/\.(glb|gltf)$/i, '').toLowerCase()
    const isModel1 = modelBaseName === '场景'
    const isModel3 = modelBaseName === '场景'

    let axis
    if (['x', 'y', 'z'].includes(currentParams.surroundingAxis)) {
      axis = currentParams.surroundingAxis
    } else if (isModel1) {
      axis = 'x'
    } else if (isModel3) {
      axis = 'x'
    } else {
      // 未知模型：取水平较短轴作为左右方向
      axis = size.x <= size.z ? 'x' : 'z'
    }

    // 三个轴的世界范围 [min, max, size]
    const axes = {
      x: { min: bounds.min.x, max: bounds.max.x, size: Math.max(size.x, 0.1) },
      y: { min: bounds.min.y, max: bounds.max.y, size: Math.max(size.y, 0.1) },
      z: { min: bounds.min.z, max: bounds.max.z, size: Math.max(size.z, 0.1) },
    }
    const lat = axes[axis] // 左右方向
    // 另外两个轴（面内方向），顺序保持稳定：按 x,y,z 去掉 lateral 后的顺序
    const faceAxes = ['x', 'y', 'z'].filter((a) => a !== axis)
    const fa1 = axes[faceAxes[0]]
    const fa2 = axes[faceAxes[1]]

    const coalThickness = Math.max(lat.size * COAL_THICKNESS_RATIO, 0.5)
    const rockThickness = Math.max(lat.size * ROCK_THICKNESS_RATIO, 0.8)

    // 左侧/右侧整体块（煤+岩）世界 AABB，用 {axis: [min,max]} 字典表示，
    // 这样空洞相对坐标换算与 axis 无关。
    const buildBlock = (latMin, latMax) => {
      const block = { min: {}, max: {} }
      block.min[axis] = latMin
      block.max[axis] = latMax
      block.min[faceAxes[0]] = fa1.min
      block.max[faceAxes[0]] = fa1.max
      block.min[faceAxes[1]] = fa2.min
      block.max[faceAxes[1]] = fa2.max
      return block
    }
    const leftBlock = buildBlock(lat.min - coalThickness - rockThickness, lat.min)
    const rightBlock = buildBlock(lat.max, lat.max + coalThickness + rockThickness)

    // 把配置里的相对空洞换算成世界 AABB
    // hollow.center/size 是 [lateral, faceAxis1, faceAxis2] 顺序的相对值
    const worldHollows = (currentParams.surroundingHollows || []).map((h) => {
      const block = h.side === 'left' ? leftBlock : h.side === 'right' ? rightBlock : null
      if (!block) return null
      const dims = [axis, faceAxes[0], faceAxes[1]]
      const min = {}
      const max = {}
      dims.forEach((d, i) => {
        const span = block.max[d] - block.min[d]
        const hw = (h.size?.[i] ?? 0.3) * span
        const c = block.min[d] + (h.center?.[i] ?? 0.5) * span
        min[d] = c - hw / 2
        max[d] = c + hw / 2
      })
      return { min, max, side: h.side }
    }).filter(Boolean)

    const leftHollows = worldHollows.filter((h) => h.side === 'left' || h.side === 'both')
    const rightHollows = worldHollows.filter((h) => h.side === 'right' || h.side === 'both')

    surroundingGroup = new THREE.Group()
    surroundingGroup.name = SURROUNDING_NAME

    // 四个 slab，各自挖掉对应空洞
    // buildHollowedSlab 签名是 (name, x0,w, y0,h, z0,d, color, hollows)
    // hollows 用 {min:{x,y,z}, max:{x,y,z}} 字典格式
    const slabs = [
      { name: 'coalLeft',  pos: lat.min - coalThickness,                 thick: coalThickness, color: COAL_COLOR, hollows: leftHollows },
      { name: 'rockLeft',  pos: lat.min - coalThickness - rockThickness, thick: rockThickness, color: ROCK_COLOR, hollows: leftHollows },
      { name: 'coalRight', pos: lat.max,                                  thick: coalThickness, color: COAL_COLOR, hollows: rightHollows },
      { name: 'rockRight', pos: lat.max + coalThickness,                  thick: rockThickness, color: ROCK_COLOR, hollows: rightHollows },
    ]

    for (const s of slabs) {
      // 构造该 slab 的世界 AABB（字典格式）
      const slabBox = { min: {}, max: {} }
      slabBox.min[axis] = s.pos
      slabBox.max[axis] = s.pos + s.thick
      slabBox.min[faceAxes[0]] = fa1.min
      slabBox.max[faceAxes[0]] = fa1.max
      slabBox.min[faceAxes[1]] = fa2.min
      slabBox.max[faceAxes[1]] = fa2.max
      surroundingGroup.add(buildHollowedSlabFromBox(s.name, slabBox, s.color, s.hollows))
    }

    scene.add(surroundingGroup)
  }

  /**
   * 构建一个可能带空洞的实心 slab。
   * slabBox: 世界 AABB，{min:{x,y,z}, max:{x,y,z}}
   * hollows: 世界 AABB 数组，会从 slab 中挖掉。
   * 内部用轴对齐 box 减法把 slab 切成若干子 box，合并成单个 geometry，性能好且无 CSG 依赖。
   */
  function buildHollowedSlabFromBox(name, slabBox, color, hollows) {
    const pieces = subtractBox(slabBox, hollows || [])
    const geometries = pieces.map((p) => {
      const pw = p.max.x - p.min.x
      const ph = p.max.y - p.min.y
      const pd = p.max.z - p.min.z
      const g = new THREE.BoxGeometry(pw, ph, pd)
      g.translate(p.min.x + pw / 2, p.min.y + ph / 2, p.min.z + pd / 2)
      return g
    })

    let geometry
    if (geometries.length === 0) {
      // 整块被挖空，给一个极小的占位 geometry，保持 mesh 存在以便碰撞体一致
      geometry = new THREE.BoxGeometry(0.01, 0.01, 0.01)
      geometry.translate(
        (slabBox.min.x + slabBox.max.x) / 2,
        (slabBox.min.y + slabBox.max.y) / 2,
        (slabBox.min.z + slabBox.max.z) / 2,
      )
    } else {
      geometry = mergeGeometries(geometries, false)
      geometries.forEach((g) => g.dispose())
    }

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      metalness: 0.0,
    })
    // 煤层/岩石层使用对应贴图
    const texture = color === COAL_COLOR ? getCoalTexture() : getRockTexture()
    if (texture) {
      material.map = texture
      material.color.set(0xffffff)
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  /**
   * 轴对齐 box 减法：从 box 中挖掉所有 hollows，返回剩余的 box 列表。
   * box/hollow 用 {min:{x,y,z}, max:{x,y,z}} 字典格式。
   * 算法：取第一个与 box 相交的 hollow，把 box 切成至多 6 个包围 hollow 的子 box，递归处理。
   */
  const AXES = ['x', 'y', 'z']
  function subtractBox(box, hollows) {
    let hit = null
    for (const h of hollows) {
      if (boxesIntersect(box, h)) {
        hit = h
        break
      }
    }
    if (!hit) return [box]

    // 把 hollow 裁剪到 box 范围内
    const ch = { min: {}, max: {} }
    for (const a of AXES) {
      ch.min[a] = Math.max(box.min[a], hit.min[a])
      ch.max[a] = Math.min(box.max[a], hit.max[a])
    }

    const sub = []
    for (const a of AXES) {
      // 低侧：box.min[a] ~ ch.min[a]，另外两轴用 hollow 范围
      if (ch.min[a] > box.min[a]) {
        const s = { min: {}, max: {} }
        for (const b of AXES) {
          s.min[b] = b === a ? box.min[b] : ch.min[b]
          s.max[b] = b === a ? ch.min[b] : ch.max[b]
        }
        sub.push(s)
      }
      // 高侧：ch.max[a] ~ box.max[a]
      if (ch.max[a] < box.max[a]) {
        const s = { min: {}, max: {} }
        for (const b of AXES) {
          s.min[b] = b === a ? ch.max[b] : ch.min[b]
          s.max[b] = b === a ? box.max[b] : ch.max[b]
        }
        sub.push(s)
      }
    }

    const out = []
    for (const s of sub) {
      out.push(...subtractBox(s, hollows))
    }
    return out
  }

  function boxesIntersect(a, b) {
    for (const ax of AXES) {
      if (!(a.min[ax] < b.max[ax] && a.max[ax] > b.min[ax])) return false
    }
    return true
  }

  function disposeSurroundingGroup(group) {
    if (!group) return
    group.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.()
        const material = child.material
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose?.())
        } else {
          material?.dispose?.()
        }
      }
    })
  }

  /**
   * 运行时动态添加一个煤块或石块。
   * 块放在独立的 dynamicBlocksGroup 里，不影响围岩层（surroundingGroup）。
   *
   * @param {Object} opts
   * @param {number[]|THREE.Vector3} opts.position 块中心世界坐标 [x,y,z]
   * @param {number[]|THREE.Vector3} [opts.size=[2,2,2]] 块尺寸 [w,h,d]
   * @param {number[]|THREE.Euler} [opts.rotation] 块旋转（Euler 弧度 [x,y,z]）
   * @param {'coal'|'rock'} [opts.type='coal'] 块类型，决定颜色
   * @param {string} [opts.name] 自定义 mesh name
   * @returns {number} 块 id（用于 removeBlock）
   */
  function addBlock(opts = {}) {
    if (!scene) return 0
    refreshHandles()
    if (!dynamicBlocksGroup) {
      dynamicBlocksGroup = new THREE.Group()
      dynamicBlocksGroup.name = '__goafDynamicBlocks'
      scene.add(dynamicBlocksGroup)
    }

    const type = opts.type === 'rock' ? 'rock' : 'coal'

    // 基础尺寸：用户传入或默认 [2,2,2]
    const baseSizeArr = opts.size instanceof THREE.Vector3
      ? [opts.size.x, opts.size.y, opts.size.z]
      : (Array.isArray(opts.size) ? opts.size : [2, 2, 2])
    let w = Math.max(Number(baseSizeArr[0]) || 1, 0.01)
    let h = Math.max(Number(baseSizeArr[1]) || 1, 0.01)
    let d = Math.max(Number(baseSizeArr[2]) || 1, 0.01)

    // 程序化生成：尺寸/贴图偏移随机抖动，让每个块都不完全相同
    // 默认开启，传入 procedural:false 可禁用
    const procedural = opts.procedural !== false
    let texOffset = null
    if (procedural) {
      const JITTER = 0.18 // ±18% 尺寸抖动
      const j = () => 1 + (Math.random() - 0.5) * 2 * JITTER
      w = Math.max(w * j(), 0.01)
      h = Math.max(h * j(), 0.01)
      d = Math.max(d * j(), 0.01)
      texOffset = [Math.random(), Math.random()]
    }

    const position = opts.position instanceof THREE.Vector3
      ? opts.position
      : new THREE.Vector3(opts.position?.[0] ?? 0, opts.position?.[1] ?? 0, opts.position?.[2] ?? 0)

    // 如果高模尚未加载，触发异步加载以便后续块使用
    if (!getBlockModelTemplate(type)) {
      loadBlockModelTemplate(type === 'rock' ? ROCK_BLOCK_MODEL_URL : COAL_BLOCK_MODEL_URL)
    }

    const { geometry, material } = createBlockGeometryAndMaterial(type, w, h, d, texOffset)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    // 旋转：用户传入优先；程序化模式下默认随机 Y 轴旋转
    if (Array.isArray(opts.rotation)) {
      mesh.rotation.set(opts.rotation[0] || 0, opts.rotation[1] || 0, opts.rotation[2] || 0)
    } else if (opts.rotation instanceof THREE.Euler) {
      mesh.rotation.copy(opts.rotation)
    } else if (procedural) {
      mesh.rotation.set(
        (Math.random() - 0.5) * 0.4,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.4,
      )
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.goafBlockType = type
    mesh.userData.goafBlockId = dynamicBlockIdSeq
    mesh.userData.procedural = procedural
    mesh.userData.goafBlockScale = blockGlobalScale
    mesh.scale.setScalar(blockGlobalScale)
    if (opts.name) mesh.name = opts.name
    else mesh.name = `__goafBlock_${type}_${dynamicBlockIdSeq}`

    dynamicBlocksGroup.add(mesh)
    dynamicBlocks.set(dynamicBlockIdSeq, mesh)
    return dynamicBlockIdSeq++
  }

  /**
   * 按 id 更新一个动态块的属性（保留 id 和 group 中的位置）。
   * 传入的 size/position/rotation/type 会覆盖原值，未传的字段保留。
   *
   * @param {number} id addBlock 返回的 id
   * @param {Object} opts
   * @param {number[]|THREE.Vector3} [opts.position]
   * @param {number[]|THREE.Vector3} [opts.size]
   * @param {number[]|THREE.Euler} [opts.rotation]
   * @param {'coal'|'rock'} [opts.type]
   * @returns {boolean} 是否更新成功
   */
  function updateBlock(id, opts = {}) {
    const mesh = dynamicBlocks.get(id)
    if (!mesh) return false

    const oldType = mesh.userData.goafBlockType || 'coal'
    const newType = opts.type === 'rock' ? 'rock' : (opts.type === 'coal' ? 'coal' : oldType)

    // 尺寸：传入则用新值，否则保留原值
    let w, h, d
    if (opts.size != null) {
      const sizeArr = opts.size instanceof THREE.Vector3
        ? [opts.size.x, opts.size.y, opts.size.z]
        : (Array.isArray(opts.size) ? opts.size : [2, 2, 2])
      w = Math.max(Number(sizeArr[0]) || 1, 0.01)
      h = Math.max(Number(sizeArr[1]) || 1, 0.01)
      d = Math.max(Number(sizeArr[2]) || 1, 0.01)
    } else {
      mesh.geometry?.computeBoundingBox?.()
      const size = mesh.geometry?.boundingBox?.getSize(new THREE.Vector3())
      w = size?.x ?? 2
      h = size?.y ?? 2
      d = size?.z ?? 2
    }

    // 贴图偏移：保留原偏移，避免每次更新都跳变（仅 fallback 材质有效）
    const oldOffset = mesh.material?.map?.offset
    const texOffset = (oldOffset && Number.isFinite(oldOffset.x) && !mesh.material?.userData?.isGltfTemplateMaterial)
      ? [oldOffset.x, oldOffset.y]
      : null

    // 释放旧 geometry / material，重建
    mesh.geometry?.dispose?.()
    const oldMat = mesh.material
    if (oldMat) {
      if (!oldMat.userData?.isGltfTemplateMaterial) {
        oldMat.map?.dispose?.()
      }
      oldMat.dispose?.()
    }
    const { geometry, material } = createBlockGeometryAndMaterial(newType, w, h, d, texOffset)
    mesh.geometry = geometry
    mesh.material = material
    mesh.userData.goafBlockType = newType
    mesh.userData.goafBlockScale = blockGlobalScale
    mesh.scale.setScalar(blockGlobalScale)

    // 位置
    if (opts.position != null) {
      const pos = opts.position instanceof THREE.Vector3
        ? opts.position
        : new THREE.Vector3(opts.position?.[0] ?? 0, opts.position?.[1] ?? 0, opts.position?.[2] ?? 0)
      mesh.position.copy(pos)
    }

    // 旋转
    if (opts.rotation != null) {
      if (Array.isArray(opts.rotation)) {
        mesh.rotation.set(opts.rotation[0] || 0, opts.rotation[1] || 0, opts.rotation[2] || 0)
      } else if (opts.rotation instanceof THREE.Euler) {
        mesh.rotation.copy(opts.rotation)
      }
    }

    if (opts.name != null) mesh.name = opts.name
    if (id === ignitionBlockId) {
      syncFlameToIgnitionBlock()
    }
    return true
  }

  /**
   * 按 id 删除一个动态块。
   * @param {number} id addBlock 返回的 id
   * @returns {boolean} 是否删除成功
   */
  function removeBlock(id) {
    const mesh = dynamicBlocks.get(id)
    if (!mesh) return false
    mesh.parent?.remove(mesh)
    disposeBlockMesh(mesh)
    dynamicBlocks.delete(id)
    if (id === ignitionBlockId) {
      ignitionBlockId = 0
      flameEffect?.setVisible(false)
    }
    return true
  }

  /**
   * 清除所有动态块。
   */
  function clearBlocks() {
    for (const mesh of dynamicBlocks.values()) {
      mesh.parent?.remove(mesh)
      disposeBlockMesh(mesh)
    }
    dynamicBlocks.clear()
    if (ignitionBlockId) {
      ignitionBlockId = 0
      flameEffect?.setVisible(false)
    }
  }

  /**
   * 获取动态块整体缩放系数。
   * @returns {number}
   */
  function getBlockScale() {
    return blockGlobalScale
  }

  /**
   * 设置动态块整体缩放系数，并同步更新所有已创建的块。
   * @param {number} scale
   */
  function setBlockScale(scale) {
    const newScale = Math.max(0.01, Number(scale) || 1)
    blockGlobalScale = newScale
    for (const mesh of dynamicBlocks.values()) {
      mesh.scale.setScalar(newScale)
      mesh.userData.goafBlockScale = newScale
    }
  }

  /**
   * 获取所有动态块信息（不含 mesh 引用，方便外部读取）。
   * @returns {Array<{id:number, type:string, name:string, position:{x,y,z}, size:{x,y,z}, rotation:{x,y,z}}>}
   */
  function getBlocks() {
    const out = []
    for (const [id, mesh] of dynamicBlocks.entries()) {
      const geo = mesh.geometry
      let w = 2, h = 2, d = 2
      if (geo?.parameters) {
        // BoxGeometry 的 parameters 存原始尺寸
        w = geo.parameters.width ?? 2
        h = geo.parameters.height ?? 2
        d = geo.parameters.depth ?? 2
      } else {
        // GLB 模型几何体用包围盒取本地尺寸
        geo?.computeBoundingBox?.()
        const size = geo?.boundingBox?.getSize(new THREE.Vector3())
        if (size) {
          w = size.x
          h = size.y
          d = size.z
        }
      }
      out.push({
        id,
        type: mesh.userData.goafBlockType || 'coal',
        name: mesh.name || '',
        position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        size: { x: w, y: h, z: d },
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      })
    }
    return out
  }

  /**
   * 清除泄漏源视觉标识（原点、连线、标签）并释放资源。
   */
  function clearGasSourceVisuals() {
    if (!gasSourcesLabelsGroup) return
    gasSourcesLabelsGroup.traverse((child) => {
      if (child.isSprite) {
        child.material?.map?.dispose?.()
        child.material?.dispose?.()
      } else if (child.isMesh || child.isLine) {
        child.geometry?.dispose?.()
        child.material?.dispose?.()
      }
    })
    gasSourcesLabelsGroup.clear()
  }

  /**
   * 根据当前 gasSources 重建泄漏源视觉标识。
   * 标识挂在 gasGroup 下，跟随瓦斯系统一起显示/隐藏。
   */
  function buildGasSourceVisuals() {
    clearGasSourceVisuals()
    if (!scene || !gasGroup || gasSources.length === 0) return

    if (!gasSourcesLabelsGroup) {
      gasSourcesLabelsGroup = new THREE.Group()
      gasSourcesLabelsGroup.name = '__goafGasSourceLabels'
      gasGroup.add(gasSourcesLabelsGroup)
    }

    gasSources.forEach((source, index) => {
      if (source.visible === false) return
      const visual = createGasSourceVisual(source, index)
      visual.position.copy(source.position)
      gasSourcesLabelsGroup.add(visual)
    })
  }

  /**
   * 构建泄漏源拖拽平面（过泄漏源、法向为相机视线方向）。
   */
  function sourceDragPlane(source) {
    const camera = getCameraForDrag()
    const normal = new THREE.Vector3()
    if (camera) {
      camera.getWorldDirection(normal)
    } else {
      normal.set(0, 0, 1)
    }
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, source.position)
  }

  /**
   * 用 raycaster 拾取泄漏源视觉标识。
   */
  function pickGasSourceVisual(raycaster) {
    if (!gasSourcesLabelsGroup || !raycaster) return null
    const hits = raycaster.intersectObjects(gasSourcesLabelsGroup.children, true)
    return hits.find(
      (hit) =>
        hit.object?.userData?.isGasSourceVisual ||
        hit.object?.userData?.isGasSourceMarker,
    )
  }

  /**
   * 开始拖拽泄漏源。
   * @param {THREE.Raycaster} raycaster
   * @returns {boolean} 是否成功命中并开始拖拽
   */
  function beginSourceDrag(raycaster) {
    if (!raycaster) return false
    const hit = pickGasSourceVisual(raycaster)
    const index = hit?.object?.userData?.sourceIndex
    if (index == null || !gasSources[index]) return false

    const source = gasSources[index]
    isDraggingSource = true
    draggedSourceIndex = index
    draggedSourcePlane = sourceDragPlane(source)
    const target = new THREE.Vector3()
    const planeHit = raycaster.ray.intersectPlane(draggedSourcePlane, target)
    draggedSourceOffset = planeHit
      ? source.position.clone().sub(target)
      : new THREE.Vector3()
    return true
  }

  /**
   * 根据当前射线更新被拖拽泄漏源的位置，并同步烟雾发射点与点火源。
   * @param {THREE.Raycaster} raycaster
   * @returns {boolean} 是否成功更新
   */
  function updateSourceDrag(raycaster) {
    if (
      !isDraggingSource ||
      draggedSourceIndex < 0 ||
      !draggedSourcePlane ||
      !raycaster
    ) {
      return false
    }
    const source = gasSources[draggedSourceIndex]
    if (!source) return false

    const target = new THREE.Vector3()
    const hit = raycaster.ray.intersectPlane(draggedSourcePlane, target)
    if (!hit) return false
    target.add(draggedSourceOffset)

    source.position.copy(target)

    const visual = gasSourcesLabelsGroup?.children?.find(
      (child) =>
        child.userData?.isGasSourceVisual &&
        child.userData?.sourceIndex === draggedSourceIndex,
    )
    if (visual) {
      visual.position.copy(source.position)
    }

    if (controller) {
      controller.sources = gasSources
    }
    updateIgnitionSource()

    // 实时更新烟雾发射种子，避免每帧重建整个粒子系统
    if (smokeSystem) {
      const newSeeds = buildSurfaceSeeds()
      smokeSystem.setRuntimeParams({
        emitter: {
          position: [0, 0, 0],
          radius: 1.2,
          surfaceSeeds: newSeeds,
        },
      })
    }
    return true
  }

  /**
   * 结束拖拽泄漏源，并通知外部刷新 UI。
   */
  function finishSourceDrag() {
    if (!isDraggingSource) return
    isDraggingSource = false
    draggedSourceIndex = -1
    draggedSourcePlane = null
    draggedSourceOffset = null
    suppressNextSourceClick = true
    notifySourcesUpdated()
  }

  function isSourceDragging() {
    return isDraggingSource
  }

  function consumeSuppressNextClick() {
    if (suppressNextSourceClick) {
      suppressNextSourceClick = false
      return true
    }
    return false
  }

  function buildDefaultGasSources() {
    // 默认单个泄漏源，位置固定为 (2.8, -3.5, 1.9)
    return [{
      position: new THREE.Vector3(2.8, -3.5, 1.9),
      type: 'goaf',
      emissionFactor: 1.0,
      height: 2,
      visible: true,
    }]
  }

  function normalizeSources(sources) {
    return (sources || []).map((s) => ({
      position: s.position?.clone?.() || new THREE.Vector3(s.x ?? 0, s.y ?? 0, s.z ?? 0),
      type: s.type || 'goaf',
      emissionFactor: Number.isFinite(s.emissionFactor) ? s.emissionFactor : 1.0,
      height: Number.isFinite(s.height) ? s.height : s.position?.y ?? 0,
      visible: s.visible !== false,
    }))
  }

  function ensureCollisionBoundsTree(mesh) {
    const geometry = mesh?.geometry
    if (!geometry || geometry.boundsTree) return
    try {
      geometry.computeBoundsTree?.()
    } catch (error) {
      console.warn('[GoafGas] 碰撞 BVH 构建失败，回退普通碰撞:', error)
    }
  }

  const collisionProxyCache = new WeakMap() // mesh -> proxy mesh

  /**
   * 为高模 Mesh 创建低精度包围盒代理，用于烟雾碰撞。
   * 代理几何体已变换到世界坐标，代理 Mesh 置于原点且 matrixAutoUpdate=false。
   */
  function getCollisionProxy(mesh) {
    if (!mesh) return null
    if (collisionProxyCache.has(mesh)) return collisionProxyCache.get(mesh)

    mesh.geometry?.computeBoundingBox?.()
    const worldBox = new THREE.Box3().setFromObject(mesh)
    if (worldBox.isEmpty()) return null

    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    worldBox.getSize(size)
    worldBox.getCenter(center)

    const proxyGeo = new THREE.BoxGeometry(size.x, size.y, size.z)
    proxyGeo.translate(center.x, center.y, center.z)
    const proxyMesh = new THREE.Mesh(proxyGeo)
    proxyMesh.matrixAutoUpdate = false
    proxyMesh.updateMatrix()
    ensureCollisionBoundsTree(proxyMesh)

    collisionProxyCache.set(mesh, proxyMesh)
    return proxyMesh
  }

  function collectCollisionMeshes() {
    const meshes = []
    if (modelGroup) {
      // 烟雾碰撞主要检测煤层/土层相关模型，避免穿模；使用包围盒代理优化性能
      modelGroup.traverse((child) => {
        if (child.isMesh && child.visible) {
          const n = child.name || ''
          if (n.startsWith('煤层') || n.startsWith('土层')) {
            const proxy = getCollisionProxy(child)
            if (proxy) meshes.push(proxy)
          }
        }
      })
    }
    if (surroundingGroup) {
      surroundingGroup.traverse((child) => {
        if (child.isMesh && child.visible) {
          ensureCollisionBoundsTree(child)
          meshes.push(child)
        }
      })
    }
    if (rootGroup) {
      rootGroup.traverse((child) => {
        if (child.isMesh && child.visible && child.name?.startsWith('tunnelCollider')) {
          ensureCollisionBoundsTree(child)
          meshes.push(child)
        }
      })
    }
    return meshes
  }

  /**
   * 将十六进制颜色转换为烟雾系统用的 scatter / absorb / particle 颜色数组。
   */
  function buildSmokeColors(baseHex) {
    const baseColor = new THREE.Color(baseHex || currentParams.gasColor)
    const r = baseColor.r
    const g = baseColor.g
    const b = baseColor.b
    return {
      scatter: [r * 0.9, g * 0.9, b * 0.9],
      absorb: [r * 0.35, g * 0.35, b * 0.35],
      particle: [r, g, b],
    }
  }

  function buildSurfaceSeeds(count = 120) {
    const visibleSources = gasSources.filter((s) => s.visible !== false)
    if (!visibleSources.length) return []
    const seeds = []
    for (let i = 0; i < count; i++) {
      const source = visibleSources[i % visibleSources.length]
      const spread = 0.4 + Math.random() * 0.6
      // 让初始扩散方向明显偏向正 Y（瓦斯向上部积聚），同时保留 X/Z 水平扩散。
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      let nx = Math.sin(phi) * Math.cos(theta)
      let ny = Math.abs(Math.sin(phi) * Math.sin(theta)) * 0.75 + 0.55
      let nz = Math.cos(phi)
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= len
      ny /= len
      nz /= len
      seeds.push({
        x: source.position.x + (Math.random() - 0.5) * spread,
        y: source.position.y + (Math.random() - 0.5) * spread,
        z: source.position.z + (Math.random() - 0.5) * spread,
        nx,
        ny,
        nz,
      })
    }
    return seeds
  }

  function rebuildSmokeSystem() {
    if (!gasGroup) return
    if (smokeSystem) {
      smokeSystem.mesh?.geometry?.dispose()
      smokeSystem.mesh?.material?.dispose()
      smokeSystem.mesh?.parent?.remove(smokeSystem.mesh)
      smokeSystem = null
    }
    const visibleSources = gasSources.filter((s) => s.visible !== false)
    if (visibleSources.length === 0) {
      // 所有泄漏源均被隐藏时，不生成烟雾，避免在世界原点出现残留粒子
      return
    }
    const texture = createSmokeTexture()
    const collisionMeshes = currentParams.collisionEnabled ? collectCollisionMeshes() : []
    const surfaceSeeds = buildSurfaceSeeds()
    const smokeColors = buildSmokeColors()

    smokeSystem = new SmokeSystem(
      currentParams.gasParticleCount,
      texture,
      gasGroup,
      {
        size: currentParams.smokeSize,
        speed: currentParams.smokeSpeed,
        range: 0.65,
        swirl: 1.3,
        density: currentParams.smokeDensity,
        velocityField: {
          worldScale: 10,
          strength: 0.8,
          stride: 2,
          sample: () => ({ vx: 0, vy: 0.35, vz: 0, speed: 0.35 }),
        },
        maxLifetime: 50,
        spawnDuration: 10,
        emitter: {
          position: [0, 0, 0],
          radius: 0.6,
          surfaceSeeds,
        },
        color: smokeColors,
        collision: collisionMeshes.length && currentParams.collisionEnabled
          ? {
              meshes: collisionMeshes,
              radius: 0.2,
              probeDistance: 0.35,
              maxCandidates: 4,
              restitution: 0.05,
              slide: 0.75,
              stride: 16,
              blockNormalVelocity: true,
              proximity: false,
            }
          : undefined,
      },
    )
    // 只有已开始泄漏/点火后才显示气体；idle 状态隐藏，避免刚进入页面就看到气体
    if (smokeSystem?.mesh) {
      smokeSystem.mesh.visible = controller?.currentStage !== 'idle'
    }
  }

  function updateIgnitionSource() {
    // 点火源直接使用最后一个泄漏源位置，不再使用硬编码偏移，
    // 便于点火生成的煤炭块位置和火焰/爆炸位置一致且可预测。
    ignitionSource = gasSources.length
      ? gasSources[gasSources.length - 1].position.clone()
      : new THREE.Vector3(0, 0, 0)
    flameEffect?.setPosition(ignitionSource.x, ignitionSource.y, ignitionSource.z)
    explosionEffect?.setPosition(ignitionSource.x, ignitionSource.y, ignitionSource.z)
  }

  /**
   * 将火焰定位到点火煤炭块顶部，跟随其位置/尺寸变化。
   */
  function syncFlameToIgnitionBlock() {
    if (!ignitionBlockId || !flameEffect) return
    const mesh = dynamicBlocks.get(ignitionBlockId)
    if (!mesh) return
    mesh.geometry?.computeBoundingBox?.()
    const size = mesh.geometry?.boundingBox?.getSize(new THREE.Vector3())
    const visualHeight = size ? size.y * mesh.scale.y : 1.0 * blockGlobalScale
    flameEffect.setPosition(mesh.position.x, mesh.position.y + visualHeight / 2, mesh.position.z)
  }

  function setup() {
    // 刷新 three.js 对象引用：goafGasSystem 可能早于 onMounted 创建，
    // 此时 scene/modelGroup 才在 onMounted 中被赋值
    refreshHandles()
    const task = getCurrentTask?.()
    if (!task || !scene) return

    // 防重入 + 去抖：频繁触发时只保留最后一次
    if (setupDebounceTimer) {
      clearTimeout(setupDebounceTimer)
      setupDebounceTimer = null
    }
    if (isSettingUp) {
      setupDebounceTimer = setTimeout(() => {
        setupDebounceTimer = null
        setup()
      }, 50)
      return
    }
    isSettingUp = true

    teardown()

    gasGroup = new THREE.Group()
    gasGroup.name = '__goafGasLeakGroup'
    scene.add(gasGroup)

    // 预加载煤/石块高模，供动态块使用（失败不影响主流程）
    preloadBlockModelTemplates().catch((err) => {
      console.warn('[GoafGas] 预加载块模型失败:', err)
    })

    gasSources = buildDefaultGasSources()
    notifySourcesUpdated()
    updateIgnitionSource()
    buildGasSourceVisuals()

    controller = new GasAccidentController({
      settings: {
        ventilationScenario: currentParams.ventilationScenario,
        leakRatePercent: currentParams.leakRatePercent,
        methaneLowerExplosiveLimit: currentParams.methaneLowerExplosiveLimit,
        methaneUpperExplosiveLimit: currentParams.methaneUpperExplosiveLimit,
        ignitionProtectionFailed: currentParams.ignitionProtectionFailed,
        ignitionSparkStrength: currentParams.ignitionSparkStrength,
        ignitionTemperatureC: currentParams.ignitionTemperatureC,
        ignitionEnergyMj: currentParams.ignitionEnergyMj,
        minIgnitionDelay: currentParams.minIgnitionDelay,
        sparkDuration: currentParams.sparkDuration,
        explosionIntensity: currentParams.explosionIntensity,
        gasColor: currentParams.gasColor,
        gasOpacity: currentParams.gasOpacity,
        gasParticleCount: currentParams.gasParticleCount,
      },
      sources: gasSources,
      ignitionSourceProvider: () => ignitionSource,
      on: {
        stageChange: (stage) => {
          console.log('[GoafGas] stage ->', stage)
          if (stage !== 'ignited') flameEffect?.setVisible(false)
        },
        ignition: () => {
          console.log('[GoafGas] 点火')
          if (currentParams.flameEnabled) {
            // 自燃效果：在点火位置生成煤炭块，火焰从煤炭上方冒出
            if (ignitionSource && !ignitionBlockId) {
              ignitionBlockId = addBlock({
                position: [ignitionSource.x, ignitionSource.y, ignitionSource.z],
                size: [1.6, 1.0, 1.6],
                type: 'coal',
                procedural: false,
                name: '__ignitionCoal',
              })
              // 火焰定位到煤炭块顶部（考虑整体缩放）
              const visualHeight = 1.0 * blockGlobalScale
              flameEffect?.setPosition(ignitionSource.x, ignitionSource.y + visualHeight / 2, ignitionSource.z)
            }
            flameEffect?.setVisible(true)
          }
        },
        explosion: () => {
          console.log('[GoafGas] 爆炸触发')
          if (currentParams.explosionEnabled) explosionEffect?.trigger()
        },
        safetyAlarm: (level) => console.log('[GoafGas] 安全等级', level),
      },
    })
    controller.setSparkScene(scene)

    flameEffect = new FlameEffect({
      position: ignitionSource,
      color: currentParams.flameColor,
      intensity: currentParams.flameIntensity,
      size: currentParams.flameSize,
      maxSpreadRadius: 6 + currentParams.flameSize * 1.5,
      spreadSpeed: 1.5 + currentParams.flameIntensity * 0.5,
    })
    flameEffect.addTo(scene)
    flameEffect.setVisible(false)

    explosionEffect = new ExplosionEffect({
      position: ignitionSource,
      color: currentParams.explosionColor,
      intensity: currentParams.explosionIntensity,
      maxRadius: 8 + currentParams.explosionIntensity * 6,
    })
    explosionEffect.addTo(scene)

    // 视觉适配器
    controller.setVisualAdapter(new GasVisualAdapter({
      visuals: [{
        smoke: {
          opacity: currentParams.gasOpacity,
          syncMaterial: () => {
            if (smokeSystem?.uniforms?.uDensity) {
              smokeSystem.uniforms.uDensity.value = currentParams.smokeOpacity * (0.22 + controller.methanePercent * 0.1)
            }
          },
        },
        diffuseSmoke: {
          opacity: currentParams.gasOpacity * 0.5,
          syncMaterial: () => {},
        },
        setConcentration: (v) => {
          if (smokeSystem?.uniforms?.uDensity) {
            smokeSystem.uniforms.uDensity.value = currentParams.smokeOpacity * (0.2 + v * 0.35)
          }
        },
        setColor: (c) => {
          if (smokeSystem?.setColor) {
            smokeSystem.setColor(c)
          }
        },
        setSparking: () => {},
        setIgnited: () => {
          if (currentParams.flameEnabled) flameEffect?.setVisible(true)
        },
        clearSparking: () => {},
        applyVisualOverrides: () => {},
      }],
      getSettings: () => controller.settings,
    }))

    lastElapsed = 0
    frameCallback = (elapsed) => {
      const dt = Number.isFinite(lastElapsed) && elapsed > lastElapsed
        ? Math.min(elapsed - lastElapsed, 0.05)
        : 0.016
      lastElapsed = elapsed

      controller.update(dt)
      // 仅在已开始泄漏/点火后更新并显示烟雾，idle 状态隐藏
      if (controller.currentStage !== 'idle') {
        if (smokeSystem?.mesh) smokeSystem.mesh.visible = true
        smokeSystem?.update(elapsed, dt)
      } else if (smokeSystem?.mesh) {
        smokeSystem.mesh.visible = false
      }
      // 点火状态下火焰跟随燃烧的煤炭块并随瓦斯浓度蔓延
      if (controller.currentStage === 'ignited') {
        syncFlameToIgnitionBlock()
        const upperLimit = controller.settings.methaneUpperExplosiveLimit || 16
        // 瓦斯浓度越高，火焰蔓延半径越大（最低 20%，最高 100%）
        const methaneFactor = Math.min(1, Math.max(0.2, controller.methanePercent / upperLimit))
        flameEffect?.setSpreadRadius(flameEffect.maxSpreadRadius * methaneFactor)
      }
      flameEffect?.update(dt, elapsed)
      explosionEffect?.update(dt)

      if (isAutoIgnite && controller.currentStage === 'leaking' && controller.methanePercent >= controller.settings.methaneUpperExplosiveLimit * 0.85) {
        controller.requestManualIgnition()
      }
    }
    addFrameCallback(frameCallback)

    // 把重初始化任务拆到下一帧，避免阻塞主线程导致页面卡死
    requestAnimationFrame(() => {
      try {
        if (!controller) return
        if (currentParams.surroundingLayersEnabled) {
          buildSurroundingLayers()
        }
        rebuildSmokeSystem()
      } catch (error) {
        console.error('[GoafGas] 异步重建视觉系统失败:', error)
      } finally {
        isSettingUp = false
      }
    })
  }

  function teardown() {
    if (frameCallback) {
      removeFrameCallback(frameCallback)
      frameCallback = null
    }
    if (smokeSystem) {
      smokeSystem.mesh?.geometry?.dispose()
      smokeSystem.mesh?.material?.dispose()
      smokeSystem.mesh?.parent?.remove(smokeSystem.mesh)
      smokeSystem = null
    }
    if (flameEffect) {
      flameEffect.removeFrom(scene)
      flameEffect.dispose()
      flameEffect = null
    }
    if (explosionEffect) {
      explosionEffect.removeFrom(scene)
      explosionEffect.dispose()
      explosionEffect = null
    }
    if (gasSourcesLabelsGroup) {
      clearGasSourceVisuals()
      gasSourcesLabelsGroup.parent?.remove(gasSourcesLabelsGroup)
      gasSourcesLabelsGroup = null
    }
    if (gasGroup) {
      gasGroup.clear()
      gasGroup.parent?.remove(gasGroup)
      gasGroup = null
    }
    if (surroundingGroup) {
      disposeSurroundingGroup(surroundingGroup)
      surroundingGroup.parent?.remove(surroundingGroup)
      surroundingGroup = null
    }
    // 清理动态块：teardown 时不保留，重建 setup 后场景干净
    clearBlocks()
    ignitionBlockId = 0
    if (dynamicBlocksGroup) {
      dynamicBlocksGroup.parent?.remove(dynamicBlocksGroup)
      dynamicBlocksGroup = null
    }
    // 重置拖拽状态，防止 teardown 时仍有未完成的拖拽
    isDraggingSource = false
    draggedSourceIndex = -1
    draggedSourcePlane = null
    draggedSourceOffset = null
    suppressNextSourceClick = false
    controller = null
    gasSources = []
    ignitionSource = null
    lastElapsed = 0
    isAutoIgnite = false
    if (setupDebounceTimer) {
      clearTimeout(setupDebounceTimer)
      setupDebounceTimer = null
    }
  }

  function start(autoIgnite = false) {
    if (!controller) setup()
    isAutoIgnite = autoIgnite
    controller?.start()
  }

  function ignite() {
    if (!controller) setup()
    if (!controller) return
    // 确保已开始泄漏
    if (controller.currentStage === 'idle') {
      controller.start()
    }
    // 直接点火（演示模式：不强制要求瓦斯浓度达到爆炸下限）
    if (controller.currentStage !== 'ignited') {
      controller.ignite()
    }
  }

  /**
   * 熄灭火焰：将控制器状态从 ignited 切回 leaking，保留气体浓度。
   */
  function extinguishFlame() {
    if (!controller) return
    if (controller.currentStage === 'ignited') {
      controller._setStage('leaking')
    }
    flameEffect?.setVisible(false)
  }

  function reset() {
    controller?.reset()
    flameEffect?.setVisible(false)
    if (smokeSystem?.mesh) smokeSystem.mesh.visible = false
    isAutoIgnite = false
    // 移除自燃煤炭块
    if (ignitionBlockId) {
      removeBlock(ignitionBlockId)
      ignitionBlockId = 0
    }
  }

  function getState() {
    return controller?.getState() || { stage: 'idle' }
  }

  function getSources() {
    return gasSources.map((s) => ({
      x: s.position.x,
      y: s.position.y,
      z: s.position.z,
      type: s.type,
      emissionFactor: s.emissionFactor,
      height: s.height,
      visible: s.visible !== false,
    }))
  }

  function setSources(sources) {
    gasSources = normalizeSources(sources)
    // 外部同步新数据源时，强制结束可能未完成的拖拽，避免索引/对象不一致
    if (isDraggingSource) {
      isDraggingSource = false
      draggedSourceIndex = -1
      draggedSourcePlane = null
      draggedSourceOffset = null
      suppressNextSourceClick = false
    }
    if (controller) {
      controller.sources = gasSources
      rebuildSmokeSystem()
      updateIgnitionSource()
    }
    buildGasSourceVisuals()
    notifySourcesUpdated()
  }

  function getParams() {
    return { ...currentParams }
  }

  function setParams(params) {
    currentParams = { ...currentParams, ...(params || {}) }
    if (!controller) return
    // 更新控制器 settings 中受支持的字段
    const settings = controller.settings
    if (params.leakRatePercent !== undefined) settings.leakRatePercent = currentParams.leakRatePercent
    if (params.methaneLowerExplosiveLimit !== undefined) settings.methaneLowerExplosiveLimit = currentParams.methaneLowerExplosiveLimit
    if (params.methaneUpperExplosiveLimit !== undefined) settings.methaneUpperExplosiveLimit = currentParams.methaneUpperExplosiveLimit
    if (params.ignitionSparkStrength !== undefined) settings.ignitionSparkStrength = currentParams.ignitionSparkStrength
    if (params.ignitionTemperatureC !== undefined) settings.ignitionTemperatureC = currentParams.ignitionTemperatureC
    if (params.ignitionEnergyMj !== undefined) settings.ignitionEnergyMj = currentParams.ignitionEnergyMj
    if (params.minIgnitionDelay !== undefined) settings.minIgnitionDelay = currentParams.minIgnitionDelay
    if (params.sparkDuration !== undefined) settings.sparkDuration = currentParams.sparkDuration
    if (params.explosionIntensity !== undefined) settings.explosionIntensity = currentParams.explosionIntensity
    if (params.gasOpacity !== undefined) settings.gasOpacity = currentParams.gasOpacity
    if (params.gasColor !== undefined) {
      settings.gasColor = currentParams.gasColor
      if (smokeSystem?.setColor) smokeSystem.setColor(currentParams.gasColor)
    }

    if (params.flameIntensity !== undefined) flameEffect?.setIntensity(currentParams.flameIntensity)
    if (params.flameSize !== undefined && flameEffect) flameEffect.size = currentParams.flameSize
    if (params.flameColor !== undefined && flameEffect) flameEffect.color.set(currentParams.flameColor)
    if (params.explosionIntensity !== undefined && explosionEffect) {
      explosionEffect.intensity = currentParams.explosionIntensity
      explosionEffect.maxRadius = 8 + currentParams.explosionIntensity * 6
    }
    if (params.smokeSize !== undefined || params.smokeDensity !== undefined || params.smokeSpeed !== undefined || params.gasParticleCount !== undefined || params.collisionEnabled !== undefined) {
      rebuildSmokeSystem()
    }
    // 围岩层开关/轴向/空洞配置变化时重建围岩层，并刷新烟雾碰撞体
    if (params.surroundingLayersEnabled !== undefined || params.surroundingHollows !== undefined || params.surroundingAxis !== undefined) {
      if (currentParams.surroundingLayersEnabled) {
        buildSurroundingLayers()
      } else if (surroundingGroup) {
        disposeSurroundingGroup(surroundingGroup)
        surroundingGroup.parent?.remove(surroundingGroup)
        surroundingGroup = null
      }
      rebuildSmokeSystem()
    }
  }

  function triggerExplosion() {
    if (currentParams.explosionEnabled) explosionEffect?.trigger()
  }

  // 请求重建围岩层（带去抖）：切模型可见性时调用，避免轴向不对
  let rebuildSurroundingTimer = null
  function requestRebuildSurrounding() {
    if (rebuildSurroundingTimer) clearTimeout(rebuildSurroundingTimer)
    rebuildSurroundingTimer = setTimeout(() => {
      rebuildSurroundingTimer = null
      if (controller && currentParams.surroundingLayersEnabled) {
        buildSurroundingLayers()
        rebuildSmokeSystem()
      }
    }, 60)
  }

  return {
    setup,
    teardown,
    start,
    ignite,
    extinguishFlame,
    reset,
    getState,
    getSources,
    setSources,
    getParams,
    setParams,
    triggerExplosion,
    requestRebuildSurrounding,
    // 运行时动态煤/石块 API
    addBlock,
    updateBlock,
    removeBlock,
    clearBlocks,
    getBlocks,
    getBlockScale,
    setBlockScale,
    // 泄漏源拖拽
    pickGasSourceVisual,
    beginSourceDrag,
    updateSourceDrag,
    finishSourceDrag,
    isSourceDragging,
    consumeSuppressNextClick,
  }
}
