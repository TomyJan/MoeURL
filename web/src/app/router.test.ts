import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRequireAdminAccess, createRequireConsoleAccess, createRequireSignedIn, requireAdminAccess, requireConsoleAccess, requireSignedIn, router, routes } from './router'
import { me } from '@/entities/auth/api'
import HomePage from '@/pages/HomePage.vue'

vi.mock('@/entities/auth/api', () => ({
  me: vi.fn(async () => ({
    user: { id: 'admin-id', username: 'admin', nickname: 'Admin', group: 'admin', permissions: ['admin:access', 'short_link:read_own'] },
  })),
}))

describe('router', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    if (router.currentRoute.value.path !== '/') {
      await router.push('/')
    }
  })

  it('contains fixed singular page routes', () => {
    const routePaths = routes.flatMap((route) => [route.path, ...(route.children?.map((child) => child.path) ?? [])])

    expect(routePaths).toEqual(
      expect.arrayContaining([
        '/',
        '/setup',
        '/login',
        '/go/:slug',
        '/profile',
        '/console',
        '/link',
        '/analytics',
        '/admin/link',
        '/admin/user',
        '/admin/user/group',
        '/admin/setting',
        '/admin/user/new',
        '/:pathMatch(.*)*',
      ]),
    )
  })

  it('marks admin routes as admin-only', () => {
    const consoleRoute = routes.find((route) => route.children)
    const adminRoutes = consoleRoute?.children?.filter((route) => route.path.startsWith('/admin/')) ?? []

    expect(adminRoutes).toHaveLength(5)
    expect(adminRoutes.every((route) => route.meta?.requiresAdmin === true)).toBe(true)
  })

  it('nests console pages under the console shell and loads page chunks lazily', async () => {
    const consoleRoute = routes.find((route) => route.children)
    const overviewRoute = consoleRoute?.children?.find((route) => route.path === '/console')
    const profileRoute = consoleRoute?.children?.find((route) => route.path === '/profile')

    expect(consoleRoute?.children?.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/profile', '/link', '/admin/link', '/admin/user', '/admin/user/new']),
    )
    expect(profileRoute?.meta?.requiresSignedIn).toBe(true)
    expect(profileRoute?.beforeEnter).toBe(requireSignedIn)
    expect(consoleRoute?.children?.filter((route) => route.meta?.requiresConsole === true).every((route) => route.path !== '/profile')).toBe(true)
    expect(typeof overviewRoute?.component).toBe('function')
    expect(typeof consoleRoute?.children?.find((route) => route.path === '/analytics')?.component).toBe('function')
    expect(typeof consoleRoute?.children?.find((route) => route.path === '/admin/link')?.component).toBe('function')

    const lazyChildren = consoleRoute?.children ?? []
    const loadedPages = await Promise.all(lazyChildren.map((route) => (
      route.component as () => Promise<{ default: unknown }>
    )()))
    expect(loadedPages.every((page) => page.default)).toBe(true)
  })

  it('registers the public redirect page as a lazy route without an access guard', async () => {
    const redirectRoute = routes.find((route) => route.path === '/go/:slug')

    expect(typeof redirectRoute?.component).toBe('function')
    expect(redirectRoute?.beforeEnter).toBeUndefined()
    const loadedPage = await (redirectRoute?.component as () => Promise<{ default: unknown }>)()
    expect(loadedPage.default).toBeTruthy()
  })

  it('resolves the public root path to home before the console shell parent', async () => {
    await router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.matched[0]?.components?.default).toBe(HomePage)
  })

  it('allows signed-in users and redirects guests before entering console routes', async () => {
    const regular = vi.fn(async () => ({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: ['short_link:read_own'] },
    }))
    const withoutOwnLinks = vi.fn(async () => ({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] },
    }))
    const guest = vi.fn(async () => ({
      user: { id: 'guest-id', username: 'guest', nickname: 'Guest', group: 'guest', permissions: [] },
    }))
    const failed = vi.fn(async () => {
      throw new Error('session unavailable')
    })

    await expect(createRequireConsoleAccess(regular)()).resolves.toBe(true)
    await expect(createRequireConsoleAccess(withoutOwnLinks)()).resolves.toBe('/')
    await expect(createRequireConsoleAccess(guest)({ fullPath: '/link' } as never, {} as never, vi.fn())).resolves.toEqual({
      path: '/login',
      query: { redirect: '/link' },
    })
    await expect(createRequireConsoleAccess(failed)({ fullPath: '/console' } as never, {} as never, vi.fn())).resolves.toEqual({
      path: '/login',
      query: { redirect: '/console' },
    })
    await expect(createRequireConsoleAccess(guest)()).resolves.toBe('/login')
  })

  it('allows signed-in users without console permissions before entering profile routes', async () => {
    const regular = vi.fn(async () => ({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] },
    }))
    const guest = vi.fn(async () => ({
      user: { id: 'guest-id', username: 'guest', nickname: 'Guest', group: 'guest', permissions: [] },
    }))
    const failed = vi.fn(async () => {
      throw new Error('session unavailable')
    })

    await expect(createRequireSignedIn(regular)()).resolves.toBe(true)
    await expect(createRequireSignedIn(guest)({ fullPath: '/profile' } as never, {} as never, vi.fn())).resolves.toEqual({
      path: '/login',
      query: { redirect: '/profile' },
    })
    await expect(createRequireSignedIn(failed)({ fullPath: '/profile?tab=account' } as never, {} as never, vi.fn())).resolves.toEqual({
      path: '/login',
      query: { redirect: '/profile?tab=account' },
    })
  })

  it('allows admins and redirects non-admin users before entering admin routes', async () => {
    const admin = vi.fn(async () => ({
      user: { id: 'admin-id', username: 'admin', nickname: 'Admin', group: 'admin', permissions: ['admin:access'] },
    }))
    const regular = vi.fn(async () => ({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] },
    }))
    const guest = vi.fn(async () => ({
      user: { id: 'guest-id', username: 'guest', nickname: 'Guest', group: 'guest', permissions: [] },
    }))
    const failed = vi.fn(async () => {
      throw new Error('session unavailable')
    })

    await expect(createRequireAdminAccess(admin)()).resolves.toBe(true)
    await expect(createRequireAdminAccess(regular)()).resolves.toBe('/')
    await expect(createRequireAdminAccess(guest)({ fullPath: '/admin/user' } as never, {} as never, vi.fn())).resolves.toEqual({
      path: '/login',
      query: { redirect: '/admin/user' },
    })
    await expect(createRequireAdminAccess(failed)({ fullPath: '/admin/link' } as never, {} as never, vi.fn())).resolves.toEqual({
      path: '/login',
      query: { redirect: '/admin/link' },
    })
  })

  it('uses the current user API when invoked as a route guard', async () => {
    await expect(requireConsoleAccess()).resolves.toBe(true)
    await expect(requireAdminAccess()).resolves.toBe(true)
    await expect(requireSignedIn()).resolves.toBe(true)

    expect(me).toHaveBeenCalled()
  })

  it('redirects signed-in users without own-link read permission during console navigation', async () => {
    vi.mocked(me).mockResolvedValueOnce({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] },
    })

    await router.push('/link')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
    expect(me).toHaveBeenCalled()
  })

  it('allows signed-in users to open the profile route without console permissions', async () => {
    vi.mocked(me).mockResolvedValueOnce({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] },
    })

    await router.push('/profile')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/profile')
    expect(me).toHaveBeenCalled()
  })

  it('redirects non-admin users during actual router navigation', async () => {
    vi.mocked(me).mockResolvedValueOnce({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] },
    })

    await router.push('/admin/user')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
    expect(me).toHaveBeenCalled()
  })

  it('redirects guests during actual router navigation', async () => {
    vi.mocked(me).mockResolvedValueOnce({
      user: { id: 'guest-id', username: 'guest', nickname: 'Guest', group: 'guest', permissions: [] },
    })

    await router.push('/admin/user')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/admin/user')
    expect(me).toHaveBeenCalled()
  })

  it('redirects guests during actual profile navigation', async () => {
    vi.mocked(me).mockResolvedValueOnce({
      user: { id: 'guest-id', username: 'guest', nickname: 'Guest', group: 'guest', permissions: [] },
    })

    await router.push('/profile')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/profile')
    expect(me).toHaveBeenCalled()
  })

  it('registers the admin guard on concrete admin routes', () => {
    const adminRoute = router.getRoutes().find((route) => route.path === '/admin/user')

    expect(adminRoute?.beforeEnter).toBe(requireAdminAccess)
  })

  it('registers the console guard on concrete console routes', () => {
    const linksRoute = router.getRoutes().find((route) => route.path === '/link')

    expect(linksRoute?.beforeEnter).toBe(requireConsoleAccess)
  })

  it('registers the signed-in guard on the profile route', () => {
    const profileRoute = router.getRoutes().find((route) => route.path === '/profile')

    expect(profileRoute?.beforeEnter).toBe(requireSignedIn)
  })
})
