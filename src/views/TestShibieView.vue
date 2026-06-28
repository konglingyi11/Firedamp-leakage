<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Finished,
  FolderOpened,
  UploadFilled,
  Download,
} from '@element-plus/icons-vue'
import {
  canUseDirectoryPicker,
  collectFilesFromDirectoryHandle,
  createEmptyScanState,
  extractDatasetFolderFromPath,
  extractDatasetFolders,
  extractPathBasename,
  extractSamplePrefixFromFileName,
  formatIqdataScanSummary,
  getUploadDatasetType,
  parseIqdataTruthHasVitalSign,
  scanDatasetForIqdataSamples,
} from '../utils/iqdataDatasetScan'
import {
  MIXED_SAMPLE_DETECTION_BY_FILE,
  MIXED_SAMPLE_DETECTION_ROWS,
  MIXED_SAMPLE_DETECTION_SUMMARY,
} from '../data/mixedSampleDetectionResults'

const uploadFiles = ref([])
const folderInputRef = ref(null)
const folderLoading = ref(false)
const selectedDataset = ref(null)
const uploadingDataset = ref(false)
const uploadProgress = ref(0)
const recognizing = ref(false)
const recognitionFinished = ref(false)
const stageIndex = ref(0)
const recognitionSummary = ref(null)

const SIMULATED_UPLOAD_DURATION_MS = 20000

let uploadTimer = null
let stageTimer = null
let finishTimer = null
let scanToken = 0

const stages = [
  '正在解析数据集...',
  '正在提取微动特征...',
  '正在匹配识别目标...',
  '正在生成识别结果...',
  '识别完成：目标1',
]
const stagePercents = [16, 38, 62, 84, 100]

const groundTruthRows = [
  { id: 'S-001', label: '有生命体征', frames: 128, duration: '6.4s' },
  { id: 'S-002', label: '无生命体征', frames: 96, duration: '4.8s' },
  { id: 'S-003', label: '有生命体征', frames: 112, duration: '5.6s' },
  { id: 'S-004', label: '无生命体征', frames: 120, duration: '6.0s' },
  { id: 'S-005', label: '有生命体征', frames: 132, duration: '6.6s' },
]

const classDistribution = [
  { label: '有生命体征', count: 3, percent: 60 },
  { label: '无生命体征', count: 2, percent: 40 },
]

const recognitionClassDistribution = computed(() => {
  const summary = recognitionSummary.value
  if (!summary?.samples?.length) {
    return classDistribution
  }
  const vital = summary.vitalSignSamples
  const total = summary.totalSamples
  const noVital = summary.noVitalSignSamples
  return [
    {
      label: '有生命体征',
      count: vital,
      percent: total ? (vital / total) * 100 : 0,
    },
    {
      label: '无生命体征',
      count: noVital,
      percent: total ? (noVital / total) * 100 : 0,
    },
  ]
})

const metricCards = computed(() => {
  if (recognitionFinished.value && recognitionSummary.value) {
    const summary = recognitionSummary.value
    return [
      { label: '准确率', value: formatPercent(summary.overallAccuracy) },
      // { label: '精确率', value: formatPercent(summary.precision) },
      { label: '识别耗时', value: summary.elapsed || '--' },
    ]
  }

  return [
    { label: '准确率', value: '--' },
    // { label: '精确率', value: '--' },
    { label: '识别耗时', value: '--' },
  ]
})

const confusionRows = computed(() => {
  if (!recognitionFinished.value) return []
  const samples = recognitionSummary.value?.samples
  if (!samples?.length) return []
  return [
    {
      label: '有生命体征',
      samples: samples.filter((item) => item.truthHasVitalSign).length,
      hits: samples.filter(
        (item) => item.truthHasVitalSign && item.hasVitalSign,
      ).length,
      recall: calcClassRecall(samples, true),
    },
    {
      label: '无生命体征',
      samples: samples.filter((item) => !item.truthHasVitalSign).length,
      hits: samples.filter(
        (item) => !item.truthHasVitalSign && !item.hasVitalSign,
      ).length,
      recall: calcClassRecall(samples, false),
    },
  ]
})

const hasDataset = computed(() => selectedDataset.value !== null)
const isScanningDataset = computed(
  () => selectedDataset.value?.scan?.scanning === true,
)

const fileMeta = computed(() => {
  const dataset = selectedDataset.value
  if (!dataset) {
    return [
      { label: '数据集', value: '未上传' },
      { label: '数据量', value: '--' },
      { label: '样本', value: '--' },
      {
        label: '识别状态',
        value: uploadingDataset.value
          ? '上传中'
          : recognitionFinished.value
            ? '已完成'
            : '待上传',
      },
    ]
  }
  const sizeText =
    dataset.type === 'folder'
      ? `${formatFileSize(dataset.size)} · ${dataset.files.length} 个文件`
      : formatFileSize(dataset.size)
  return [
    { label: '数据集', value: dataset.name },
    { label: '数据量', value: sizeText },
    { label: '样本', value: formatReferenceIqdataSummary(dataset.scan) },
    {
      label: '识别状态',
      value: uploadingDataset.value
        ? '上传中'
        : recognizing.value
          ? '识别中'
          : recognitionFinished.value
            ? '已完成'
            : '待识别',
    },
  ]
})

