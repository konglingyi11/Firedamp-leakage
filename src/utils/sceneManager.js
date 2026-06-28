/**
 * Three.js 场景单例管理器
 * 确保整个应用只有一个 Three.js 场景实例
 * 解决 WebGL 上下文泄漏问题
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { getRenderer, releaseRenderer } from './rendererManager'

let globalScene = null
let globalCamera = null
let globalControls = null
let globalRenderer = null
let globalComposer = null
let animationFrameId = 0
let currentContainer = null
let resizeObserver = null
let refCount = 0

/** F3 切换：Three 画布右上角性能浮层 */
let perfOverlayVisible = false
let perfOverlayEl = null
let perfHotkeyInstalled = false
let perfFpsWindowStart = 0
let perfFpsFrameCount = 0
let perfFps = 0
let perfLastFrameAt = 0
let perfFrameMs = 0
const perfDrawingBufferScratch = new THREE.Vector2()

// 帧回调（供各模块注册每帧更新逻辑）
const frameCallbacks = []

/** WebGL 渲染之后执行（例如 CSS2D 标签） */
const postRenderCallbacks = []

// 场景组
let rootGroup = null
let planeGroup = null
let volumeGroup = null
let streamlineGroup = null
let boundsGroup = null
let overlayGroup = null
let axisGroup = null
let modelGroup = null
let monitoringPointsGroup = null

// 灯光
let ambientLight = null
let hemisphereLight = null
let keyLight = null
let fillLight = null
let rimLight = null

// 其他
let raycaster = null
let gltfModel = null
let clock = null
let sky = null
let groundPlane = null

// 事件监听器
const eventListeners = {
  mousemove: [],
  mousedown: [],
  mouseup: [],
  click: [],
  keydown: [],
  keyup: [],
}

/**
 * 初始化场景（只在第一次调用时创建）
 */
function initScene() {
  if (globalScene) return

  console.log('[SceneManager] 创建全局 Three.js 场景')

  // 创建场景
  globalScene = new THREE.Scene()
  globalScene.background = new THREE.Color('#06111d')
  globalScene.fog = new THREE.Fog('#06111d', 5000, 15000)

  // 创建组
  rootGroup = new THREE.Group()
  planeGroup = new THREE.Group()
  volumeGroup = new THREE.Group()
  streamlineGroup = new THREE.Group()
  boundsGroup = new THREE.Group()
  overlayGroup = new THREE.Group()
  axisGroup = new THREE.Group()
  modelGroup = new THREE.Group()
  monitoringPointsGroup = new THREE.Group()

  // 组装场景结构
  rootGroup.add(planeGroup)
  rootGroup.add(volumeGroup)
  rootGroup.add(streamlineGroup)
  rootGroup.add(boundsGroup)
  rootGroup.add(overlayGroup)
  rootGroup.add(monitoringPointsGroup)

  globalScene.add(rootGroup)
  globalScene.add(axisGroup)
  globalScene.add(modelGroup)

  // 创建灯光：提升环境光和补光亮度，场景更明亮
  ambientLight = new THREE.AmbientLight('#f4f7ff', 0.45)
  hemisphereLight = new THREE.HemisphereLight('#cfe8ff', '#25364a', 0.65)
  hemisphereLight.position.set(0, 0, 1)
  keyLight = new THREE.DirectionalLight('#fff3dc', 1.5)
  keyLight.position.set(7000, -4500, 9000)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.camera.near = 100
  keyLight.shadow.camera.far = 26000
  keyLight.shadow.camera.left = -8000
  keyLight.shadow.camera.right = 8000
  keyLight.shadow.camera.top = 8000
  keyLight.shadow.camera.bottom = -8000
  keyLight.shadow.bias = -0.00008
  keyLight.shadow.normalBias = 0.03
  fillLight = new THREE.DirectionalLight('#8fc7ff', 0.55)
  fillLight.position.set(-7000, 4500, 3500)
  rimLight = new THREE.DirectionalLight('#c8e4ff', 0.65)
  rimLight.position.set(-9000, -6500, 6500)

  globalScene.add(ambientLight)
  globalScene.add(hemisphereLight)
  globalScene.add(keyLight)
  globalScene.add(fillLight)
  globalScene.add(rimLight)

  // 创建网格
  const groundGeometry = new THREE.PlaneGeometry(24000, 24000)
  groundGeometry.setAttribute(
    'uv2',
    new THREE.BufferAttribute(groundGeometry.attributes.uv.array, 2),
  )
  const groundMaps = loadGroundMaps('/textures/ground/dirt/')
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: '#8a725c',
    map: groundMaps.diffuse,
    normalMap: groundMaps.normal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: groundMaps.roughness,
    aoMap: groundMaps.ao,
    aoMapIntensity: 0.55,
    side: THREE.DoubleSide,
    roughness: 0.96,
    metalness: 0,
  })
  groundPlane = new THREE.Mesh(groundGeometry, groundMaterial)
  groundPlane.name = 'realistic-scene-ground'
  groundPlane.position.set(0, 0, -0.04)
  groundPlane.receiveShadow = true
  groundPlane.visible = false
  axisGroup.add(groundPlane)

  const grid = new THREE.GridHelper(12000, 12, '#2c8cb4', '#123144')
  grid.rotation.x = Math.PI / 2
  grid.position.set(0, 0, 0)
  grid.material.opacity = 0.2
  grid.material.transparent = true
  axisGroup.add(grid)

  // 创建相机（正面视角：从 -Y 方向看向原点，Z 轴为竖直向上）
  globalCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000)
  globalCamera.position.set(0, -20, 0)
  globalCamera.up.set(0, 0, 1)
  globalCamera.lookAt(0, 0, 0)

  // 创建射线检测器
  raycaster = new THREE.Raycaster()

  // 创建时钟
  clock = new THREE.Clock()

  // 获取全局 renderer
  globalRenderer = getRenderer()
  console.log('[SceneManager] 使用全局 renderer')

  // 创建后处理链（Bloom 辉光让体渲染更有气体感）
  globalComposer = new EffectComposer(globalRenderer)
  globalComposer.addPass(new RenderPass(globalScene, globalCamera))
  globalComposer.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(globalRenderer.domElement.width, globalRenderer.domElement.height),
      0.12,   // strength
      0.18,   // radius
      0.94,   // threshold
    ),
  )

  installPerfOverlayHotkey()

  addRealisticSky()

  // 创建控制器（延迟到容器绑定时）
  // globalControls 将在 bindContainer 中创建
}

