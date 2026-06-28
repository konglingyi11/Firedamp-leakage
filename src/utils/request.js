import axios from 'axios'
import { ElMessage } from 'element-plus'

const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

// 创建 axios 实例
const service = axios.create({
  baseURL: localStorage.getItem('apiBaseUrl') || DEFAULT_BASE_URL,
  timeout: 6000000,
  headers: {
    'Content-Type': 'application/json;charset=UTF-8'
  }
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
      // A0404：任务未启用预生成等业务提示，不弹 ElMessage
      // A0500：模型被任务占用无法删除，由调用方展示格式化提示
      if (res.code !== 'A0404' && res.code !== 'A0500') {
        ElMessage.error(res.message || '请求失败')
      }

      // 特殊状态码处理
      if (res.code === 401) {
        // token 过期或未登录
        ElMessage.error('登录已过期，请重新登录')
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

    ElMessage.error(message)
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
