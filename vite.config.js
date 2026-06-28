import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import fs from 'fs'
import path from 'path'

const cesiumSource = 'node_modules/cesium/Build/Cesium'
const cesiumBaseUrl = 'cesiumStatic'
const objModelManifestUrl = '/__obj-models.json'
const plyModelManifestUrl = '/__ply-models.json'
const lasModelManifestUrl = '/__las-models.json'
const splatModelManifestUrl = '/__splat-models.json'
const objModelDirs = ['obj', 'models']

function encodeUrlPath(parts) {
  return `/${parts.map((part) => encodeURIComponent(part)).join('/')}`
}

function readReferencedMtl(objPath) {
  try {
    const text = fs.readFileSync(objPath, 'utf8')
    const match = text.match(/^mtllib\s+(.+)$/m)
    return match?.[1]?.trim() || ''
  } catch {
    return ''
  }
}

function scanObjModelDir(publicDir, dirName) {
  const root = path.join(publicDir, dirName)
  if (!fs.existsSync(root)) {
    return { dir: dirName, exists: false, files: [], models: [] }
  }

  const files = []

  function walk(currentDir, relativeDir = '') {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath, path.join(relativeDir, entry.name))
        continue
      }

      const extension = path.extname(entry.name).toLowerCase()
      if (extension !== '.obj' && extension !== '.mtl') {
        continue
      }

      const relativeParts = relativeDir ? relativeDir.split(path.sep) : []
      const publicParts = [dirName, ...relativeParts, entry.name]
      const stats = fs.statSync(entryPath)
      files.push({
        name: entry.name,
        relativeDir: relativeParts.join('/'),
        extension: extension.slice(1),
        url: encodeUrlPath(publicParts),
        requestFile: encodeURIComponent(entry.name),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        absPath: entryPath,
      })
    }
  }

  walk(root)

  const mtls = files.filter((file) => file.extension === 'mtl')
  const models = files
    .filter((file) => file.extension === 'obj')
    .map((obj) => {
      const objBaseName = path.basename(obj.name, path.extname(obj.name))
      const referencedMtl = readReferencedMtl(obj.absPath)
      const mtl =
        mtls.find((file) => file.relativeDir === obj.relativeDir && file.name === referencedMtl) ||
        mtls.find(
          (file) =>
            file.relativeDir === obj.relativeDir &&
            path.basename(file.name, path.extname(file.name)) === objBaseName,
        ) ||
        null
      const relativeParts = obj.relativeDir ? obj.relativeDir.split('/') : []
      const baseUrl = `${encodeUrlPath([dirName, ...relativeParts])}/`

      return {
        name: objBaseName,
        directory: dirName,
        baseUrl,
        objFile: obj.name,
        objRequestFile: obj.requestFile,
        objUrl: obj.url,
        mtlFile: mtl?.name || '',
        mtlRequestFile: mtl?.requestFile || '',
        mtlUrl: mtl?.url || '',
      }
    })

  return {
    dir: dirName,
    exists: true,
    files: files.map(({ absPath, ...file }) => file),
    models,
  }
}

function createObjModelManifest() {
  const publicDir = path.resolve(process.cwd(), 'public')
  const directories = objModelDirs.map((dirName) => scanObjModelDir(publicDir, dirName))
  return {
    generatedAt: new Date().toISOString(),
    directories,
    models: directories.flatMap((directory) => directory.models),
  }
}

function scanPlyModelDir(publicDir) {
  const dirName = 'ply'
  const root = path.join(publicDir, dirName)
  if (!fs.existsSync(root)) {
    return { dir: dirName, exists: false, files: [] }
  }

  const files = []

  function walk(currentDir, relativeDir = '') {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath, path.join(relativeDir, entry.name))
        continue
      }

      if (path.extname(entry.name).toLowerCase() !== '.ply') {
        continue
      }

      const relativeParts = relativeDir ? relativeDir.split(path.sep) : []
      const publicParts = [dirName, ...relativeParts, entry.name]
      const stats = fs.statSync(entryPath)
      files.push({
        name: path.basename(entry.name, path.extname(entry.name)),
        fileName: entry.name,
        relativeDir: relativeParts.join('/'),
        directory: dirName,
        url: encodeUrlPath(publicParts),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      })
    }
  }

  walk(root)
  files.sort((a, b) => a.url.localeCompare(b.url))
  return { dir: dirName, exists: true, files }
}

function createPlyModelManifest() {
  const publicDir = path.resolve(process.cwd(), 'public')
  const directory = scanPlyModelDir(publicDir)
  return {
    generatedAt: new Date().toISOString(),
    directory,
    files: directory.files,
  }
}

