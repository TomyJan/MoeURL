import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import HomeIntroSections from './HomeIntroSections.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('HomeIntroSections', () => {
  it('renders the four lightweight product introduction sections', () => {
    render(HomeIntroSections)

    expect(screen.getByText('homeIntro.permission.title')).toBeTruthy()
    expect(screen.getByText('homeIntro.selfHosted.title')).toBeTruthy()
    expect(screen.getByText('homeIntro.management.title')).toBeTruthy()
    expect(screen.getByText('homeIntro.modern.title')).toBeTruthy()
  })
})