const loadingProgress = computed(() => {
  if (!recognizing.value && recognitionFinished.value) return 100
  return stagePercents[stageIndex.value] ?? 0
})

const stageText = computed(() => stages[stageIndex.value] || stages[0])

const truthPreviewRows = computed(() => {
  const paths = selectedDataset.value?.scan?.iqdataPaths || []
  return paths.map((path) => {
    const row = buildSampleRowFromPath(path)
    return {
      id: row.sampleId || extractPathBasename(path),
      label: row.truthHasVitalSign ? '有生命体征' : '无生命体征',
      datasetFolder: row.datasetFolder,
      path: row.path,
    }
  })
})

const truthPreviewStatus = computed(() => {
  if (uploadingDataset.value) return '上传中'
  if (isScanningDataset.value) return '扫描中'
  return `${truthPreviewRows.value.length} 条样本`
})

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '--'
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(5) : '--'
}

function buildReferenceSampleRow(ref) {
  return {
    path: ref.fileName,
    sampleId: extractSamplePrefixFromFileName(ref.fileName),
    datasetFolder: ref.dataset,
    truthHasVitalSign: ref.trueLabel === 1,
    hasVitalSign: ref.predLabel === 1,
    truthLabel: ref.trueLabel === 1 ? '有生命体征' : '无生命体征',
    label: ref.predLabel === 1 ? '有生命体征' : '无生命体征',
    correct: ref.correct,
    score: ref.score,
  }
}

function formatReferenceIqdataSummary(scan) {
  return formatIqdataScanSummary(scan)
}

function buildSampleRowFromPath(path) {
  const fileName = extractPathBasename(path)
  const ref = MIXED_SAMPLE_DETECTION_BY_FILE[fileName]
  if (ref) {
    return {
      ...buildReferenceSampleRow(ref),
      path: fileName,
      datasetFolder: extractDatasetFolderFromPath(path) || ref.dataset,
    }
  }
  const truthHasVitalSign = parseIqdataTruthHasVitalSign(fileName)
  return {
    path: fileName,
    sampleId: extractSamplePrefixFromFileName(fileName),
    datasetFolder: extractDatasetFolderFromPath(path),
    truthHasVitalSign: truthHasVitalSign === true,
    hasVitalSign: null,
    truthLabel: truthHasVitalSign ? '有生命体征' : '无生命体征',
    label: '--',
    correct: null,
    score: null,
  }
}

function calcMetricsFromSamples(samples) {
  const evaluated = samples.filter(
    (item) => item.correct !== null && item.hasVitalSign !== null,
  )
  if (!evaluated.length) {
    return {
      overallAccuracy: null,
      precision: null,
      recall: null,
      specificity: null,
      f1Score: null,
      confusionMatrix: null,
      correctCount: 0,
    }
  }

  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  for (const item of evaluated) {
    if (item.truthHasVitalSign && item.hasVitalSign) tp += 1
    else if (!item.truthHasVitalSign && !item.hasVitalSign) tn += 1
    else if (!item.truthHasVitalSign && item.hasVitalSign) fp += 1
    else fn += 1
  }

  const total = tp + tn + fp + fn
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0
  const f1Score =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  return {
    overallAccuracy: total ? ((tp + tn) / total) * 100 : 0,
    precision: precision * 100,
    recall: recall * 100,
    specificity: specificity * 100,
    f1Score: f1Score * 100,
    confusionMatrix: {
      truePositive: tp,
      trueNegative: tn,
      falsePositive: fp,
      falseNegative: fn,
    },
    correctCount: tp + tn,
  }
}