function scanLasModelDir(publicDir) {
  const dirName = 'las'
  const root = path.join(publicDir, dirName)
  if (!fs.existsSync(root)) {
    return { dir: dirName, exists: false, files: [] }
  }

  const files = []

  function walk(currentDir, relativeDir = '') {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath, path.join(relativeDir, entry.name))
        continue
      }

      if (path.extname(entry.name).toLowerCase() !== '.las') {
        continue
      }

      const relativeParts = relativeDir ? relativeDir.split(path.sep) : []
      const publicParts = [dirName, ...relativeParts, entry.name]
      const stats = fs.statSync(entryPath)
      files.push({
        name: path.basename(entry.name, path.extname(entry.name)),
        fileName: entry.name,
        relativeDir: relativeParts.join('/'),
        directory: dirName,
        url: encodeUrlPath(publicParts),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      })
    }
  }

  walk(root)
  files.sort((a, b) => a.url.localeCompare(b.url))
  return { dir: dirName, exists: true, files }
}

function createLasModelManifest() {
  const publicDir = path.resolve(process.cwd(), 'public')
  const directory = scanLasModelDir(publicDir)
  return {
    generatedAt: new Date().toISOString(),
    directory,
    files: directory.files,
  }
}

function scanSplatModelDir(publicDir) {
  const dirName = 'splat'
  const root = path.join(publicDir, dirName)
  if (!fs.existsSync(root)) {
    return { dir: dirName, exists: false, files: [] }
  }

  const files = []

  function walk(currentDir, relativeDir = '') {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath, path.join(relativeDir, entry.name))
        continue
      }

      if (path.extname(entry.name).toLowerCase() !== '.splat') {
        continue
      }

      const relativeParts = relativeDir ? relativeDir.split(path.sep) : []
      const publicParts = [dirName, ...relativeParts, entry.name]
      const stats = fs.statSync(entryPath)
      files.push({
        name: path.basename(entry.name, path.extname(entry.name)),
        fileName: entry.name,
        relativeDir: relativeParts.join('/'),
        directory: dirName,
        url: encodeUrlPath(publicParts),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      })
    }
  }

  walk(root)
  files.sort((a, b) => a.url.localeCompare(b.url))
  return { dir: dirName, exists: true, files }
}

function createSplatModelManifest() {
  const publicDir = path.resolve(process.cwd(), 'public')
  const directory = scanSplatModelDir(publicDir)
  return {
    generatedAt: new Date().toISOString(),
    directory,
    files: directory.files,
  }
}

function objModelManifestPlugin() {
  return {
    name: 'obj-model-manifest',
    configureServer(server) {
      server.middlewares.use(objModelManifestUrl, (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(createObjModelManifest()))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: objModelManifestUrl.slice(1),
        source: JSON.stringify(createObjModelManifest()),
      })
    },
  }
}

function plyModelManifestPlugin() {
  return {
    name: 'ply-model-manifest',
    configureServer(server) {
      server.middlewares.use(plyModelManifestUrl, (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(createPlyModelManifest()))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: plyModelManifestUrl.slice(1),
        source: JSON.stringify(createPlyModelManifest()),
      })
    },
  }
}

function lasModelManifestPlugin() {
  return {
    name: 'las-model-manifest',
    configureServer(server) {
      server.middlewares.use(lasModelManifestUrl, (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(createLasModelManifest()))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: lasModelManifestUrl.slice(1),
        source: JSON.stringify(createLasModelManifest()),
      })
    },
  }
}

function splatModelManifestPlugin() {
  return {
    name: 'splat-model-manifest',
    configureServer(server) {
      server.middlewares.use(splatModelManifestUrl, (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(createSplatModelManifest()))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: splatModelManifestUrl.slice(1),
        source: JSON.stringify(createSplatModelManifest()),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget =
    env.VITE_DEV_API_PROXY_TARGET ||
    env.VITE_API_BASE_URL ||
    'http://localhost:8000'

  return {
    define: {
      CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
    },
    plugins: [
      vue(),
      objModelManifestPlugin(),
      plyModelManifestPlugin(),
      lasModelManifestPlugin(),
      splatModelManifestPlugin(),
      viteStaticCopy({
        targets: [
          { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
          { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
          { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
          { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
          {
            src: 'node_modules/three/examples/jsm/libs/draco/gltf/*',
            dest: 'draco/gltf',
          },
        ],
      }),
    ],
    server: {
      host: '0.0.0.0', // 关键配置：监听所有网络接口
      port: 8011,       // 你的端口号
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    },
    build: {
      rollupOptions: {
        input: 'index.html',
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('element-plus') || id.includes('@element-plus')) {
              return 'vendor-element-plus'
            }
            if (id.includes('three')) return 'vendor-three'
            if (id.includes('@kitware/vtk.js')) return 'vendor-vtk'
            if (id.includes('echarts')) return 'vendor-echarts'
            if (id.includes('vue') || id.includes('pinia')) return 'vendor-vue'
            return 'vendor'
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    }
  }
})
