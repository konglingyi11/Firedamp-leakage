/**
 * 将模拟雷达贴图中「切割面与网格相交」以外的像素 Alpha 置零（透明）。
 * 算法：三角面与切片平面求交 → 在切面 2D 上画封闭边界 → 角点洪水填充标记外侧。
 */

import * as THREE from 'three'

const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()

function dedupePoints(pts, epsSq) {
  const out = []
  for (const p of pts) {
    if (!out.some((q) => q.distanceToSquared(p) < epsSq)) out.push(p)
  }
  return out
}

function pushIntersectionSegment(v0, v1, v2, plane, eps, segments) {
  const d0 = plane.distanceToPoint(v0)
  const d1 = plane.distanceToPoint(v1)
  const d2 = plane.distanceToPoint(v2)

  if (Math.abs(d0) <= eps && Math.abs(d1) <= eps && Math.abs(d2) <= eps) {
    segments.push([v0.clone(), v1.clone()])
    segments.push([v1.clone(), v2.clone()])
    segments.push([v2.clone(), v0.clone()])
    return
  }

  const pts = []
  function addEdge(pa, pb, da, db) {
    if (Math.abs(da) <= eps && Math.abs(db) <= eps) return
    if (Math.abs(da) <= eps) {
      pts.push(pa.clone())
      return
    }
    if (Math.abs(db) <= eps) {
      pts.push(pb.clone())
      return
    }
    if (da * db > 0) return
    const t = da / (da - db)
    pts.push(pa.clone().lerp(pb, t))
  }

  addEdge(v0, v1, d0, d1)
  addEdge(v1, v2, d1, d2)
  addEdge(v2, v0, d2, d0)

  const epsSq = eps * eps
  const up = dedupePoints(pts, epsSq)
  if (up.length === 2) {
    segments.push([up[0], up[1]])
  } else if (up.length >= 3) {
    segments.push([up[0], up[1]])
    segments.push([up[1], up[2]])
    if (up.length === 3) {
      segments.push([up[2], up[0]])
    }
  }
}

function collectSliceSegments(meshes, plane, eps) {
  const segments = []
  let triCount = 0
  for (const mesh of meshes) {
    const geom = mesh.geometry
    const pos = geom.attributes?.position
    if (!pos) continue
    mesh.updateMatrixWorld(true)
    const index = geom.index
    const vc = pos.count
    const processTri = (ia, ib, ic) => {
      _v0.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld)
      _v1.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld)
      _v2.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld)
      pushIntersectionSegment(_v0, _v1, _v2, plane, eps, segments)
      triCount++
    }
    if (index) {
      const n = index.count
      for (let i = 0; i < n; i += 3) {
        processTri(index.getX(i), index.getX(i + 1), index.getX(i + 2))
      }
    } else {
      for (let i = 0; i + 2 < vc; i += 3) {
        processTri(i, i + 1, i + 2)
      }
    }
  }
  return { segments, triCount }
}

function planeUvBasis(planeMesh) {
  planeMesh.updateMatrixWorld(true)
  const mw = planeMesh.matrixWorld
  const origin = new THREE.Vector3().setFromMatrixPosition(mw)
  const rotMat = new THREE.Matrix4()
  rotMat.extractRotation(mw)
  const quat = new THREE.Quaternion().setFromRotationMatrix(rotMat)
  const e1 = new THREE.Vector3(1, 0, 0).applyQuaternion(quat).normalize()
  const e2 = new THREE.Vector3(0, 1, 0).applyQuaternion(quat).normalize()
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize()
  const params = planeMesh.geometry?.parameters || {}
  const W = Number(params.width) || 1
  const H = Number(params.height) || 1
  return { origin, e1, e2, normal, width: W, height: H }
}

function worldToPlaneUv(p, origin, e1, e2) {
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  const dz = p.z - origin.z
  const d = new THREE.Vector3(dx, dy, dz)
  return { u: d.dot(e1), v: d.dot(e2) }
}

function uvToCanvas(u, v, planeW, planeH, cw, ch) {
  const x = (u / planeW + 0.5) * cw
  const y = (-v / planeH + 0.5) * ch
  return [x, y]
}

function estimateEpsilon(meshes) {
  const box = new THREE.Box3()
  let any = false
  for (const mesh of meshes) {
    if (!mesh.geometry) continue
    mesh.updateMatrixWorld(true)
    mesh.geometry.computeBoundingBox()
    const lb = mesh.geometry.boundingBox
    if (!lb) continue
    const tmp = lb.clone().applyMatrix4(mesh.matrixWorld)
    box.union(tmp)
    any = true
  }
  if (!any) return 1e-5
  const size = box.getSize(new THREE.Vector3())
  const diag = Math.max(size.length(), 1e-6)
  return Math.max(1e-7, diag * 1e-5)
}

