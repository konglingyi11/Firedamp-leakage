import JSZip from 'jszip'

/** 样本 iqdata 命名：样本{编号}_{0|1}_iqdata.csv，中间 0/1 为真值 */
export const IQDATA_SAMPLE_FILE_RE = /^样本\d+_[01]_iqdata\.csv$/i

export function isIqdataSampleFileName(name) {
  return IQDATA_SAMPLE_FILE_RE.test(String(name || '').trim())
}

/** 从 iqdata 文件名提取样本前缀，例如 样本061_1_iqdata.csv -> 样本061 */
export function extractSamplePrefixFromFileName(fileName) {
  const basename = extractPathBasename(fileName)
  const match = basename.match(/^(.+?)_[01]_iqdata\.csv$/i)
  if (match) return match[1]
  return basename.replace(/\.csv$/i, '') || basename
}

/** 从文件名解析真值：_0_ = 无生命体征，_1_ = 有生命体征 */
export function parseIqdataTruthHasVitalSign(fileName) {
  const match = String(fileName || '').trim().match(/_(0|1)_iqdata\.csv$/i)
  if (!match) return null
  return match[1] === '1'
}

export function extractPathBasename(path) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || ''
}

export function extractDatasetFolderFromPath(path) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return parts[parts.length - 2]
}

export function extractDatasetFolders(paths) {
  const folders = new Set()
  for (const path of paths) {
    const folder = extractDatasetFolderFromPath(path)
    if (folder) folders.add(folder)
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export function countIqdataSampleFilesFromPaths(paths) {
  const matched = []
  for (const path of paths) {
    const name = extractPathBasename(path)
    if (isIqdataSampleFileName(name)) {
      matched.push(path)
    }
  }
  return {
    count: matched.length,
    paths: matched,
    datasetFolders: extractDatasetFolders(matched),
  }
}

export function countIqdataFromFileList(files) {
  const paths = files.map((file) => file.webkitRelativePath || file.name)
  return countIqdataSampleFilesFromPaths(paths)
}

export async function listZipEntryNames(file) {
  const zip = await JSZip.loadAsync(file)
  const names = []
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) {
      names.push(relativePath)
    }
  })
  return names
}

export async function countIqdataFromZipFile(file) {
  const paths = await listZipEntryNames(file)
  return countIqdataSampleFilesFromPaths(paths)
}

export function getUploadDatasetType(file) {
  const name = String(file?.name || '').toLowerCase()
  if (name.endsWith('.zip')) return 'zip'
  return 'file'
}

export function createEmptyScanState() {
  return {
    scanning: false,
    iqdataCount: 0,
    iqdataPaths: [],
    datasetFolders: [],
    error: null,
  }
}

export async function scanDatasetForIqdataSamples(dataset) {
  if (dataset.type === 'folder') {
    return countIqdataFromFileList(dataset.files)
  }
  if (dataset.type === 'zip') {
    return await countIqdataFromZipFile(dataset.file)
  }
  if (dataset.type === 'file' && isIqdataSampleFileName(dataset.file?.name)) {
    return {
      count: 1,
      paths: [dataset.file.name],
      datasetFolders: [],
    }
  }
  return {
    count: 0,
    paths: [],
    datasetFolders: [],
  }
}

export function formatIqdataScanSummary(scan) {
  if (!scan) return '--'
  if (scan.scanning) return '扫描中...'
  if (scan.error) return '扫描失败'
  if (!scan.iqdataCount) return '0 个'
  return `${scan.iqdataCount} 个`
}

export function canUseDirectoryPicker() {
  return typeof window.showDirectoryPicker === 'function'
}

export async function collectFilesFromDirectoryHandle(dirHandle, relativePrefix) {
  const files = []
  for await (const [name, handle] of dirHandle.entries()) {
    const relPath = `${relativePrefix}/${name}`
    if (handle.kind === 'file') {
      const file = await handle.getFile()
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relPath,
        configurable: true,
      })
      files.push(file)
    } else if (handle.kind === 'directory') {
      const nested = await collectFilesFromDirectoryHandle(handle, relPath)
      files.push(...nested)
    }
  }
  return files
}