function addRealisticSky() {
  if (!globalScene || sky) return

  const sunPosition = new THREE.Vector3(-0.35, 0.25, 0.9).normalize()

  if (keyLight) {
    keyLight.position.copy(sunPosition).multiplyScalar(15000)
    keyLight.intensity = 1.35
  }
  if (rimLight) {
    rimLight.position.set(-9000, -6500, 6500)
  }

  globalScene.background = new THREE.Color('#b9d5e8')
  globalScene.fog = new THREE.Fog('#9bb8d3', 7000, 18000)
  sky = createProceduralSkyDome(sunPosition)
  globalScene.add(sky)

  const environmentLoader = new RGBELoader()
  environmentLoader.load(
    '/textures/sky/wasteland_clouds_puresky_2k.hdr',
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      if (globalScene) {
        globalScene.environment = texture
        globalScene.environmentIntensity = 0.08
      }
    },
    undefined,
    (error) => {
      console.warn('[SceneManager] 真实天空 HDRI 加载失败:', error)
    },
  )
}

function createProceduralSkyDome(sunDirection) {
  const geometry = new THREE.SphereGeometry(17000, 64, 32)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uSunDirection: { value: sunDirection.clone().normalize() },
    },
    vertexShader: `
      varying vec3 vDirection;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vDirection = normalize(worldPosition.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform vec3 uSunDirection;
      varying vec3 vDirection;

      float cloudNoise(vec2 uv) {
        float value = 0.0;
        value += sin(uv.x * 3.1 + uv.y * 1.7) * 0.32;
        value += sin(uv.x * 6.4 - uv.y * 2.8 + 1.4) * 0.21;
        value += sin(uv.x * 11.0 + uv.y * 4.3 + 2.1) * 0.11;
        return value * 0.5 + 0.5;
      }

      void main() {
        vec3 direction = normalize(vDirection);
        float height = clamp(direction.z * 0.5 + 0.5, 0.0, 1.0);
        float horizon = smoothstep(0.0, 0.34, height);
        vec3 horizonColor = vec3(0.83, 0.91, 0.94);
        vec3 midColor = vec3(0.48, 0.70, 0.88);
        vec3 zenithColor = vec3(0.20, 0.48, 0.82);
        vec3 skyColor = mix(horizonColor, midColor, horizon);
        skyColor = mix(skyColor, zenithColor, smoothstep(0.48, 1.0, height));

        float sunDot = max(dot(direction, normalize(uSunDirection)), 0.0);
        float sunDisc = pow(sunDot, 720.0);
        float sunGlow = pow(sunDot, 22.0);
        skyColor += vec3(1.0, 0.78, 0.36) * sunGlow * 0.42;
        skyColor = mix(skyColor, vec3(1.0, 0.94, 0.74), clamp(sunDisc * 3.0, 0.0, 1.0));

        vec2 cloudUv = vec2(atan(direction.y, direction.x) * 0.9, direction.z * 2.3);
        float cloudBand = smoothstep(0.30, 0.56, height) * (1.0 - smoothstep(0.92, 1.0, height));
        float cloudMask = smoothstep(0.58, 0.78, cloudNoise(cloudUv));
        float cloudAlpha = cloudMask * cloudBand * 0.42;
        vec3 cloudColor = mix(vec3(0.76, 0.82, 0.84), vec3(1.0), height);
        skyColor = mix(skyColor, cloudColor, cloudAlpha);

        float haze = 1.0 - smoothstep(0.18, 0.42, height);
        skyColor = mix(skyColor, vec3(0.86, 0.93, 0.95), haze * 0.28);

        gl_FragColor = vec4(skyColor, 1.0);
      }
    `,
  })
  const dome = new THREE.Mesh(geometry, material)
  dome.name = 'procedural-realistic-sky-dome'
  dome.renderOrder = -1000
  return dome
}

