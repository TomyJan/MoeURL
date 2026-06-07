import { describe, expect, it } from 'vitest'

import { routes } from './router'

describe('router', () => {
  it('contains fixed singular page routes', () => {
    expect(routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/setup', '/login', '/link', '/admin/link', '/admin/user', '/admin/user/new', '/:pathMatch(.*)*']),
    )
  })
})
