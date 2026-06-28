import * as THREE from 'three'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js'

const DISSOLVE_MODEL_KEYS = new Set(['geometry', 'real'])
const MODEL_DISSOLVE_PARTICLE_COUNT = 6000
const MODEL_DISSOLVE_PARTICLE_VERTEX_SHADER = `
  attribute float aDissolve;
  attribute float aRandom;
  attribute vec3 aNormal;
  varying float vBand;
  varying float vRandom;
  uniform float uDissolveProgress;
  uniform float uDissolveEdgeWidth;
  uniform float uDissolveTime;
  uniform float uDissolveParticleStrength;
  uniform float uDissolvePixelRatio;
  uniform int uDissolveMode;

  void main() {
    float band = 1.0 - smoothstep(0.0, uDissolveEdgeWidth * 3.4, abs(aDissolve - uDissolveProgress));
    vBand = band;
    vRandom = aRandom;
    float direction = uDissolveMode == 1 ? -1.0 : 1.0;
    vec3 tangentDrift = vec3(
      sin(aRandom * 37.0 + uDissolveTime * 2.8) * 0.055,
      sin(aRandom * 19.0 + uDissolveTime * 1.7) * 0.035,
      cos(aRandom * 41.0 + uDissolveTime * 2.2) * 0.055
    );
    vec3 drift = (normalize(aNormal) * direction * (0.08 + aRandom * 0.22) + tangentDrift) * band * uDissolveParticleStrength;
    vec4 mvPosition = modelViewMatrix * vec4(position + drift, 1.0);
    gl_PointSize = (4.5 + 7.5 * aRandom) * band * uDissolvePixelRatio / max(0.42, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`
const MODEL_DISSOLVE_PARTICLE_FRAGMENT_SHADER = `
  varying float vBand;
  varying float vRandom;
  uniform vec3 uDissolveColor;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float circle = 1.0 - smoothstep(0.12, 0.5, length(uv));
    float core = 1.0 - smoothstep(0.0, 0.2, length(uv));
    vec3 color = mix(uDissolveColor, vec3(0.1, 0.96, 0.82), vRandom * 0.42);
    gl_FragColor = vec4(color + core * 0.8, circle * vBand * 0.92);
  }
`

