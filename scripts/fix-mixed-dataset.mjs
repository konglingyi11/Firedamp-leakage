import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { MIXED_SAMPLE_IQDATA_FILES } from '../src/data/mixedSampleDetectionResults.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/dataset')

function walk(dir, rel = '') {
  const entries = []
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const relPath = rel ? `${rel}/${name}` : name
    if (fs.statSync(abs).isDirectory()) {
      entries.push(...walk(abs, relPath))
    } else {
      entries.push({ abs, rel: relPath.replace(/\\/g, '/'), name })
    }
  }
  return entries
}

// 4m 下误放的 031-036（算法里这些样本属于 5m）
for (const id of ['031', '032', '033', '034', '035', '036']) {
  for (const ext of ['iqdata', 'amplitude', 'phase']) {
    const file = path.join(root, '4m', `样本${id}_1_${ext}.csv`)
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
      console.log('removed', path.relative(root, file))
    }
  }
}

// 6m 下 051-060 应为 081-090
for (let i = 51; i <= 60; i += 1) {
  const oldId = String(i).padStart(3, '0')
  const newId = String(i + 30).padStart(3, '0')
  for (const ext of ['iqdata', 'amplitude', 'phase']) {
    const oldFile = path.join(root, '6m', `样本${oldId}_1_${ext}.csv`)
    const newFile = path.join(root, '6m', `样本${newId}_1_${ext}.csv`)
    if (fs.existsSync(oldFile)) {
      fs.renameSync(oldFile, newFile)
      console.log('renamed', `6m/样本${oldId}_1_${ext}.csv`, '->', `6m/样本${newId}_1_${ext}.csv`)
    }
  }
}

const iqdataFiles = walk(root).filter((item) => item.name.endsWith('_iqdata.csv'))
const names = iqdataFiles.map((item) => item.name)
const inWhitelist = names.filter((name) => MIXED_SAMPLE_IQDATA_FILES.has(name))
const extra = names.filter((name) => !MIXED_SAMPLE_IQDATA_FILES.has(name))
const missing = [...MIXED_SAMPLE_IQDATA_FILES].filter((name) => !names.includes(name))

console.log('iqdata total', names.length)
console.log('whitelist match', inWhitelist.length)
console.log('extra', extra.length, extra.join(', ') || '(none)')
console.log('missing', missing.length, missing.join(', ') || '(none)')