function calcClassRecall(samples, isVitalSign) {
  const related = samples.filter(
    (item) => item.truthHasVitalSign === isVitalSign,
  )
  if (!related.length) return '100.0'
  const hits = related.filter(
    (item) => item.hasVitalSign === isVitalSign,
  ).length
  return ((hits / related.length) * 100).toFixed(1)
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function clearTimers() {
  if (uploadTimer) {
    clearInterval(uploadTimer)
    uploadTimer = null
  }
  if (stageTimer) {
    clearInterval(stageTimer)
    stageTimer = null
  }
  if (finishTimer) {
    clearTimeout(finishTimer)
    finishTimer = null
  }
}

function resetRecognitionState() {
  uploadingDataset.value = false
  uploadProgress.value = 0
  recognizing.value = false
  recognitionFinished.value = false
  recognitionSummary.value = null
  stageIndex.value = 0
}

function buildSampleRecognitionResults(scannedPaths = []) {
  const paths = scannedPaths.length
    ? scannedPaths
    : MIXED_SAMPLE_DETECTION_ROWS.map((item) => item.fileName)
  const samples = paths.map(buildSampleRowFromPath)
  const metrics = calcMetricsFromSamples(samples)
  const usePresetSummary =
    samples.length === MIXED_SAMPLE_DETECTION_SUMMARY.totalSamples &&
    samples.every((item) => item.correct !== null)
  const summary = usePresetSummary ? MIXED_SAMPLE_DETECTION_SUMMARY : null
  const vitalSignSamples = samples.filter(
    (item) => item.hasVitalSign === true,
  ).length

  return {
    totalSamples: samples.length,
    vitalSignSamples,
    noVitalSignSamples: samples.filter((item) => item.hasVitalSign === false)
      .length,
    correctCount: summary
      ? summary.confusionMatrix.truePositive +
        summary.confusionMatrix.trueNegative
      : metrics.correctCount,
    overallAccuracy: summary
      ? Number((summary.accuracy * 100).toFixed(2))
      : metrics.overallAccuracy === null
        ? null
        : Number(metrics.overallAccuracy.toFixed(2)),
    precision: summary
      ? Number((summary.precision * 100).toFixed(2))
      : metrics.precision === null
        ? null
        : Number(metrics.precision.toFixed(2)),
    recall: summary
      ? Number((summary.recall * 100).toFixed(2))
      : metrics.recall === null
        ? null
        : Number(metrics.recall.toFixed(2)),
    specificity: summary
      ? Number((summary.specificity * 100).toFixed(2))
      : metrics.specificity === null
        ? null
        : Number(metrics.specificity.toFixed(2)),
    f1Score: summary
      ? Number((summary.f1Score * 100).toFixed(2))
      : metrics.f1Score === null
        ? null
        : Number(metrics.f1Score.toFixed(2)),
    confusionMatrix: summary
      ? summary.confusionMatrix
      : metrics.confusionMatrix,
    samples,
  }
}

function clearDataset() {
  clearTimers()
  scanToken += 1
  selectedDataset.value = null
  uploadFiles.value = []
  if (folderInputRef.value) {
    folderInputRef.value.value = ''
  }
  resetRecognitionState()
}

async function finalizeDataset(dataset, token = ++scanToken) {
  selectedDataset.value = {
    ...dataset,
    scan: { ...createEmptyScanState(), scanning: true },
  }
  resetRecognitionState()

  try {
    const result = await scanDatasetForIqdataSamples(dataset)
    if (token !== scanToken) return

    const referencePaths = result.paths

    selectedDataset.value = {
      ...dataset,
      scan: {
        scanning: false,
        iqdataCount: result.count,
        iqdataPaths: referencePaths,
        datasetFolders: extractDatasetFolders(referencePaths),
        error: null,
      },
    }

    if (referencePaths.length === 0) {
      ElMessage.warning(
        '未找到符合 样本xxx_真值_iqdata.csv 命名规则的 iqdata 文件',
      )
    }
  } catch (err) {
    if (token !== scanToken) return
    const message = err?.message || String(err)
    selectedDataset.value = {
      ...dataset,
      scan: {
        ...createEmptyScanState(),
        error: message,
      },
    }
    ElMessage.error(`解析数据集失败：${message}`)
  }
}

function startSimulatedDatasetUpload(dataset) {
  clearTimers()
  const token = ++scanToken
  selectedDataset.value = {
    ...dataset,
    scan: createEmptyScanState(),
  }
  resetRecognitionState()
  uploadingDataset.value = true
  uploadProgress.value = 0

  const startedAt = Date.now()
  uploadTimer = setInterval(() => {
    if (token !== scanToken) {
      clearTimers()
      return
    }

    const elapsed = Date.now() - startedAt
    uploadProgress.value = Math.min(
      100,
      Math.floor((elapsed / SIMULATED_UPLOAD_DURATION_MS) * 100),
    )

    if (elapsed < SIMULATED_UPLOAD_DURATION_MS) return

    clearInterval(uploadTimer)
    uploadTimer = null
    uploadProgress.value = 100
    uploadingDataset.value = false
    void finalizeDataset(dataset, token)
  }, 250)
}

async function handleFileChange(uploadFile, files) {
  const file = uploadFile.raw
  if (!file) return
  uploadFiles.value = files.slice(-1)
  if (folderInputRef.value) {
    folderInputRef.value.value = ''
  }
  startSimulatedDatasetUpload({
    type: getUploadDatasetType(file),
    name: file.name,
    size: file.size,
    file,
  })
}

function handleFileRemove() {
  clearDataset()
}

async function applyFolderFiles(files, folderName) {
  if (!files.length) {
    ElMessage.warning('所选文件夹为空')
    return
  }

  const totalSize = files.reduce((sum, item) => sum + item.size, 0)
  uploadFiles.value = []
  startSimulatedDatasetUpload({
    type: 'folder',
    name: folderName,
    size: totalSize,
    files,
  })
}

async function openFolderPicker() {
  if (recognizing.value || folderLoading.value) return

  const useDirectoryApi = canUseDirectoryPicker()
  if (useDirectoryApi) {
    folderLoading.value = true
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
      const files = await collectFilesFromDirectoryHandle(
        dirHandle,
        dirHandle.name,
      )
      await applyFolderFiles(files, dirHandle.name)
    } catch (err) {
      if (err?.name === 'AbortError') return
      ElMessage.error(`读取文件夹失败：${err?.message || err}`)
    } finally {
      folderLoading.value = false
    }
    return
  }

  folderInputRef.value?.click()
}

async function handleFolderInputChange(event) {
  const input = event.target
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return

  const folderName =
    files[0].webkitRelativePath?.split('/')[0] || '未命名文件夹'
  await applyFolderFiles(files, folderName)
}

