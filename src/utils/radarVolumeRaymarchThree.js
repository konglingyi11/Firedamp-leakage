/**
 * 雷达模拟标量场的 Three.js 体渲染：Data3DTexture + 盒内射线步进 + Jet 传递函数。
 * 标量采样与 /test-leida、radarVolumeScalarMock 一致。
 */
import * as THREE from 'three'
import { jetColorT } from '@/utils/radarPolarLuminanceMock.js'
import {
  fillRadarVolumeNormalizedGridSequentialZ,
  histogramContrastStretchVoxel,
  smoothstep01,
} from '@/utils/radarVolumeScalarMock.js'

/**
 * 供 volumeMode 主射线 shader 内联：与 createRadarVolumeRaymarchMesh 中逻辑一致，由时间轴驱动 uRadarWaveTime。
 */
export const RADAR_VOLUME_WAVE_GLSL_CHUNK = `
uniform float uRadarWaveTime;
uniform float uRadarWaveStrength;
float radarWaveModulate(vec3 uvw, float t) {
  vec3 origin = vec3(0.14, 0.18, 0.11);
  float dist = distance(uvw, origin);
  const float maxR = 1.48;
  const float speed = 0.38;
  float w0 = mod(t * speed, maxR);
  const float thick = 0.055;
  float g0 = exp(-(((dist - w0) * (dist - w0)) / (thick * thick)));
  float w1 = mod(t * speed - 0.26, maxR);
  float g1 = 0.42 * exp(-(((dist - w1) * (dist - w1)) / (thick * thick * 1.45)));
  float w2 = mod(t * speed - 0.52, maxR);
  float g2 = 0.22 * exp(-(((dist - w2) * (dist - w2)) / (thick * thick * 2.1)));
  float pulse = clamp(g0 + g1 + g2, 0.0, 1.0);
  float ambient = 0.88 + 0.12 * sin(t * 1.15 + dist * 4.5);
  return mix(1.0, (0.18 + 0.92 * pulse) * ambient, uRadarWaveStrength);
}
`

const clamp01 = (v) => Math.max(0, Math.min(1, v))

function threeColorFromJet01(u) {
  return new THREE.Color(jetColorT(clamp01(u)))
}

