import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'

import { componentStubs } from './component-stubs'

describe('componentStubs', () => {
  it('renders RouterLink with real link semantics', () => {
    render({
      components: {
        RouterLink: componentStubs.RouterLink,
      },
      template: '<RouterLink to="/admin/user">Users</RouterLink>',
    })

    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/admin/user')
  })
})
