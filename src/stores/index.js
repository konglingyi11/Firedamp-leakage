import { createPinia } from 'pinia'

const pinia = createPinia()

export default pinia
export { useTaskStore } from './task.js'
export { useMonitoringPointStore } from './monitoringPoints.js'
