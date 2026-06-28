import { ref } from 'vue'

const preloadedImageUrls = new Set()

export function useImagePreloader() {
  const preloadingCount = ref(0)
  const preloadedCount = ref(0)

  function resolve2DFrameImageUrl(frame) {
    const raw =
      frame?.png_url ||
      frame?.svg_url ||
      frame?.url ||
      frame?.data?.png_url ||
      frame?.data?.svg_url ||
      frame?.data?.vector_url ||
      frame?.data?.contour_frame_url ||
      frame?.data?.url ||
      ''
    return typeof raw === 'string' ? raw.replace(/[`\s]/g, '') : ''
  }

  function cleanImageUrl(url) {
    return typeof url === 'string' ? url.replace(/[`\s]/g, '') : ''
  }

  function preloadBrowserImage(url) {
    const cleanUrl = cleanImageUrl(url)
    if (!cleanUrl || preloadedImageUrls.has(cleanUrl)) {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      const image = new Image()
      let settled = false
      const timer = setTimeout(() => finish(false), 15000)
      const finish = (ok) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (ok) preloadedImageUrls.add(cleanUrl)
        resolve(ok)
      }
      image.onload = () => finish(true)
      image.onerror = () => finish(false)
      image.decoding = 'async'
      image.src = cleanUrl
      if (image.complete && image.naturalWidth > 0) {
        finish(true)
      }
    })
  }

  async function preload2DFrameImageUrls(urls, onProgress) {
    const uniqueUrls = [
      ...new Set(
        (Array.isArray(urls) ? urls : [])
          .map((u) => cleanImageUrl(u))
          .filter(Boolean),
      ),
    ]
    const total = uniqueUrls.length
    if (total === 0) return 0

    let loaded = 0
    preloadingCount.value = total
    preloadedCount.value = 0

    const concurrency = 4
    let index = 0

    async function worker() {
      while (index < total) {
        const currentIndex = index++
        const url = uniqueUrls[currentIndex]
        try {
          await preloadBrowserImage(url)
        } catch (e) {
          // ignore errors
        }
        loaded++
        preloadedCount.value = loaded
        if (typeof onProgress === 'function') {
          onProgress(loaded, total)
        }
      }
    }

    const workers = []
    for (let i = 0; i < Math.min(concurrency, total); i++) {
      workers.push(worker())
    }
    await Promise.all(workers)

    preloadingCount.value = 0
    return loaded
  }

  function isUrlPreloaded(url) {
    return preloadedImageUrls.has(cleanImageUrl(url))
  }

  function clearPreloadCache() {
    preloadedImageUrls.clear()
    preloadingCount.value = 0
    preloadedCount.value = 0
  }

  return {
    preloadingCount,
    preloadedCount,
    preloadedImageUrls,
    resolve2DFrameImageUrl,
    cleanImageUrl,
    preloadBrowserImage,
    preload2DFrameImageUrls,
    isUrlPreloaded,
    clearPreloadCache,
  }
}
