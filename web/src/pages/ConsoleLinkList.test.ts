import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import ConsoleLinkList, { type ConsoleLinkListItem } from './ConsoleLinkList.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('ConsoleLinkList quota', () => {
  it('shows finite quota separately from analytics and hides it for unlimited links', async () => {
    const link: ConsoleLinkListItem = {
      id: 'link-id', slug: 'abc123', url: 'https://go.example.com/abc123', targetUrl: 'https://example.com',
      status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
      expired: false, passwordEnabled: false, maxVisits: 2, visitsUsed: 2, visitsRemaining: 0, exhausted: true,
    }
    const view = render(ConsoleLinkList, { props: { links: [link] }, global: { stubs: componentStubs } })
    expect(screen.getByTestId('visit-limit').textContent).toContain('visitLimit.usage')
    expect(screen.getByText('visitLimit.exhausted')).toBeTruthy()
    expect(screen.getByText('links.stats.visitCount')).toBeTruthy()
    await view.rerender({ links: [{ ...link, visitsUsed: 1, visitsRemaining: 1, exhausted: false }] })
    expect(screen.getByTestId('visit-limit')).toBeTruthy()
    expect(screen.queryByText('visitLimit.exhausted')).toBeNull()
    await view.rerender({ links: [{ ...link, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }] })
    expect(screen.queryByTestId('visit-limit')).toBeNull()
  })
})