function floodFillOutside(maskCanvas, wallRgbThreshold = 220) {
  const ctx = maskCanvas.getContext('2d')
  const w = maskCanvas.width
  const h = maskCanvas.height
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const stride = w

  function isWall(ix, iy) {
    const i = (iy * stride + ix) * 4
    return (
      d[i] < wallRgbThreshold ||
      d[i + 1] < wallRgbThreshold ||
      d[i + 2] < wallRgbThreshold
    )
  }

  const seeds = []
  for (let x = 0; x < w; x++) {
    if (!isWall(x, 0)) seeds.push([x, 0])
    if (!isWall(x, h - 1)) seeds.push([x, h - 1])
  }
  for (let y = 0; y < h; y++) {
    if (!isWall(0, y)) seeds.push([0, y])
    if (!isWall(w - 1, y)) seeds.push([w - 1, y])
  }
  if (seeds.length === 0) return null

  const visited = new Uint8Array(w * h)
  const stack = seeds.slice()
  while (stack.length) {
    const [x, y] = stack.pop()
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const id = y * stride + x
    if (visited[id]) continue
    if (isWall(x, y)) continue
    visited[id] = 1
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  return visited
}

/**
 * @param {CanvasImageSource} sourceImage texture.image
 * @param {THREE.Mesh} planeMesh 数据平面 Mesh（含 PlaneGeometry）
 * @param {THREE.Mesh[]} meshes 参与求交的网格列表（世界矩阵已更新）
 * @returns {HTMLCanvasElement|null}
 */
export function buildRadarTextureWithModelSliceAlpha(sourceImage, planeMesh, meshes) {
  if (
    !sourceImage ||
    !planeMesh?.geometry ||
    !Array.isArray(meshes) ||
    meshes.length === 0
  ) {
    return null
  }

  const cw = sourceImage.width || sourceImage.naturalWidth
  const ch = sourceImage.height || sourceImage.naturalHeight
  if (!(cw > 0 && ch > 0)) return null

  const { origin, e1, e2, normal, width: planeW, height: planeH } = planeUvBasis(planeMesh)
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin)
  const eps = estimateEpsilon(meshes)
  const { segments, triCount } = collectSliceSegments(meshes, plane, eps)

  if (segments.length === 0 || triCount === 0) {
    return null
  }

  const mask = document.createElement('canvas')
  mask.width = cw
  mask.height = ch
  const mctx = mask.getContext('2d')
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, cw, ch)
  mctx.strokeStyle = '#000000'
  mctx.lineWidth = Math.max(2, Math.floor(Math.min(cw, ch) / 512) + 2)
  mctx.lineCap = 'square'
  mctx.lineJoin = 'miter'

  for (const [a, b] of segments) {
    const ua = worldToPlaneUv(a, origin, e1, e2)
    const ub = worldToPlaneUv(b, origin, e1, e2)
    const [x1, y1] = uvToCanvas(ua.u, ua.v, planeW, planeH, cw, ch)
    const [x2, y2] = uvToCanvas(ub.u, ub.v, planeW, planeH, cw, ch)
    mctx.beginPath()
    mctx.moveTo(x1, y1)
    mctx.lineTo(x2, y2)
    mctx.stroke()
  }

  const outside = floodFillOutside(mask, 220)
  if (!outside) {
    return null
  }

  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  const octx = out.getContext('2d')
  octx.drawImage(sourceImage, 0, 0, cw, ch)
  const outImg = octx.getImageData(0, 0, cw, ch)
  const od = outImg.data

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const id = y * cw + x
      if (outside[id]) {
        od[id * 4 + 3] = 0
      }
    }
  }
  octx.putImageData(outImg, 0, 0)

  return out
}

/**
 * 世界坐标点 → 与 buildRadarTextureWithModelSliceAlpha 一致的平面 UV（0–1，对应 PlaneGeometry 默认 uv）
 */
export function worldPointToPlaneUv01(point, planeMesh) {
  if (!point || !planeMesh?.geometry) return { u: 0.5, v: 0.5 }
  const { origin, e1, e2, width: planeW, height: planeH } = planeUvBasis(
    planeMesh,
  )
  const ua = worldToPlaneUv(point, origin, e1, e2)
  const w = Number(planeW) > 1e-9 ? planeW : 1
  const h = Number(planeH) > 1e-9 ? planeH : 1
  return {
    u: ua.u / w + 0.5,
    v: ua.v / h + 0.5,
  }
}

/**
 * 模型三角面与当前切片平面的交线段，转为平面 UV 空间 [0,1] 内线段（条数上限防御）
 * @returns {{ segments: number[][], lineCount: number }} segments 每项 [u0,v0,u1,v1]
 */
export function collectRadarWaveObstacleUvSegments(
  planeMesh,
  meshes,
  maxLines = 24,
) {
  if (!planeMesh?.geometry || !Array.isArray(meshes) || meshes.length === 0) {
    return { segments: [], lineCount: 0 }
  }
  const { origin, e1, e2, normal, width: planeW, height: planeH } =
    planeUvBasis(planeMesh)
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin)
  const eps = estimateEpsilon(meshes)
  const { segments: worldSegs } = collectSliceSegments(meshes, plane, eps)
  const w = Number(planeW) > 1e-9 ? planeW : 1
  const h = Number(planeH) > 1e-9 ? planeH : 1
  const invW = 1 / w
  const invH = 1 / h
  const out = []
  for (const [a, b] of worldSegs) {
    if (out.length >= maxLines) break
    const ua = worldToPlaneUv(a, origin, e1, e2)
    const ub = worldToPlaneUv(b, origin, e1, e2)
    const u0 = ua.u * invW + 0.5
    const v0 = ua.v * invH + 0.5
    const u1 = ub.u * invW + 0.5
    const v1 = ub.v * invH + 0.5
    if (
      [u0, v0, u1, v1].every(
        (x) => typeof x === 'number' && Number.isFinite(x),
      )
    ) {
      out.push([u0, v0, u1, v1])
    }
  }
  return { segments: out, lineCount: out.length }
}
