import * as THREE from 'three'

function createFlameTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2
  const cy = size * 0.68

  ctx.clearRect(0, 0, size, size)

  // 泪滴形火焰渐变：底部亮、顶部暗，边缘不规则
  const grad = ctx.createRadialGradient(cx, cy + size * 0.1, 0, cx, cy, size * 0.55)
  grad.addColorStop(0, 'rgba(255,255,255,0.98)')
  grad.addColorStop(0.1, 'rgba(255,250,180,0.92)')
  grad.addColorStop(0.25, 'rgba(255,190,60,0.78)')
  grad.addColorStop(0.48, 'rgba(255,110,25,0.45)')
  grad.addColorStop(0.74, 'rgba(160,45,10,0.16)')
  grad.addColorStop(1, 'rgba(60,8,3,0)')

  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(cx, size * 0.95)
  ctx.bezierCurveTo(size * 0.14, size * 0.72, size * 0.1, size * 0.24, cx, size * 0.04)
  ctx.bezierCurveTo(size * 0.9, size * 0.24, size * 0.86, size * 0.72, cx, size * 0.95)
  ctx.fill()

  // 叠加火舌细节
  ctx.globalCompositeOperation = 'lighter'
  for (let b = 0; b < 8; b++) {
    const bx = cx + (Math.random() - 0.5) * size * 0.4
    const by = size * 0.2 + Math.random() * size * 0.6
    const br = size * (0.1 + Math.random() * 0.2)
    const a = 0.15 + Math.random() * 0.2
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    g.addColorStop(0, `rgba(255,190,70,${a})`)
    g.addColorStop(1, 'rgba(255,60,20,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/**
 * 简单的煤自燃火焰粒子效果。
 * 附着在煤炭堆上，持续跳动，可作为点火源位置。
 */
export class CoalFlameEffect {
  constructor(options = {}) {
    this.position = options.position?.clone?.() || new THREE.Vector3(0, 0, 0)
    this.count = options.count || 80
    this.scene = options.scene || null
    this.texture = createFlameTexture()

    this.geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(this.count * 3)
    this.velocities = new Float32Array(this.count * 3)
    this.lifetimes = new Float32Array(this.count)
    this.startTimes = new Float32Array(this.count)
    this.sizes = new Float32Array(this.count)
    this.alphas = new Float32Array(this.count)
    this.randoms = new Float32Array(this.count * 2)

    for (let i = 0; i < this.count; i++) {
      this._resetParticle(i, -Math.random() * 2)
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1))
    this.geometry.setAttribute('random', new THREE.BufferAttribute(this.randoms, 2))

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTexture: { value: this.texture },
        uTime: { value: 0 },
        uGlobalAlpha: { value: 1.0 },
        uColor: { value: new THREE.Color(0xffaa44) },
      },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec2 random;
        uniform float uTime;
        varying float vAlpha;
        varying vec2 vRandom;
        void main() {
          vAlpha = alpha;
          vRandom = random;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float flicker = 1.0 + 0.12 * sin(uTime * 9.0 + random.x * 6.28)
                         + 0.06 * sin(uTime * 17.0 + random.y * 6.28);
          gl_PointSize = size * flicker * (280.0 / -mvPosition.z);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform vec3 uColor;
        uniform float uGlobalAlpha;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord;
          vec4 tex = texture2D(uTexture, uv);
          if (tex.a < 0.01) discard;
          float d = length(uv - 0.5) * 2.0;

          // 火焰色温：核心白热 -> 黄 -> 橙 -> 边缘暗红
          vec3 core = vec3(1.0, 0.98, 0.85);
          vec3 hot = vec3(1.0, 0.78, 0.18);
          vec3 mid = vec3(1.0, 0.42, 0.04);
          vec3 edge = vec3(0.75, 0.1, 0.02);

          vec3 color = mix(core, hot, smoothstep(0.0, 0.22, d));
          color = mix(color, mid, smoothstep(0.22, 0.55, d));
          color = mix(color, edge, smoothstep(0.55, 0.95, d));
          // 与全局色调融合
          color = mix(color, uColor, 0.25);

          // 边缘柔和淡出
          float alpha = tex.a * (1.0 - smoothstep(0.75, 1.0, d)) * vAlpha * uGlobalAlpha;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    })

    this.mesh = new THREE.Points(this.geometry, this.material)
    this.mesh.position.copy(this.position)
    this.mesh.frustumCulled = false
    if (this.scene) this.scene.add(this.mesh)

    this.light = new THREE.PointLight(0xff6600, 0, 14)
    this.light.position.copy(this.position).add(new THREE.Vector3(0, 0.6, 0))
    if (this.scene) this.scene.add(this.light)

    this.elapsed = 0
    this.intensity = options.intensity ?? 1.0
    this.active = true
  }

  setIntensity(v) {
    this.intensity = Math.max(0, v)
    this.material.uniforms.uGlobalAlpha.value = this.intensity
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z)
    this.mesh.position.set(x, y, z)
    this.light.position.set(x, y + 0.6, z)
  }

  _resetParticle(i, elapsed) {
    const angle = Math.random() * Math.PI * 2
    const r = Math.random() * 0.18
    this.positions[i * 3] = Math.cos(angle) * r
    this.positions[i * 3 + 1] = Math.random() * 0.12
    this.positions[i * 3 + 2] = Math.sin(angle) * r

    const speed = 0.45 + Math.random() * 0.8
    this.velocities[i * 3] = (Math.random() - 0.5) * 0.18
    this.velocities[i * 3 + 1] = speed
    this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.18

    this.lifetimes[i] = 0.38 + Math.random() * 0.55
    this.startTimes[i] = elapsed
    this.sizes[i] = 0.28 + Math.random() * 0.6
    this.alphas[i] = 0.55 + Math.random() * 0.45
    this.randoms[i * 2] = Math.random()
    this.randoms[i * 2 + 1] = Math.random()
  }

  update(delta, elapsed) {
    if (!this.active) return
    this.elapsed = elapsed
    this.material.uniforms.uTime.value = elapsed
    const flicker = 0.82 + 0.18 * Math.sin(elapsed * 7.5) + 0.08 * Math.sin(elapsed * 19.0)
    this.light.intensity = 2.4 * this.intensity * flicker

    for (let i = 0; i < this.count; i++) {
      const age = elapsed - this.startTimes[i]
      if (age > this.lifetimes[i]) {
        this._resetParticle(i, elapsed)
        continue
      }
      const t = age / this.lifetimes[i]

      this.positions[i * 3] += this.velocities[i * 3] * delta
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * delta
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * delta

      this.velocities[i * 3] += (Math.random() - 0.5) * 0.10 * delta
      this.velocities[i * 3 + 2] += (Math.random() - 0.5) * 0.10 * delta
      this.velocities[i * 3 + 1] *= 1.0 - 0.25 * delta

      this.sizes[i] = (0.32 + t * 0.95) * (1.0 + this.intensity * 0.5)
      this.alphas[i] = (1.0 - t * t) * flicker
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.size.needsUpdate = true
    this.geometry.attributes.alpha.needsUpdate = true
  }

  dispose() {
    this.active = false
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh)
    if (this.light.parent) this.light.parent.remove(this.light)
  }
}