function loadGroundMaps(basePath) {
  const loader = new THREE.TextureLoader()
  const repeat = 2400
  const configure = (texture, colorSpace = THREE.NoColorSpace) => {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat, repeat)
    texture.anisotropy = globalRenderer?.capabilities?.getMaxAnisotropy?.() || 1
    texture.colorSpace = colorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    return texture
  }

  return {
    diffuse: configure(
      loader.load(`${basePath}dirt_diff_2k.jpg`),
      THREE.SRGBColorSpace,
    ),
    normal: configure(loader.load(`${basePath}dirt_nor_gl_2k.jpg`)),
    roughness: configure(loader.load(`${basePath}dirt_rough_2k.jpg`)),
    ao: configure(loader.load(`${basePath}dirt_ao_2k.jpg`)),
  }
}

/**
 * 绑定到容器
 */
function bindContainer(container) {
  if (!container) {
    console.warn('[SceneManager] 容器无效')
    return false
  }

  // 如果已经绑定到同一个容器，不需要重新绑定
  if (currentContainer === container && globalControls) {
    console.log('[SceneManager] 已绑定到此容器，跳过')
    return true
  }

  console.log('[SceneManager] 绑定到新容器')

  // 确保场景已初始化
  initScene()

  // 只移动 Three 自己的 canvas，不清空整个容器。
  // 宿主容器属于 Vue 管理，直接 innerHTML 会让 Vue 的 vnode/真实 DOM 映射失效。
  const canvas = globalRenderer?.domElement
  const previousParent = canvas?.parentElement
  if (canvas && previousParent && previousParent !== container) {
    previousParent.removeChild(canvas)
  }
  if (canvas && canvas.parentElement !== container) {
    container.appendChild(canvas)
  }
  currentContainer = container

  // 创建或更新控制器
  if (!globalControls) {
    globalControls = new OrbitControls(globalCamera, globalRenderer.domElement)
    globalControls.enableDamping = true
    globalControls.dampingFactor = 0.08
    globalControls.target.set(0, 0, 0)
    globalControls.minDistance = 0.1
    globalControls.maxDistance = 500
  } else {
    // 更新控制器的 DOM 元素
    globalControls.domElement = globalRenderer.domElement
  }

  // 设置 resize observer
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  resizeObserver = new ResizeObserver(() => {
    resizeRenderer()
  })
  resizeObserver.observe(container)

  // 初始调整大小
  resizeRenderer()

  if (perfOverlayVisible) {
    mountPerfOverlay()
  }

  // 启动动画循环（如果还没启动）
  if (!animationFrameId) {
    animate()
  }

  return true
}

