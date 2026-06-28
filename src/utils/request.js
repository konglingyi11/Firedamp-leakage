import axios from 'axios'

const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/**
 * 临时全局 Mock 开关：true 时所有 axios 请求都不发往真实后端，
 * 直接返回结构合理的空数据，避免后端不可用时弹出红色错误弹窗。
 * 后端恢复后改为 false 即可。
 */
const MOCK_ALL_REQUESTS = true

/**
 * 为 GET 请求根据 URL 返回合理的空数据结构，
 * 让调用方拿到"成功但无数据"的响应，业务逻辑不会因结构异常崩溃。
 */
function mockGetData(url) {
  // 列表类接口：返回空数组
  if (/(\/tasks\/?|\/workers\/?|\/models\/?|\/color-maps\/?|\/ribbons\/?|\/variables|\/time-steps)/.test(url)) {
    return []
  }
  // 分页类接口：返回空分页结构
  if (/\/(models|tasks)\b/.test(url)) {
    return { items: [], total: 0, page: 1, pageSize: 20 }
  }
  // progress 类：返回 0 进度
  if (/\/progress/.test(url)) {
    return { progress: 0, status: 'idle' }
  }
  // health 类
  if (/\/health/.test(url)) {
    return { status: 'ok' }
  }
  // geometry-bounds / plane-variable-bounds
  if (/bounds/.test(url)) {
    return null
  }
  // 其他详情类：返回空对象
  return {}
}

/**
 * 自定义 axios adapter：拦截所有请求，返回 mock 响应。
 * 响应结构模拟后端统一格式 { code: 200, data: ..., message: 'OK' }，
 * 让响应拦截器走成功分支，调用方拿到 mock data。
 */
function createMockAdapter() {
  return function mockAdapter(config) {
    const method = (config.method || 'get').toLowerCase()
    let data
    if (method === 'get') {
      data = mockGetData(config.url || '')
    } else {
      // POST/PUT/DELETE/PATCH：返回成功操作结果
      data = { success: true, id: Date.now() }
    }
    const response = {
      data: { code: 200, data, message: 'OK (mock)' },
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config,
      request: {},
    }
    return Promise.resolve(response)
  }
}

// 创建 axios 实例
const service = axios.create({
  baseURL: localStorage.getItem('apiBaseUrl') || DEFAULT_BASE_URL,
  timeout: 6000000,
  headers: {
    'Content-Type': 'application/json;charset=UTF-8'
  },
  // 全局 Mock：拦截所有请求，不发往真实后端
  adapter: MOCK_ALL_REQUESTS ? createMockAdapter() : undefined,
})

export function getBaseUrl() {
  return service.defaults.baseURL
}

export function setBaseUrl(url) {
  const normalized = (url || '').replace(/\/+$/, '') || DEFAULT_BASE_URL
  service.defaults.baseURL = normalized
  localStorage.setItem('apiBaseUrl', normalized)
}

// 请求拦截器
service.interceptors.request.use(
  config => {
    // 在请求发送之前做些什么
    // 可以在这里添加 token
    const token = localStorage.getItem('token')
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  error => {
    // 请求错误处理
    console.error('请求错误：', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
service.interceptors.response.use(
  response => {
    // 对响应数据做些什么
    const res = response.data

    // 根据后端返回的状态码进行处理
    // 这里假设后端返回格式为 { code: 200, data: {}, message: '' }
    if (res.code !== 200 && res.code !== 0 && res.code !== "00000") {
      // 业务状态码错误统一交给调用方处理，不再全局弹 ElMessage
      if (res.code === 401) {
        // token 过期或未登录
        localStorage.removeItem('token')
        // 可以跳转到登录页
        // router.push('/login')
      }

      return Promise.reject(new Error(res.message || '请求失败'))
    } else {
      return res.data || res
    }
  },
  error => {
    // 响应错误处理
    console.error('响应错误：', error)

    let message = '请求失败'
    if (error.response) {
      switch (error.response.status) {
        case 400:
          message = '请求参数错误'
          break
        case 401:
          message = '未授权，请重新登录'
          localStorage.removeItem('token')
          // router.push('/login')
          break
        case 403:
          message = '拒绝访问'
          break
        case 404:
          message = '请求地址不存在'
          break
        case 500:
          message = '服务器内部错误'
          break
        case 502:
          message = '网关错误'
          break
        case 503:
          message = '服务不可用'
          break
        case 504:
          message = '网关超时'
          break
        default:
          message = `连接错误 ${error.response.status}`
      }
    } else if (error.message.includes('timeout')) {
      message = '请求超时'
    } else if (error.message.includes('Network Error')) {
      message = '网络连接异常'
    }

    // 网络/服务端错误统一交给调用方处理，不再全局弹 ElMessage
    // 把可读错误信息挂到 error.message 上，方便调用方自行展示
    if (error && typeof error === 'object') {
      try {
        error.message = message
      } catch {
        // message 可能只读，忽略
      }
    }
    return Promise.reject(error)
  }
)

// 封装常用的请求方法
export const request = {
  get(url, params, config = {}) {
    return service.get(url, { params, ...config })
  },

  post(url, data, config = {}) {
    return service.post(url, data, config)
  },

  put(url, data, config = {}) {
    return service.put(url, data, config)
  },

  delete(url, params, config = {}) {
    return service.delete(url, { params, ...config })
  },

  patch(url, data, config = {}) {
    return service.patch(url, data, config)
  },

  // 文件上传
  upload(url, formData, config = {}) {
    return service.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      ...config
    })
  }
}

// 默认导出 axios 实例
export default service
