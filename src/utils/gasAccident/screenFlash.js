/**
 * 屏幕闪爆反馈工具
 * 在爆炸瞬间给 canvas/DOM 加一层白屏闪，增强临场感。
 * 支持按容器隔离，避免多个实例共享同一个全局 overlay。
 */

/** @type {Map<HTMLElement, HTMLElement>} 容器 -> overlay 映射 */
const _overlays = new Map()

/**
 * 确保指定容器存在 overlay。
 * @param {HTMLElement} [container=document.body]
 * @returns {HTMLElement}
 */
function _ensureOverlay(container = document.body) {
  if (_overlays.has(container)) return _overlays.get(container)

  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: container === document.body ? 'fixed' : 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    background: '#ffffff',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '99999',
    transition: 'opacity 0.08s ease-out',
  })
  container.appendChild(overlay)
  _overlays.set(container, overlay)
  return overlay
}

/**
 * 触发屏幕白闪
 * @param {Object} [options={}]
 * @param {number} [options.intensity=1] 闪光强度 0~1
 * @param {number} [options.durationMs=120] 白屏持续时间(ms)
 * @param {number} [options.fadeMs=280] 淡出时间(ms)
 * @param {HTMLElement} [options.container=document.body] 闪爆容器，默认全屏 body
 */
export function triggerScreenFlash(options = {}) {
  const intensity = Math.max(0, Math.min(1, options.intensity ?? 1))
  const durationMs = options.durationMs ?? 120
  const fadeMs = options.fadeMs ?? 280
  const container = options.container || document.body
  const overlay = _ensureOverlay(container)

  overlay.style.transition = 'none'
  overlay.style.opacity = String(0.45 + intensity * 0.55)
  requestAnimationFrame(() => {
    overlay.style.transition = `opacity ${fadeMs}ms ease-out`
    setTimeout(() => {
      overlay.style.opacity = '0'
    }, durationMs)
  })
}

/**
 * 清理闪爆 overlay（路由切换或实例销毁时调用）
 * @param {Object} [options={}]
 * @param {HTMLElement} [options.container] 指定容器；为空时清理所有容器
 */
export function disposeScreenFlash(options = {}) {
  const container = options?.container
  if (container) {
    const overlay = _overlays.get(container)
    if (overlay) {
      overlay.remove()
      _overlays.delete(container)
    }
    return
  }

  for (const overlay of _overlays.values()) {
    overlay.remove()
  }
  _overlays.clear()
}

export default { triggerScreenFlash, disposeScreenFlash }
