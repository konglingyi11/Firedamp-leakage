/** 发给 UE 前移除 base64 字符串（data URL），避免传输过大且 UE 可能无法使用 */
export function stripBase64ForUE(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (obj.startsWith('data:')) return null
    return obj
  }
  if (Array.isArray(obj)) {
    return obj
      .map((item) => stripBase64ForUE(item))
      .filter((v) => v !== null && v !== undefined)
  }
  if (typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = stripBase64ForUE(v)
      out[k] = cleaned
    }
    return out
  }
  return obj
}
