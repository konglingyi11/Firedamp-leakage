const TEST_CSV_URL = import.meta.env.VITE_VOLUME_WORKER_TEST_CSV_URL || ''
const TEST_VARIABLE = 'Temperature'

async function testVolumeWorkerDirect() {
  if (!TEST_CSV_URL) {
    throw new Error('请先配置 VITE_VOLUME_WORKER_TEST_CSV_URL')
  }
  
  

  const workerUrl = '/src/workers/volumeCsvWorker.js'
  

  const worker = new Worker(workerUrl, { type: 'module' })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('Worker timeout - no response after 180s'))
    }, 180000)

    worker.onmessage = (event) => {
      const { type, ok, error, result, strategy, fileSize, phase, offset, size } = event.data || {}

      if (type === 'strategy_selected') {
        
        return
      }

      if (type === 'progress') {
        const percent = size ? Math.round((offset / size) * 100) : '...'
        
        return
      }

      if (type === 'lod_ready') {
        
        return
      }

      if (type === 'complete' && ok) {
        clearTimeout(timeout)
        worker.terminate()
        

        const memMB = (result.data?.length / 1024 / 1024).toFixed(2)
        

        resolve(result)
        return
      }

      if (type === 'complete' && !ok) {
        clearTimeout(timeout)
        worker.terminate()
        console.error('[错误]', error)
        reject(new Error(error))
      }
    }

    worker.onerror = (err) => {
      clearTimeout(timeout)
      worker.terminate()
      console.error('[Worker错误]', err)
      reject(err)
    }

    worker.postMessage({
      id: `vol-${Date.now()}`,
      url: TEST_CSV_URL,
      variable: TEST_VARIABLE,
      dims: 128
    })

    
  })
}

window.testVolumeWorkerDirect = testVolumeWorkerDirect
window.TEST_CSV_URL = TEST_CSV_URL


