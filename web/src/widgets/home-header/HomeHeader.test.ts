import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import HomeHeader from './HomeHeader.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

interface HomeHeaderTestProps {
  displayName: string
  isGuest: boolean
  onConsoleClick?: () => void
}

function mountHeader(props: HomeHeaderTestProps) {
  return render(HomeHeader, {
    props,
    global: {
      stubs: componentStubs,
    },
  })
}

describe('HomeHeader', () => {
  it('renders a blended brand header and login action for guests', () => {
    mountHeader({ isGuest: true, displayName: 'guest' })

    expect(screen.getByText('MoeURL')).toBeTruthy()
    expect(screen.getByText('nav.login')).toBeTruthy()
  })

  it('emits console navigation when authenticated account is clicked', async () => {
    const consoleClick = vi.fn()
    mountHeader({ isGuest: false, displayName: 'Alice', onConsoleClick: consoleClick })

    expect(screen.queryByText('nav.login')).toBeNull()
    await fireEvent.click(screen.getByText('Alice'))

    expect(consoleClick).toHaveBeenCalled()
  })
})
