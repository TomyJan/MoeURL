import { afterEach, describe, expect, it, vi } from 'vitest'
import { me } from '@/entities/auth/api'
import { routes } from './router'
vi.mock('@/entities/auth/api', () => ({ me: vi.fn() }))
afterEach(() => vi.clearAllMocks())
describe('insight route permission intersections', () => {
  it.each([['/admin/dashboard', 'statistics:read_all'], ['/admin/audit', 'audit:read']])('requires both capabilities on %s', async (path, capability) => {
    const route = routes.find((item) => item.children)?.children?.find((item) => item.path === path)
    expect(route).toBeDefined()
    for (const permissions of [[], ['admin:access'], [capability], ['admin:access', capability]]) {
      vi.mocked(me).mockResolvedValue({ user: { id: 'a', username: 'admin', nickname: '', group: 'admin', permissions } })
      const result = await (route!.beforeEnter as () => Promise<unknown>)()
      expect(result).toBe(permissions.length === 2 ? true : '/')
    }
    vi.mocked(me).mockResolvedValue({ user: { id: '', username: 'guest', nickname: '', group: 'guest', permissions: [] } })
    expect(await (route!.beforeEnter as () => Promise<unknown>)()).toBe('/login')
  })
})
