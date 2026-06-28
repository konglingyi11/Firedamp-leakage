import { request } from '@/utils/request'

export default {
  /**
   * 创建色带
   * @param {Object} data - 色带数据
   * @param {string} data.name - 色带名称
   * @param {string} data.color - 色带颜色
   * @param {string} data.description - 色带描述
   * @returns {Promise<Object>} - 创建的色带信息
   */
  createRibbon(data) {
    return request.post('/api/v1/color-maps/', data)
  },

  /**
   * 分页获取色带列表
   * @param {Object} params - 查询参数
   * @param {number} [params.page=1] - 页码
   * @param {number} [params.page_size=10] - 每页数量
   * @param {string} [params.name] - 色带名称
   * @returns {Promise<Object>} - 色带列表
   */
  getRibbons(params) {
    return request.get('/api/v1/color-maps/', { params })
  },

  /**
   * 获取色带详情
   * @param {string} colorMapId - 色带ID
   * @returns {Promise<Object>} - 色带详细信息
   */
  getRibbonInfo(colorMapId) {
    return request.get(`/api/v1/color-maps/${colorMapId}`)
  },

  /**
   * 修改色带
   * @param {string} colorMapId - 色带ID
   * @param {Object} data - 更新数据
   * @param {string} [data.name] - 色带名称
   * @param {string} [data.color] - 色带颜色
   * @param {string} [data.description] - 色带描述
   * @returns {Promise<Object>} - 更新后的色带信息
   */
  updateRibbon(colorMapId, data) {
    return request.put(`/api/v1/color-maps/${colorMapId}`, data)
  },

  /**
   * 删除色带
   * @param {string} colorMapId - 色带ID
   * @returns {Promise<Object>} - 删除结果
   */
  deleteRibbon(colorMapId) {
    return request.delete(`/api/v1/color-maps/${colorMapId}`)
  }
}