/** 雷达 Jet 传递函数 1D（色偏饱和、α 低段更干净） */
export function buildRadarJetTransferTexture() {
  const width = 256
  const data = new Uint8Array(width * 4)
  for (let i = 0; i < width; i += 1) {
    const t = width > 1 ? i / (width - 1) : 0
    const c = threeColorFromJet01(t)
    const idx = i * 4
    const sat = smoothstep01(t * 1.06)
    const cr = clamp01((c.r - 0.5) * (0.92 + sat * 0.28) + 0.5)
    const cg = clamp01((c.g - 0.5) * (0.92 + sat * 0.22) + 0.5)
    const cb = clamp01((c.b - 0.5) * (0.94 + sat * 0.2) + 0.52)
    data[idx + 0] = Math.round(cr * 255)
    data[idx + 1] = Math.round(cg * 255)
    data[idx + 2] = Math.round(cb * 255)
    const cutoff = smoothstep01((t - 0.075) / 0.925)
    const a = Math.pow(cutoff, 1.55) * (0.18 + 0.82 * smoothstep01((t - 0.12) / 0.88))
    data[idx + 3] = Math.round(a * 255)
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

export function buildRadarVolumeData3DTexture(gs, bandScale, noiseSeed) {
  const nx = gs
  const ny = gs
  const nz = gs
  const voxel = new Float32Array(nx * ny * nz)
  fillRadarVolumeNormalizedGridSequentialZ(gs, bandScale, noiseSeed, voxel)
  histogramContrastStretchVoxel(voxel)
  const texture = new THREE.Data3DTexture(voxel, nx, ny, nz)
  texture.format = THREE.RedFormat
  texture.type = THREE.FloatType
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

/**
 * @param {THREE.Data3DTexture} volumeTexture
 * @param {THREE.DataTexture} transferTexture
 * @param {{
 *   volumeSpan?: number,
 *   steps?: number,
 *   opacityScale?: number,
 *   waveAnimation?: boolean,
 * }} options — waveAnimation：在静态标量场上叠球面行波，模拟雷达发射/回波扫掠
 */
export function createRadarVolumeRaymarchMesh(volumeTexture, transferTexture, options = {}) {
  const volumeSpan = options.volumeSpan ?? 90
  const steps = options.steps ?? 176
  const opacityScale = options.opacityScale ?? 1.05
  const waveStrength = options.waveAnimation ? 1.0 : 0.0

  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    glslVersion: THREE.GLSL3,
    uniforms: {
      uVolume: { value: volumeTexture },
      uTransfer: { value: transferTexture },
      uSteps: { value: steps },
      uOpacityScale: { value: opacityScale },
      uModelInv: { value: new THREE.Matrix4() },
      uJitter: { value: Math.random() * 5000 },
      uRadarWaveTime: { value: 0 },
      uRadarWaveStrength: { value: waveStrength },
    },
    vertexShader: `
      out vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform sampler3D uVolume;
      uniform sampler2D uTransfer;
      uniform float uSteps;
      uniform float uOpacityScale;
      uniform float uJitter;
      uniform float uRadarWaveTime;
      uniform float uRadarWaveStrength;
      uniform mat4 uModelInv;
      in vec3 vLocalPos;
      out vec4 out_FragColor;

      /** 纹理空间 [0,1]^3 内，从偏移原点发出、周期重复的球面波包络（归一化距离 0..~1.7） */
      float radarWaveModulate(vec3 uvw, float t) {
        vec3 origin = vec3(0.14, 0.18, 0.11);
        float dist = distance(uvw, origin);
        const float maxR = 1.48;
        const float speed = 0.38;
        float w0 = mod(t * speed, maxR);
        const float thick = 0.055;
        float g0 = exp(-(((dist - w0) * (dist - w0)) / (thick * thick)));
        float w1 = mod(t * speed - 0.26, maxR);
        float g1 = 0.42 * exp(-(((dist - w1) * (dist - w1)) / (thick * thick * 1.45)));
        float w2 = mod(t * speed - 0.52, maxR);
        float g2 = 0.22 * exp(-(((dist - w2) * (dist - w2)) / (thick * thick * 2.1)));
        float pulse = clamp(g0 + g1 + g2, 0.0, 1.0);
        float ambient = 0.88 + 0.12 * sin(t * 1.15 + dist * 4.5);
        return mix(1.0, (0.18 + 0.92 * pulse) * ambient, uRadarWaveStrength);
      }

      vec2 hitBox(vec3 origin, vec3 dir) {
        vec3 boxMin = vec3(-0.5);
        vec3 boxMax = vec3(0.5);
        vec3 invDir = 1.0 / dir;
        vec3 tMinTmp = (boxMin - origin) * invDir;
        vec3 tMaxTmp = (boxMax - origin) * invDir;
        vec3 tMin = min(tMinTmp, tMaxTmp);
        vec3 tMax = max(tMinTmp, tMaxTmp);
        float t0 = max(max(tMin.x, tMin.y), tMin.z);
        float t1 = min(min(tMax.x, tMax.y), tMax.z);
        return vec2(t0, t1);
      }

      void main() {
        vec3 rayOrigin = (uModelInv * vec4(cameraPosition, 1.0)).xyz;
        vec3 rayDir = normalize(vLocalPos - rayOrigin);
        vec2 bounds = hitBox(rayOrigin, rayDir);
        if (bounds.x > bounds.y) discard;

        float t0 = max(bounds.x, 0.0);
        float t1 = bounds.y;
        float dt = (t1 - t0) / max(uSteps, 1.0);
        float jitter = fract(sin(uJitter + dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

        vec4 accum = vec4(0.0);
        const int MAX_STEPS = 256;
        for (int i = 0; i < MAX_STEPS; i += 1) {
          if (float(i) >= uSteps) break;
          float tmid = t0 + dt * (float(i) + 0.5 + jitter * 0.85);
          vec3 p = rayOrigin + rayDir * tmid;
          vec3 uvw = p + 0.5;
          float raw = clamp(texture(uVolume, uvw).r, 0.0, 1.0);
          raw *= radarWaveModulate(uvw, uRadarWaveTime);
          raw = clamp(raw, 0.0, 1.0);
          float d = pow(max(raw - 0.004, 0.0), 0.58);
          vec4 tf = texture(uTransfer, vec2(max(d, 1e-4), 0.5));
          float extinct = (tf.a * 1.15 + d * d * 3.8 + d * 0.55);
          float alphaStep = (1.0 - exp(-extinct * uOpacityScale * dt * 32.0));
          alphaStep = clamp(alphaStep, 0.0, 1.0);
          accum.rgb += (1.0 - accum.a) * alphaStep * tf.rgb;
          accum.a += (1.0 - accum.a) * alphaStep;
          if (accum.a > 0.985) break;
        }

        if (accum.a < 0.003) discard;
        accum.rgb = pow(max(accum.rgb, vec3(0.0)), vec3(0.96));
        out_FragColor = accum;
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.setScalar(volumeSpan)
  mesh.updateMatrixWorld(true)
  material.uniforms.uModelInv.value.copy(mesh.matrixWorld).invert()
  return mesh
}

export function syncRadarRaymarchModelInv(mesh) {
  const mat = mesh.material
  if (mat?.uniforms?.uModelInv) {
    mesh.updateMatrixWorld(true)
    mat.uniforms.uModelInv.value.copy(mesh.matrixWorld).invert()
  }
}
