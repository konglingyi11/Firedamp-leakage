import { ref, onBeforeUnmount } from 'vue'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

export function useCss2dRenderer(options = {}) {
  const {
    getHost = () => null,
    getScene = () => null,
    getCamera = () => null,
    addPostRenderCallback,
    removePostRenderCallback,
  } = options

  const css2dRenderer = ref(null)
  const css2dResizeObserver = ref(null)
  const frameCallbacks = new Set()

  function resizeCss2dRenderer() {
    if (!css2dRenderer.value) return
    const host = getHost?.()
    if (!host) return
    const w = host.clientWidth || 1
    const h = host.clientHeight || 1
    css2dRenderer.value.setSize(w, h)
  }

  function renderCss2dRendererFrame() {
    if (!css2dRenderer.value) return
    const scene = getScene?.()
    const camera = getCamera?.()
    if (!scene || !camera) return
    css2dRenderer.value.render(scene, camera)
  }

  function ensureCss2dRenderer() {
    if (css2dRenderer.value) return
    const host = getHost?.()
    if (!host) return

    css2dRenderer.value = new CSS2DRenderer()
    const dom = css2dRenderer.value.domElement
    dom.style.position = 'absolute'
    dom.style.inset = '0'
    dom.style.pointerEvents = 'none'
    host.style.position = 'relative'
    host.appendChild(dom)

    resizeCss2dRenderer()

    css2dResizeObserver.value = new ResizeObserver(() => resizeCss2dRenderer())
    css2dResizeObserver.value.observe(host)

    if (typeof addPostRenderCallback === 'function') {
      addPostRenderCallback(renderCss2dRendererFrame)
    }
  }

  function teardownCss2dRenderer() {
    if (typeof removePostRenderCallback === 'function') {
      removePostRenderCallback(renderCss2dRendererFrame)
    }
    css2dResizeObserver.value?.disconnect?.()
    css2dResizeObserver.value = null

    frameCallbacks.forEach((cb) => {
      if (typeof cb.cleanup === 'function') {
        cb.cleanup()
      }
    })
    frameCallbacks.clear()

    if (css2dRenderer.value) {
      css2dRenderer.value.domElement?.parentNode?.removeChild(
        css2dRenderer.value.domElement,
      )
      css2dRenderer.value = null
    }
  }

  function addCss2dObject(obj) {
    if (!css2dRenderer.value) return
    const scene = getScene?.()
    if (scene) {
      scene.add(obj)
    }
  }

  function removeCss2dObject(obj) {
    if (!css2dRenderer.value) return
    obj?.removeFromParent?.()
  }

  onBeforeUnmount(() => {
    teardownCss2dRenderer()
  })

  return {
    css2dRenderer,
    css2dResizeObserver,
    ensureCss2dRenderer,
    teardownCss2dRenderer,
    resizeCss2dRenderer,
    renderCss2dRendererFrame,
    addCss2dObject,
    removeCss2dObject,
  }
}