/**
 * 调整渲染器大小
 */
function resizeRenderer() {
  if (!currentContainer || !globalRenderer || !globalCamera) return

  const width = currentContainer.clientWidth || 1
  const height = currentContainer.clientHeight || 1

  globalRenderer.setSize(width, height, false)
  globalCamera.aspect = width / height
  globalCamera.updateProjectionMatrix()
  if (globalComposer) {
    globalComposer.setSize(width, height)
  }
}

/**
 * 动画循环
 */
function animate() {
  animationFrameId = window.requestAnimationFrame(animate)

  if (globalControls) {
    globalControls.update()
  }

  // 执行帧回调（如流线粒子动画）
  if (frameCallbacks.length && clock) {
    const elapsed = clock.getElapsedTime()
    for (let i = 0; i < frameCallbacks.length; i++) {
      frameCallbacks[i](elapsed)
    }
  }

  // broadcast uTime to all volume meshes for static micro-flow
  if (globalScene && globalRenderer) {
    const elapsed = clock?.getElapsedTime() ?? 0
    globalScene.traverse((obj) => {
      if (obj.isMesh && obj.material?.uniforms?.uTime) {
        obj.material.uniforms.uTime.value = elapsed
      }
    })
  }

  const shouldRenderDirectly = hasVisibleGaussianSplatModel(globalScene)
  if (globalComposer && globalScene && globalCamera && !shouldRenderDirectly) {
    globalComposer.render()
  } else if (globalRenderer && globalScene && globalCamera) {
    globalRenderer.render(globalScene, globalCamera)
  }

  if (postRenderCallbacks.length && globalScene && globalCamera) {
    for (let i = 0; i < postRenderCallbacks.length; i++) {
      postRenderCallbacks[i]()
    }
  }

  if (perfOverlayVisible && perfOverlayEl && globalRenderer) {
    updatePerfOverlayDom()
  }
}

function hasVisibleGaussianSplatModel(scene) {
  if (!scene) return false
  let found = false
  scene.traverse((object) => {
    if (found || object.visible === false) return
    if (object.userData?.isGaussianSplatModel) {
      found = true
    }
  })
  return found
}

function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

function installPerfOverlayHotkey() {
  if (perfHotkeyInstalled) return
  perfHotkeyInstalled = true
  window.addEventListener(
    'keydown',
    (ev) => {
      if (ev.code !== 'F3') return
      if (isTypingTarget(ev.target)) return
      if (!currentContainer) return
      ev.preventDefault()
      ev.stopPropagation()
      perfOverlayVisible = !perfOverlayVisible
      if (perfOverlayVisible) {
        mountPerfOverlay()
      } else {
        unmountPerfOverlay()
      }
    },
    true,
  )
}

function mountPerfOverlay() {
  if (!currentContainer) return
  unmountPerfOverlay(false)
  const el = document.createElement('div')
  el.className = 'three-scene-perf-overlay'
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = [
    'position:absolute',
    'top:8px',
    'right:8px',
    'z-index:10050',
    'pointer-events:none',
    'font:12px/1.45 ui-monospace,Consolas,monospace',
    'color:#c8ffd8',
    'background:rgba(6,17,29,.88)',
    'border:1px solid rgba(120,200,255,.4)',
    'border-radius:6px',
    'padding:8px 10px',
    'text-align:right',
    'white-space:pre',
    'box-shadow:0 2px 12px rgba(0,0,0,.35)',
  ].join(';')
  currentContainer.appendChild(el)
  perfOverlayEl = el
  const pos = getComputedStyle(currentContainer).position
  if (pos === 'static') {
    currentContainer.style.position = 'relative'
  }
  perfLastFrameAt = performance.now()
  perfFpsWindowStart = perfLastFrameAt
  perfFpsFrameCount = 0
}

function unmountPerfOverlay(clearVisible = true) {
  if (perfOverlayEl?.parentNode) {
    perfOverlayEl.parentNode.removeChild(perfOverlayEl)
  }
  perfOverlayEl = null
  if (clearVisible) perfOverlayVisible = false
}

