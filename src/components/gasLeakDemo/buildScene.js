import * as THREE from 'three'
import {
  createWallTexture,
  createRockTexture,
  createRoughnessTexture,
  createMetalTexture,
  createBeltTexture,
} from './proceduralTextures.js'

/**
 * 用程序化的几何体+贴图搭建更真实的矿道 demo 场景。
 * 返回 { sceneGroup, machineGroup, coalPieces, crackMeshes, crackPositions, crackCenters, ignitionPosition, collisionMeshes, tunnelParams }
 */
export function buildMiningScene() {
  const group = new THREE.Group()
  group.name = 'miningScene'

  // 尺寸参数（单位：m）
  const tunnelLength = 60
  const tunnelWidth = 8
  const tunnelHeight = 5
  const wallThick = 0.5
  const floorY = -tunnelHeight / 2 + 0.15
  const ceilingY = tunnelHeight / 2 - 0.1
  const halfWidth = tunnelWidth / 2 - 0.35

  const collisionMeshes = []

  // ---------- 程序化贴图 ----------
  const wallTexture = createWallTexture()
  const rockTexture = createRockTexture()
  const rockRoughness = createRoughnessTexture(220)
  const metalTexture = createMetalTexture()
  const metalRoughness = createRoughnessTexture(90)
  const beltTexture = createBeltTexture()

  // ---------- 巷道（地板、顶棚、左右侧帮） ----------
  wallTexture.repeat.set(6, 1)
  const wallMat = new THREE.MeshStandardMaterial({
    color: '#646464',
    map: wallTexture,
    roughnessMap: createRoughnessTexture(180),
    roughness: 0.92,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(tunnelLength, wallThick, tunnelWidth),
    wallMat,
  )
  floor.position.set(0, -tunnelHeight / 2 - wallThick / 2, 0)
  floor.receiveShadow = true
  group.add(floor)
  collisionMeshes.push(floor)

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(tunnelLength, wallThick, tunnelWidth),
    wallMat,
  )
  ceiling.position.set(0, tunnelHeight / 2 + wallThick / 2, 0)
  ceiling.receiveShadow = true
  group.add(ceiling)
  collisionMeshes.push(ceiling)

  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(tunnelLength, tunnelHeight, wallThick),
    wallMat,
  )
  leftWall.position.set(0, 0, -tunnelWidth / 2 - wallThick / 2)
  leftWall.receiveShadow = true
  group.add(leftWall)
  collisionMeshes.push(leftWall)

  const rightWall = new THREE.Mesh(
    new THREE.BoxGeometry(tunnelLength, tunnelHeight, wallThick),
    wallMat,
  )
  rightWall.position.set(0, 0, tunnelWidth / 2 + wallThick / 2)
  rightWall.receiveShadow = true
  group.add(rightWall)
  collisionMeshes.push(rightWall)

  // ---------- 液压支架（沿左帮排列） ----------
  const supportMat = new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    map: metalTexture,
    roughnessMap: metalRoughness,
    roughness: 0.55,
    metalness: 0.45,
  })
  const supportGroup = new THREE.Group()
  supportGroup.name = 'supports'
  for (let i = 0; i < 10; i++) {
    const x = -18 + i * 3.5
    const support = new THREE.Group()

    // 底座
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 0.8), supportMat)
    base.position.set(0, floorY + 0.12, 0)
    base.castShadow = true
    support.add(base)

    // 立柱
    const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, ceilingY - floorY - 0.4, 12), supportMat)
    leg1.position.set(-0.35, (floorY + ceilingY) / 2, 0)
    support.add(leg1)
    const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, ceilingY - floorY - 0.4, 12), supportMat)
    leg2.position.set(0.35, (floorY + ceilingY) / 2, 0)
    support.add(leg2)

    // 顶梁
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.9), supportMat)
    beam.position.set(0, ceilingY - 0.1, 0)
    beam.castShadow = true
    support.add(beam)

    support.position.set(x, 0, -halfWidth + 0.6)
    supportGroup.add(support)
  }
  group.add(supportGroup)

  // ---------- 刮板输送机 ----------
  const conveyorGroup = new THREE.Group()
  conveyorGroup.name = 'conveyor'
  const frameMat = new THREE.MeshStandardMaterial({ color: '#4a4a4a', roughness: 0.7, metalness: 0.4 })
  const beltMat = new THREE.MeshStandardMaterial({
    color: '#222222',
    map: beltTexture,
    roughness: 0.85,
    metalness: 0.1,
  })

  const conveyorLength = 40
  const conveyorBed = new THREE.Mesh(new THREE.BoxGeometry(conveyorLength, 0.3, 1.2), frameMat)
  conveyorBed.position.set(-2, floorY + 0.25, 0)
  conveyorBed.castShadow = true
  conveyorGroup.add(conveyorBed)

  const conveyorBelt = new THREE.Mesh(new THREE.BoxGeometry(conveyorLength, 0.08, 1.0), beltMat)
  conveyorBelt.position.set(-2, floorY + 0.42, 0)
  conveyorGroup.add(conveyorBelt)

  // 输送机侧护栏
  const railGeo = new THREE.BoxGeometry(conveyorLength, 0.25, 0.06)
  const railL = new THREE.Mesh(railGeo, frameMat)
  railL.position.set(-2, floorY + 0.7, -0.55)
  conveyorGroup.add(railL)
  const railR = new THREE.Mesh(railGeo, frameMat)
  railR.position.set(-2, floorY + 0.7, 0.55)
  conveyorGroup.add(railR)

  group.add(conveyorGroup)

  // ---------- 长壁放顶煤机（更精细） ----------
  const machineGroup = new THREE.Group()
  machineGroup.position.set(-8, -tunnelHeight / 2 + 1.0, 0)

  const bodyMat = new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    map: metalTexture,
    roughnessMap: metalRoughness,
    roughness: 0.5,
    metalness: 0.5,
  })
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2d2d2d', roughness: 0.7, metalness: 0.4 })

  // 主机身
  const body = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.6, 2.0), bodyMat)
  body.position.set(0, 0.8, 0)
  body.castShadow = true
  machineGroup.add(body)

  // 机身细节块
  const bodyTop = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.5, 1.6), darkMat)
  bodyTop.position.set(0, 1.7, 0)
  machineGroup.add(bodyTop)

  // 摇臂
  const armGeo = new THREE.BoxGeometry(3.2, 0.45, 0.5)
  const arm = new THREE.Mesh(armGeo, bodyMat)
  arm.position.set(3.2, 1.4, 0)
  arm.rotation.z = -0.15
  arm.castShadow = true
  machineGroup.add(arm)

  // 滚筒（采煤滚筒）
  const drumMat = new THREE.MeshStandardMaterial({ color: '#525252', roughness: 0.5, metalness: 0.7 })
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.4, 24), drumMat)
  drum.rotation.x = Math.PI / 2
  drum.position.set(4.6, 1.0, 0)
  drum.castShadow = true
  machineGroup.add(drum)

  // 滚筒齿
  for (let i = 0; i < 12; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.08), drumMat)
    const angle = (i / 12) * Math.PI * 2
    tooth.position.set(
      4.6 + Math.cos(angle) * 0.85,
      1.0 + Math.sin(angle) * 0.85,
      0,
    )
    tooth.rotation.z = angle
    machineGroup.add(tooth)
  }

  // 履带
  const trackMat = new THREE.MeshStandardMaterial({ color: '#2d2d2d', roughness: 0.8, metalness: 0.3 })
  const trackL = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.55, 0.45), trackMat)
  trackL.position.set(0, 0.28, 1.0)
  trackL.castShadow = true
  machineGroup.add(trackL)
  const trackR = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.55, 0.45), trackMat)
  trackR.position.set(0, 0.28, -1.0)
  trackR.castShadow = true
  machineGroup.add(trackR)

  group.add(machineGroup)

  // 增加局部补光
  const workLight = new THREE.PointLight('#fff3dc', 3.0, 40)
  workLight.position.set(-6, 3, 0)
  workLight.castShadow = true
  group.add(workLight)

  const fillLight2 = new THREE.PointLight('#8fc7ff', 1.5, 50)
  fillLight2.position.set(8, 4, 6)
  group.add(fillLight2)

  // 来自巷道入口的定向光（模拟外部自然光）
  const entranceLight = new THREE.DirectionalLight('#fff8e7', 1.2)
  entranceLight.position.set(-30, 8, 4)
  entranceLight.target.position.set(10, 0, 0)
  entranceLight.castShadow = true
  entranceLight.shadow.mapSize.width = 1024
  entranceLight.shadow.mapSize.height = 1024
  entranceLight.shadow.camera.near = 1
  entranceLight.shadow.camera.far = 80
  entranceLight.shadow.camera.left = -20
  entranceLight.shadow.camera.right = 20
  entranceLight.shadow.camera.top = 20
  entranceLight.shadow.camera.bottom = -20
  group.add(entranceLight)
  group.add(entranceLight.target)

  // 收集采煤机碰撞体
  const machineBodyBox = new THREE.Mesh(
    new THREE.BoxGeometry(6.0, 2.2, 3.0),
    new THREE.MeshBasicMaterial({ visible: false }),
  )
  machineBodyBox.position.copy(machineGroup.position).add(new THREE.Vector3(0.5, 1.0, 0))
  group.add(machineBodyBox)
  collisionMeshes.push(machineBodyBox)

  // ---------- 落煤（从机子上方掉落的煤块） ----------
  const coalMat = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.95, metalness: 0.05 })
  const coalPieces = []
  for (let i = 0; i < 24; i++) {
    const s = 0.15 + Math.random() * 0.25
    const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), coalMat)
    coal.position.set(
      -8 + (Math.random() - 0.5) * 2.5,
      tunnelHeight / 2 - 0.5 - Math.random() * 2.5,
      (Math.random() - 0.5) * 1.5,
    )
    coal.userData = {
      fallSpeed: 0.8 + Math.random() * 1.2,
      rotSpeed: (Math.random() - 0.5) * 2,
      resetY: tunnelHeight / 2 - 0.5,
      floorY: -tunnelHeight / 2 + 0.3,
    }
    group.add(coal)
    coalPieces.push(coal)
  }

  // ---------- 落地煤堆（自燃点火源位置） ----------
  const coalPileGroup = new THREE.Group()
  coalPileGroup.name = 'coalPile'
  const pileCenter = new THREE.Vector3(-5.8, floorY + 0.28, 1.5)
  for (let i = 0; i < 22; i++) {
    const s = 0.18 + Math.random() * 0.32
    const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), coalMat)
    const angle = Math.random() * Math.PI * 2
    const r = Math.random() * 0.95
    coal.position.set(
      pileCenter.x + Math.cos(angle) * r,
      pileCenter.y + Math.random() * 0.4,
      pileCenter.z + Math.sin(angle) * r * 0.7,
    )
    coal.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    coal.castShadow = true
    coalPileGroup.add(coal)
  }
  group.add(coalPileGroup)

  const ignitionPosition = pileCenter.clone().add(new THREE.Vector3(0, 0.4, 0))

  // ---------- 采空区充填岩石（带缝隙的岩堆，更真实） ----------
  const goafStartX = 2.4
  const goafEndX = 19.0
  const goafHalfWidth = halfWidth

  function pileHeightAt(x, z) {
    const nx = Math.max(0, Math.min(1, (x - goafStartX) / (goafEndX - goafStartX)))
    const centerHeight = 3.6 * Math.pow(1 - nx, 0.7) + 0.35
    const zRatio = Math.abs(z) / goafHalfWidth
    const sideFalloff = Math.max(0, 1 - Math.pow(zRatio, 2.4))
    return floorY + centerHeight * sideFalloff
  }

  const rocks = []
  const targetCount = 520
  const minGap = 0.12
  let attempts = 0
  const maxAttempts = targetCount * 140

  while (rocks.length < targetCount && attempts < maxAttempts) {
    attempts++
    const t = Math.random()
    const x = goafStartX + (1 - Math.pow(1 - t, 1.3)) * (goafEndX - goafStartX)
    const z = (Math.random() - 0.5) * 2 * goafHalfWidth * 0.92
    const maxH = pileHeightAt(x, z)
    if (maxH <= floorY + 0.5) continue

    const y = floorY + Math.random() * (maxH - floorY)

    const heightFactor = Math.max(0, Math.min(1, (y - floorY) / 3.8))
    const sx = 0.45 + Math.random() * 1.2 * (1 - heightFactor * 0.35)
    const sy = 0.4 + Math.random() * 1.0 * (1 - heightFactor * 0.25)
    const sz = 0.45 + Math.random() * 1.2 * (1 - heightFactor * 0.35)

    const radius = Math.sqrt(sx * sx + sy * sy + sz * sz) * 0.55

    let overlap = false
    for (const r of rocks) {
      const dx = r.x - x
      const dy = r.y - y
      const dz = r.z - z
      const minDist = r.radius + radius + minGap
      if (dx * dx + dy * dy + dz * dz < minDist * minDist) {
        overlap = true
        break
      }
    }
    if (overlap) continue

    if (y - sy / 2 < floorY + 0.05 || y + sy / 2 > ceilingY - 0.1) continue
    if (Math.abs(z) + sz / 2 > goafHalfWidth) continue

    rocks.push({
      x,
      y,
      z,
      sx,
      sy,
      sz,
      radius,
      rotX: Math.random() * Math.PI,
      rotY: Math.random() * Math.PI,
      rotZ: Math.random() * Math.PI,
    })
  }

  // 岩石视觉：用 Dodecahedron + 顶点扰动，更自然
  const rockMat = new THREE.MeshStandardMaterial({
    color: '#6b6862',
    map: rockTexture,
    roughnessMap: rockRoughness,
    roughness: 0.92,
    metalness: 0.05,
    flatShading: true,
  })
  const rockBaseGeo = new THREE.DodecahedronGeometry(1, 0)
  const rockGeo = rockBaseGeo.clone()
  const posAttr = rockGeo.attributes.position
  for (let i = 0; i < posAttr.count; i++) {
    const px = posAttr.getX(i)
    const py = posAttr.getY(i)
    const pz = posAttr.getZ(i)
    const n = Math.sin(px * 3.7) * Math.cos(py * 4.2) * Math.sin(pz * 3.3)
    const scale = 1.0 + n * 0.12
    posAttr.setXYZ(i, px * scale, py * scale, pz * scale)
  }
  rockGeo.computeVertexNormals()

  const rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length)
  rockInstanced.name = 'goafRocks'
  rockInstanced.castShadow = true
  rockInstanced.receiveShadow = true

  const dummy = new THREE.Object3D()
  rocks.forEach((r, i) => {
    dummy.position.set(r.x, r.y, r.z)
    dummy.rotation.set(r.rotX, r.rotY, r.rotZ)
    dummy.scale.set(r.sx, r.sy, r.sz)
    dummy.updateMatrix()
    rockInstanced.setMatrixAt(i, dummy.matrix)
  })
  rockInstanced.instanceMatrix.needsUpdate = true
  group.add(rockInstanced)

  // 岩石碰撞体：取体积最大的 45 块
  const sortedByVolume = [...rocks].sort((a, b) => (b.sx * b.sy * b.sz) - (a.sx * a.sy * a.sz))
  const colliderRocks = sortedByVolume.slice(0, 45)
  const rockColliderMat = new THREE.MeshBasicMaterial({ visible: false })
  colliderRocks.forEach((r) => {
    const collider = new THREE.Mesh(
      new THREE.BoxGeometry(r.sx * 0.98, r.sy * 0.98, r.sz * 0.98),
      rockColliderMat,
    )
    collider.position.set(r.x, r.y, r.z)
    collider.rotation.set(r.rotX, r.rotY, r.rotZ)
    group.add(collider)
    collisionMeshes.push(collider)
  })

  // ---------- 缝隙发射源（在岩堆内部/缝隙中） ----------
  const gapPositions = []
  const candidateCount = 400
  for (let i = 0; i < candidateCount; i++) {
    const x = goafStartX + Math.random() * (goafEndX - goafStartX)
    const z = (Math.random() - 0.5) * 2 * goafHalfWidth * 0.9
    const maxH = pileHeightAt(x, z)
    if (maxH <= floorY + 0.8) continue

    const y = floorY + 0.3 + Math.random() * (maxH - floorY - 0.5)

    let minDistRatio = Infinity
    for (const r of rocks) {
      const dx = (x - r.x) / (r.sx * 0.55)
      const dy = (y - r.y) / (r.sy * 0.55)
      const dz = (z - r.z) / (r.sz * 0.55)
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d < minDistRatio) minDistRatio = d
    }

    if (minDistRatio > 1.05 && minDistRatio < 2.6) {
      gapPositions.push({ x, y, z, ratio: minDistRatio, height: y })
    }
  }

  if (gapPositions.length < 8) {
    for (let i = 0; i < 16; i++) {
      const x = goafStartX + 1 + Math.random() * (goafEndX - goafStartX - 2)
      const z = (Math.random() - 0.5) * 2 * goafHalfWidth * 0.6
      const maxH = pileHeightAt(x, z)
      const y = floorY + 0.5 + Math.random() * Math.max(0.3, maxH - floorY - 0.8)
      gapPositions.push({ x, y, z, ratio: 1.5, height: y })
    }
  }

  gapPositions.sort((a, b) => b.height - a.height)
  const surfaceGaps = gapPositions.slice(0, 32).map((g) => new THREE.Vector3(g.x, g.y, g.z))
  const deepGaps = gapPositions
    .slice(32, 90)
    .filter((g) => g.ratio > 1.3)
    .slice(0, 8)
    .map((g) => new THREE.Vector3(g.x, g.y, g.z))
  const allGapPositions = [...surfaceGaps, ...deepGaps]

  // 视觉裂缝贴片
  const crackMeshes = []
  const crackCenters = []
  const crackMat = new THREE.MeshBasicMaterial({
    color: '#1a1816',
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  })
  for (let i = 0; i < 8; i++) {
    const pos = allGapPositions[i * 3] || allGapPositions[i]
    if (!pos) continue
    const crack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25 + Math.random() * 0.2, 0.4 + Math.random() * 0.3),
      crackMat,
    )
    crack.position.copy(pos).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.3,
    ))
    crack.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    group.add(crack)
    crackMeshes.push(crack)
    crackCenters.push(pos.clone())
  }

  return {
    sceneGroup: group,
    machineGroup,
    rockGroup: rockInstanced,
    coalPieces,
    crackMeshes,
    crackPositions: allGapPositions,
    crackCenters,
    ignitionPosition,
    collisionMeshes,
    tunnelParams: { length: tunnelLength, width: tunnelWidth, height: tunnelHeight },
  }
}

/**
 * 更新落煤动画
 */
export function updateCoalFall(coalPieces, delta) {
  coalPieces.forEach((coal) => {
    coal.position.y -= coal.userData.fallSpeed * delta
    coal.rotation.x += coal.userData.rotSpeed * delta
    coal.rotation.z += coal.userData.rotSpeed * delta * 0.5
    if (coal.position.y < coal.userData.floorY) {
      coal.position.y = coal.userData.resetY
      coal.position.x = -8 + (Math.random() - 0.5) * 2.5
      coal.position.z = (Math.random() - 0.5) * 1.5
    }
  })
}
