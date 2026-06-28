<template>
  <div
    class="player-wrapper"
    @click="handleVideoInteraction"
    @contextmenu.prevent>
    <!-- 使用原生 video 标签 + is 属性 -->
    <video
      v-if="isPeerStreamLoaded"
      ref="videoRef"
      is="peer-stream"
      :id="signalUrl"
      autoplay
      playsinline
      muted
      tabindex="0"
      class="peer-video"
      @mousedown="handleVideoInteraction"
      @mousemove="handleMouseMove"
      @keydown="handleKeyInteraction"
      @keyup="handleKeyUp"
      @keydown.esc="handleEscExit"
      @keyup.esc="handleEscExit"></video>

    <!-- 隐形遮罩层：未聚焦时覆盖在视频上，阻挡鼠标事件 -->
    <div
      v-if="!isFocused"
      class="interaction-overlay"
      @click="handleVideoInteraction"
      @contextmenu.prevent>
      <div class="overlay-tip">点击画面开始操作</div>
    </div>

    <!-- 可选：加载中提示（排队时不显示，避免与排队文案重复） -->
    <div v-if="!isPlaying && !isInPlayerQueue" class="loading-overlay">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>Loading peer-stream...</span>
    </div>

    <!-- 信令排队：已连上 WS，等待服务端分配媒体流 -->
    <div v-if="isInPlayerQueue" class="queue-overlay">
      <el-icon class="is-loading queue-icon"><Loading /></el-icon>
      <div class="queue-title">正在排队，等待分配画面</div>
      <div v-if="queueHint" class="queue-hint">{{ queueHint }}</div>
      <div class="queue-sub">信令已连接，轮到您后将自动建立 WebRTC 并显示画面</div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'

const signalUrl =
  import.meta.env.VITE_PIXEL_STREAMING_SIGNAL_URL?.trim() || ''
const isPeerStreamLoaded = ref(false)
const isPlaying = ref(false)
const videoRef = ref(null)
const isImmersiveMode = ref(false) // 沉浸模式开关
const isLocked = ref(false) // 鼠标锁定状态
const isFocused = ref(false) // 是否聚焦状态
const currentViewMode = ref(0) // 0: 自由视角 (默认), 1: 第一人称, 2: 第三人称
const intentionalUnlock = ref(false) // 标记是否为意图解锁（如Alt键或切换模式），用于区分Esc退出

/** 像素流服务端排队（playerqueue），尚未收到 offer / 未出画 */
const isInPlayerQueue = ref(false)
const queueSeq = ref(null)

const queueHint = computed(() => {
  if (queueSeq.value == null || queueSeq.value === '') return ''
  return `队列信息：序号 ${queueSeq.value}`
})

// 定义事件发射器
const emit = defineEmits([
  'update-plane',
  'update-coordinate',
  'apply-settings',
  'ue-focus-point',
  'ue-finish-vector',
])

// 拦截鼠标移动事件
const handleMouseMove = (e) => {
  // 如果没有聚焦，且没有鼠标锁定，则阻止事件冒泡和默认行为，防止发送给 UE
  if (!isFocused.value && !document.pointerLockElement) {
    e.stopPropagation()
    // e.preventDefault() // 注意：preventDefault 可能会阻止一些浏览器原生行为，视情况而定
    // 如果 peer-stream 组件内部是通过监听 document 的 mousemove，这里可能拦不住
    // 需要依赖 isFocused 状态在组件内部处理，或者通过 blur() 让组件知道失去了焦点
  }
}

// 处理 Esc 退出聚焦
const handleEscExit = () => {
  if (videoRef.value) {
    videoRef.value.blur()
    isFocused.value = false // 标记失去焦点
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    
  }
}