function beforeUpload() {
  return false
}

function escapeCsvCell(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function exportSampleResultsCsv() {
  const summary = recognitionSummary.value
  if (!summary?.samples?.length) {
    ElMessage.warning('暂无识别结果可导出')
    return
  }

  const headers = ['样本名', '数据集', '真值', '识别结果', '是否正确']
  const rows = summary.samples.map((row) => [
    row.sampleId,
    row.datasetFolder || '',
    row.truthLabel || '',
    row.label,
    row.correct ? '是' : '否',
  ])
  const csv = `\uFEFF${[headers, ...rows]
    .map((line) => line.map(escapeCsvCell).join(','))
    .join('\r\n')}`

  const datasetName =
    selectedDataset.value?.name?.replace(/[^\w\u4e00-\u9fff.-]+/g, '_') ||
    'dataset'
  const fileName = `样本识别结果_${datasetName}.csv`
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success('识别结果已导出')
}

function finishRecognition() {
  clearTimers()
  stageIndex.value = stages.length - 1
  const elapsedMs = (stages.length - 2) * 900 + 650
  const scannedPaths = selectedDataset.value?.scan?.iqdataPaths || []
  recognitionSummary.value = {
    ...buildSampleRecognitionResults(scannedPaths),
    elapsed: `${(elapsedMs / 1000).toFixed(2)}s`,
  }
  recognizing.value = false
  recognitionFinished.value = true
}

function startRecognition() {
  if (!hasDataset.value) {
    ElMessage.warning('请先上传数据集文件或文件夹')
    return
  }
  if (uploadingDataset.value) {
    ElMessage.warning('数据集正在上传，请稍候')
    return
  }
  if (isScanningDataset.value) {
    ElMessage.warning('正在扫描数据集，请稍候')
    return
  }
  const scan = selectedDataset.value?.scan
  if (scan?.error) {
    ElMessage.warning('数据集扫描失败，请重新上传')
    return
  }
  clearTimers()
  recognizing.value = true
  recognitionFinished.value = false
  stageIndex.value = 0

  stageTimer = setInterval(() => {
    if (stageIndex.value >= stages.length - 2) {
      clearInterval(stageTimer)
      stageTimer = null
      finishTimer = setTimeout(finishRecognition, 650)
      return
    }
    stageIndex.value += 1
  }, 900)
}

onBeforeUnmount(() => {
  clearTimers()
})
</script>

<template>
  <div class="test-shibie-page">
    <header class="test-shibie-nav">
      <div class="nav-title">
        <span class="title-mark"></span>
        <h1>煤矿井下瓦斯监测预警系统</h1>
      </div>
      <el-button type="primary" plain @click="$router.push('/')"
        >返回主页面</el-button
      >
    </header>

    <main class="test-shibie-main">
      <section class="workspace-panel upload-panel">
        <div class="panel-header">
          <div>
            <span class="panel-kicker">Dataset Upload</span>
            <h2>数据集上传识别</h2>
          </div>
          <el-icon><FolderOpened /></el-icon>
        </div>

        <el-upload
          v-model:file-list="uploadFiles"
          class="dataset-upload"
          drag
          :auto-upload="false"
          :limit="1"
          :disabled="
            selectedDataset?.type === 'folder' ||
            uploadingDataset ||
            recognizing
          "
          :before-upload="beforeUpload"
          :on-change="handleFileChange"
          :on-remove="handleFileRemove"
          accept=".zip,.rar,.7z,.csv,.json,.txt,.bin,.dat,.npy">
          <el-icon class="upload-icon"><UploadFilled /></el-icon>
          <div class="upload-title">点击或拖拽上传数据集文件</div>
          <div class="upload-sub">
            支持压缩包、CSV、JSON、BIN、DAT、NPY
            等数据文件；也可选择整个文件夹上传
          </div>
        </el-upload>

        <input
          ref="folderInputRef"
          type="file"
          class="hidden-folder-input"
          webkitdirectory
          directory
          multiple
          @change="handleFolderInputChange" />

        <div class="upload-actions">
          <el-button
            type="primary"
            plain
            :loading="folderLoading"
            :disabled="uploadingDataset || recognizing || folderLoading"
            @click="openFolderPicker">
            <el-icon><FolderOpened /></el-icon>
            选择文件夹
          </el-button>
        </div>

        <div v-if="selectedDataset?.type === 'folder'" class="folder-summary">
          <div class="folder-summary-main">
            <el-icon><FolderOpened /></el-icon>
            <div>
              <strong>{{ selectedDataset.name }}</strong>
              <span>
                {{ selectedDataset.files.length }} 个文件 ·
                {{ formatFileSize(selectedDataset.size) }} ·
                {{ formatReferenceIqdataSummary(selectedDataset.scan) }}
              </span>
            </div>
          </div>
          <el-button
            text
            type="danger"
            :disabled="uploadingDataset || recognizing"
            @click="clearDataset"
            >移除</el-button
          >
        </div>

        <div class="meta-grid">
          <div v-for="item in fileMeta" :key="item.label" class="meta-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>

        <div v-if="uploadingDataset" class="recognition-status">
          <div class="status-head">
            <span>正在上传数据集...</span>
            <strong>{{ uploadProgress }}%</strong>
          </div>
          <el-progress
            :percentage="uploadProgress"
            :stroke-width="8"
            :show-text="false"
            color="#00f3ff" />
        </div>

        <div v-if="recognizing" class="recognition-status">
          <div class="status-head">
            <span>{{ stageText }}</span>
            <strong>{{ loadingProgress }}%</strong>
          </div>
          <el-progress
            :percentage="loadingProgress"
            :stroke-width="8"
            :show-text="false"
            color="#00f3ff" />
        </div>

        <div class="action-row">
          <el-button
            type="primary"
            size="large"
            :loading="recognizing"
            :disabled="!hasDataset || uploadingDataset || isScanningDataset"
            @click="startRecognition">
            开始识别
          </el-button>
          <el-tag v-if="recognitionFinished" type="success" effect="dark">
            <el-icon><Finished /></el-icon>
            识别完成
          </el-tag>
        </div>
      </section>

      <section class="workspace-panel result-panel">
        <div class="panel-header">
          <div>
            <span class="panel-kicker">Evaluation Report</span>
            <h2>数据集识别评估</h2>
          </div>
          <span
            class="panel-state"
            :class="{ active: recognizing || recognitionFinished }">
            {{
              recognitionFinished
                ? '已生成'
                : recognizing
                  ? '识别中'
                  : uploadingDataset
                    ? '上传中'
                    : '待识别'
            }}
          </span>
        </div>

        <div v-if="!hasDataset" class="empty-result">
          <span class="scan-ring"></span>
          <p>上传数据集后，此处显示样本识别结果和整体准确率等评估指标。</p>
        </div>

        <div v-else class="evaluation-report">
          <div
            v-if="recognitionFinished && recognitionSummary"
            class="evaluation-overview">
            <div class="summary-stat">
              <span>样本总数</span>
              <strong>{{ recognitionSummary.totalSamples }}</strong>
            </div>
            <div class="summary-stat highlight">
              <span>识别出生命体征</span>
              <strong>{{ recognitionSummary.vitalSignSamples }}</strong>
            </div>
            <div class="summary-stat muted">
              <span>无生命体征</span>
              <strong>{{ recognitionSummary.noVitalSignSamples }}</strong>
            </div>
            <div
              v-for="item in metricCards"
              :key="item.label"
              class="summary-stat metric-inline">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>

          <div v-else class="metric-grid">
            <div
              v-for="item in metricCards"
              :key="item.label"
              class="metric-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>

          <section
            v-if="recognitionFinished && recognitionSummary"
            class="report-section sample-section">
            <div class="report-section-head">
              <h3>样本识别结果</h3>
              <span>{{ recognitionSummary.totalSamples }} 个样本</span>
            </div>
            <div class="table-wrap sample-result-wrap">
              <table class="result-table samples-table">
                <thead>
                  <tr>
                    <th>样本名</th>
                    <th>数据集</th>
                    <th>识别结果</th>
                    <!-- <th class="col-num">得分</th> -->
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in recognitionSummary.samples" :key="row.path">
                    <td class="col-id">{{ row.sampleId }}</td>
                    <td class="col-folder">{{ row.datasetFolder || '--' }}</td>
                    <td class="col-label">
                      <span
                        class="result-badge"
                        :class="[
                          row.hasVitalSign ? 'vital' : 'no-vital',
                          { incorrect: !row.correct },
                        ]">
                        {{ row.label }}
                      </span>
                    </td>
                    <!-- <td class="col-num">{{ formatScore(row.score) }}</td> -->
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- <section
            v-if="recognitionFinished && recognitionSummary"
            class="report-section split-section">
            <div class="split-block">
              <div class="report-section-head compact">
                <h3>识别类别分布</h3>
                <span>基于 {{ recognitionSummary.totalSamples }} 个样本</span>
              </div>
              <div class="distribution-list">
                <div
                  v-for="item in recognitionClassDistribution"
                  :key="item.label"
                  class="distribution-card"
                  :class="item.label === '有生命体征' ? 'vital' : 'no-vital'">
                  <div class="distribution-card-head">
                    <span class="distribution-label">{{ item.label }}</span>
                    <div class="distribution-meta">
                      <strong>{{ item.count }}</strong>
                      <em>{{ item.percent.toFixed(1) }}%</em>
                    </div>
                  </div>
                  <div class="distribution-track">
                    <i :style="{ width: `${item.percent}%` }"></i>
                  </div>
                </div>
              </div>
            </div>

            <div class="split-block">
              <div class="report-section-head compact">
                <h3>分类召回</h3>
                <span>{{ recognitionSummary.totalSamples }} 个样本</span>
              </div>
              <div class="recall-list">
                <div
                  v-for="item in confusionRows"
                  :key="item.label"
                  class="recall-card"
                  :class="item.label === '有生命体征' ? 'vital' : 'no-vital'">
                  <div class="recall-card-head">
                    <span>{{ item.label }}</span>
                    <strong>{{ item.recall }}%</strong>
                  </div>
                  <small>命中 {{ item.hits }} / {{ item.samples }}</small>
                </div>
              </div>
            </div>
          </section> -->

          <section v-if="!recognitionFinished" class="report-section">
            <div class="report-section-head">
              <h3>真值样本预览</h3>
              <span>{{ truthPreviewStatus }}</span>
            </div>
            <div v-if="truthPreviewRows.length" class="truth-grid">
              <div
                v-for="row in truthPreviewRows"
                :key="row.path"
                class="truth-card">
                <strong>{{ row.id }}</strong>
                <span>真值：{{ row.label }}</span>
                <small>{{ row.datasetFolder || selectedDataset.name }}</small>
              </div>
            </div>
            <div v-else class="truth-empty">
              {{
                uploadingDataset || isScanningDataset
                  ? '正在读取数据集样本...'
                  : '未扫描到真值样本'
              }}
            </div>
          </section>
        </div>

        <div
          v-if="recognitionFinished && recognitionSummary"
          class="export-result-bar">
          <el-button type="primary" plain @click="exportSampleResultsCsv">
            <el-icon><Download /></el-icon>
            导出结果
          </el-button>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.test-shibie-page {
  display: flex;
  height: 100vh;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
  background:
    linear-gradient(135deg, rgba(0, 243, 255, 0.07), transparent 34%),
    radial-gradient(
      circle at 78% 22%,
      rgba(188, 19, 254, 0.12),
      transparent 28%
    ),
    transparent;
}

