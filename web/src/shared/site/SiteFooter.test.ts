import { cleanup, render, screen, waitFor, within } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { bindSiteTitle, setSiteConfig, productDefaultSiteConfig } from './useSiteConfig'
import SiteFooter from './SiteFooter.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let client: QueryClient
function mountFooter() {
  return render(SiteFooter, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
}

describe('SiteFooter', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { links: [] }, meta: {} }))))
  })
  afterEach(() => {
    cleanup()
    client.clear()
    vi.unstubAllGlobals()
    setSiteConfig(productDefaultSiteConfig)
  })

  it('renders footer content as text and uses the fixed MoeURL attribution', () => {
    setSiteConfig({ ...productDefaultSiteConfig, siteName: 'Example', footerText: '<strong>Safe text</strong>' })
    mountFooter()

    expect(screen.getByText('<strong>Safe text</strong>')).toBeTruthy()
    expect(screen.getByRole('contentinfo').textContent).toContain('Powered by MoeURL V')
    const versionLink = screen.getByRole('link', { name: /^V\d/ })
    expect(versionLink.textContent).not.toContain('Powered by MoeURL')
    expect(versionLink.getAttribute('href')).toMatch(/^https:\/\/github\.com\/TomyJan\/MoeURL\/(?:commit|tree)\//)
    expect(versionLink.getAttribute('target')).toBe('_blank')
    expect(document.querySelector('.site-footer strong')).toBeNull()
  })

  it('always shows traceable attribution when custom footer content is empty', () => {
    setSiteConfig({ ...productDefaultSiteConfig, footerText: '', showPoweredBy: false })
    const view = mountFooter()
    expect(view.container.querySelector('footer')).not.toBeNull()
    expect(screen.getByRole('link', { name: /^V\d/ })).toBeTruthy()
  })

  it('skips title updates when no browser document exists', () => {
    vi.stubGlobal('document', undefined)
    expect(() => bindSiteTitle(ref('Headless site'))).not.toThrow()
  })

  it('renders ordered duplicate labels as literal safe new-window navigation without replacing attribution', async () => {
    const links = [
      { label: '<script>help</script>', url: 'https://example.com/help?q=%2F#top' },
      { label: '<script>help</script>', url: 'http://localhost:8080/help' },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { links }, meta: {} }))))
    mountFooter()
    const nav = await screen.findByRole('navigation', { name: 'footerLinks.navigation' })
    const anchors = within(nav).getAllByRole('link')
    expect(anchors.map(a => a.getAttribute('href'))).toEqual(['https://example.com/help?q=%2F#top', 'http://localhost:8080/help'])
    for (const anchor of anchors) {
      expect(anchor.textContent).toContain('<script>help</script>')
      expect(anchor.getAttribute('target')).toBe('_blank')
      expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
      expect(anchor.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(anchor.textContent).toContain('footerLinks.newWindow')
    }
    expect(nav.querySelector('script')).toBeNull()
    expect(screen.getByRole('link', { name: /^V\d/ })).toBeTruthy()
  })

  it('does not create empty navigation when the public configuration has no links', async () => {
    mountFooter()
    await waitFor(() => expect(screen.queryByRole('navigation')).toBeNull())
    expect(screen.getByRole('link', { name: /^V\d/ })).toBeTruthy()
  })
})
