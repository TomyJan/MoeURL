import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import { componentStubs } from './component-stubs'

describe('componentStubs', () => {
  it.each([false, true])('selects a toggle value in the mounting millisecond (nested target: %s)', async (nested) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
    try {
      await Promise.resolve()
      render({
        components: { VBtn: componentStubs.VBtn, VBtnToggle: componentStubs.VBtnToggle },
        data: () => ({ selected: 'direct' }),
        template: '<VBtnToggle v-model="selected"><VBtn value="intermediate"><span>Intermediate</span></VBtn></VBtnToggle><output>{{ selected }}</output>',
      })
      await fireEvent.click(nested ? screen.getByText('Intermediate') : screen.getByRole('button'))
      expect(screen.getByRole('status').textContent).toBe('intermediate')
    } finally {
      clock.mockRestore()
    }
  })

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
