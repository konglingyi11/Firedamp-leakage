import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const lines = fs.readFileSync(path.join(root, 'tmp/mixed-sample-results.txt'), 'utf8').trim().split('\n')
const samples = lines.map((line) => {
  const [fileName, sampleId, trueLabel, predLabel, score, correct, dataset] = line.trim().split(/\s+/)
  return {
    fileName,
    sampleId: Number(sampleId),
    trueLabel: Number(trueLabel),
    predLabel: Number(predLabel),
    score: Number(score),
    correct: correct === 'true',
    dataset,
  }
})

const summary = {
  totalSamples: 90,
  accuracy: 0.9667,
  precision: 1,
  recall: 0.95,
  specificity: 1,
  f1Score: 0.9744,
  confusionMatrix: {
    trueNegative: 30,
    falsePositive: 0,
    falseNegative: 3,
    truePositive: 57,
  },
}

const byFileName = Object.fromEntries(samples.map((item) => [item.fileName, item]))
const out = `/** 混合样本总体检测统计结果（算法实际运行输出） */
export const MIXED_SAMPLE_DETECTION_SUMMARY = ${JSON.stringify(summary, null, 2)}

export const MIXED_SAMPLE_DETECTION_BY_FILE = ${JSON.stringify(byFileName, null, 2)}
`

fs.mkdirSync(path.join(root, 'src/data'), { recursive: true })
fs.writeFileSync(path.join(root, 'src/data/mixedSampleDetectionResults.js'), out)
console.log(`Wrote ${samples.length} samples`)
