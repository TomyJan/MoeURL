import type { NavigationGuard, RouteLocationRaw, RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import type { CurrentUser } from '@/entities/auth/api'
import { me } from '@/entities/auth/api'
import HomePage from '@/pages/HomePage.vue'
import LoginPage from '@/pages/LoginPage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'
import SetupPage from '@/pages/SetupPage.vue'
import ConsoleShell from '@/widgets/console-shell/ConsoleShell.vue'

type AccessGuard = NavigationGuard & (() => Promise<true | string | RouteLocationRaw>)
type AccessDecision = true | string | RouteLocationRaw
type AccessDecisionPredicate = (user: CurrentUser, loginRedirect: RouteLocationRaw) => AccessDecision

/** Builds a login route that preserves the originally requested console path. */
function createLoginRedirect(fullPath?: string): RouteLocationRaw {
  if (!fullPath) {
    return '/login'
  }
  return { path: '/login', query: { redirect: fullPath } }
}

/** Wraps a current-user decision in a router guard that fails closed to login. */
function createAccessGuard(loadCurrentUser = me, decideAccess: AccessDecisionPredicate): AccessGuard {
  /** Resolves identity once and applies the supplied access decision. */
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

/** Creates a guard that admits signed-in users with personal short-link access. */
export function createRequireConsoleAccess(loadCurrentUser = me): AccessGuard {
  return createAccessGuard(loadCurrentUser, (user, loginRedirect) => {
    if (user.group === 'guest') {
      return loginRedirect
    }
    return user.permissions.includes('short_link:read_own') ? true : '/'
  })
}

/** Creates a guard that rejects the built-in guest identity. */
export function createRequireSignedIn(loadCurrentUser = me): AccessGuard {
  return createAccessGuard(loadCurrentUser, (user, loginRedirect) => {
    if (user.group === 'guest') {
      return loginRedirect
    }
    return true
  })
}

/** Creates a guard that requires the administrative access permission. */
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
  { path: '/go/:slug', component: () => import('@/pages/RedirectPage.vue') },
  {
    path: '/',
    component: ConsoleShell,
    children: [
      {
        path: '/profile',
        component: () => import('@/pages/ProfilePage.vue'),
        meta: { requiresSignedIn: true },
        beforeEnter: requireSignedIn,
      },
      {
        path: '/console',
        component: () => import('@/pages/ConsoleOverviewPage.vue'),
        meta: { requiresConsole: true },
        beforeEnter: requireConsoleAccess,
      },
      { path: '/link', component: () => import('@/pages/MyLinksPage.vue'), meta: { requiresConsole: true }, beforeEnter: requireConsoleAccess },
      {
        path: '/analytics',
        component: () => import('@/pages/AnalyticsPage.vue'),
        meta: { requiresConsole: true },
        beforeEnter: requireConsoleAccess,
      },
      {
        path: '/admin/link',
        component: () => import('@/pages/AdminLinksPage.vue'),
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
      {
        path: '/admin/user',
        component: () => import('@/pages/AdminUsersPage.vue'),
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
      {
        path: '/admin/user/group',
        component: () => import('@/pages/ConsolePlaceholderPage.vue'),
        props: { kind: 'userGroups' },
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
      {
        path: '/admin/setting',
        component: () => import('@/pages/ConsolePlaceholderPage.vue'),
        props: { kind: 'settings' },
        meta: { requiresConsole: true, requiresAdmin: true },
        beforeEnter: requireAdminAccess,
      },
      {
        path: '/admin/user/new',
        component: () => import('@/pages/CreateUserPage.vue'),
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
