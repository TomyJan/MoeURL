import type { NavigationGuard, RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import { me } from '@/entities/auth/api'
import AdminLinksPage from '@/pages/AdminLinksPage.vue'
import AdminUsersPage from '@/pages/AdminUsersPage.vue'
import CreateUserPage from '@/pages/CreateUserPage.vue'
import HomePage from '@/pages/HomePage.vue'
import LoginPage from '@/pages/LoginPage.vue'
import MyLinksPage from '@/pages/MyLinksPage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'
import SetupPage from '@/pages/SetupPage.vue'
import ConsoleShell from '@/widgets/console-shell/ConsoleShell.vue'

type AdminAccessGuard = NavigationGuard & (() => Promise<true | string>)
type ConsoleAccessGuard = NavigationGuard & (() => Promise<true | string>)

export function createRequireConsoleAccess(loadCurrentUser = me): ConsoleAccessGuard {
  const guard = async () => {
    try {
      const result = await loadCurrentUser()
      return result.user.group === 'guest' ? '/login' : true
    } catch {
      return '/login'
    }
  }
  return guard as ConsoleAccessGuard
}

export function createRequireAdminAccess(loadCurrentUser = me): AdminAccessGuard {
  const guard = async () => {
    try {
      const result = await loadCurrentUser()
      if (result.user.permissions.includes('admin:access')) {
        return true
      }
      return result.user.group === 'guest' ? '/login' : '/'
    } catch {
      return '/login'
    }
  }
  return guard as AdminAccessGuard
}

export const requireConsoleAccess = createRequireConsoleAccess()
export const requireAdminAccess = createRequireAdminAccess()

export const routes: RouteRecordRaw[] = [
  { path: '/', component: HomePage },
  { path: '/setup', component: SetupPage },
  { path: '/login', component: LoginPage },
  {
    path: '/',
    component: ConsoleShell,
    children: [
      { path: '/link', component: MyLinksPage, meta: { requiresConsole: true }, beforeEnter: requireConsoleAccess },
      {
        path: '/admin/link',
        component: AdminLinksPage,
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
      {
        path: '/admin/user',
        component: AdminUsersPage,
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
      {
        path: '/admin/user/new',
        component: CreateUserPage,
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
    ],
  },
  { path: '/:pathMatch(.*)*', component: NotFoundPage },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
