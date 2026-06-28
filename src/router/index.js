import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/models',
    name: 'Models',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/models/:id/preview',
    name: 'ModelPreview',
    component: () => import('../views/ModelPreviewView.vue'),
    props: true,
  },
  {
    path: '/leida',
    name: 'Leida',
    component: () => import('../leida/LeidaDashboardView.vue'),
  },
  {
    path: '/test-shibie',
    name: 'TestShibie',
    component: () => import('../views/TestShibieView.vue'),
  },
  {
    path: '/gas-leak-demo',
    name: 'GasLeakDemo',
    component: () => import('../views/GasLeakDemoView.vue'),
  },
]

routes.push({
  path: '/:pathMatch(.*)*',
  redirect: '/',
})

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
