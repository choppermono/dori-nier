import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

// Hash URLs (/#/about) work on any static host without a rewrite rule, so a
// refresh on the About page can never 404.
const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/about',
      name: 'about',
      // Split into its own chunk, loaded only when visited.
      component: () => import('../views/AboutView.vue'),
    },
  ],
})

export default router
