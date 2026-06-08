import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRequireAdminAccess, requireAdminAccess, router, routes } from './router'
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
    expect(routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/setup', '/login', '/link', '/admin/link', '/admin/user', '/admin/user/new', '/:pathMatch(.*)*']),
    )
  })

  it('marks admin routes as admin-only', () => {
    const adminRoutes = routes.filter((route) => route.path.startsWith('/admin/'))

    expect(adminRoutes).toHaveLength(3)
    expect(adminRoutes.every((route) => route.meta?.requiresAdmin === true)).toBe(true)
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
    await expect(createRequireAdminAccess(guest)()).resolves.toBe('/login')
    await expect(createRequireAdminAccess(failed)()).resolves.toBe('/login')
  })

  it('uses the current user API when invoked as a route guard', async () => {
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
    expect(me).toHaveBeenCalled()
  })

  it('registers the admin guard on concrete admin routes', () => {
    const adminRoute = router.getRoutes().find((route) => route.path === '/admin/user')

    expect(adminRoute?.beforeEnter).toBe(requireAdminAccess)
  })
})