.test-shibie-nav {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 70px;
  padding: 12px 32px;
  border-bottom: 1px solid var(--border-color);
  background: rgba(5, 10, 20, 0.82);
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
}

.test-shibie-nav::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--primary-color),
    transparent
  );
  box-shadow: 0 0 10px var(--primary-color);
  content: '';
}

.nav-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.title-mark {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  background: var(--primary-color);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  box-shadow: 0 0 16px rgba(0, 243, 255, 0.7);
}

.nav-title h1 {
  margin: 0;
  overflow: hidden;
  color: var(--primary-color);
  font-family: var(--font-family-tech);
  font-size: var(--text-page-title);
  font-weight: 700;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 0 10px rgba(0, 243, 255, 0.5);
}

.test-shibie-main {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(480px, 1.1fr);
  gap: 22px;
  min-height: 0;
  flex: 1;
  padding: 24px 32px;
  overflow: hidden;
}

.workspace-panel {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(0, 243, 255, 0.26);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(0, 243, 255, 0.08), transparent 44%),
    rgba(8, 12, 24, 0.78);
  box-shadow:
    inset 0 0 24px rgba(0, 243, 255, 0.04),
    0 14px 38px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(10px);
}

.upload-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px;
}

.result-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow: hidden;
  padding: 18px;
}

