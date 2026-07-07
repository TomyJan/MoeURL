import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import HomeIntroSections from './HomeIntroSections.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('HomeIntroSections', () => {
  it('keeps the below-fold product introduction lightweight', () => {
    render(HomeIntroSections)

    expect(screen.getByLabelText('homeIntro.ariaLabel')).toBeTruthy()
    expect(screen.getByText('homeIntro.permission.title')).toBeTruthy()
    expect(screen.getByText('homeIntro.selfHosted.title')).toBeTruthy()
    expect(screen.getByText('homeIntro.management.title')).toBeTruthy()
    expect(screen.getByText('homeIntro.modern.title')).toBeTruthy()
    expect(screen.queryByText('homeIntro.workflow.title')).toBeNull()
    expect(screen.queryByText('homeIntro.deploy.title')).toBeNull()
    expect(screen.getByText('homeIntro.footerCopyright')).toBeTruthy()
  })
})
