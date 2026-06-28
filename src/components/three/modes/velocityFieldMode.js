import { THREE, clearGroup } from './shared'

const DOWNSCALE = 8 // 每8个网格点取1个

function speedToColor(speed, maxSpeed) {
  const t = Math.max(0, Math.min(1, speed / maxSpeed))
  if (t < 0.5) {
    const s = t * 2
    return new THREE.Color(0, s, 1 - s * 0.5)
  }
  const s = (t - 0.5) * 2
  return new THREE.Color(s, 1, 0.5 - s * 0.5)
}

export function createVelocityFieldMode(options) {
  const { getDynamicGroup, requestVelocityField } = options

  let group = null
  let instancedMesh = null
  let dummy = new THREE.Object3D()
  let visible = false
  let cachedField = null
  let loadToken = 0
  let _built = false  // exposed so canvas can check if arrows are ready

  function disposeObject(obj) {
    obj?.removeFromParent?.()
    obj?.geometry?.dispose?.()
    obj?.material?.dispose?.()
  }

  function dispose() {
    if (instancedMesh) {
      disposeObject(instancedMesh)
      instancedMesh = null
    }
    if (group) {
      clearGroup(group)
      group = null
    }
    visible = false
    _built = false
    cachedField = null
  }

  async function sync(layer) {
    const token = ++loadToken
    let field = null
    if (layer) {
      field = await requestVelocityField?.(layer)
    }
    if (token !== loadToken || !field) return
    if (cachedField === field) {
      // field 未变化，只更新可见性
      if (group) group.visible = visible
      return
    }
    cachedField = field
    if (group) {
      group.visible = visible
    } else {
      const dynamicGroup = getDynamicGroup?.()
      if (!dynamicGroup) return
      group = new THREE.Group()
      group.renderOrder = 900
      dynamicGroup.add(group)
    }

    const dims = field.dims || [1, 1, 1]
    const nx = Math.max(2, dims[0])
    const ny = Math.max(2, dims[1])
    const nz = Math.max(2, dims[2])
    const origin = field.origin || [0, 0, 0]
    const spacing = field.spacing || [1, 1, 1]
    const vx = field.vx
    const vy = field.vy
    const vz = field.vz

    // 降采样：计算采样步长
    const stepX = Math.max(1, Math.round(nx / DOWNSCALE))
    const stepY = Math.max(1, Math.round(ny / DOWNSCALE))
    const stepZ = Math.max(1, Math.round(nz / DOWNSCALE))

    const sampleNX = Math.ceil(nx / stepX)
    const sampleNY = Math.ceil(ny / stepY)
    const sampleNZ = Math.ceil(nz / stepZ)
    const count = sampleNX * sampleNY * sampleNZ

    console.log('[VelocityField] building arrows:', count, 'from grid', [nx, ny, nz], 'step', [stepX, stepY, stepZ])

    // 计算速度大小阈值用于颜色映射
    let maxSpeed = 0
    const sampledSpeeds = new Float32Array(count)
    let idx = 0
    for (let iz = 0; iz < nz; iz += stepZ) {
      for (let iy = 0; iy < ny; iy += stepY) {
        for (let ix = 0; ix < nx; ix += stepX) {
          const gi = iz * ny * nx + iy * nx + ix
          const svx = Number(vx?.[gi]) || 0
          const svy = Number(vy?.[gi]) || 0
          const svz = Number(vz?.[gi]) || 0
          const speed = Math.sqrt(svx * svx + svy * svy + svz * svz)
          sampledSpeeds[idx] = speed
          if (speed > maxSpeed) maxSpeed = speed
          idx++
        }
      }
    }
    if (maxSpeed < 1e-8) maxSpeed = 1

    // 构建 instanced arrow mesh
    if (instancedMesh) {
      disposeObject(instancedMesh)
      instancedMesh = null
    }

    const arrowGeo = new THREE.ConeGeometry(0.003, 0.012, 6)
    arrowGeo.translate(0, 0.006, 0)
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    instancedMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, count)
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    instancedMesh.frustumCulled = false
    group.add(instancedMesh)

    idx = 0
    for (let iz = 0; iz < nz; iz += stepZ) {
      for (let iy = 0; iy < ny; iy += stepY) {
        for (let ix = 0; ix < nx; ix += stepX) {
          const gi = iz * ny * nx + iy * nx + ix
          const px = origin[0] + ix * spacing[0]
          const py = origin[1] + iy * spacing[1]
          const pz = origin[2] + iz * spacing[2]
          const svx = Number(vx?.[gi]) || 0
          const svy = Number(vy?.[gi]) || 0
          const svz = Number(vz?.[gi]) || 0

          const speed = sampledSpeeds[idx]
          const color = speedToColor(speed, maxSpeed)
          instancedMesh.setColorAt(idx, color)

          const dir = new THREE.Vector3(svx, svy, svz)
          const dirLen = dir.length()
          if (dirLen > 1e-8) {
            dir.normalize()
          } else {
            dir.set(1, 0, 0)
          }

          dummy.position.set(px, py, pz)
          dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
          const s = Math.max(0.5, Math.min(3, dirLen / maxSpeed * 0.8))
          dummy.scale.setScalar(s)
          dummy.updateMatrix()
          instancedMesh.setMatrixAt(idx, dummy.matrix)
          idx++
        }
      }
    }

    instancedMesh.count = idx
    instancedMesh.instanceMatrix.needsUpdate = true
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true

    group.visible = visible
    _built = true
    console.log('[VelocityField] rendered', idx, 'arrows, maxSpeed:', maxSpeed)
  }

  function setVisible(v) {
    visible = v
    if (group) group.visible = v
  }

  function isVisible() {
    return visible
  }

  return { sync, setVisible, isVisible, dispose }
}