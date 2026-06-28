/**
 * /test-leida 三维体标量场的唯一数据源：归一坐标 (nx,ny,nz∈[-1,1]) → [0,1] 连续场，
 * 与射线体渲染、点云、(mockRadarVolume3d) VTK blob 共用，避免多套实现分叉。
 */

/** 与 TestLeidaView 初始 volumeSeed 一致（未点「重新采样」） */
export const TEST_LEIDA_DEFAULT_VOLUME_SEED = 77140231

const clamp01 = (v) => Math.max(0, Math.min(1, v))

export function smoothstep01(t) {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

export function histogramContrastStretchVoxel(arr) {
  const H = 48
  const hist = new Uint32Array(H)
  const n = arr.length
  for (let i = 0; i < n; i += 1) {
    const b = Math.min(H - 1, Math.floor(clamp01(arr[i]) * H))
    hist[b] += 1
  }
  let acc = 0
  const tail = Math.max(8, Math.floor(n * 0.06))
  let loBin = 0
  while (loBin < H && acc < tail) {
    acc += hist[loBin++]
  }
  acc = 0
  let hiBin = H - 1
  while (hiBin >= 0 && acc < tail) {
    acc += hist[hiBin--]
  }
  const lo = (loBin - 1) / H
  const hi = (hiBin + 2) / H
  const span = Math.max(hi - lo, 0.04)
  for (let i = 0; i < n; i += 1) {
    const u = clamp01((arr[i] - lo) / span)
    arr[i] = Math.pow(u, 0.88)
  }
}

function hashUint32(x) {
  let n = x >>> 0
  n ^= n << 13
  n ^= n >>> 17
  n ^= n << 5
  return n >>> 0
}

function latticeNoise(ix, iy, iz, seed) {
  const h = hashUint32(
    Math.imul(ix, 374761393) ^
      Math.imul(iy, 668265263) ^
      Math.imul(iz, 1274126177) ^
      seed,
  )
  return h / 4294967296
}

function fadePerlin(t) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** 平滑三维值噪声：nx,ny,nz∈[-1,1]，空间连续；seed 变化整体换纹理 */
export function smoothValueNoise3(nx, ny, nz, seed) {
  const fx = nx * 3.7 + 102.413
  const fy = ny * 3.7 + 207.919
  const fz = nz * 3.7 + 313.531
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const z0 = Math.floor(fz)
  const tx = fx - x0
  const ty = fy - y0
  const tz = fz - z0
  const u = fadePerlin(tx)
  const v = fadePerlin(ty)
  const w = fadePerlin(tz)
  const lerp = (a, b, t2) => a + (b - a) * t2
  const L = (x, y, z) => latticeNoise(x, y, z, seed)

  const c000 = L(x0, y0, z0)
  const c100 = L(x0 + 1, y0, z0)
  const c010 = L(x0, y0 + 1, z0)
  const c110 = L(x0 + 1, y0 + 1, z0)
  const c001 = L(x0, y0, z0 + 1)
  const c101 = L(x0 + 1, y0, z0 + 1)
  const c011 = L(x0, y0 + 1, z0 + 1)
  const c111 = L(x0 + 1, y0 + 1, z0 + 1)

  const c00 = lerp(c000, c100, u)
  const c10 = lerp(c010, c110, u)
  const c01 = lerp(c001, c101, u)
  const c11 = lerp(c011, c111, u)
  const c0 = lerp(c00, c10, v)
  const c1 = lerp(c01, c11, v)
  return lerp(c0, c1, w)
}

/**
 * 归一化坐标 nx,ny,nz ∈ [-1,1]，返回 [0,1] — 强对流柱 + 中高层云顶，外层快速衰减留白
 * （与 TestLeidaView.vue 原版一致）
 */
export function sampleRadarVolumeNormalized(nx, ny, nz, bandScale, noiseSeed) {
  const bs = bandScale
  const rho = Math.sqrt(nx * nx + ny * ny)
  const z = nz

  const jitter =
    smoothValueNoise3(nx * 3.5 + 0.11, ny * 3.5 - 0.09, nz * 3.4 + 0.17, noiseSeed) -
    0.5

  let v =
    0.018 +
    0.065 * smoothValueNoise3(nx * 2.05, ny * 2.05, nz * 1.95, noiseSeed ^ 0x12345679)

  const dx = nx - (-0.04 * bs + jitter * 0.045)
  const dy = ny - (0.1 * bs)
  const rz = rho * bs

  const core =
    Math.exp(-(rz * rz) / (0.095 * bs) - Math.pow(z - 0.18 / bs, 2) / 0.055) * 0.95
  v += core

  v +=
    0.72 *
    Math.exp(
      -((rz - 0.16 * bs) ** 2) / (0.16 * bs) - Math.pow(z - 0.42 / bs, 2) / 0.1,
    )
  const wall =
    0.45 *
    Math.exp(
      -((dx * dx + dy * dy) / (0.18 * bs) + Math.pow(z + 0.22, 2) * 1.05 / (0.32 * bs)),
    )
  v += wall

  v *= 0.34 + 0.66 * Math.exp(-rho * rho * (0.55 + 0.2 * jitter))
  const vertCap = smoothstep01((z + 0.35) / 1.32)
  const horizFade = smoothstep01(1.06 - rho * (0.88 / bs))
  v *= vertCap * (0.22 + 0.78 * horizFade)

  return Math.min(1, Math.max(0, v))
}

/**
 * 按 Three Data3DTexture / TestLeida 填充顺序 iz→iy→ix 写入 out（线性 wi++）
 */
export function fillRadarVolumeNormalizedGridSequentialZ(gs, bandScale, noiseSeed, out) {
  const nx = gs
  const ny = gs
  const nz = gs
  const g1 = Math.max(1, gs - 1)
  let wi = 0
  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const fx = ix / g1
        const fy = iy / g1
        const fz = iz / g1
        const nxN = fx * 2 - 1
        const nyN = fy * 2 - 1
        const nzN = fz * 2 - 1
        out[wi] = sampleRadarVolumeNormalized(nxN, nyN, nzN, bandScale, noiseSeed)
        wi += 1
      }
    }
  }
}

/**
 * VTK 磁盘序：ix * ny*nz + iy * nz + iz（与 mockRadarVolume3d / volumeMode 输入一致）
 */
export function fillRadarVolumeNormalizedGridVtkIxIyIz(nx, ny, nz, bandScale, noiseSeed, outScratch) {
  const g1x = Math.max(1, nx - 1)
  const g1y = Math.max(1, ny - 1)
  const g1z = Math.max(1, nz - 1)
  for (let ix = 0; ix < nx; ix += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let iz = 0; iz < nz; iz += 1) {
        const vk = ix * ny * nz + iy * nz + iz
        const fx = ix / g1x
        const fy = iy / g1y
        const fz = iz / g1z
        outScratch[vk] = sampleRadarVolumeNormalized(
          fx * 2 - 1,
          fy * 2 - 1,
          fz * 2 - 1,
          bandScale,
          noiseSeed,
        )
      }
    }
  }
}