// 处理按键交互 (F键切换视角, Alt键解锁)
const handleKeyInteraction = (e) => {
  // F键：切换视角
  // 0: 自由 (显示鼠标), 1: 第一人称 (隐藏鼠标), 2: 第三人称 (隐藏鼠标)
  if (e.key === 'f' || e.key === 'F') {
    // 防止长按重复触发
    if (e.repeat) return

    currentViewMode.value = (currentViewMode.value + 1) % 3
    

    if (videoRef.value) {
      if (currentViewMode.value === 0) {
        // 自由视角：显示鼠标，不请求锁定，允许鼠标自由移动（浏览器限制：无法既显示系统鼠标又限制范围）
        if (document.pointerLockElement) {
          intentionalUnlock.value = true
          document.exitPointerLock()
        }
      } else {
        // 第一/第三人称：隐藏鼠标
        if (!document.pointerLockElement) {
          videoRef.value.requestPointerLock()
        }
      }
    }
  }

  // Alt键按下：临时退出鼠标锁定 (显示鼠标)
  if (e.key === 'Alt') {
    if (document.pointerLockElement) {
      intentionalUnlock.value = true
      document.exitPointerLock()
      
    }
  }
}

// 处理按键抬起 (Alt键抬起恢复锁定)
const handleKeyUp = (e) => {
  if (e.key === 'Alt') {
    // 如果在第一或第三人称模式，且鼠标当前未锁定，则重新锁定
    if (
      currentViewMode.value !== 0 &&
      videoRef.value &&
      !document.pointerLockElement
    ) {
      videoRef.value.requestPointerLock()
      
    }
  }
}

// 切换沉浸模式
const handleImmersiveChange = (val) => {
  if (val) {
    // 开启时自动聚焦视频，确保键盘立即生效
    if (videoRef.value) {
      videoRef.value.focus()
    }
    ElMessage({
      message: '沉浸模式已开启：键盘已聚焦，点击画面可锁定鼠标',
      type: 'success',
      duration: 5000,
      showClose: true,
    })
  } else {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    ElMessage.info('已恢复普通模式')
  }
}

// 处理视频交互（聚焦+锁定鼠标）
const handleVideoInteraction = () => {
  if (videoRef.value) {
    // 1. 获取焦点以接收键盘事件
    videoRef.value.focus()
    isFocused.value = true // 标记获得焦点

    // 2. 根据当前视角模式决定是否请求鼠标锁定
    // 自由视角 (0)：不锁定，显示系统鼠标
    // 第一/第三人称 (1或2)：请求锁定，隐藏系统鼠标
    if (currentViewMode.value !== 0 && !document.pointerLockElement) {
      videoRef.value.requestPointerLock()
    }
  }
}

// 监听鼠标锁定状态变化
const handlePointerLockChange = () => {
  const locked = document.pointerLockElement === videoRef.value
  isLocked.value = locked

  // 如果解锁了
  if (!locked) {
    // 如果是意图解锁（如按Alt或切换到自由模式），则保留焦点
    if (intentionalUnlock.value) {
      intentionalUnlock.value = false // 重置标志
      isFocused.value = true // 保持焦点
      
    } else {
      // 否则认为是 Esc 退出（或系统强制退出），此时取消焦点
      if (videoRef.value) {
        videoRef.value.blur()
      }
      isFocused.value = false // 标记失去焦点
      
    }
  }
}

