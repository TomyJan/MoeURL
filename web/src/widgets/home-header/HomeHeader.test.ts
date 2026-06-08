import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import HomeHeader from './HomeHeader.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'zh-CN' },
    t: (key: string) => key,
  }),
}))

vi.mock('vuetify/framework', () => ({
  useTheme: () => ({
    global: {
      name: { value: 'moeurlLight' },
    },
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
    expect(screen.getByRole('group', { name: 'app preferences' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'preferences.language' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'preferences.theme' })).toBeTruthy()
  })

  it('emits console navigation when authenticated account is clicked', async () => {
    const consoleClick = vi.fn()
    mountHeader({ isGuest: false, displayName: 'Alice', onConsoleClick: consoleClick })

    expect(screen.queryByText('nav.login')).toBeNull()
    expect(screen.getByRole('button', { name: 'Alice' }).textContent).toContain('Alice')
    await fireEvent.click(screen.getByText('Alice'))

    expect(consoleClick).toHaveBeenCalled()
  })
})
