import { request } from '@/utils/request'

/** 解包 getModelInfo 等接口返回（兼容 { code, data } 与 Vue Ref） */
export function unwrapApiModel(payload) {
  if (!payload || typeof payload !== 'object') return payload

  if (
    Object.prototype.hasOwnProperty.call(payload, 'value') &&
    payload.value &&
    typeof payload.value === 'object'
  ) {
    return unwrapApiModel(payload.value)
  }

  if (
    payload.id &&
    (payload.case_file_url ||
      payload.preview_url ||
      payload.geometry_model_url ||
      payload.geometry_model_file ||
      payload.real_model_url ||
      payload.real_model_file ||
      payload.name)
  ) {
    return payload
  }

  if (payload.data && typeof payload.data === 'object') {
    const inner = payload.data
    if (
      inner.id ||
      inner.case_file_url ||
      inner.preview_url ||
      inner.geometry_model_url ||
      inner.geometry_model_file ||
      inner.real_model_url ||
      inner.real_model_file ||
      inner.name
    ) {
      return inner
    }
  }

  return payload
}

const MODEL_UPDATE_TEXT_FIELDS = [
  'name',
  'building_type',
  'survival_space',
  'rescue_difficulty',
]

const MODEL_UPDATE_FILE_FIELDS = [
  'case_file',
  'preview_image',
  'geometry_model_file',
  'real_model_file',
]

/**
 * 模型管理 API
 * 提供 Fluent 模型文件的上传、管理和分析功能
 */
export const modelApi = {
  /**
   * 获取模型列表
   * @param {Object} [params] - 查询参数
   * @param {number} [params.page=1] - 页码
   * @param {number} [params.page_size=20] - 每页数量
   * @param {string} [params.building_type] - 建筑类型过滤
   * @returns {Promise<Object>} 模型列表
   * @returns {Promise<Array>} result.items - 模型列表
   * @returns {Promise<number>} result.total - 总数量
   */
  getModels(params) {
    return request.get('/api/v1/models/', params)
  },

  /**
   * 上传并创建模型
   * 支持的文件格式：.cas.h5, .msh.gz
   * @param {Object} data - 模型数据
   * @param {File} data.file - 模型文件（必填）
   * @param {string} [data.name] - 模型名称（可选，默认使用文件名）
   * @param {string} [data.building_type] - 建筑类别
   * @param {string} [data.survival_space] - 存活空间描述
   * @param {string} [data.rescue_difficulty] - 搜救难点描述
   * @returns {Promise<Object>} 创建的模型详情
   * @returns {Promise<string>} result.id - 模型 ID
   * @returns {Promise<string>} result.name - 模型名称
   * @returns {Promise<string>} result.file_path - 文件路径
   * @returns {Promise<string>} result.status - 模型状态: 'uploading' | 'analyzing' | 'ready' | 'error'
   * @returns {Promise<Object>} result.metadata - 模型元数据（分析完成后可用）
   */
  createModel(data) {
    const formData = new FormData()
    formData.append('file', data.file)
    if (data.name) formData.append('name', data.name)
    if (data.building_type) formData.append('building_type', data.building_type)
    if (data.survival_space)
      formData.append('survival_space', data.survival_space)
    if (data.rescue_difficulty)
      formData.append('rescue_difficulty', data.rescue_difficulty)

    return request.post('/api/v1/models/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  },

  /**
   * 获取模型详情
   * @param {string} modelId - 模型 ID
   * @returns {Promise<Object>} 模型详细信息
   * @returns {Promise<string>} result.id - 模型 ID
   * @returns {Promise<string>} result.name - 模型名称
   * @returns {Promise<string>} result.file_path - 文件路径
   * @returns {Promise<string>} result.status - 模型状态
   * @returns {Promise<string>} result.building_type - 建筑类别
   * @returns {Promise<string>} result.survival_space - 存活空间
   * @returns {Promise<string>} result.rescue_difficulty - 搜救难点
   * @returns {Promise<Object>} result.metadata - 模型元数据
   * @returns {Promise<Object>} result.metadata.geometry - 几何信息（边界框、中心点等）
   * @returns {Promise<Object>} result.metadata.mesh - 网格信息（节点数、单元数等）
   * @returns {Promise<Array>} result.metadata.boundary_conditions - 边界条件列表
   * @returns {Promise<string>} result.created_at - 创建时间
   * @returns {Promise<string>} result.updated_at - 更新时间
   */
  getModelInfo(modelId) {
    return request.get(`/api/v1/models/${modelId}`)
  },

  /**
   * 修改模型信息
   * @param {string} modelId - 模型 ID
   * @param {Object} data - 更新数据
   * @param {string|null} [data.name] - 模型名称
   * @param {string|null} [data.building_type] - 建筑类别
   * @param {string|null} [data.survival_space] - 存活空间
   * @param {string|null} [data.rescue_difficulty] - 搜救难点
   * @param {File|null} [data.case_file] - Case 模型文件 (.cas / .cas.h5)
   * @param {File|null} [data.preview_image] - 预览图
   * @param {File|null} [data.geometry_model_file] - 几何模型 (.fbx / .glb / .gltf / .obj / .stl)
   * @param {File|null} [data.real_model_file] - 真实模型 (.fbx / .glb / .gltf / .obj / .stl)
   * @returns {Promise<Object>} 更新后的模型详情
   */
  async updateModel(modelId, data) {
    const formData = new FormData()

    for (const key of MODEL_UPDATE_TEXT_FIELDS) {
      if (data?.[key] !== undefined && data?.[key] !== null) {
        formData.append(key, data[key])
      }
    }

    for (const key of MODEL_UPDATE_FILE_FIELDS) {
      if (typeof File !== 'undefined' && data?.[key] instanceof File) {
        formData.append(key, data[key])
      }
    }

    return request.put(`/api/v1/models/${modelId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  },

  /**
   * 手动触发模型分析
   * 用于重新分析模型元数据（几何、网格、边界条件等）
   * @param {string} modelId - 模型 ID
   * @returns {Promise<Object>} 触发结果
   * @returns {Promise<boolean>} result.success - 是否成功触发
   * @returns {Promise<string>} result.message - 结果消息
   * @returns {Promise<string>} result.status - 模型当前状态
   */
  analyzeModel(modelId) {
    return request.post(`/api/v1/models/${modelId}/analyze`)
  },

  /**
   * 删除模型
   * 注意：删除模型会同时删除关联的所有任务和计算结果
   * @param {string} modelId - 模型 ID
   * @returns {Promise<Object>} 删除结果
   * @returns {Promise<boolean>} result.success - 是否成功
   * @returns {Promise<string>} result.message - 结果消息
   */
  deleteModel(modelId) {
    return request.delete(`/api/v1/models/${modelId}`)
  },
}

export default modelApi