// 消息监听回调
const handleMessage = (e) => {
  

  // 解析消息数据
  let data
  try {
    // 如果 e.detail 已经是对象，直接使用
    if (typeof e.detail === 'object' && e.detail !== null) {
      data = e.detail
    }
    // 如果是字符串，尝试解析为 JSON
    else if (typeof e.detail === 'string') {
      try {
        data = JSON.parse(e.detail)
      } catch (parseError) {
        // 如果解析失败，说明是普通文本消息
        
        ElMessage({
          message: `收到UE消息: ${e.detail}`,
          type: 'info',
          duration: 3000,
        })
        return // 不是 JSON 格式，直接返回
      }
    } else {
      console.warn('Unknown message format:', e.detail)
      return
    }

    // UE 要求前端聚焦到指定平面（不弹通用 Toast）
    if (data && data.type === 'focusPlane') {
      const fid = data.id ?? data.point_id ?? data.pointId
      if (fid != null && fid !== '') {
        emit('ue-focus-point', { id: fid })
      }
      return
    }

    // UE 通知等值线完成，交给父组件决定是否加入图层列表
    if (data && data.type === 'finishVector') {
      emit('ue-finish-vector', data)
      return
    }

    // 显示消息通知
    ElMessage({
      message: `收到UE消息: ${JSON.stringify(data)}`,
      type: 'info',
      duration: 3000,
    })

    // 处理 UE 发送的 setAxis 消息
    if (data && data.type === 'setAxis') {
      

      const { axis, coordinate } = data

      // 根据 axis 确定对应的 plane
      let plane
      if (axis === 'x轴' || axis === 'X' || axis === 'x') {
        plane = 'yz'
      } else if (axis === 'y轴' || axis === 'Y' || axis === 'y') {
        plane = 'xz'
      } else if (axis === 'z轴' || axis === 'Z' || axis === 'z') {
        plane = 'xy'
      }

      if (plane) {
        // 触发父组件更新
        emit('update-plane', plane)
        emit('update-coordinate', parseFloat(coordinate))
        // 触发父组件应用设置
        emit('apply-settings')

        ElMessage.success(`已接收UE数据：${axis} 坐标 ${coordinate}`)
      }
    }
  } catch (error) {
    console.error('Failed to handle message:', error)
  }
}

// 播放状态监听
let lastDisconnectToastAt = 0
let initListenersTimer = null
let dataChannelRetryTimer = null
let bufferMonitorTimer = null
let listenersInitialized = false

const handlePlayerDisconnected = () => {
  isPlaying.value = false
  isInPlayerQueue.value = false
  queueSeq.value = null
  const now = Date.now()
  if (now - lastDisconnectToastAt > 5000) {
    lastDisconnectToastAt = now
    ElMessage.warning({
      message: '像素流连接已断开，正在自动重连…',
      duration: 4500,
      showClose: true,
    })
  }
}

const handlePlayerQueue = (e) => {
  const d = e?.detail && typeof e.detail === 'object' ? e.detail : {}
  isInPlayerQueue.value = true
  const s = d.seq ?? d.position ?? d.index
  queueSeq.value = s != null && s !== '' ? s : null
}

const handlePlaying = () => {
  

  isInPlayerQueue.value = false
  queueSeq.value = null

  // 自动获取焦点以便接收键盘事件
  if (videoRef.value) {
    videoRef.value.focus()
  }

  // 检查 Data Channel 状态
  if (videoRef.value && videoRef.value.dc) {
    
    if (videoRef.value.dc.readyState === 'open') {
      isPlaying.value = true
      ElMessage.success('像素流及数据通道已就绪')
    } else {
      // 监听开启事件
      videoRef.value.dc.onopen = () => {
        
        isPlaying.value = true
        ElMessage.success('数据通道已开启')
      }
    }
  } else {
    // 如果还没创建 dc，可能需要等一下或者监听 ondatachannel
    console.warn('⚠️ Data Channel not yet created')
    isPlaying.value = true // 依然显示按钮，尝试发送
  }
}

const handleUeDisconnected = () => {
  console.warn('❌ UE instance disconnected')
  isPlaying.value = false
  isInPlayerQueue.value = false
  queueSeq.value = null
  ElMessage.warning('UE 实例异常断开')
}

// 明确调用 emitMessage
const emitMessage = (msg) => {
  if (!videoRef.value) {
    console.error('❌ Video element not loaded')
    return false
  }

  const dc = videoRef.value.dc

  if (!dc) {
    console.error('❌ Data Channel not created')
    return false
  }

  if (dc.readyState !== 'open') {
    console.warn(`⚠️ Data Channel not ready (status: ${dc.readyState})`)
    return false
  }

  // 检查缓冲区，避免过载
  const bufferThreshold = 16 * 1024 * 1024 // 16MB
  if (dc.bufferedAmount > bufferThreshold) {
    console.warn(
      `⚠️ Buffer full (${(dc.bufferedAmount / 1024 / 1024).toFixed(2)}MB), message queued`,
    )
    return false
  }

  try {
    // 计算消息大小
    const msgSize = JSON.stringify(msg).length
    

    // 打印完整的发送数据
    

    // 如果数据是JSON字符串，尝试解析并美化打印
    if (msg.data && typeof msg.data === 'string') {
      try {
        const parsedData = JSON.parse(msg.data)
        
      } catch (e) {
        
      }
    }

    videoRef.value.emitMessage(msg)
    return true
  } catch (err) {
    console.error('❌ Error sending message:', err)
    return false
  }
}

