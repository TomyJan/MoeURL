import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import ConsoleAccountCard from './ConsoleAccountCard.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

function mountAccountCard(displayName: string, username = 'alice') {
  return render(ConsoleAccountCard, {
    props: {
      displayName,
      username,
    },
    global: {
      stubs: componentStubs,
    },
  })
}

describe('ConsoleAccountCard', () => {
  it('uses shared avatar text rules for blank and multi-code-unit names', async () => {
    const { rerender } = mountAccountCard('  😀 Alice')

    expect(screen.getByText('😀')).toBeTruthy()

    await rerender({ displayName: '   ', username: 'alice' })
    expect(screen.getByText('M')).toBeTruthy()
  })

  it('does not fall back to username initials when display name is blank', async () => {
    const { rerender } = mountAccountCard('Alice', 'bob')

    expect(screen.getByText('A')).toBeTruthy()

    await rerender({ displayName: '   ', username: 'bob' })

    expect(screen.getByText('M')).toBeTruthy()
    expect(screen.queryByText('B')).toBeNull()
  })
})
