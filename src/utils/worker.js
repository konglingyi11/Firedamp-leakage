/**
 * 统一解析「活跃 Worker 列表」接口返回值。
 * axios 拦截器可能已解包为数组，也可能仍为 { data: [] } / { items } 等。
 * @param {*} payload
 * @returns {Array<Object>}
 */
export function normalizeWorkersList(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.list)) return payload.list
  return []
}

/**
 * 统一解析 GET /api/v1/workers/{id} 单条详情（拦截器解包后通常为对象本身）。
 * @param {*} payload
 * @returns {Object|null}
 */
export function normalizeWorkerDetail(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (Array.isArray(payload)) return null
  if (payload.data != null && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data
  }
  if (payload.id != null || payload.hostname != null) return payload
  return null
}
