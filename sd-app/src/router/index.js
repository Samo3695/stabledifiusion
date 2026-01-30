import { createRouter, createWebHistory } from 'vue-router'
import App from '../App.vue'
import GameView from '../GameView.vue'

const routes = [
  {
    path: '/',
    name: 'Editor',
    component: App
  },
  {
    path: '/game',
    name: 'Game',
    component: GameView
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