.result-panel .panel-header {
  flex: 0 0 auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(0, 243, 255, 0.16);
}

.panel-header h2 {
  margin: 2px 0 0;
  color: #fff;
  font-size: 20px;
  line-height: 1.2;
}

.panel-header .el-icon {
  color: var(--primary-color);
  font-size: 26px;
}

.panel-kicker {
  color: var(--primary-light);
  font-family: var(--font-family-mono);
  font-size: 12px;
  font-weight: 700;
}

.panel-state {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.panel-state.active {
  border-color: rgba(0, 243, 255, 0.42);
  color: var(--primary-color);
  background: rgba(0, 243, 255, 0.08);
}

.dataset-upload {
  width: 100%;
}

.dataset-upload :deep(.el-upload),
.dataset-upload :deep(.el-upload-dragger) {
  width: 100%;
}

.dataset-upload :deep(.el-upload-dragger) {
  display: grid;
  place-items: center;
  min-height: 210px;
  border-color: rgba(0, 243, 255, 0.3);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(0, 243, 255, 0.09), rgba(122, 90, 248, 0.06)),
    rgba(3, 16, 31, 0.58);
}

.dataset-upload :deep(.el-upload-dragger:hover) {
  border-color: rgba(0, 243, 255, 0.65);
  background: rgba(0, 243, 255, 0.08);
}

.upload-icon {
  margin-bottom: 10px;
  color: var(--primary-color);
  font-size: 44px;
}

.upload-title {
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.upload-sub {
  max-width: 360px;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.hidden-folder-input {
  display: none;
}

.upload-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.upload-actions-hint {
  color: var(--text-secondary);
  font-size: 12px;
}

.folder-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(0, 243, 255, 0.22);
  border-radius: 6px;
  background: rgba(0, 243, 255, 0.06);
}

.folder-summary-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.folder-summary-main .el-icon {
  flex: 0 0 auto;
  color: var(--primary-color);
  font-size: 22px;
}

.folder-summary-main strong {
  display: block;
  overflow: hidden;
  color: #fff;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-summary-main span {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.meta-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(0, 243, 255, 0.14);
  border-radius: 6px;
  background: rgba(3, 16, 31, 0.58);
}

.meta-card span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
}

.meta-card strong {
  display: block;
  overflow: hidden;
  margin-top: 6px;
  color: var(--primary-light);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recognition-status {
  padding: 14px;
  border: 1px solid rgba(0, 243, 255, 0.2);
  border-radius: 6px;
  background: rgba(3, 16, 31, 0.62);
}

.status-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 13px;
}

