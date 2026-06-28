import { onMounted, onBeforeUnmount } from 'vue'

/**
 * UE 消息总线，统一管理前端到 UE Pixel Streaming 的消息发送。
 * 取代原来散落在 HomeView.vue 30+ 处的 playerRef.value.emitMessage({...}) 调用，
 * 提供类型化的发送方法和统一的日志记录。
 * @param {import('vue').Ref} playerRef - PixelStreamingPlayer 组件 ref
 */
export function useUeMessageBus(playerRef) {
  // ── 核心发送方法 ──

  /**
   * 发送消息给 UE（底层方法）
   * @param {string} type - 消息类型
   * @param {object} data - 消息数据（会被 JSON.stringify）
   * @param {string} [logTag=''] - 日志前缀标签
   * @returns {boolean} 是否成功发送
   */
  function emit(type, data = {}, logTag = '') {
    if (!playerRef.value) {
      console.warn(`[UE Bus] playerRef 未就绪，消息 "${type}" 未发送`)
      return false
    }
    const payload = {
      type,
      data: JSON.stringify(data),
    }
    playerRef.value.emitMessage(payload)
    const prefix = logTag ? `[${logTag}]` : '[UE Bus]'
    
    return true
  }

  // ── 类型化发送方法 ──

  /** 重置关卡（清空 UE 场景） */
  function resetLevel() {
    emit('resetLevel', {}, '发往 UE')
  }

  /** 重置可视化设置 */
  function resetSettings(config) {
    emit('resetSettings', config, '发往 UE')
  }

  /** 加载建筑模型 */
  function loadBuilding(taskId, modelId) {
    emit('Loadbuilding', { task_id: taskId, modelid: modelId }, 'UE SEND')
  }

  /** 生成角色 */
  function spawnActor(name) {
    emit('spawnActor', { name }, '发往 UE')
  }

  /** 更新动画速度 */
  function updateAnimationSpeed(speed) {
    emit('updateAnimationSpeed', { speed }, '发往 UE')
  }

  /** 动画帧更新 */
  function animationUpdate(payload) {
    emit('animationUpdate', payload, '动画同步')
  }

  /** 2D 云图参数（分片带 URLs） */
  function update2DContourParams1(payload) {
    emit('update2DContourParams1', payload, '应用设置')
  }

  /** 2D 矢量参数（分片带 URLs） */
  function update2DVectorParams(payload) {
    emit('update2DVectorParams', payload, '应用设置')
  }

  /** 2D 云图参数（不带 URLs，初始化用） */
  function update2DContourParams(payload) {
    emit('update2DContourParams', payload, '发往 UE')
  }

  /** 3D 体渲染纹理更新 */
  function updateCloudTexture(payload) {
    emit('updateCloudTexture', payload, '同步到 UE')
  }

  function updateVolumeTextureParams(payload) {
    emit('updateVolumeTextureParams', payload, '同步到 UE')
  }

  /** 3D 体渲染帧更新 */
  function updateCloud(payload) {
    emit('updateCloud', payload, '动画同步')
  }

  /** 流线图清空 */
  function clearStreamLine() {
    emit('clearStreamLine', {}, '发往 UE')
  }

  /** 流线图更新 */
  function updateStreamLine(payload) {
    emit('updateStreamLine', payload, '同步到 UE')
  }

  function updateStreamlineParams(payload) {
    emit('updateStreamlineParams', payload, '同步到 UE')
  }

  /** 图层可见性通知 */
  function vizLayerVisibility(payload) {
    emit('vizLayerVisibility', payload, '发往 UE')
  }

  /** 图层可见性重置 */
  function vizLayerVisibilityReset() {
    emit(
      'vizLayerVisibility',
      {
        id: '',
        name: '',
        visible: false,
        kind: 'contour',
        layer_type: 'contour',
        layer_type_name: '',
        layer_id: '',
        label: '',
        layers: [],
        reset: true,
      },
      '发往 UE',
    )
  }

  /** 聚焦平面 */
  function focusPlane(data) {
    emit('focusPlane', data)
  }

  /** 添加监测点 */
  function addPoint(data) {
    emit('addPoint', data, '发往 UE')
  }

  /** 更新监测点 */
  function updatePoint(data) {
    emit('updatePoint', data, '发往 UE')
  }

  /** 删除监测点 */
  function deletePoint(data) {
    emit('deletePoint', data, '发往 UE')
  }

  /** 更新建筑 */
  function updateBuilding() {
    emit('updateBuilding', {}, '发往 UE')
  }

  // ── 生命周期：页面卸载时自动 resetLevel ──

  function handlePageHide(e) {
    if (e.persisted) return
    resetLevel()
  }

  function handleBeforeUnload() {
    resetLevel()
  }

  onMounted(() => {
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    window.removeEventListener('pagehide', handlePageHide)
    resetLevel()
  })

  return {
    emit,
    resetLevel,
    resetSettings,
    loadBuilding,
    spawnActor,
    updateAnimationSpeed,
    animationUpdate,
    update2DContourParams,
    update2DContourParams1,
    update2DVectorParams,
    updateCloudTexture,
    updateVolumeTextureParams,
    updateCloud,
    clearStreamLine,
    updateStreamLine,
    updateStreamlineParams,
    vizLayerVisibility,
    vizLayerVisibilityReset,
    focusPlane,
    addPoint,
    updatePoint,
    deletePoint,
    updateBuilding,
  }
}

