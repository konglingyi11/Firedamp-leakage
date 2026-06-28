/**
 * WebGL Renderer 单例管理器
 * 确保整个应用只有一个 WebGL 上下文
 */

import * as THREE from 'three'

export const MAIN_SCENE_TONE_MAPPING_EXPOSURE = 1.18

let globalRenderer = null
let refCount = 0
let canvas = null

/**
 * 获取全局 renderer 实例
 * @param {Object} options - WebGLRenderer 配置选项
 * @returns {THREE.WebGLRenderer}
 */
export function getRenderer(options = {}) {
  if (!globalRenderer) {
    console.log('[RendererManager] 创建全局 WebGL Renderer')

    // 创建或复用 canvas
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.id = 'global-webgl-canvas'
    }

    // 创建 renderer
    globalRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
      ...options,
    })

    globalRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    globalRenderer.outputColorSpace = THREE.SRGBColorSpace
    globalRenderer.toneMapping = THREE.ACESFilmicToneMapping
    globalRenderer.toneMappingExposure = MAIN_SCENE_TONE_MAPPING_EXPOSURE
    globalRenderer.shadowMap.enabled = true
    globalRenderer.shadowMap.type = THREE.PCFSoftShadowMap

    // 添加上下文丢失和恢复监听
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        console.error('[RendererManager] WebGL 上下文丢失')
        event.preventDefault()
      },
      false,
    )

    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        console.log('[RendererManager] WebGL 上下文已恢复')
        if (globalRenderer) {
          globalRenderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, 2),
          )
          globalRenderer.outputColorSpace = THREE.SRGBColorSpace
          globalRenderer.toneMapping = THREE.ACESFilmicToneMapping
          globalRenderer.toneMappingExposure = MAIN_SCENE_TONE_MAPPING_EXPOSURE
          globalRenderer.shadowMap.enabled = true
          globalRenderer.shadowMap.type = THREE.PCFSoftShadowMap
        }
      },
      false,
    )
  }

  refCount++
  console.log(`[RendererManager] 引用计数: ${refCount}`)

  return globalRenderer
}

/**
 * 释放 renderer 引用
 * 当引用计数归零时，清理 renderer
 */
export function releaseRenderer() {
  refCount--
  console.log(`[RendererManager] 引用计数: ${refCount}`)

  if (refCount <= 0) {
    console.log('[RendererManager] 引用计数归零，清理 renderer')
    cleanup()
  }
}

/**
 * 强制清理 renderer（慎用）
 */
export function forceCleanup() {
  console.warn('[RendererManager] 强制清理 renderer')
  refCount = 0
  cleanup()
}

/**
 * 内部清理函数
 */
function cleanup() {
  const oldCanvas = canvas
  if (globalRenderer) {
    globalRenderer.forceContextLoss()
    globalRenderer.dispose()
    globalRenderer = null
  }

  if (oldCanvas && oldCanvas.parentElement) {
    oldCanvas.parentElement.removeChild(oldCanvas)
  }

  canvas = null
  refCount = 0
}

/**
 * 获取当前引用计数
 */
export function getRefCount() {
  return refCount
}

/**
 * 检查 renderer 是否存在
 */
export function hasRenderer() {
  return globalRenderer !== null
}

/**
 * 获取 canvas 元素
 */
export function getCanvas() {
  return canvas
}

/**
 * 重置引用计数（用于调试）
 */
export function resetRefCount() {
  console.warn('[RendererManager] 重置引用计数')
  refCount = 0
}
