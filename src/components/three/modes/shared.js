import * as THREE from 'three'
import Papa from 'papaparse'

export function normalizeUrl(url) {
  return typeof url === 'string' ? url.replace(/[`\s]/g, '') : ''
}

export function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop()
    if (child.geometry) child.geometry.dispose()
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material?.dispose?.())
    } else {
      child.material?.dispose?.()
    }
  }
}

export function parseCsv(text) {
  if (typeof text !== 'string') return []
  
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => typeof value === 'string' ? value.trim() : value,
  })
  
  if (result.errors.length > 0) {
    console.warn('CSV parsing warnings:', result.errors)
  }
  
  return result.data || []
}

export function toFiniteNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function toFloat32Array(values) {
  if (values instanceof Float32Array) return values
  if (Array.isArray(values)) {
    return new Float32Array(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item)),
    )
  }
  return new Float32Array()
}

export function createTextResourceLoader() {
  const resourceTextCache = new Map()
  const inflightTextRequests = new Map()
  return async function fetchTextResource(url) {
    const cleanUrl = normalizeUrl(url)
    if (!cleanUrl) return ''
    if (resourceTextCache.has(cleanUrl)) return resourceTextCache.get(cleanUrl)
    if (inflightTextRequests.has(cleanUrl)) return inflightTextRequests.get(cleanUrl)
    const request = (async () => {
      const response = await fetch(cleanUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch ${cleanUrl}`)
      }
      const text = await response.text()
      resourceTextCache.set(cleanUrl, text)
      return text
    })()
    inflightTextRequests.set(cleanUrl, request)
    try {
      return await request
    } finally {
      inflightTextRequests.delete(cleanUrl)
    }
  }
}

export function createStructuredResourceLoader() {
  const fetchTextResource = createTextResourceLoader()
  return async function fetchStructuredResource(url) {
    const text = await fetchTextResource(url)
    const trimmed = text.trim()
    if (!trimmed) return null
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return parseCsv(trimmed)
      }
    }
    return parseCsv(trimmed)
  }
}

export { THREE }
