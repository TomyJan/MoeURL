import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import ConsoleLinkList, { type ConsoleLinkListItem } from './ConsoleLinkList.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('ConsoleLinkList', () => {
  it('keeps owner cells aligned when a list contains both owned and ownerless links', () => {
    const link: ConsoleLinkListItem = {
      id: 'owned-link', slug: 'owned1', url: 'https://go.example.com/owned1', targetUrl: 'https://example.com/owned',
      title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
      expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
      owner: { id: 'owner-id', username: 'alice', nickname: 'Alice' },
    }
    render(ConsoleLinkList, {
      props: {
        analyticsScope: 'admin',
        links: [link, { ...link, id: 'ownerless-link', slug: 'ownerless1', url: 'https://go.example.com/ownerless1', owner: undefined }],
      },
      global: { stubs: componentStubs },
    })

    expect(screen.getByRole('columnheader', { name: 'links.owner' })).toBeTruthy()
    const [ownedRow, ownerlessRow] = screen.getAllByTestId('console-link-row')
    const ownedCells = within(ownedRow!).getAllByRole('cell')
    const ownerlessCells = within(ownerlessRow!).getAllByRole('cell')
    expect(ownedCells).toHaveLength(6)
    expect(ownerlessCells).toHaveLength(6)
    expect(within(ownedCells[2]!).getByText('alice')).toBeTruthy()
    expect(ownerlessCells[2]!.textContent).toBe('')
    expect(within(ownerlessCells[3]!).getByText('links.status.active')).toBeTruthy()
    expect(within(ownerlessCells[4]!).getByText('links.stats.visitCount')).toBeTruthy()
    expect(within(ownerlessCells[5]!).getByRole('button', { name: 'links.actions.analytics' }).getAttribute('data-to')).toBe('/admin/link/ownerless-link/analytics')
  })

  it('links analytics from each list to its contextual route and preserves long targets', async () => {
    const targetUrl = 'https://example.com/a-long-target-path/that-remains-complete?campaign=summer&ref=dashboard'
    const link: ConsoleLinkListItem = {
      id: 'link-id', slug: 'abc123', url: 'https://go.example.com/abc123', targetUrl,
      title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
      expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
    }
    const view = render(ConsoleLinkList, { props: { links: [link] }, global: { stubs: componentStubs } })

    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'links.shortUrl' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'links.targetUrl' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'links.headers.access' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'links.headers.statistics' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'links.headers.actions' })).toBeTruthy()
    expect(screen.getByTestId('console-link-row').tagName).toBe('TR')
    expect(screen.getByText(targetUrl).getAttribute('title')).toBe(targetUrl)
    expect(screen.getByRole('link', { name: targetUrl }).getAttribute('href')).toBe(targetUrl)
    expect(screen.getByText('links.actions.analytics').closest('button')?.getAttribute('data-to')).toBe('/link/link-id/analytics')

    await view.rerender({ links: [link], analyticsScope: 'admin' })
    expect(screen.getByText('links.actions.analytics').closest('button')?.getAttribute('data-to')).toBe('/admin/link/link-id/analytics')
    expect(screen.queryByRole('columnheader', { name: 'links.owner' })).toBeNull()
    await view.rerender({ links: [{ ...link, owner: { id: 'owner-id', username: 'alice', nickname: 'Alice' } }] })
    expect(screen.getByRole('columnheader', { name: 'links.owner' })).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.configure' }))
    expect(view.emitted('configure')).toHaveLength(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows finite quota separately from analytics and hides it for unlimited links', async () => {
    const link: ConsoleLinkListItem = {
      id: 'link-id', slug: 'abc123', url: 'https://go.example.com/abc123', targetUrl: 'https://example.com',
      title: '<img src=x onerror=alert(1)>', tags: ['<script>alert(1)</script>', 'Release 计划'],
      status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
      expired: false, passwordEnabled: false, maxVisits: 2, visitsUsed: 2, visitsRemaining: 0, exhausted: true,
    }
    const view = render(ConsoleLinkList, { props: { links: [link] }, global: { stubs: componentStubs } })
    expect(screen.getByText(link.title)).toBeTruthy()
    expect(screen.getByText(link.tags[0]!)).toBeTruthy()
    expect(view.container.querySelector('img, script')).toBeNull()
    expect(screen.getByTestId('visit-limit').textContent).toContain('visitLimit.usage')
    expect(screen.getByText('visitLimit.exhausted')).toBeTruthy()
    expect(screen.getByText('links.stats.visitCount')).toBeTruthy()
    await view.rerender({ links: [{ ...link, visitsUsed: 1, visitsRemaining: 1, exhausted: false }] })
    expect(screen.getByTestId('visit-limit')).toBeTruthy()
    expect(screen.queryByText('visitLimit.exhausted')).toBeNull()
    await view.rerender({ links: [{ ...link, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }] })
    expect(screen.queryByTestId('visit-limit')).toBeNull()
    await view.rerender({ links: [{ ...link, title: '', tags: [] }] })
    expect(screen.queryByTestId('link-metadata')).toBeNull()
    await view.rerender({ links: [{ ...link, title: '', tags: ['Tags without title'] }] })
    expect(screen.getByText('Tags without title')).toBeTruthy()
    expect(screen.getByTestId('link-metadata').querySelector('strong')).toBeNull()
  })
})
