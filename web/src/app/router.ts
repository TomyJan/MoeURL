import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import AdminLinksPage from '@/pages/AdminLinksPage.vue'
import AdminUsersPage from '@/pages/AdminUsersPage.vue'
import CreateUserPage from '@/pages/CreateUserPage.vue'
import HomePage from '@/pages/HomePage.vue'
import LoginPage from '@/pages/LoginPage.vue'
import MyLinksPage from '@/pages/MyLinksPage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'
import SetupPage from '@/pages/SetupPage.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', component: HomePage },
  { path: '/setup', component: SetupPage },
  { path: '/login', component: LoginPage },
  { path: '/links', component: MyLinksPage },
  { path: '/admin/links', component: AdminLinksPage },
  { path: '/admin/users', component: AdminUsersPage },
  { path: '/admin/users/new', component: CreateUserPage },
  { path: '/:pathMatch(.*)*', component: NotFoundPage },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
