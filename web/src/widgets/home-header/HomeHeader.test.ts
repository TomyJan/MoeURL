import { fireEvent, render, screen } from '@testing-library/vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import HomeHeader from './HomeHeader.vue'
import { componentStubs } from '@/test/component-stubs'

const sourcePath = resolve(__dirname, 'HomeHeader.vue')

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'zh-CN' },
    t: (key: string) => key,
  }),
}))

vi.mock('vuetify', () => ({
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
    expect(screen.getByRole('group', { name: 'preferences.groupLabel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'preferences.language' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'preferences.theme' })).toBeTruthy()
  })

  it('emits console navigation when authenticated account is clicked', async () => {
    const consoleClick = vi.fn()
    mountHeader({ isGuest: false, displayName: 'Alice', onConsoleClick: consoleClick })

    expect(screen.queryByText('nav.login')).toBeNull()
    expect(screen.getByRole('button', { name: 'Alice' }).textContent).toContain('Alice')
    expect(screen.getByRole('button', { name: 'Alice' }).textContent).toContain('A')
    await fireEvent.click(screen.getByText('Alice'))

    expect(consoleClick).toHaveBeenCalled()
  })

  it('passes the reactive display name prop directly to shared avatar text', () => {
    const source = readFileSync(sourcePath, 'utf8')

    expect(source).toContain("const displayName = toRef(props, 'displayName')")
    expect(source).toContain('useAvatarText(displayName)')
    expect(source).not.toContain('computed(() => props.displayName)')
  })
})
