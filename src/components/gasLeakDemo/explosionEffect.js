import * as THREE from 'three'

/**
 * 软圆点贴图（用于余烬粒子）：中心实心 → 边缘柔和衰减
 */
function createEmberTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.2)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

/**
 * 烟雾贴图：柔和絮状灰团，用于爆后黑烟柱
 */
function createSmokeTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2

  ctx.clearRect(0, 0, size, size)
  const base = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  base.addColorStop(0, 'rgba(255,255,255,0.55)')
  base.addColorStop(0.4, 'rgba(255,255,255,0.28)')
  base.addColorStop(0.75, 'rgba(255,255,255,0.08)')
  base.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  // 叠加絮状细节，让烟团不规则
  for (let b = 0; b < 8; b++) {
    const bx = cx + (Math.random() - 0.5) * size * 0.5
    const by = cx + (Math.random() - 0.5) * size * 0.5
    const br = size * (0.18 + Math.random() * 0.22)
    const a = 0.08 + Math.random() * 0.1
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    g.addColorStop(0, `rgba(255,255,255,${a})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

/**
 * 冲击波地面圆环贴图：中心透明 → 亮环 → 透明外缘
 */
function createShockRingTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2
  ctx.clearRect(0, 0, size, size)
  const innerR = cx * 0.32
  const outerR = cx * 0.96
  const grad = ctx.createRadialGradient(cx, cx, innerR, cx, cx, outerR)
  grad.addColorStop(0, 'rgba(255,200,100,0)')
  grad.addColorStop(0.32, 'rgba(255,200,100,0.12)')
  grad.addColorStop(0.55, 'rgba(255,235,190,0.75)')
  grad.addColorStop(0.72, 'rgba(255,170,70,0.32)')
  grad.addColorStop(1, 'rgba(120,40,10,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

// 火球 FBM 噪声 shader 片段（3D value noise + 6 octaves + 旋转扰动）
const NOISE_GLSL = `
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
                   mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                   mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
      v += a * vnoise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }
  // 旋转矩阵扰动采样坐标，避免噪声各向同性
  mat3 rotY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c);
  }
  mat3 rotZ(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,-s,0.0, s,c,0.0, 0.0,0.0,1.0);
  }