function updatePerfOverlayDom() {
  const t = performance.now()
  perfFrameMs = t - perfLastFrameAt
  perfLastFrameAt = t
  perfFpsFrameCount++
  if (t - perfFpsWindowStart >= 500) {
    perfFps =
      (perfFpsFrameCount * 1000) / Math.max(t - perfFpsWindowStart, 1e-6)
    perfFpsFrameCount = 0
    perfFpsWindowStart = t
  }

  const r = globalRenderer
  const info = r?.info
  const calls = info?.render?.calls ?? 0
  const tris = info?.render?.triangles ?? 0
  const pts = info?.render?.points ?? 0
  const lines = info?.render?.lines ?? 0
  const geoms = info?.memory?.geometries ?? 0
  const tex = info?.memory?.textures ?? 0
  const pr = r?.getPixelRatio?.() ?? 1
  r.getDrawingBufferSize(perfDrawingBufferScratch)
  const w = perfDrawingBufferScratch.x
  const h = perfDrawingBufferScratch.y

  perfOverlayEl.textContent = [
    `FPS  ${perfFps.toFixed(0)}`,
    `帧   ${perfFrameMs.toFixed(2)} ms`,
    `缓冲 ${w}×${h}  @${pr.toFixed(2)}×`,
    `Draw ${calls}  Tri ${tris}`,
    `Pt ${pts}  Line ${lines}`,
    `Geom ${geoms}  Tex ${tex}`,
    '',
    'F3 隐藏',
  ].join('\n')
}

/**
 * 注册每帧回调
 * @param {Function} callback - 接受 elapsed (秒) 参数
 */
export function addFrameCallback(callback) {
  if (typeof callback === 'function' && !frameCallbacks.includes(callback)) {
    frameCallbacks.push(callback)
  }
}

/**
 * 移除帧回调
 */
export function removeFrameCallback(callback) {
  const idx = frameCallbacks.indexOf(callback)
  if (idx > -1) frameCallbacks.splice(idx, 1)
}

/**
 * 注册在每帧 WebGL（或 Composer）渲染完成之后执行的回调
 */
export function addPostRenderCallback(callback) {
  if (
    typeof callback === 'function' &&
    !postRenderCallbacks.includes(callback)
  ) {
    postRenderCallbacks.push(callback)
  }
}

export function removePostRenderCallback(callback) {
  const idx = postRenderCallbacks.indexOf(callback)
  if (idx > -1) postRenderCallbacks.splice(idx, 1)
}

/**
 * 停止动画循环
 */
function stopAnimation() {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = 0
    console.log('[SceneManager] 动画循环已停止')
  }
}

/**
 * 获取场景实例（增加引用计数）
 */
export function getScene(container) {
  refCount++
  console.log(`[SceneManager] 引用计数: ${refCount}`)

  initScene()

  if (container) {
    bindContainer(container)
  }

  return {
    scene: globalScene,
    camera: globalCamera,
    controls: globalControls,
    renderer: globalRenderer,
    raycaster,
    clock,
    groups: {
      root: rootGroup,
      plane: planeGroup,
      volume: volumeGroup,
      streamline: streamlineGroup,
      bounds: boundsGroup,
      overlay: overlayGroup,
      axis: axisGroup,
      model: modelGroup,
      monitoringPoints: monitoringPointsGroup,
    },
    lights: {
      ambient: ambientLight,
      hemisphere: hemisphereLight,
      key: keyLight,
      fill: fillLight,
      rim: rimLight,
    },
  }
}

/**
 * 释放场景引用
 */
export function releaseScene() {
  refCount--
  console.log(`[SceneManager] 引用计数: ${refCount}`)

  // 只有当引用计数归零时才真正清理
  if (refCount <= 0) {
    console.log('[SceneManager] 引用计数归零，清理场景')
    cleanup()
  }
}

/**
 * 强制清理场景（慎用）
 */
export function forceCleanup() {
  console.warn('[SceneManager] 强制清理场景')
  refCount = 0
  cleanup()
}

/**
 * 内部清理函数
 */
