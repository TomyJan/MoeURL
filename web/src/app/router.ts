import type { NavigationGuard, RouteLocationRaw, RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import type { CurrentUser } from '@/entities/auth/api'
import { me } from '@/entities/auth/api'
import AdminLinksPage from '@/pages/AdminLinksPage.vue'
import AdminUsersPage from '@/pages/AdminUsersPage.vue'
import AnalyticsPage from '@/pages/AnalyticsPage.vue'
import ConsoleOverviewPage from '@/pages/ConsoleOverviewPage.vue'
import ConsolePlaceholderPage from '@/pages/ConsolePlaceholderPage.vue'
import CreateUserPage from '@/pages/CreateUserPage.vue'
import HomePage from '@/pages/HomePage.vue'
import LoginPage from '@/pages/LoginPage.vue'
import MyLinksPage from '@/pages/MyLinksPage.vue'
import ProfilePage from '@/pages/ProfilePage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'
import SetupPage from '@/pages/SetupPage.vue'
import ConsoleShell from '@/widgets/console-shell/ConsoleShell.vue'

type AccessGuard = NavigationGuard & (() => Promise<true | string | RouteLocationRaw>)
type AccessDecision = true | string | RouteLocationRaw
type AccessDecisionPredicate = (user: CurrentUser, loginRedirect: RouteLocationRaw) => AccessDecision

function createLoginRedirect(fullPath?: string): RouteLocationRaw {
  if (!fullPath) {
    return '/login'
  }
  return { path: '/login', query: { redirect: fullPath } }
}

function createAccessGuard(loadCurrentUser = me, decideAccess: AccessDecisionPredicate): AccessGuard {
  const guard = async (to?: { fullPath?: string }) => {
    const loginRedirect = createLoginRedirect(to?.fullPath)
    try {
      const result = await loadCurrentUser()
      return decideAccess(result.user, loginRedirect)
    } catch {
      return loginRedirect
    }
  }
  return guard as AccessGuard
}

export function createRequireConsoleAccess(loadCurrentUser = me): AccessGuard {
  return createAccessGuard(loadCurrentUser, (user, loginRedirect) => {
    if (user.group === 'guest') {
      return loginRedirect
    }
    return user.permissions.includes('short_link:read_own') ? true : '/'
  })
}

export function createRequireSignedIn(loadCurrentUser = me): AccessGuard {
  return createAccessGuard(loadCurrentUser, (user, loginRedirect) => {
    if (user.group === 'guest') {
      return loginRedirect
    }
    return true
  })
}

export function createRequireAdminAccess(loadCurrentUser = me): AccessGuard {
  return createAccessGuard(loadCurrentUser, (user, loginRedirect) => {
    if (user.permissions.includes('admin:access')) {
      return true
    }
    return user.group === 'guest' ? loginRedirect : '/'
  })
}

export const requireConsoleAccess = createRequireConsoleAccess()
export const requireSignedIn = createRequireSignedIn()
export const requireAdminAccess = createRequireAdminAccess()

export const routes: RouteRecordRaw[] = [
  // Keep the public homepage before the ConsoleShell parent: both records use '/', and vue-router resolves by definition order.
  { path: '/', component: HomePage },
  { path: '/setup', component: SetupPage },
  { path: '/login', component: LoginPage },
  {
    path: '/',
    component: ConsoleShell,
    children: [
      {
        path: '/profile',
        component: ProfilePage,
        meta: { requiresSignedIn: true },
        beforeEnter: requireSignedIn,
      },
      {
        path: '/console',
        component: ConsoleOverviewPage,
        meta: { requiresConsole: true },
        beforeEnter: requireConsoleAccess,
      },
      { path: '/link', component: MyLinksPage, meta: { requiresConsole: true }, beforeEnter: requireConsoleAccess },
      {
        path: '/analytics',
        component: AnalyticsPage,
        meta: { requiresConsole: true },
        beforeEnter: requireConsoleAccess,
      },
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
        path: '/admin/user/group',
        component: ConsolePlaceholderPage,
        props: { kind: 'userGroups' },
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
      {
        path: '/admin/setting',
        component: ConsolePlaceholderPage,
        props: { kind: 'settings' },
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
