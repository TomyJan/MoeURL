import { describe, expect, it } from 'vitest'

import { routes } from './router'

describe('router', () => {
  it('contains v0.0.1 fixed routes', () => {
    expect(routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/setup', '/login', '/links', '/admin/links', '/admin/users', '/admin/users/new', '/:pathMatch(.*)*']),
    )
  })
})