export function createModelDissolve({
  getGltfModels,
  getModelGroup,
  getRenderer,
  getClock,
  addFrameCallback,
  removeFrameCallback,
  getVisualization,
}) {
  let modelDissolveStates = new Map()
  let modelDissolveFrameActive = false

  function resolveModelDissolveSettings() {
    const raw = getVisualization()?.model_dissolve || {}
    const duration = Number(raw.duration)
    const edgeWidth = Number(raw.edge_width)
    const particleStrength = Number(raw.particle_strength)
    return {
      enabled: raw.enabled !== false,
      duration: Number.isFinite(duration) ? Math.max(0.2, Math.min(3, duration)) : 1.5,
      edgeWidth: Number.isFinite(edgeWidth) ? Math.max(0.01, Math.min(0.16, edgeWidth)) : 0.045,
      particleStrength: Number.isFinite(particleStrength)
        ? Math.max(0, Math.min(2.5, particleStrength))
        : 1.2,
      color: typeof raw.color === 'string' && raw.color ? raw.color : '#72ff66',
    }
  }

  function createModelDissolveUniforms(model) {
    const settings = resolveModelDissolveSettings()
    const renderer = getRenderer()
    const box = new THREE.Box3().setFromObject(model)
    const minY = Number.isFinite(box.min.y) ? box.min.y : 0
    const maxY = Number.isFinite(box.max.y) ? box.max.y : 1
    return {
      uDissolveProgress: { value: 1 },
      uDissolveMinY: { value: minY },
      uDissolveMaxY: { value: maxY },
      uDissolveEdgeWidth: { value: settings.edgeWidth },
      uDissolveTime: { value: 0 },
      uDissolveMode: { value: 1 },
      uDissolveColor: { value: new THREE.Color(settings.color) },
      uDissolveParticleStrength: { value: settings.particleStrength },
      uDissolvePixelRatio: {
        value: Math.min(2, renderer?.getPixelRatio?.() || window.devicePixelRatio || 1),
      },
    }
  }

  function patchMaterialForModelDissolve(material, uniforms) {
    if (!material || material.userData?.modelDissolvePatched) {
      if (material?.userData?.modelDissolveUniforms) {
        material.userData.modelDissolveUniforms = uniforms
      }
      return
    }
    material.userData.modelDissolvePatched = true
    material.userData.modelDissolveUniforms = uniforms
    const previousOnBeforeCompile = material.onBeforeCompile
    material.onBeforeCompile = (shader) => {
      previousOnBeforeCompile?.(shader)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vModelDissolveWorldPosition;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
vModelDissolveWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vModelDissolveWorldPosition;
uniform float uDissolveProgress;
uniform float uDissolveMinY;
uniform float uDissolveMaxY;
uniform float uDissolveEdgeWidth;
uniform float uDissolveTime;
uniform int uDissolveMode;
uniform vec3 uDissolveColor;
float modelDissolveEdgeValue = 0.0;

float modelDissolveHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float modelDissolveValueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = modelDissolveHash(i + vec3(0.0, 0.0, 0.0));
  float n100 = modelDissolveHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = modelDissolveHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = modelDissolveHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = modelDissolveHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = modelDissolveHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = modelDissolveHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = modelDissolveHash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

void applyModelDissolveClip() {
  float heightValue = (vModelDissolveWorldPosition.y - uDissolveMinY) / max(0.0001, uDissolveMaxY - uDissolveMinY);
  float noise = modelDissolveValueNoise(vModelDissolveWorldPosition * 4.5 + vec3(0.0, uDissolveTime * 0.18, 0.0));
  float fineNoise = modelDissolveValueNoise(vModelDissolveWorldPosition * 12.0 + vec3(uDissolveTime * 0.12, 0.0, 0.0));
  float dissolveValue = clamp(heightValue + (noise - 0.5) * 0.24 + (fineNoise - 0.5) * 0.08, 0.0, 1.0);
  bool visible = uDissolveMode == 1 ? dissolveValue <= uDissolveProgress : dissolveValue >= uDissolveProgress;
  if (!visible) discard;
  modelDissolveEdgeValue = 1.0 - smoothstep(0.0, uDissolveEdgeWidth, abs(dissolveValue - uDissolveProgress));
}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
applyModelDissolveClip();`,
        )
        .replace(
          '#include <opaque_fragment>',
          `diffuseColor.rgb = mix(diffuseColor.rgb, uDissolveColor * (0.75 + modelDissolveEdgeValue * 1.15), modelDissolveEdgeValue * 0.65);
#include <opaque_fragment>`,
        )
    }
    material.needsUpdate = true
  }

  function updateModelDissolveUniformBounds(state) {
    if (!state?.model || !state.uniforms) return
    state.model.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(state.model)
    if (!Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) return
    state.uniforms.uDissolveMinY.value = box.min.y
    state.uniforms.uDissolveMaxY.value = box.max.y
  }

  function disposeModelDissolveParticles(state) {
    if (!state?.particles) return
    state.particles.parent?.remove(state.particles)
    state.particles.geometry?.dispose?.()
    state.particles.material?.dispose?.()
    state.particles = null
  }

  function createModelDissolveParticles(model, uniforms) {
    const modelGroup = getModelGroup()
    if (!modelGroup) return null
    const positions = []
    const normals = []
    const dissolves = []
    const randoms = []
    const meshes = []
    const point = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const localPoint = new THREE.Vector3()
    const normalMatrix = new THREE.Matrix3()
    let meshIndex = 0

    model.updateWorldMatrix(true, true)
    model.traverse((child) => {
      if (child?.isMesh && child.geometry?.attributes?.position) {
        meshes.push(child)
      }
    })
    if (!meshes.length) return null

    const samplesPerMesh = Math.max(
      16,
      Math.floor(MODEL_DISSOLVE_PARTICLE_COUNT / Math.max(1, meshes.length)),
    )
    meshes.forEach((child) => {
      if (positions.length / 3 >= MODEL_DISSOLVE_PARTICLE_COUNT) return
      const sampler = new MeshSurfaceSampler(child).build()
      normalMatrix.getNormalMatrix(child.matrixWorld)
      for (
        let i = 0;
        i < samplesPerMesh && positions.length / 3 < MODEL_DISSOLVE_PARTICLE_COUNT;
        i += 1
      ) {
        sampler.sample(point, normal)
        point.applyMatrix4(child.matrixWorld)
        normal.applyMatrix3(normalMatrix).normalize()
        localPoint.copy(point)
        modelGroup.worldToLocal(localPoint)
        const random = Math.abs(
          (Math.sin((i + 1) * 12.9898 + meshIndex * 78.233) * 43758.5453) % 1,
        )
        positions.push(localPoint.x, localPoint.y, localPoint.z)
        normals.push(normal.x, normal.y, normal.z)
        dissolves.push(
          THREE.MathUtils.clamp(
            (point.y - uniforms.uDissolveMinY.value) /
              Math.max(0.0001, uniforms.uDissolveMaxY.value - uniforms.uDissolveMinY.value),
            0,
            1,
          ),
        )
        randoms.push(random)
      }
      meshIndex += 1
    })

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aNormal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('aDissolve', new THREE.Float32BufferAttribute(dissolves, 1))
    geometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(randoms, 1))
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: MODEL_DISSOLVE_PARTICLE_VERTEX_SHADER,
      fragmentShader: MODEL_DISSOLVE_PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const particles = new THREE.Points(geometry, material)
    particles.name = '__modelDissolveParticles'
    modelGroup.add(particles)
    return particles
  }

  function ensureModelDissolveParticles(state) {
    if (!state || state.particles || !state.model) return state?.particles || null
    updateModelDissolveUniformBounds(state)
    state.particles = createModelDissolveParticles(state.model, state.uniforms)
    return state.particles
  }

  function ensureModelDissolveState(key, model) {
    if (!DISSOLVE_MODEL_KEYS.has(key) || !model || model.userData?.isGaussianSplatModel) {
      return null
    }
    let state = modelDissolveStates.get(key)
    if (state?.model !== model) {
      disposeModelDissolveParticles(state)
      state = {
        key,
        model,
        progress: model.visible === false ? 0 : 1,
        from: model.visible === false ? 0 : 1,
        to: model.visible === false ? 0 : 1,
        mode: 'appear',
        startTime: 0,
        duration: resolveModelDissolveSettings().duration,
        targetVisible: model.visible !== false,
        hasSyncedVisibility: false,
        uniforms: createModelDissolveUniforms(model),
        particles: null,
      }
      modelDissolveStates.set(key, state)
    }
    updateModelDissolveUniformBounds(state)
    model.traverse((child) => {
      if (!child?.isMesh || !child.material) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => patchMaterialForModelDissolve(material, state.uniforms))
    })
    return state
  }

  function applyModelDissolveSettings() {
    const settings = resolveModelDissolveSettings()
    const gltfModels = getGltfModels()
    const renderer = getRenderer()
    if (!gltfModels) return
    for (const [key, model] of gltfModels.entries()) {
      if (!DISSOLVE_MODEL_KEYS.has(key) || model?.userData?.isGaussianSplatModel) continue
      const state = ensureModelDissolveState(key, model)
      if (!state) continue
      state.duration = settings.duration
      state.uniforms.uDissolveEdgeWidth.value = settings.edgeWidth
      state.uniforms.uDissolveParticleStrength.value = settings.particleStrength
      state.uniforms.uDissolvePixelRatio.value = Math.min(
        2,
        renderer?.getPixelRatio?.() || window.devicePixelRatio || 1,
      )
      state.uniforms.uDissolveColor.value.set(settings.color)
      state.particles && (state.particles.visible = settings.enabled && state.progress > 0 && state.progress < 1)
    }
  }

  function removeModelDissolveFrameIfIdle() {
    if (!modelDissolveFrameActive) return
    const hasActive = [...modelDissolveStates.values()].some((state) => {
      return Math.abs(state.progress - state.to) > 0.001
    })
    if (!hasActive) {
      removeFrameCallback(updateModelDissolveFrame)
      modelDissolveFrameActive = false
    }
  }

  function ensureModelDissolveFrame() {
    if (modelDissolveFrameActive) return
    addFrameCallback(updateModelDissolveFrame)
    modelDissolveFrameActive = true
  }

  function updateModelDissolveFrame(elapsed) {
    const settings = resolveModelDissolveSettings()
    let hasActive = false
    for (const state of modelDissolveStates.values()) {
      const duration = Math.max(0.05, state.duration || settings.duration)
      const t = THREE.MathUtils.clamp((elapsed - state.startTime) / duration, 0, 1)
      const eased = t * t * (3 - 2 * t)
      state.progress = THREE.MathUtils.lerp(state.from, state.to, eased)
      state.uniforms.uDissolveProgress.value = state.progress
      state.uniforms.uDissolveTime.value = elapsed
      state.uniforms.uDissolveMode.value = state.mode === 'appear' ? 1 : 0
      if (state.particles) {
        state.particles.visible = settings.enabled && t < 1 && state.progress > 0 && state.progress < 1
      }
      if (t < 1) {
        hasActive = true
      } else if (!state.targetVisible) {
        state.model.visible = false
        if (state.particles) state.particles.visible = false
      } else {
        state.model.visible = true
        if (state.particles) state.particles.visible = false
      }
    }
    if (!hasActive) {
      removeModelDissolveFrameIfIdle()
    }
  }

  function setModelVisibilityWithDissolve(key, model, shouldVisible, options = {}) {
    const settings = resolveModelDissolveSettings()
    const animate = options.animate !== false
    if (!settings.enabled || !animate || !DISSOLVE_MODEL_KEYS.has(key)) {
      const state = modelDissolveStates.get(key)
      if (state) {
        state.progress = shouldVisible ? 1 : 0
        state.from = state.progress
        state.to = state.progress
        state.uniforms.uDissolveProgress.value = state.progress
        state.mode = shouldVisible ? 'appear' : 'disappear'
        state.uniforms.uDissolveMode.value = shouldVisible ? 1 : 0
        state.targetVisible = shouldVisible
        state.hasSyncedVisibility = true
        if (state.particles) state.particles.visible = false
      }
      model.visible = shouldVisible
      return
    }
    const state = ensureModelDissolveState(key, model)
    if (!state) {
      model.visible = shouldVisible
      return
    }
    applyModelDissolveSettings()
    if (!state.hasSyncedVisibility) {
      state.hasSyncedVisibility = true
      state.targetVisible = shouldVisible
      state.mode = shouldVisible ? 'appear' : 'disappear'
      state.from = 0
      state.to = shouldVisible ? 1 : 0
      state.progress = state.from
      state.duration = settings.duration
      state.startTime = getClock()?.getElapsedTime?.() ?? 0
      state.uniforms.uDissolveMode.value = shouldVisible ? 1 : 0
      state.uniforms.uDissolveProgress.value = state.progress
      model.visible = shouldVisible
      if (!shouldVisible) {
        if (state.particles) state.particles.visible = false
        return
      }
      const particles = ensureModelDissolveParticles(state)
      if (particles) particles.visible = true
      ensureModelDissolveFrame()
      return
    }
    const fullyHidden =
      !shouldVisible &&
      state.targetVisible === false &&
      model.visible === false &&
      state.progress <= 0.001
    const fullyVisible =
      shouldVisible &&
      state.targetVisible === true &&
      model.visible !== false &&
      state.progress >= 0.999
    if (fullyHidden || fullyVisible) {
      state.from = shouldVisible ? 1 : 0
      state.to = state.from
      state.progress = state.from
      state.mode = shouldVisible ? 'appear' : 'disappear'
      state.uniforms.uDissolveMode.value = shouldVisible ? 1 : 0
      state.uniforms.uDissolveProgress.value = state.progress
      if (state.particles) state.particles.visible = false
      return
    }
    const mode = shouldVisible ? 'appear' : 'disappear'
    if (state.targetVisible === shouldVisible && state.mode === mode && Math.abs(state.to - 1) < 0.001) {
      model.visible = shouldVisible || Math.abs(state.progress - state.to) > 0.001
      return
    }
    const targetChanged = state.targetVisible !== shouldVisible
    state.targetVisible = shouldVisible
    state.mode = mode
    state.from = shouldVisible && !targetChanged && model.visible !== false ? state.progress : 0
    state.to = 1
    state.duration = settings.duration
    state.startTime = getClock()?.getElapsedTime?.() ?? 0
    state.uniforms.uDissolveMode.value = shouldVisible ? 1 : 0
    state.progress = state.from
    state.uniforms.uDissolveProgress.value = state.from
    model.visible = true
    const particles = ensureModelDissolveParticles(state)
    if (particles) particles.visible = true
    ensureModelDissolveFrame()
  }

  function disposeModelDissolveStates() {
    for (const state of modelDissolveStates.values()) {
      disposeModelDissolveParticles(state)
    }
    modelDissolveStates = new Map()
    if (modelDissolveFrameActive) {
      removeFrameCallback(updateModelDissolveFrame)
      modelDissolveFrameActive = false
    }
  }

  function getModelDissolveState(key) {
    return modelDissolveStates.get(key)
  }

  function deleteModelDissolveState(key) {
    modelDissolveStates.delete(key)
  }

  return {
    DISSOLVE_MODEL_KEYS,
    resolveModelDissolveSettings,
    applyModelDissolveSettings,
    setModelVisibilityWithDissolve,
    disposeModelDissolveStates,
    disposeModelDissolveParticles,
    ensureModelDissolveState,
    getModelDissolveState,
    deleteModelDissolveState,
  }
}
