/**
 * 采空区（goaf）任务接口模拟数据
 * 当后端接口不可达时，用这组数据让采空区任务可以正常加载和演示。
 */

export const MOCK_GOAF_TASK_ID = 'mock-goaf-task'
export const MOCK_GOAF_MODEL_ID = 'mock-goaf-model'

const GOAF_GEOMETRY_MODEL_URL =
  'https://caikongqu-1315816428.cos.ap-nanjing.myqcloud.com/采空区/场景.glb'
const GOAF_REAL_MODEL_URL = 'https://caikongqu-1315816428.cos.ap-nanjing.myqcloud.com/采空区/场景.glb'

export function isGoafMockEnabled() {
  // 当前阶段所有后端接口都走模拟数据，无需请求真实后端
  return true
}

export function setGoafMockEnabled(enabled) {
  if (enabled) {
    localStorage.setItem('mockGoaf', '1')
  } else {
    localStorage.removeItem('mockGoaf')
  }
}

export function createMockGoafTask(overrides = {}) {
  const now = new Date().toISOString()
  return {
    id: MOCK_GOAF_TASK_ID,
    name: '采空区瓦斯泄漏模拟',
    description: '本地模拟任务，用于后端接口不可达时演示采空区瓦斯泄漏效果',
    status: 'completed',
    model_id: MOCK_GOAF_MODEL_ID,
    worker_id: 'mock-worker',
    params: {},
    runtime_config: {
      time_steps: 10,
      time_step_size: 0.1,
      iterations_per_time_step: 10,
      processes: 1,
    },
    created_at: now,
    updated_at: now,
    started_at: now,
    completed_at: now,
    ...overrides,
  }
}

export function createMockGoafModelInfo(overrides = {}) {
  return {
    id: MOCK_GOAF_MODEL_ID,
    name: '采空区场景模型',
    building_type: 'goaf',
    geometry_model_url: GOAF_GEOMETRY_MODEL_URL,
    geometry_model_file: GOAF_GEOMETRY_MODEL_URL,
    real_model_url: GOAF_REAL_MODEL_URL,
    real_model_file: GOAF_REAL_MODEL_URL,
    glb_url: GOAF_GEOMETRY_MODEL_URL,
    glbFileUrl: GOAF_GEOMETRY_MODEL_URL,
    preview_url:
      'https://caikongqu-1315816428.cos.ap-nanjing.myqcloud.com/采空区/图片.png',
    ...overrides,
  }
}

export function createMockGoafMetadata(overrides = {}) {
  return {
    geometry: {
      bounds: {
        min: [-1200, -800, -600],
        max: [1200, 800, 600],
      },
      center: [0, 0, 0],
    },
    mesh: {
      nodes: 10000,
      elements: 5000,
    },
    physics: {
      operating_temperature: 300,
      operating_pressure: 101325,
    },
    variables: [
      'Temperature',
      'Pressure',
      'VelocityMagnitude',
      'Mass_fraction_of_ch4',
    ],
    boundary_conditions: [],
    ...overrides,
  }
}

export function createMockGoafTimeSteps(overrides = {}) {
  return {
    time_steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    physical_times: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    ...overrides,
  }
}

export function createMockGoafGeometryBounds(overrides = {}) {
  return {
    min: [-1200, -800, -600],
    max: [1200, 800, 600],
    ...overrides,
  }
}