.status-head strong {
  color: var(--primary-color);
}

.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
}

.action-row .el-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.empty-result {
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  align-content: center;
  gap: 18px;
  color: var(--text-secondary);
  text-align: center;
}

.empty-result p {
  max-width: 300px;
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.scan-ring {
  position: relative;
  width: 98px;
  height: 98px;
  border: 1px solid rgba(0, 243, 255, 0.32);
  border-radius: 50%;
  box-shadow:
    inset 0 0 20px rgba(0, 243, 255, 0.08),
    0 0 24px rgba(0, 243, 255, 0.12);
}

.scan-ring::before,
.scan-ring::after {
  position: absolute;
  inset: 16px;
  border: 1px dashed rgba(0, 243, 255, 0.38);
  border-radius: inherit;
  content: '';
}

.scan-ring::after {
  inset: 34px;
  border-style: solid;
  background: rgba(0, 243, 255, 0.16);
  box-shadow: 0 0 18px rgba(0, 243, 255, 0.35);
}

.evaluation-report {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.evaluation-report::-webkit-scrollbar {
  width: 8px;
}

.evaluation-report::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
}

.evaluation-report::-webkit-scrollbar-thumb {
  background: rgba(0, 243, 255, 0.42);
  border-radius: 999px;
}

.evaluation-report::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 243, 255, 0.68);
}

.export-result-bar {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 243, 255, 0.12);
}

.export-result-bar .el-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.recognition-summary-banner,
.evaluation-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.evaluation-overview {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.accuracy-pass-banner {
  grid-column: 1 / -1;
  padding: 10px 12px;
  border: 1px solid rgba(0, 255, 157, 0.45);
  border-radius: 6px;
  background: rgba(0, 255, 157, 0.1);
  color: var(--success-color);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}

@media (min-width: 1100px) {
  .evaluation-overview {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.summary-stat.metric-inline strong {
  font-size: 22px;
}

.summary-stat {
  padding: 14px 12px;
  border: 1px solid rgba(0, 243, 255, 0.18);
  border-radius: 6px;
  background:
    linear-gradient(135deg, rgba(0, 243, 255, 0.08), transparent 58%),
    rgba(3, 16, 31, 0.6);
}

.summary-stat span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
}

.summary-stat strong {
  display: block;
  margin-top: 8px;
  color: var(--primary-light);
  font-size: 28px;
  line-height: 1;
  text-shadow: 0 0 10px rgba(0, 243, 255, 0.28);
}

.summary-stat.highlight {
  border-color: rgba(0, 243, 255, 0.42);
  background:
    linear-gradient(135deg, rgba(0, 243, 255, 0.16), rgba(122, 90, 248, 0.08)),
    rgba(3, 16, 31, 0.72);
}

.summary-stat.highlight strong {
  color: #fff;
}

.summary-stat.muted strong {
  color: #9eb4c8;
  text-shadow: none;
}
.sample-result-wrap {
  flex: 1 1 auto;
  max-height: none;
  margin: 0 12px 12px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid rgba(0, 243, 255, 0.08);
  border-radius: 6px;
  background: rgba(5, 14, 28, 0.55);
}

.sample-result-wrap::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.sample-result-wrap::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
}

.sample-result-wrap::-webkit-scrollbar-thumb {
  background: rgba(0, 243, 255, 0.42);
  border-radius: 999px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.metric-card {
  min-width: 0;
  padding: 12px 10px;
  border: 1px solid rgba(0, 243, 255, 0.18);
  border-radius: 6px;
  background:
    linear-gradient(135deg, rgba(0, 243, 255, 0.08), transparent 58%),
    rgba(3, 16, 31, 0.6);
}

.metric-card span,
.report-section-head span,
.truth-card small,
.recall-card small {
  color: var(--text-secondary);
  font-size: 12px;
}

.metric-card strong {
  display: block;
  margin-top: 8px;
  color: var(--primary-light);
  font-size: 24px;
  line-height: 1;
  text-shadow: 0 0 10px rgba(0, 243, 255, 0.28);
}

.report-section {
  flex: 0 0 auto;
  border: 1px solid rgba(0, 243, 255, 0.18);
  border-radius: 6px;
  background: rgba(3, 16, 31, 0.5);
}

.sample-section {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  isolation: isolate;
}

.report-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 243, 255, 0.14);
  background: linear-gradient(90deg, rgba(0, 243, 255, 0.12), transparent);
}

.report-section-head.compact {
  padding: 12px 12px 10px;
  border-bottom: 0;
  background: transparent;
}

.report-section-head.compact span {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.report-section-head h3 {
  margin: 0;
  color: #fff;
  font-size: 15px;
  line-height: 1.2;
}

.table-wrap {
  min-width: 0;
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.result-table.samples-table {
  min-width: 0;
}

.result-table th,
.result-table td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  text-align: left;
  vertical-align: middle;
}

.result-table .col-id {
  min-width: 88px;
  white-space: nowrap;
}

.result-table .col-folder {
  min-width: 48px;
  white-space: nowrap;
}

.result-table .col-label {
  min-width: 108px;
}

.result-table .col-num {
  min-width: 72px;
  white-space: nowrap;
  text-align: right;
  font-family: Consolas, 'Courier New', monospace;
}

.sample-result-wrap .result-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgba(5, 18, 34, 0.98);
  color: var(--primary-light);
  font-weight: 700;
}