`

/**
 * 爆炸 3D 视觉效果（真实感增强版）：
 *  - 火球：FBM 噪声驱动的翻滚火焰，Fresnel 边缘辉光，上升 + 蘑菇式膨胀
 *  - 冲击波：3D 球壳辉光 + 地面圆环
 *  - 闪光灯：暖色高频闪烁衰减
 *  - 余烬：彩色粒子（白热→橙→暗红），重力 + 阻力
 *  - 烟柱：爆后深色 NormalBlended 烟雾上升翻滚
 *  - 摄像机抖动：分层正弦（低频为主 + 高频细节），二次衰减
 *
 * 公共 API 保持稳定：constructor / trigger / update / getShakeOffset / reset / dispose
 */
export class ExplosionEffect {
  /**
   * @param {Object} options
   * @param {THREE.Vector3} [options.position] 爆炸中心
   * @param {THREE.Object3D} [options.scene] 父级场景组
   * @param {number} [options.cameraShakeIntensity=0.5] 摄像机抖动最大幅度
   * @param {number} [options.cameraShakeDuration=1.6] 摄像机抖动持续时间（秒）
   * @param {number} [options.scale=1] 爆炸整体尺寸缩放
   */
  constructor(options = {}) {
    this.position = options.position?.clone?.() || new THREE.Vector3()
    this._scene = options.scene || null
    this._cameraShakeIntensity = options.cameraShakeIntensity ?? 0.5
    this._cameraShakeDuration = options.cameraShakeDuration ?? 1.6
    this._scale = Math.max(0.1, options.scale ?? 1)

    this._group = new THREE.Group()
    this._group.name = 'explosionEffect'
    this._group.position.copy(this.position)

    // ---- 火球（双层噪声翻滚 + 连续色温渐变 + 烟黑边缘过渡）----
    this._fireball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 40),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        uniforms: {
          uTime: { value: 0 },
          uLife: { value: 0 },
          uOpacity: { value: 0 },
        },
        vertexShader: `
          varying vec3 vLocalPos;
          varying vec3 vViewNormal;
          varying vec3 vViewPos;
          varying vec3 vWorldNormal;
          void main() {
            vLocalPos = position;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewPos = mvPos.xyz;
            vViewNormal = normalize(normalMatrix * normal);
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uLife;
          uniform float uOpacity;
          varying vec3 vLocalPos;
          varying vec3 vViewNormal;
          varying vec3 vViewPos;
          varying vec3 vWorldNormal;
          ${NOISE_GLSL}

          // 黑体辐射色温渐变（连续）：低温暗红 → 橙 → 黄 → 白热
          vec3 blackbody(float t) {
            t = clamp(t, 0.0, 1.0);
            vec3 c;
            // 0.0-0.3: 暗红 → 橙红
            if (t < 0.3) {
              c = mix(vec3(0.18, 0.02, 0.0), vec3(1.0, 0.35, 0.08), t / 0.3);
            }
            // 0.3-0.6: 橙红 → 橙黄
            else if (t < 0.6) {
              c = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.75, 0.30), (t - 0.3) / 0.3);
            }
            // 0.6-0.85: 橙黄 → 黄白
            else if (t < 0.85) {
              c = mix(vec3(1.0, 0.75, 0.30), vec3(1.0, 0.95, 0.72), (t - 0.6) / 0.25);
            }
            // 0.85-1.0: 黄白 → 白热
            else {
              c = mix(vec3(1.0, 0.95, 0.72), vec3(1.0, 1.0, 0.98), (t - 0.85) / 0.15);
            }
            return c;
          }

          void main() {
            // 双层噪声：大尺度形态 + 小尺度湍流细节
            // 第一层：旋转扰动的大尺度形态噪声，决定火球整体翻卷结构
            vec3 p1 = rotY(uTime * 0.35) * rotZ(uTime * 0.22) * vLocalPos;
            p1 = p1 * 1.8 + vec3(0.0, uTime * 0.7, 0.0);
            float nForm = fbm(p1);

            // 第二层：高频湍流细节，向上滚动更快，模拟火舌
            vec3 p2 = vLocalPos * 4.2 + vec3(uTime * 0.15, uTime * 1.6, uTime * 0.1);
            float nDetail = fbm(p2);

            // 混合：形态为主 + 细节叠加
            float n = nForm * 0.7 + nDetail * 0.3;
            n = clamp(n, 0.0, 1.0);

            // 中心高温偏移：靠近球心温度更高
            float distFromCenter = length(vLocalPos);
            float heatBias = smoothstep(1.0, 0.2, distFromCenter) * 0.35;
            float heat = clamp(n + heatBias, 0.0, 1.0);
            heat = pow(heat, 1.15);

            // Fresnel 边缘
            vec3 viewDir = normalize(-vViewPos);
            float fres = pow(1.0 - max(dot(normalize(vViewNormal), viewDir), 0.0), 2.5);

            // 颜色：黑体辐射连续渐变
            vec3 col = blackbody(heat);

            // 边缘辉光（暖色，模拟外焰）
            col += fres * vec3(1.0, 0.42, 0.12) * 0.6;

            // 后期向烟黑过渡：生命过半时颜色压暗、加灰
            float smokeBlend = smoothstep(0.45, 0.95, uLife);
            col = mix(col, vec3(0.06, 0.05, 0.04), smokeBlend * 0.7);

            // 透明度：低噪声区镂空成火舌，边缘 Fresnel 增强
            float alpha = smoothstep(0.10, 0.32, n);
            alpha += fres * 0.4;
            alpha *= smoothstep(0.0, 0.08, uLife) * (1.0 - smokeBlend * 0.85);
            alpha *= uOpacity;

            // 烟黑阶段降低透明度但保留形态
            alpha = max(alpha, smokeBlend * smoothstep(0.10, 0.30, n) * 0.25 * uOpacity);

            if (alpha < 0.008) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      }),
    )
    this._fireball.renderOrder = 10
    this._fireball.visible = false
    this._group.add(this._fireball)

    // ---- 冲击波球壳（多层叠加：快层 + 慢层，不同色温）----
    this._shockShell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 28),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        uniforms: {
          uOpacity: { value: 0 },
          uColorHot: { value: new THREE.Color(0xffd9a0) },
          uColorCool: { value: new THREE.Color(0xff7a2a) },
        },
        vertexShader: `
          varying vec3 vViewNormal;
          varying vec3 vViewPos;
          void main() {
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewPos = mvPos.xyz;
            vViewNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform float uOpacity;
          uniform vec3 uColorHot;
          uniform vec3 uColorCool;
          varying vec3 vViewNormal;
          varying vec3 vViewPos;
          void main() {
            vec3 viewDir = normalize(-vViewPos);
            // BackSide：法线朝内，取反后计算薄壳辉光
            float fres = pow(1.0 - max(dot(-normalize(vViewNormal), viewDir), 0.0), 3.0);
            // 内外色温渐变：峰值热色，边缘冷色
            vec3 col = mix(uColorCool, uColorHot, fres);
            float alpha = fres * uOpacity;
            if (alpha < 0.005) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      }),
    )
    this._shockShell.renderOrder = 9
    this._shockShell.visible = false
    this._group.add(this._shockShell)

    // 第二层冲击波：更快、更亮、更早消散
    this._shockShell2 = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 22),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        uniforms: {
          uOpacity: { value: 0 },
        },
        vertexShader: `
          varying vec3 vViewNormal;
          varying vec3 vViewPos;
          void main() {
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewPos = mvPos.xyz;
            vViewNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform float uOpacity;
          varying vec3 vViewNormal;
          varying vec3 vViewPos;
          void main() {
            vec3 viewDir = normalize(-vViewPos);
            float fres = pow(1.0 - max(dot(-normalize(vViewNormal), viewDir), 0.0), 4.0);
            vec3 col = vec3(1.0, 0.95, 0.8);
            float alpha = fres * uOpacity;
            if (alpha < 0.005) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      }),
    )
    this._shockShell2.renderOrder = 9
    this._shockShell2.visible = false
    this._group.add(this._shockShell2)

    // ---- 地面冲击圆环 ----
    this._shockRingTexture = createShockRingTexture()
    this._shockRing = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this._shockRingTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
        side: THREE.DoubleSide,
      }),
    )
    // Z 竖直向上，地面环在 XY 平面，无需绕 X 旋转
    this._shockRing.position.z = 0.05
    this._shockRing.renderOrder = 8
    this._group.add(this._shockRing)

    // ---- 闪光灯 ----
    this._light = new THREE.PointLight(0xffb060, 0, 40, 2)
    // Z 竖直向上
    this._light.position.set(0, 0, 1.2)
    this._group.add(this._light)

    // ---- 余烬粒子（白热→暗红）----
    this._emberCount = 260
    this._emberTexture = createEmberTexture()
    this._emberGeo = new THREE.BufferGeometry()
    this._emberPositions = new Float32Array(this._emberCount * 3)
    this._emberVelocities = new Float32Array(this._emberCount * 3)
    this._emberAges = new Float32Array(this._emberCount)
    this._emberLifetimes = new Float32Array(this._emberCount)
    this._emberSizes = new Float32Array(this._emberCount)
    this._emberColors = new Float32Array(this._emberCount * 3)
    this._emberAlphas = new Float32Array(this._emberCount)
    this._emberGeo.setAttribute('position', new THREE.BufferAttribute(this._emberPositions, 3))
    this._emberGeo.setAttribute('size', new THREE.BufferAttribute(this._emberSizes, 1))
    this._emberGeo.setAttribute('aColor', new THREE.BufferAttribute(this._emberColors, 3))
    this._emberGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this._emberAlphas, 1))

    this._emberMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTexture: { value: this._emberTexture },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 aColor;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * (240.0 / -mv.z);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          if (tex.a < 0.01) discard;
          float a = tex.a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    })
    this._embers = new THREE.Points(this._emberGeo, this._emberMaterial)
    this._embers.frustumCulled = false
    this._embers.visible = false
    this._group.add(this._embers)

    // ---- 烟柱（爆后黑烟，CustomBlending ReverseSubtract 真正减暗场景）----
    // NormalBlending 在暗背景上只会产生灰雾；改用 ReverseSubtractEquation：
    // result = dst - src*alpha，烟色越叠场景越黑，形成真正的浓烟遮挡
    this._smokeCount = 55
    this._smokeTexture = createSmokeTexture()
    this._smokeGeo = new THREE.BufferGeometry()
    this._smokePositions = new Float32Array(this._smokeCount * 3)
    this._smokeVelocities = new Float32Array(this._smokeCount * 3)
    this._smokeAges = new Float32Array(this._smokeCount)
    this._smokeLifetimes = new Float32Array(this._smokeCount)
    this._smokeSizes = new Float32Array(this._smokeCount)
    this._smokeOpacities = new Float32Array(this._smokeCount)
    this._smokeDelays = new Float32Array(this._smokeCount)
    this._smokeGeo.setAttribute('position', new THREE.BufferAttribute(this._smokePositions, 3))
    this._smokeGeo.setAttribute('size', new THREE.BufferAttribute(this._smokeSizes, 1))
    this._smokeGeo.setAttribute('aOpacity', new THREE.BufferAttribute(this._smokeOpacities, 1))

    this._smokeMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.ReverseSubtractEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      uniforms: {
        uTexture: { value: this._smokeTexture },
        // 减法混合下用中性灰，alpha 控制减暗强度
        uColor: { value: new THREE.Color(0x202020) },
      },
      vertexShader: `
        attribute float size;
        attribute float aOpacity;
        varying float vOpacity;
        void main() {
          vOpacity = aOpacity;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * (300.0 / -mv.z);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform vec3 uColor;
        varying float vOpacity;
        void main() {
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          if (tex.a < 0.01) discard;
          float a = tex.a * vOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    })
    this._smoke = new THREE.Points(this._smokeGeo, this._smokeMaterial)
    this._smoke.frustumCulled = false
    this._smoke.renderOrder = 11
    this._smoke.visible = false
    this._group.add(this._smoke)

    if (this._scene) this._scene.add(this._group)

    this._active = false
    this._elapsed = 0
    this._intensity = 1
    this._shakeOffset = new THREE.Vector3()

    // 各子效果持续时间
    this._fireballDuration = 2.2
    this._shockDuration = 1.5
    this._shock2Duration = 0.9
    this._lightDuration = 2.6
    this._emberDuration = 3.2
    this._smokeDuration = 6.0
  }

  /**
   * 触发爆炸。
   * @param {Object} [options]
   * @param {THREE.Vector3} [options.position] 爆炸位置
   * @param {number} [options.intensity=1] 爆炸强度
   */
  trigger(options = {}) {
    this._active = true
    this._elapsed = 0
    this._intensity = Math.max(0.1, options.intensity ?? 1)
    if (options.position) {
      this.position.copy(options.position)
      this._group.position.copy(this.position)
    }
    this._fireball.visible = true
    this._shockShell.visible = true
    this._shockShell2.visible = true
    this._shockRing.visible = true
    this._embers.visible = true
    this._smoke.visible = true
    this._resetEmbers()
    this._resetSmoke()
  }

  /**
   * 每帧更新所有子效果。
   * @param {number} delta 秒
   * @returns {boolean} 是否仍在活跃状态
   */
  update(delta) {
    if (!this._active) return false
    const dt = Math.min(delta, 0.05)
    this._elapsed += dt
    const t = this._elapsed

    // ---- 火球：膨胀 + 上升 + 翻滚 ----
    if (t < this._fireballDuration) {
      const ft = t / this._fireballDuration
      this._fireball.material.uniforms.uTime.value = t
      this._fireball.material.uniforms.uLife.value = ft
      this._fireball.material.uniforms.uOpacity.value = 1.0
      // 膨胀：初期快、后期慢（指数缓出）
      const ease = 1 - Math.exp(-ft * 3.2)
      const radius = (0.5 + ease * 3.6) * this._intensity * this._scale
      // 蘑菇式：竖直方向（Z）略大
      this._fireball.scale.set(radius * 0.95, radius * 0.95, radius * 1.15)
      // 上升（Z 轴）
      this._fireball.position.z = ft * 1.8 * this._intensity * this._scale
    } else {
      this._fireball.visible = false
    }

    // ---- 冲击波球壳 + 地面圆环（多层）----
    if (t < this._shockDuration) {
      const st = t / this._shockDuration
      const shellRadius = (1.2 + st * 28) * this._intensity * this._scale
      this._shockShell.scale.setScalar(shellRadius)
      this._shockShell.material.uniforms.uOpacity.value = Math.max(0, Math.pow(1 - st, 1.5) * 0.9)

      const ringRadius = (1.5 + st * 26) * this._intensity * this._scale
      this._shockRing.scale.setScalar(ringRadius)
      this._shockRing.material.opacity = Math.max(0, Math.pow(1 - st, 1.3) * 0.75)
    } else {
      this._shockShell.visible = false
      this._shockRing.visible = false
    }

    // 第二层冲击波：更快、更早消散
    if (t < this._shock2Duration) {
      const st2 = t / this._shock2Duration
      const r2 = (1.0 + st2 * 34) * this._intensity * this._scale
      this._shockShell2.scale.setScalar(r2)
      this._shockShell2.material.uniforms.uOpacity.value = Math.max(0, Math.pow(1 - st2, 2.0) * 1.0)
    } else {
      this._shockShell2.visible = false
    }

    // ---- 闪光灯：高峰持续 0.5s + 多频闪烁 + 暖冷色温变化 ----
    if (t < this._lightDuration) {
      const lt = t / this._lightDuration
      // 高峰平台：前 0.19s（lt<0.075）维持满亮，之后衰减
      let envelope
      if (lt < 0.075) envelope = 1.0
      else envelope = Math.pow(1 - (lt - 0.075) / 0.925, 2.0)
      // 多频闪烁：低频主体 + 高频细节
      const flicker = 0.82 + 0.12 * Math.sin(t * 38) + 0.06 * Math.sin(t * 91 + 1.2)
      this._light.intensity = Math.max(0, envelope * 26 * this._intensity * flicker)
      // 色温：初白热 → 后暖橙
      const tempT = Math.min(1, lt * 1.3)
      const r = 1.0
      const g = 1.0 - tempT * 0.18
      const b = 0.85 - tempT * 0.55
      this._light.color.setRGB(r, g, b)
    } else {
      this._light.intensity = 0
    }

    // ---- 余烬 ----
    this._updateEmbers(dt)

    // ---- 烟柱 ----
    this._updateSmoke(dt)

    // ---- 摄像机抖动：分层正弦（低频为主 + 高频细节），二次衰减 ----
    if (t < this._cameraShakeDuration) {
      const falloff = 1 - t / this._cameraShakeDuration
      const mag = this._cameraShakeIntensity * falloff * falloff * this._intensity
      const fx = 0.62 * Math.sin(t * 24.0) + 0.30 * Math.sin(t * 51.0 + 1.3) + 0.14 * Math.sin(t * 97.0 + 2.7)
      const fy = 0.62 * Math.sin(t * 26.0 + 0.5) + 0.30 * Math.sin(t * 49.0 + 2.1) + 0.14 * Math.sin(t * 103.0 + 0.8)
      const fz = 0.62 * Math.sin(t * 22.0 + 1.1) + 0.30 * Math.sin(t * 55.0 + 0.4) + 0.14 * Math.sin(t * 89.0 + 1.9)
      this._shakeOffset.set(fx * mag, fy * mag, fz * mag)
    } else {
      this._shakeOffset.set(0, 0, 0)
    }

    // 所有效果结束后停止
    const total = Math.max(
      this._fireballDuration, this._shockDuration, this._shock2Duration,
      this._lightDuration, this._emberDuration, this._smokeDuration,
      this._cameraShakeDuration,
    )
    if (t > total) {
      this._active = false
      this._fireball.visible = false
      this._shockShell.visible = false
      this._shockShell2.visible = false
      this._shockRing.visible = false
      this._embers.visible = false
      this._smoke.visible = false
      this._light.intensity = 0
    }

    return this._active
  }

  /** 获取当前帧的摄像机抖动偏移量 */
  getShakeOffset() {
    return this._shakeOffset
  }

  /** 立即停止所有子效果（用于重置场景） */
  reset() {
    this._active = false
    this._elapsed = 0
    this._fireball.visible = false
    this._shockShell.visible = false
    this._shockShell2.visible = false
    this._shockRing.visible = false
    this._embers.visible = false
    this._smoke.visible = false
    this._light.intensity = 0
    this._shakeOffset.set(0, 0, 0)
    this._fireball.position.z = 0
  }

  _resetEmbers() {
    for (let i = 0; i < this._emberCount; i++) {
      const idx = i * 3
      this._emberPositions[idx] = 0
      this._emberPositions[idx + 1] = 0
      this._emberPositions[idx + 2] = 0

      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speed = (2.8 + Math.random() * 7) * this._intensity * this._scale
      // Z 竖直向上：初始速度以 Z 为主
      this._emberVelocities[idx] = Math.sin(phi) * Math.cos(theta) * speed
      this._emberVelocities[idx + 1] = Math.sin(phi) * Math.sin(theta) * speed
      this._emberVelocities[idx + 2] = (Math.cos(phi) + 0.35) * speed

      this._emberLifetimes[i] = 0.7 + Math.random() * 1.7
      this._emberAges[i] = 0
      this._emberSizes[i] = 0.12 + Math.random() * 0.38
      // 初始为白热色
      this._emberColors[idx] = 1.0
      this._emberColors[idx + 1] = 0.92
      this._emberColors[idx + 2] = 0.65
      this._emberAlphas[i] = 0.9 + Math.random() * 0.1
    }
    this._emberGeo.attributes.position.needsUpdate = true
    this._emberGeo.attributes.size.needsUpdate = true
    this._emberGeo.attributes.aColor.needsUpdate = true
    this._emberGeo.attributes.aAlpha.needsUpdate = true
  }

  _updateEmbers(dt) {
    const gravity = -4.8
    let anyAlive = false
    for (let i = 0; i < this._emberCount; i++) {
      const idx = i * 3
      this._emberAges[i] += dt
      if (this._emberAges[i] >= this._emberLifetimes[i]) {
        if (this._emberAlphas[i] !== 0) {
          this._emberAlphas[i] = 0
          this._emberGeo.attributes.aAlpha.needsUpdate = true
        }
        continue
      }
      anyAlive = true
      this._emberPositions[idx] += this._emberVelocities[idx] * dt
      this._emberPositions[idx + 1] += this._emberVelocities[idx + 1] * dt
      this._emberPositions[idx + 2] += this._emberVelocities[idx + 2] * dt
      // Z 竖直向上，重力沿 -Z
      this._emberVelocities[idx + 2] += gravity * dt
      const drag = 1 - 0.55 * dt
      this._emberVelocities[idx] *= drag
      this._emberVelocities[idx + 1] *= drag
      this._emberVelocities[idx + 2] *= drag

      // 颜色随生命从白热 → 橙 → 暗红
      const r = this._emberAges[i] / this._emberLifetimes[i]
      let cr, cg, cb
      if (r < 0.35) {
        const k = r / 0.35
        cr = 1.0
        cg = 0.92 - k * 0.42
        cb = 0.65 - k * 0.50
      } else {
        const k = (r - 0.35) / 0.65
        cr = 1.0 - k * 0.45
        cg = 0.50 - k * 0.42
        cb = 0.15 - k * 0.13
      }
      this._emberColors[idx] = cr
      this._emberColors[idx + 1] = cg
      this._emberColors[idx + 2] = cb
      this._emberAlphas[i] = (1 - r) * 0.95
      this._emberSizes[i] *= 1 - 0.25 * dt
    }
    if (!anyAlive) this._embers.visible = false
    this._emberGeo.attributes.position.needsUpdate = true
    this._emberGeo.attributes.size.needsUpdate = true
    this._emberGeo.attributes.aColor.needsUpdate = true
    this._emberGeo.attributes.aAlpha.needsUpdate = true
  }

  _resetSmoke() {
    for (let i = 0; i < this._smokeCount; i++) {
      const idx = i * 3
      // 从爆炸中心一个小球内生成
      const r = Math.random() * 0.4
      const a = Math.random() * Math.PI * 2
      // Z 竖直向上：XY 水平，Z 为高度
      this._smokePositions[idx] = Math.cos(a) * r
      this._smokePositions[idx + 1] = Math.sin(a) * r
      this._smokePositions[idx + 2] = Math.random() * 0.3

      // 主要向上喷射（Z 轴） + 少量横向扩散
      const upward = (2.8 + Math.random() * 2.2) * this._scale
      this._smokeVelocities[idx] = (Math.random() - 0.5) * 0.9
      this._smokeVelocities[idx + 1] = (Math.random() - 0.5) * 0.9
      this._smokeVelocities[idx + 2] = upward

      this._smokeLifetimes[i] = 3.5 + Math.random() * 2.0
      this._smokeAges[i] = 0
      // 错峰生成，让烟柱持续涌出
      this._smokeDelays[i] = 0.15 + Math.random() * 1.0
      this._smokeSizes[i] = 0
      this._smokeOpacities[i] = 0
    }
    this._smokeGeo.attributes.position.needsUpdate = true
    this._smokeGeo.attributes.size.needsUpdate = true
    this._smokeGeo.attributes.aOpacity.needsUpdate = true
  }

  _updateSmoke(dt) {
    let anyAlive = false
    const baseSize = 2.4 * this._scale
    for (let i = 0; i < this._smokeCount; i++) {
      const idx = i * 3
      // 未到生成时间的粒子保持隐藏
      if (this._elapsed < this._smokeDelays[i]) {
        if (this._smokeOpacities[i] !== 0) {
          this._smokeOpacities[i] = 0
          this._smokeGeo.attributes.aOpacity.needsUpdate = true
        }
        continue
      }
      this._smokeAges[i] += dt
      const r = this._smokeAges[i] / this._smokeLifetimes[i]
      if (r >= 1) {
        if (this._smokeOpacities[i] !== 0) {
          this._smokeOpacities[i] = 0
          this._smokeGeo.attributes.aOpacity.needsUpdate = true
        }
        continue
      }
      anyAlive = true

      // 横向湍流：低频摆动，越往上摆动越强（Z 为高度）
      const heightFactor = 0.5 + this._smokePositions[idx + 2] * 0.15
      const sway = Math.sin(this._elapsed * 1.6 + i * 0.7) * 0.5 * heightFactor * dt
      const sway2 = Math.cos(this._elapsed * 1.3 + i * 0.5) * 0.5 * heightFactor * dt
      this._smokeVelocities[idx] += sway
      this._smokeVelocities[idx + 1] += sway2
      // 上升减速（浮力衰减）
      this._smokeVelocities[idx + 2] *= 1 - 0.22 * dt

      this._smokePositions[idx] += this._smokeVelocities[idx] * dt
      this._smokePositions[idx + 1] += this._smokeVelocities[idx + 1] * dt
      this._smokePositions[idx + 2] += this._smokeVelocities[idx + 2] * dt

      // 烟团持续大幅膨胀（0.8 → 4.0 倍）
      this._smokeSizes[i] = baseSize * (0.8 + r * 3.2)
      // 透明度：减法混合下需要较高 alpha 才能压暗；淡入 → 缓慢淡出
      let op
      if (r < 0.12) op = r / 0.12
      else if (r < 0.7) op = 1.0
      else op = Math.max(0, 1.0 - (r - 0.7) / 0.3)
      this._smokeOpacities[i] = op * 0.85
    }
    if (!anyAlive && this._elapsed > 2) this._smoke.visible = false
    this._smokeGeo.attributes.position.needsUpdate = true
    this._smokeGeo.attributes.size.needsUpdate = true
    this._smokeGeo.attributes.aOpacity.needsUpdate = true
  }

  dispose() {
    this._active = false
    this._fireball.geometry.dispose()
    this._fireball.material.dispose()
    this._shockShell.geometry.dispose()
    this._shockShell.material.dispose()
    this._shockShell2.geometry.dispose()
    this._shockShell2.material.dispose()
    this._shockRing.geometry.dispose()
    this._shockRing.material.dispose()
    this._emberGeo.dispose()
    this._emberMaterial.dispose()
    this._smokeGeo.dispose()
    this._smokeMaterial.dispose()
    this._emberTexture.dispose()
    this._smokeTexture.dispose()
    this._shockRingTexture.dispose()
    if (this._group.parent) this._group.parent.remove(this._group)
  }
}

export default ExplosionEffect
