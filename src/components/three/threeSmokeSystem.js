import * as THREE from 'three'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js'
import {
  DEFAULT_SMOKE_CONFIG,
  normalizeSmokeConfig,
  smokeConfigToRuntimeParams,
} from '@/utils/smokeDataConfig.js'
import { SmokeSystem, createSmokeTexture } from '@/utils/smokeSystem.js'
import {
  loadSmokeScalarField,
  loadSmokeVelocityFieldFromManifestUrl,
} from '@/utils/smokeVelocityField.js'
import { resolveVolumeDatasetFrame } from '@/utils/volumeFrameUrl'
import { clearGroup, normalizeUrl } from './modes/shared'

const DEFAULT_SMOKE_SCALAR = 'mass_fraction_of_ch4'
const PERSON_SMOKE_RELEASE_ZONE_NAME = 'head-release-zone'

export function createSmokeSystem({
  getScene,
  getSmokeGroup,
  getGltfModels,
  getVisualization,
  getCurrentTask,
  getTimelineCurrentStep,
  currentTimeStep,
  activeSmokeLayer,
  hasVisibleSmokeLayer,
  selectedVolumeLayer,
  activeVolumePayload,
  extractVolumeVariableFromLayer,
  findFirstVolumePayloadWithData,
  hasVolumeManifestLocator,
  hasVolumeDataLocator,
  cacheVolumePayload,
  requestVolumePayloadForLayer,
  volumePayloadCanProvideVariable,
  getModelMeshMaterialName,
}) {
  let smokeSystem = null
  let smokeTexture = null
  let smokeLoadKey = ''
  let smokeVelocityFrameKey = ''
  let smokeVelocityFramePromise = null
  let smokeVelocityFrameQueued = false
  let smokeSyncPromise = null
  let smokeSyncToken = 0
  let smokeElapsed = 0
  let smokeLastFrameAt = null
  let smokeReleaseZoneSignature = ''

  function resolveSmokeManifestUrl(layer) {
    const visualization = getVisualization()
    const explicitCandidates = [
      layer?.smokeManifestUrl,
      layer?.manifest_url,
      layer?.manifestUrl,
      visualization?.smoke_manifest_url,
      visualization?.smokeManifestUrl,
    ]
    const explicit = explicitCandidates.find(
      (value) => typeof value === 'string' && value.trim() !== '',
    )
    return explicit ? normalizeUrl(explicit) : ''
  }

  function resolveSmokeVolumeVariable(layer) {
    const visualization = getVisualization()
    const candidates = [
      layer?.smokeVolumeVariable,
      visualization?.smoke_volume_variable,
      ...(Array.isArray(visualization?.volume_variables)
        ? visualization.volume_variables
        : []),
      selectedVolumeLayer.value
        ? extractVolumeVariableFromLayer(selectedVolumeLayer.value)
        : '',
      visualization?.variable,
      'VelocityMagnitude',
    ]
    const hit = candidates.find(
      (value) => value != null && String(value).trim() !== '',
    )
    return String(hit || 'VelocityMagnitude').trim()
  }

  function buildSmokeVolumeProxyLayer(layer) {
    const variable = resolveSmokeVolumeVariable(layer)
    const taskId = getCurrentTask()?.id ?? 'default'
    return {
      id: `volume:${taskId}:${variable}`,
      kind: 'volume',
      variable,
      volumeVariable: variable,
      visible: true,
      loaded: true,
      usePregen: layer?.usePregen,
    }
  }

  async function resolveSmokeVolumePayload(
    layer,
    targetTimeStep = currentTimeStep.value,
  ) {
    const explicitManifestUrl = resolveSmokeManifestUrl(layer)
    if (explicitManifestUrl) {
      return {
        manifest_url: explicitManifestUrl,
        source_time_step: targetTimeStep,
      }
    }

    const variable = resolveSmokeVolumeVariable(layer)
    const firstPayload = findFirstVolumePayloadWithData()
    const activePayload = volumePayloadCanProvideVariable(
      activeVolumePayload.value,
      variable,
    )
      ? activeVolumePayload.value
      : null
    const cached =
      activePayload ||
      (volumePayloadCanProvideVariable(firstPayload, variable)
        ? firstPayload
        : null)
    if (hasVolumeManifestLocator(cached) || hasVolumeDataLocator(cached)) {
      return cacheVolumePayload(cached, [layer?.id, variable], targetTimeStep)
    }

    return requestVolumePayloadForLayer(
      buildSmokeVolumeProxyLayer(layer),
      {
        timeStep: targetTimeStep,
        preferFullTimeline: true,
      },
    )
  }

  function resolveSmokeManifestUrlFromPayload(
    payload,
    targetTimeStep = currentTimeStep.value,
  ) {
    const frame = resolveVolumeDatasetFrame(payload, targetTimeStep)
    const manifestUrl = String(
      frame?.manifest_url || payload?.manifest_url || '',
    ).trim()
    return manifestUrl ? normalizeUrl(manifestUrl) : ''
  }

  function resolveSmokeScalar(layer) {
    if (layer?.smokeTotal) return ''
    const visualization = getVisualization()
    return String(
      layer?.smokeScalar ||
        layer?.smokeVariable ||
        visualization?.smoke_variable ||
        visualization?.smokeScalar ||
        DEFAULT_SMOKE_SCALAR,
    ).trim()
  }

  function resolveSmokeFrameIndex(layer) {
    const visualization = getVisualization()
    const raw =
      layer?.smokeFrameIndex ??
      visualization?.smoke_frame_index ??
      getTimelineCurrentStep() ??
      0
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  }

  function isPersonSmokeLayer(layer) {
    const visualization = getVisualization()
    return Boolean(
      layer?.smokePersonLayer ||
        layer?.personSmoke ||
        layer?.smokeReleaseZoneName ||
        visualization?.smoke_person_layer ||
        visualization?.smokePersonLayer,
    )
  }

  function normalizeModelToken(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
  }

  function getSmokeReleaseZoneName(layer) {
    const visualization = getVisualization()
    return normalizeModelToken(
      layer?.smokeReleaseZoneName ||
        visualization?.smoke_release_zone_name ||
        visualization?.smokeReleaseZoneName ||
        PERSON_SMOKE_RELEASE_ZONE_NAME,
    )
  }

  function meshMatchesSmokeReleaseZone(mesh, releaseZoneName) {
    if (!mesh || !releaseZoneName) return false
    const materialNames = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .map((material) => material?.name)
      .filter(Boolean)
    const tokens = [
      mesh.name,
      mesh.geometry?.name,
      mesh.userData?.name,
      mesh.userData?.geometrySelectionName,
      mesh.userData?.geometryMaterialName,
      getModelMeshMaterialName(mesh),
      ...materialNames,
    ]
    return tokens.some((token) => {
      const normalized = normalizeModelToken(token)
      if (!normalized) return false
      return (
        normalized === releaseZoneName ||
        normalized.includes(releaseZoneName) ||
        releaseZoneName.includes(normalized)
      )
    })
  }

  function findSmokeReleaseZoneMesh(layer) {
    const gltfModels = getGltfModels()
    const releaseZoneName = getSmokeReleaseZoneName(layer)
    const models = [
      gltfModels.get('personGeometry'),
      gltfModels.get('personReal'),
      gltfModels.get('geometry'),
      gltfModels.get('real'),
    ].filter(Boolean)
    let target = null
    for (const model of models) {
      model.traverse((child) => {
        if (target || !child?.isMesh || !child.geometry) return
        if (meshMatchesSmokeReleaseZone(child, releaseZoneName)) target = child
      })
      if (target) break
    }
    return target
  }

  function findPersonSmokeRoot() {
    const gltfModels = getGltfModels()
    return (
      gltfModels.get('personReal') ||
      gltfModels.get('personGeometry') ||
      gltfModels.get('real') ||
      gltfModels.get('geometry') ||
      null
    )
  }

  function buildSmokeSurfaceSeeds(mesh, count = 180) {
    if (!mesh?.geometry) return []
    mesh.updateWorldMatrix(true, false)
    const sampler = new MeshSurfaceSampler(mesh).build()
    const position = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    const seeds = []
    const total = Math.max(24, Math.min(512, Math.round(Number(count) || 180)))
    for (let i = 0; i < total; i += 1) {
      sampler.sample(position, normal)
      position.applyMatrix4(mesh.matrixWorld)
      normal.applyNormalMatrix(normalMatrix).normalize()
      seeds.push({
        x: position.x,
        y: position.y,
        z: position.z,
        nx: normal.x,
        ny: normal.y,
        nz: normal.z,
      })
    }
    return seeds
  }

  function collectSmokeCollisionMeshes(releaseZoneMesh = null) {
    const gltfModels = getGltfModels()
    const visualization = getVisualization()
    const geometryRoots = [
      gltfModels.get('geometry'),
      gltfModels.get('real'),
    ].filter(Boolean)
    const fallbackRoots = [
      gltfModels.get('personGeometry'),
      gltfModels.get('personReal'),
    ].filter(Boolean)
    const roots = geometryRoots.length ? geometryRoots : fallbackRoots
    const meshes = []
    const entries = []
    for (const root of roots) {
      root.updateWorldMatrix(true, true)
      root.traverse((child) => {
        if (
          child?.isMesh &&
          child.geometry &&
          child.visible !== false &&
          child !== releaseZoneMesh &&
          !child.userData?.isGeometrySelectionOutline
        ) {
          ensureSmokeCollisionBoundsTree(child)
          meshes.push(child)
          const box = new THREE.Box3().setFromObject(child)
          const boxSize = box.getSize(new THREE.Vector3())
          const score =
            boxSize.x * boxSize.y +
            boxSize.y * boxSize.z +
            boxSize.x * boxSize.z
          entries.push({
            mesh: child,
            box,
            score,
          })
        }
      })
    }
    const meshCap = Math.max(
      16,
      Math.round(Number(visualization?.smoke_collision_mesh_cap) || 120),
    )
    entries.sort((a, b) => b.score - a.score)
    const cappedEntries = entries.slice(0, meshCap)
    return {
      meshes: cappedEntries.map((entry) => entry.mesh),
      entries: cappedEntries,
    }
  }

  function ensureSmokeCollisionBoundsTree(mesh) {
    const geometry = mesh?.geometry
    if (!geometry || geometry.boundsTree) return
    try {
      geometry.computeBoundsTree?.()
    } catch (error) {
      console.warn('[SmokeLayer] 碰撞 BVH 构建失败，回退普通碰撞:', error)
    }
  }

  function buildPersonSmokeRuntimeOverrides(layer, particleCount) {
    const visualization = getVisualization()
    if (!isPersonSmokeLayer(layer) && layer?.smokeTotal !== true) return null
    const personSmokeLayer = isPersonSmokeLayer(layer)
    const velocityOverviewLayer = layer?.smokeTotal === true
    const releaseZoneMesh = findSmokeReleaseZoneMesh(layer)
    const root = releaseZoneMesh || findPersonSmokeRoot()
    if (!root) throw new Error('人体烟雾层未找到人体模型')

    root.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const emitterCenter = releaseZoneMesh
      ? center
      : new THREE.Vector3(center.x, box.min.y + size.y * 0.82, center.z)
    const surfaceSeeds = releaseZoneMesh
      ? buildSmokeSurfaceSeeds(
          releaseZoneMesh,
          Math.max(
            96,
            Math.min(384, Math.round((Number(particleCount) || 800) / 4)),
          ),
        )
      : []
    const collisionRuntime = collectSmokeCollisionMeshes(releaseZoneMesh)
    const radius = releaseZoneMesh
      ? Math.max(0.02, Math.min(size.x, size.y, size.z) * 0.35)
      : Math.max(0.08, Math.min(size.x, size.z) * 0.18)
    return {
      signature: [
        root.uuid,
        releaseZoneMesh?.uuid || 'head-fallback',
        collisionRuntime.meshes.length,
        emitterCenter.x.toFixed(3),
        emitterCenter.y.toFixed(3),
        emitterCenter.z.toFixed(3),
      ].join(':'),
      runtime: {
        emitter: {
          position: emitterCenter.toArray(),
          radius,
          heightJitter: releaseZoneMesh
            ? Math.max(0.01, Math.max(size.x, size.y, size.z) * 0.08)
            : Math.max(0.05, size.y * 0.04),
          surfaceSeeds,
        },
        collision: {
          meshes: collisionRuntime.meshes,
          entries: collisionRuntime.entries,
          radius: Number(visualization?.smoke_collision_radius) || 0.035,
          probeDistance:
            Number(visualization?.smoke_collision_probe_distance) || 0.07,
          maxCandidates:
            Number(visualization?.smoke_collision_max_candidates) || 8,
          restitution:
            Number(visualization?.smoke_collision_restitution) ||
            (velocityOverviewLayer ? 0.04 : 0.16),
          slide:
            Number(visualization?.smoke_collision_slide) ||
            (velocityOverviewLayer ? 0.42 : 0.76),
          blockNormalVelocity: velocityOverviewLayer,
          stride:
            Number(visualization?.smoke_collision_stride) ||
            (personSmokeLayer ? 8 : 3),
        },
      },
    }
  }

  function clearSmokeScene() {
    smokeSyncToken += 1
    smokeLoadKey = ''
    smokeReleaseZoneSignature = ''
    smokeVelocityFrameKey = ''
    smokeVelocityFramePromise = null
    smokeVelocityFrameQueued = false
    smokeLastFrameAt = null
    if (smokeSystem) {
      smokeSystem.dispose()
      smokeSystem = null
    }
    const group = getSmokeGroup()
    if (group) clearGroup(group)
  }

  async function updateSmokeVelocityForCurrentFrame(
    layer = activeSmokeLayer.value,
  ) {
    const visualization = getVisualization()
    if (!smokeSystem || !layer) return
    if (isPersonSmokeLayer(layer)) return
    const payload = await resolveSmokeVolumePayload(layer, currentTimeStep.value)
    const manifestUrl = resolveSmokeManifestUrlFromPayload(
      payload,
      currentTimeStep.value,
    )
    if (!manifestUrl) {
      console.warn('[SmokeLayer] 当前时间步缺少体渲染 manifest_url，无法更新速度场')
      return
    }
    const frameIndex = resolveSmokeFrameIndex(layer)
    const strength = Number(visualization?.smoke_data_scale) || 120
    const worldScale = Number(visualization?.smoke_world_scale) || 10
    const frameKey = `${manifestUrl}:${frameIndex}:${strength}:${worldScale}`
    if (smokeVelocityFrameKey === frameKey) return
    if (smokeVelocityFramePromise) {
      smokeVelocityFrameQueued = true
      return smokeVelocityFramePromise
    }

    const token = smokeSyncToken
    smokeVelocityFramePromise = (async () => {
      try {
        const velocityField = await loadSmokeVelocityFieldFromManifestUrl(
          manifestUrl,
          frameIndex,
        )
        if (token !== smokeSyncToken || !smokeSystem) return
        smokeSystem.setRuntimeParams({
          velocityField: {
            sample: velocityField.sample,
            strength,
            worldScale,
            stride: Number(visualization?.smoke_velocity_sample_stride) || 2,
          },
        })
        smokeVelocityFrameKey = frameKey
      } catch (error) {
        console.warn('[SmokeLayer] 当前时间步速度场加载失败，沿用上一帧速度场:', error)
      }
    })()

    try {
      return await smokeVelocityFramePromise
    } finally {
      smokeVelocityFramePromise = null
      if (smokeVelocityFrameQueued) {
        smokeVelocityFrameQueued = false
        void updateSmokeVelocityForCurrentFrame(activeSmokeLayer.value)
      }
    }
  }

  async function syncSmokeToScene() {
    if (smokeSyncPromise) return smokeSyncPromise
    smokeSyncPromise = (async () => {
      const visualization = getVisualization()
      const scene = getScene()
      const smokeGroup = getSmokeGroup()
      const layer = activeSmokeLayer.value
      if (!scene || !smokeGroup || !layer) {
        clearSmokeScene()
        return
      }

      const config = normalizeSmokeConfig(
        visualization?.smoke_config || DEFAULT_SMOKE_CONFIG,
      )
      const particles = {
        ...config.particles,
        ...(visualization?.smoke_particles || {}),
      }
      const personSmokeLayer = isPersonSmokeLayer(layer)
      const personSmokeOverrides = buildPersonSmokeRuntimeOverrides(
        layer,
        particles.count,
      )
      const scalar = personSmokeLayer ? '' : resolveSmokeScalar(layer)
      const frameIndex = resolveSmokeFrameIndex(layer)
      const volumeVariable = personSmokeLayer
        ? 'person-surface'
        : resolveSmokeVolumeVariable(layer)
      const releaseZoneSignature = personSmokeOverrides?.signature || ''
      const loadKey = `${layer.id}:${volumeVariable}:${scalar}:${personSmokeLayer ? 'person' : layer?.smokeTotal ? 'total' : 'scalar'}:${releaseZoneSignature}`
      if (smokeSystem && smokeLoadKey === loadKey) {
        await updateSmokeVelocityForCurrentFrame(layer)
        return
      }

      clearSmokeScene()
      const token = ++smokeSyncToken
      smokeLoadKey = loadKey

      try {
        const runtime = smokeConfigToRuntimeParams(config, particles)
        if (personSmokeOverrides?.runtime) {
          runtime.emitter = {
            ...runtime.emitter,
            ...personSmokeOverrides.runtime.emitter,
          }
          runtime.collision = personSmokeOverrides.runtime.collision
          smokeReleaseZoneSignature = releaseZoneSignature
        }
        const volumePayload = personSmokeLayer
          ? null
          : await resolveSmokeVolumePayload(layer, currentTimeStep.value)
        const manifestUrl = personSmokeLayer
          ? ''
          : resolveSmokeManifestUrlFromPayload(
              volumePayload,
              currentTimeStep.value,
            )
        if (!personSmokeLayer && !manifestUrl) {
          throw new Error('烟雾层缺少接口返回的体渲染 manifest_url')
        }

        const [velocityField, scalarField] = personSmokeLayer
          ? [null, null]
          : await Promise.all([
              loadSmokeVelocityFieldFromManifestUrl(manifestUrl, frameIndex).catch(
                (error) => {
                  console.warn('[SmokeLayer] 速度场加载失败，改用程序烟雾:', error)
                  return null
                },
              ),
              scalar
                ? loadSmokeScalarField({
                    manifestUrl,
                    scalar,
                    frameIndex,
                  }).catch((error) => {
                    console.warn('[SmokeLayer] 标量场加载失败，改用基础烟雾:', error)
                    return null
                  })
                : Promise.resolve(null),
            ])

        if (token !== smokeSyncToken || !getSmokeGroup()) return

        if (velocityField) {
          const strength = Number(visualization?.smoke_data_scale) || 120
          const worldScale = Number(visualization?.smoke_world_scale) || 10
          runtime.velocityField = {
            sample: velocityField.sample,
            strength,
            worldScale,
            stride: Number(visualization?.smoke_velocity_sample_stride) || 2,
          }
          smokeVelocityFrameKey = `${manifestUrl}:${frameIndex}:${strength}:${worldScale}`
        }
        if (scalarField) {
          runtime.scalarField = {
            sample: scalarField.sample,
            worldScale:
              Number(visualization?.smoke_scalar_world_scale) ||
              Number(visualization?.smoke_world_scale) ||
              10,
            influence: Number(visualization?.smoke_scalar_influence) || 1,
            emitAttempts: Number(visualization?.smoke_emit_attempts) || 10,
            color: [0.36, 0.78, 0.52],
            min: Number(visualization?.smoke_scalar_min) || 0,
            max: Number(visualization?.smoke_scalar_max) || 1,
          }
        }

        if (!smokeTexture) smokeTexture = createSmokeTexture()
        const requestedParticleCount = Math.round(Number(particles.count) || 800)
        const collisionParticleCap = runtime.collision?.meshes?.length
          ? Math.max(
              120,
              Math.round(
                Number(visualization?.smoke_collision_particle_cap) ||
                  (personSmokeLayer ? 180 : 320),
              ),
            )
          : Infinity
        smokeSystem = new SmokeSystem(
          Math.min(requestedParticleCount, collisionParticleCap),
          smokeTexture,
          getSmokeGroup(),
          runtime,
        )
        smokeElapsed = 0
        smokeLastFrameAt = null
        if (!personSmokeLayer) {
          await updateSmokeVelocityForCurrentFrame(layer)
        }
      } catch (error) {
        console.warn('[SmokeLayer] 烟雾层同步失败:', error)
        clearSmokeScene()
      }
    })()
    try {
      return await smokeSyncPromise
    } finally {
      smokeSyncPromise = null
    }
  }

  function tickSmokeLayer(elapsed = 0) {
    if (!smokeSystem || !hasVisibleSmokeLayer.value) return
    const now = Number(elapsed)
    const rawDelta =
      Number.isFinite(now) && smokeLastFrameAt != null
        ? now - smokeLastFrameAt
        : 0.016
    if (Number.isFinite(now)) smokeLastFrameAt = now
    const dt = Math.max(0.001, Math.min(0.08, rawDelta || 0.016))
    smokeElapsed += dt
    if (smokeSystem.uniforms?.uTime) {
      smokeSystem.uniforms.uTime.value = smokeElapsed
    }
    smokeSystem.update(smokeElapsed, dt)
  }

  function disposeSmokeTexture() {
    if (smokeTexture) {
      smokeTexture.dispose()
      smokeTexture = null
    }
  }

  return {
    syncSmokeToScene,
    tickSmokeLayer,
    clearSmokeScene,
    isPersonSmokeLayer,
    disposeSmokeTexture,
  }
}