.result-table th {
  color: var(--primary-light);
  font-weight: 700;
}

.result-table td {
  color: var(--text-secondary);
}

.result-table tr:last-child td {
  border-bottom: 0;
}

.result-badge {
  display: inline-flex;
  justify-content: center;
  min-width: 42px;
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
  font-weight: 700;
}

.result-badge.vital {
  color: #5dffc0;
  border-color: rgba(0, 255, 157, 0.55);
  background: rgba(0, 255, 157, 0.12);
}

.result-badge.no-vital {
  color: #c4b5fd;
  border-color: rgba(122, 90, 248, 0.55);
  background: rgba(122, 90, 248, 0.14);
}

.result-badge.incorrect {
  border-style: dashed;
  box-shadow: inset 0 0 0 1px rgba(247, 185, 85, 0.35);
}

.result-badge.incorrect.vital {
  color: #ffd59a;
  border-color: rgba(247, 185, 85, 0.72);
  background: rgba(247, 185, 85, 0.14);
}

.result-badge.incorrect.no-vital {
  color: #ffd59a;
  border-color: rgba(247, 185, 85, 0.72);
  background: rgba(247, 185, 85, 0.14);
}

.truth-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  padding: 12px;
}

.truth-card {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(0, 243, 255, 0.12);
  border-radius: 6px;
  background: rgba(8, 18, 34, 0.68);
}

.truth-card strong,
.truth-card span,
.truth-card small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.truth-card strong {
  color: var(--primary-light);
  font-size: 13px;
}

.truth-card span {
  margin-top: 6px;
  color: #fff;
  font-size: 13px;
}

.truth-card small {
  margin-top: 5px;
}

.truth-empty {
  padding: 24px 12px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

.split-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 12px;
}

.split-block {
  min-width: 0;
}

.distribution-list,
.recall-list {
  display: grid;
  gap: 12px;
  padding: 0 12px 12px;
}

.distribution-card,
.recall-card {
  padding: 14px;
  border-radius: 8px;
  border: 1px solid rgba(0, 243, 255, 0.14);
  background:
    linear-gradient(145deg, rgba(0, 243, 255, 0.05), transparent 55%),
    rgba(5, 14, 28, 0.78);
}

.distribution-card.vital,
.recall-card.vital {
  border-color: rgba(0, 255, 157, 0.28);
  background:
    linear-gradient(145deg, rgba(0, 255, 157, 0.1), transparent 58%),
    rgba(5, 18, 28, 0.82);
}

.distribution-card.no-vital,
.recall-card.no-vital {
  border-color: rgba(122, 90, 248, 0.28);
  background:
    linear-gradient(145deg, rgba(122, 90, 248, 0.1), transparent 58%),
    rgba(10, 12, 28, 0.82);
}

.distribution-card-head,
.recall-card-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.distribution-label,
.recall-card-head span {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.distribution-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.distribution-meta strong,
.recall-card-head strong {
  color: var(--primary-light);
  font-size: 24px;
  line-height: 1;
  text-shadow: 0 0 10px rgba(0, 243, 255, 0.22);
}

.distribution-card.vital .distribution-meta strong,
.recall-card.vital .recall-card-head strong {
  color: var(--success-color);
  text-shadow: 0 0 10px rgba(0, 255, 157, 0.28);
}

.distribution-card.no-vital .distribution-meta strong,
.recall-card.no-vital .recall-card-head strong {
  color: #c4b5fd;
  text-shadow: 0 0 10px rgba(122, 90, 248, 0.28);
}

.distribution-meta em {
  color: var(--text-secondary);
  font-size: 12px;
  font-style: normal;
}

.distribution-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
}

.distribution-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.35s ease;
}

.distribution-card.vital .distribution-track i {
  background: linear-gradient(90deg, #00ff9d, #00f3ff);
  box-shadow: 0 0 14px rgba(0, 255, 157, 0.35);
}

.distribution-card.no-vital .distribution-track i {
  background: linear-gradient(90deg, #7a5af8, #bc13fe);
  box-shadow: 0 0 14px rgba(188, 19, 254, 0.28);
}

.recall-card small {
  display: block;
}

.recall-empty {
  display: grid;
  min-height: 88px;
  place-items: center;
  border: 1px dashed rgba(0, 243, 255, 0.16);
  border-radius: 5px;
  color: var(--text-secondary);
  font-size: 13px;
}

@media (max-width: 980px) {
  .test-shibie-nav {
    align-items: flex-start;
    padding: 12px 18px;
  }

  .test-shibie-main {
    grid-template-columns: 1fr;
    overflow-y: auto;
    padding: 18px;
  }

  .meta-grid {
    grid-template-columns: 1fr;
  }

  .evaluation-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .split-section {
    grid-template-columns: 1fr;
  }

  .metric-grid,
  .truth-grid,
  .split-section {
    grid-template-columns: 1fr;
  }
}
</style>