function cleanup() {
  console.log('[SceneManager] 开始清理...')

  unmountPerfOverlay()
  perfOverlayVisible = false

  // 停止动画
  stopAnimation()

  // 断开 resize observer
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  // 清理控制器
  if (globalControls) {
    globalControls.dispose()
    globalControls = null
  }

  // 清理场景中的所有对象
  if (globalScene) {
    globalScene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose()
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => disposeMaterial(material))
        } else {
          disposeMaterial(object.material)
        }
      }
    })
    if (sky?.dispose) {
      sky.dispose()
    }
    globalScene.background = null
    globalScene.environment = null
  }

  // 清理组
  clearGroup(planeGroup)
  clearGroup(volumeGroup)
  clearGroup(streamlineGroup)
  clearGroup(boundsGroup)
  clearGroup(overlayGroup)
  clearGroup(monitoringPointsGroup)
  clearGroup(axisGroup)
  clearGroup(modelGroup)
  clearGroup(rootGroup)

  // 释放后处理器
  if (globalComposer) {
    globalComposer.dispose()
    globalComposer = null
  }

  // 释放 renderer
  if (globalRenderer) {
    if (globalRenderer.domElement?.parentElement === currentContainer) {
      currentContainer.removeChild(globalRenderer.domElement)
    }
    releaseRenderer()
    globalRenderer = null
  }

  // 清空帧回调
  frameCallbacks.length = 0
  postRenderCallbacks.length = 0

  // 清空所有引用
  globalScene = null
  globalCamera = null
  raycaster = null
  gltfModel = null
  clock = null
  sky = null
  groundPlane = null
  currentContainer = null

  rootGroup = null
  planeGroup = null
  volumeGroup = null
  streamlineGroup = null
  boundsGroup = null
  overlayGroup = null
  axisGroup = null
  modelGroup = null
  monitoringPointsGroup = null

  ambientLight = null
  hemisphereLight = null
  keyLight = null
  fillLight = null
  rimLight = null

  console.log('[SceneManager] 清理完成')
}

/**
 * 清理材质
 */
function disposeMaterial(material) {
  if (!material) return

  const textures = [
    'map',
    'lightMap',
    'bumpMap',
    'normalMap',
    'specularMap',
    'envMap',
    'alphaMap',
    'aoMap',
    'displacementMap',
    'emissiveMap',
    'gradientMap',
    'metalnessMap',
    'roughnessMap',
  ]

  textures.forEach((textureName) => {
    if (material[textureName]) {
      material[textureName].dispose()
    }
  })

  if (material.uniforms) {
    Object.values(material.uniforms).forEach((uniform) => {
      if (
        uniform.value?.dispose &&
        typeof uniform.value.dispose === 'function'
      ) {
        uniform.value.dispose()
      }
    })
  }

  material.dispose()
}

/**
 * 清理组
 */
function clearGroup(group) {
  if (!group) return

  while (group.children.length > 0) {
    const child = group.children[0]
    group.remove(child)

    if (child.geometry) {
      child.geometry.dispose()
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => disposeMaterial(m))
      } else {
        disposeMaterial(child.material)
      }
    }
  }
}

/**
 * 获取当前引用计数
 */
export function getRefCount() {
  return refCount
}

/**
 * 检查场景是否存在
 */
export function hasScene() {
  return globalScene !== null
}

/**
 * 重置引用计数（用于调试）
 */
export function resetRefCount() {
  console.warn('[SceneManager] 重置引用计数')
  refCount = 0
}

/**
 * 添加事件监听器
 */
export function addEventListener(type, handler) {
  if (!eventListeners[type]) {
    eventListeners[type] = []
  }
  eventListeners[type].push(handler)

  // 如果 renderer 已存在，立即添加到 DOM
  if (globalRenderer?.domElement) {
    globalRenderer.domElement.addEventListener(type, handler)
  }
}

/**
 * 移除事件监听器
 */
export function removeEventListener(type, handler) {
  if (eventListeners[type]) {
    const index = eventListeners[type].indexOf(handler)
    if (index > -1) {
      eventListeners[type].splice(index, 1)
    }
  }

  if (globalRenderer?.domElement) {
    globalRenderer.domElement.removeEventListener(type, handler)
  }
}

/**
 * 获取诊断信息
 */
export function getDiagnostics() {
  return {
    refCount,
    hasScene: !!globalScene,
    hasCamera: !!globalCamera,
    hasControls: !!globalControls,
    hasRenderer: !!globalRenderer,
    isAnimating: animationFrameId > 0,
    containerBound: !!currentContainer,
    sceneChildren: globalScene?.children?.length || 0,
  }
}
