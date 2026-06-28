const TERMINAL_PREGEN_STATUSES = new Set([
  'completed',
  'failed',
  'stopped',
  'cancelled',
  'canceled',
])

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function ratioToPercent(current, total) {
  const currentValue = toNumber(current)
  const totalValue = toNumber(total)
  if (currentValue == null || totalValue == null || totalValue <= 0) return null
  return clamp((currentValue / totalValue) * 100, 0, 100)
}

function resolvePhaseProgress(data) {
  const majorTotal = toNumber(data.major_phase_total)
  const majorCurrent = toNumber(data.major_phase_current)
  const minorTotal = toNumber(data.minor_phase_total)
  const minorCurrent = toNumber(data.minor_phase_current)

  if (majorTotal != null && majorTotal > 0 && majorCurrent != null) {
    if (minorTotal != null && minorTotal > 0 && minorCurrent != null) {
      const currentMajorBase = majorCurrent > 0 ? majorCurrent - 1 : 0
      const minorFraction = clamp(minorCurrent / minorTotal, 0, 1)
      return clamp(((currentMajorBase + minorFraction) / majorTotal) * 100, 0, 100)
    }

    return ratioToPercent(majorCurrent, majorTotal)
  }

  return ratioToPercent(minorCurrent, minorTotal)
}

function buildCurrentPhase(data) {
  return (
    data.current_phase ||
    data.status_text ||
    data.minor_phase_name ||
    data.major_phase_name ||
    ''
  )
}

function unwrapPregenProgressResponse(response) {
  if (!response || typeof response !== 'object') return response || {}
  if (response.data && (response.code !== undefined || response.message !== undefined)) {
    return response.data || {}
  }
  return response.data || response
}

export function normalizePregenProgressResponse(response) {
  const data = unwrapPregenProgressResponse(response)
  const status = data.status || ''
  let progress = toNumber(data.progress ?? data.progress_percentage)

  if (progress == null) {
    progress = ratioToPercent(data.completed_count, data.total_count)
  }

  if (progress == null) {
    progress = resolvePhaseProgress(data)
  }

  if (status === 'completed') {
    progress = 100
  }

  return {
    raw: data,
    taskId: data.task_id,
    status,
    statusText: data.status_text || '',
    progress: progress ?? 0,
    completedCount: data.completed_count,
    totalCount: data.total_count,
    currentPhase: buildCurrentPhase(data),
    majorPhaseName: data.major_phase_name || '',
    majorPhaseCurrent: data.major_phase_current,
    majorPhaseTotal: data.major_phase_total,
    minorPhaseName: data.minor_phase_name || '',
    minorPhaseCurrent: data.minor_phase_current,
    minorPhaseTotal: data.minor_phase_total,
    failureCount: data.failure_count,
    failureSummary: Array.isArray(data.failure_summary) ? data.failure_summary : [],
    errorMessage: data.error_message || data.error || '',
    startedAt: data.started_at,
    completedAt: data.completed_at,
    updatedAt: data.updated_at,
  }
}

export function isPregenProgressComplete(progressInfo) {
  return (
    progressInfo?.status === 'completed' ||
    Number(progressInfo?.progress ?? 0) >= 100
  )
}

export function isPregenProgressTerminal(progressInfo) {
  const status = progressInfo?.status
  return status ? TERMINAL_PREGEN_STATUSES.has(status) : false
}