// 导出方法供父组件调用
defineExpose({
  emitMessage,
})

onMounted(() => {
  if (!signalUrl) {
    ElMessage.error('未配置像素流信令地址')
    return
  }

  // 检查是否已注册
  if (customElements.get('peer-stream')) {
    isPeerStreamLoaded.value = true
    initEventListeners()
    return
  }

  // 动态加载 peer-stream.js（作为 module）
  const script = document.createElement('script')
  script.type = 'module'
  script.src = '/peer-stream.js' // 确保文件放在 public/peer-stream.js

  script.onload = () => {
    
    isPeerStreamLoaded.value = true
    initEventListeners()
  }

  script.onerror = (err) => {
    console.error('❌ Failed to load peer-stream.js', err)
    ElMessage.error('像素流脚本加载失败')
  }

  document.head.appendChild(script)
})

const initEventListeners = () => {
  if (listenersInitialized) return

  // 延迟一会确保 videoRef 已绑定
  initListenersTimer = setTimeout(() => {
    initListenersTimer = null
    if (videoRef.value) {
      listenersInitialized = true
      videoRef.value.addEventListener('message', handleMessage)
      videoRef.value.addEventListener('playing', handlePlaying)
      videoRef.value.addEventListener('playerqueue', handlePlayerQueue)
      videoRef.value.addEventListener('playerdisconnected', handlePlayerDisconnected)
      videoRef.value.addEventListener('ueDisConnected', handleUeDisconnected)

      // 监听data channel状态
      const setupDataChannelMonitoring = () => {
        const dc = videoRef.value.dc
        if (dc) {
          

          dc.onclose = () => {
            console.warn('❌ Data Channel closed（信令恢复后会重建）')
            isPlaying.value = false
          }

          dc.onerror = (error) => {
            console.error('❌ Data Channel error:', error)
            ElMessage.error('数据通道错误')
          }

          dc.onopen = () => {
            
          }

          // 定期检查缓冲区状态
          bufferMonitorTimer = setInterval(() => {
            if (dc.readyState === 'open' && dc.bufferedAmount > 0) {
              
            }
          }, 5000) // 每5秒检查一次
        } else {
          // 如果dc还没创建，延迟重试
          dataChannelRetryTimer = setTimeout(() => {
            dataChannelRetryTimer = null
            setupDataChannelMonitoring()
          }, 500)
        }
      }

      setupDataChannelMonitoring()

      // 监听全局鼠标锁定变化
      document.addEventListener('pointerlockchange', handlePointerLockChange)
    }
  }, 100)
}

onBeforeUnmount(() => {
  if (initListenersTimer) {
    clearTimeout(initListenersTimer)
    initListenersTimer = null
  }
  if (dataChannelRetryTimer) {
    clearTimeout(dataChannelRetryTimer)
    dataChannelRetryTimer = null
  }
  if (bufferMonitorTimer) {
    clearInterval(bufferMonitorTimer)
    bufferMonitorTimer = null
  }

  if (videoRef.value) {
    videoRef.value.removeEventListener('message', handleMessage)
    videoRef.value.removeEventListener('playing', handlePlaying)
    videoRef.value.removeEventListener('playerqueue', handlePlayerQueue)
    videoRef.value.removeEventListener(
      'playerdisconnected',
      handlePlayerDisconnected,
    )
    videoRef.value.removeEventListener('ueDisConnected', handleUeDisconnected)
    document.removeEventListener('pointerlockchange', handlePointerLockChange)
  }
  listenersInitialized = false
})
</script>

<style scoped src="@/assets/styles/components/PixelStreamingPlayer.css"></style>
