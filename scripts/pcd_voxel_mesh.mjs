import fs from 'node:fs'
import path from 'node:path'

const inputPath = process.argv[2] || 'public/pcd/rgb_pt.pcd'
const outDir = process.argv[3] || 'output/pcd_mesh'
const voxelSize = Number(process.argv[4] || 0.08)
const maxVoxels = Number(process.argv[5] || 350000)

const absoluteInput = path.resolve(inputPath)
const absoluteOutDir = path.resolve(outDir)

const data = fs.readFileSync(absoluteInput)
const marker = Buffer.from('DATA binary\n')
const dataStart = data.indexOf(marker)

if (dataStart < 0) {
  throw new Error('Only binary PCD files with a DATA binary header are supported.')
}

const payloadOffset = dataStart + marker.length
const header = data.subarray(0, payloadOffset).toString('ascii')
const metadata = Object.fromEntries(
  header
    .trim()
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [key, ...values] = line.trim().split(/\s+/)
      return [key, values]
    }),
)

const fields = metadata.FIELDS || []
const sizes = (metadata.SIZE || []).map(Number)
const types = metadata.TYPE || []
const counts = (metadata.COUNT || []).map(Number)
const points = Number(metadata.POINTS?.[0] || metadata.WIDTH?.[0])

if (!fields.includes('x') || !fields.includes('y') || !fields.includes('z')) {
  throw new Error(`PCD file must include x, y, z fields. Found: ${fields.join(' ')}`)
}

const offsets = new Map()
let stride = 0
for (let i = 0; i < fields.length; i += 1) {
  offsets.set(fields[i], stride)
  stride += sizes[i] * (counts[i] || 1)
}

if (!Number.isFinite(points) || points <= 0 || stride <= 0) {
  throw new Error('Invalid PCD header: missing point count or field sizes.')
}

const readField = (offset, field) => {
  const fieldIndex = fields.indexOf(field)
  const fieldOffset = offsets.get(field)
  if (fieldOffset == null) return 0
  const type = types[fieldIndex]
  const size = sizes[fieldIndex]
  const at = offset + fieldOffset

  if (type === 'F' && size === 4) return data.readFloatLE(at)
  if (type === 'U' && size === 4) return data.readUInt32LE(at)
  if (type === 'I' && size === 4) return data.readInt32LE(at)
  throw new Error(`Unsupported field type for ${field}: ${type}${size}`)
}

const voxels = new Map()
const colorSums = new Map()
let step = 1

while (true) {
  voxels.clear()
  colorSums.clear()

  for (let i = 0; i < points; i += step) {
    const offset = payloadOffset + i * stride
    if (offset + stride > data.length) break

    const x = readField(offset, 'x')
    const y = readField(offset, 'y')
    const z = readField(offset, 'z')

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue

    const ix = Math.floor(x / voxelSize)
    const iy = Math.floor(y / voxelSize)
    const iz = Math.floor(z / voxelSize)
    const key = `${ix},${iy},${iz}`
    voxels.set(key, [ix, iy, iz])

    if (fields.includes('rgb')) {
      const rgb = readField(offset, 'rgb')
      const r = (rgb >> 16) & 255
      const g = (rgb >> 8) & 255
      const b = rgb & 255
      const color = colorSums.get(key) || [0, 0, 0, 0]
      color[0] += r
      color[1] += g
      color[2] += b
      color[3] += 1
      colorSums.set(key, color)
    }
  }

  if (voxels.size <= maxVoxels || step > 256) break
  step *= 2
}

fs.mkdirSync(absoluteOutDir, { recursive: true })

const objPath = path.join(absoluteOutDir, 'rgb_pt_voxel_mesh.obj')
const mtlPath = path.join(absoluteOutDir, 'rgb_pt_voxel_mesh.mtl')
const summaryPath = path.join(absoluteOutDir, 'rgb_pt_voxel_mesh_summary.json')

const directions = [
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
]

const materials = new Map()
let vertexIndex = 1
let faceCount = 0
const obj = fs.createWriteStream(objPath)

obj.write('# Voxel surface mesh generated from rgb_pt.pcd\n')
obj.write(`mtllib ${path.basename(mtlPath)}\n`)

const getMaterial = (key) => {
  const color = colorSums.get(key)
  if (!color) return 'mat_default'
  const r = Math.round(color[0] / color[3] / 32) * 32
  const g = Math.round(color[1] / color[3] / 32) * 32
  const b = Math.round(color[2] / color[3] / 32) * 32
  const material = `mat_${r}_${g}_${b}`
  materials.set(material, [r / 255, g / 255, b / 255])
  return material
}

let currentMaterial = ''
for (const [key, voxel] of voxels) {
  const [ix, iy, iz] = voxel
  const material = getMaterial(key)

  for (const direction of directions) {
    const neighbor = `${ix + direction.n[0]},${iy + direction.n[1]},${iz + direction.n[2]}`
    if (voxels.has(neighbor)) continue

    if (material !== currentMaterial) {
      obj.write(`usemtl ${material}\n`)
      currentMaterial = material
    }

    const indices = []
    for (const corner of direction.corners) {
      const x = (ix + corner[0]) * voxelSize
      const y = (iy + corner[1]) * voxelSize
      const z = (iz + corner[2]) * voxelSize
      obj.write(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}\n`)
      indices.push(vertexIndex)
      vertexIndex += 1
    }

    obj.write(`f ${indices[0]} ${indices[1]} ${indices[2]}\n`)
    obj.write(`f ${indices[0]} ${indices[2]} ${indices[3]}\n`)
    faceCount += 2
  }
}

await new Promise((resolve) => obj.end(resolve))

let mtl = '# Quantized point colors\nnewmtl mat_default\nKd 0.8 0.8 0.8\n'
for (const [name, color] of materials) {
  mtl += `newmtl ${name}\nKd ${color.map((value) => value.toFixed(4)).join(' ')}\n`
}
fs.writeFileSync(mtlPath, mtl)

const summary = {
  input: absoluteInput,
  points,
  stride,
  voxelSize,
  sampledEvery: step,
  occupiedVoxels: voxels.size,
  vertices: vertexIndex - 1,
  triangles: faceCount,
  obj: objPath,
  mtl: mtlPath,
}

fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
