import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard'
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: () => import('../views/Dashboard.vue')
    },
    {
      path: '/nodes',
      name: 'Nodes',
      component: () => import('../views/Nodes.vue')
    },
    {
      path: '/tunnels',
      name: 'Tunnels',
      component: () => import('../views/Tunnels.vue')
    },
    {
      path: '/monitor',
      name: 'Monitor',
      component: () => import('../views/Monitor.vue')
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('../views/Settings.vue')
    }
  ]
})

export default router
