import * as THREE from 'three'

function createFlameTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2

  ctx.clearRect(0, 0, size, size)

  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.12, 'rgba(255,245,140,0.88)')
  grad.addColorStop(0.28, 'rgba(255,170,50,0.70)')
  grad.addColorStop(0.52, 'rgba(230,70,20,0.38)')
  grad.addColorStop(0.78, 'rgba(120,20,5,0.10)')
  grad.addColorStop(1, 'rgba(60,5,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

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
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          if (tex.a < 0.01) discard;
          vec3 color = mix(uColor, vec3(1.0, 0.95, 0.75), tex.r * 0.6);
          float alpha = tex.a * vAlpha * uGlobalAlpha;
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
