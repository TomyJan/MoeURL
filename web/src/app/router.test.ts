import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRequireConsoleAccess, createRequireAdminAccess, requireAdminAccess, requireConsoleAccess, router, routes } from './router'
import { me } from '@/entities/auth/api'

vi.mock('@/entities/auth/api', () => ({
  me: vi.fn(async () => ({
    user: { id: 'admin-id', username: 'admin', nickname: 'Admin', group: 'admin', permissions: ['admin:access'] },
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

  it('nests console pages under the console shell', () => {
    const consoleRoute = routes.find((route) => route.children)

    expect(consoleRoute?.children?.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/link', '/admin/link', '/admin/user', '/admin/user/new']),
    )
    expect(consoleRoute?.children?.every((route) => route.meta?.requiresConsole === true)).toBe(true)
  })

  it('allows signed-in users and redirects guests before entering console routes', async () => {
    const regular = vi.fn(async () => ({
      user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: ['short_link:read_own'] },
    }))
    const guest = vi.fn(async () => ({
      user: { id: 'guest-id', username: 'guest', nickname: 'Guest', group: 'guest', permissions: [] },
    }))
    const failed = vi.fn(async () => {
      throw new Error('session unavailable')
    })

    await expect(createRequireConsoleAccess(regular)()).resolves.toBe(true)
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

  it('registers the admin guard on concrete admin routes', () => {
    const adminRoute = router.getRoutes().find((route) => route.path === '/admin/user')

    expect(adminRoute?.beforeEnter).toBe(requireAdminAccess)
  })

  it('registers the console guard on concrete console routes', () => {
    const linksRoute = router.getRoutes().find((route) => route.path === '/link')

    expect(linksRoute?.beforeEnter).toBe(requireConsoleAccess)
  })
})
