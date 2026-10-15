import { render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { bindSiteTitle, setSiteConfig, productDefaultSiteConfig } from './useSiteConfig'
import SiteFooter from './SiteFooter.vue'

describe('SiteFooter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setSiteConfig(productDefaultSiteConfig)
  })

  it('renders footer content as text and uses the fixed MoeURL attribution', () => {
    setSiteConfig({ ...productDefaultSiteConfig, siteName: 'Example', footerText: '<strong>Safe text</strong>' })
    render(SiteFooter)

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
    const view = render(SiteFooter)
    expect(view.container.querySelector('footer')).not.toBeNull()
    expect(screen.getByRole('link', { name: /^V\d/ })).toBeTruthy()
  })

  it('skips title updates when no browser document exists', () => {
    vi.stubGlobal('document', undefined)
    expect(() => bindSiteTitle(ref('Headless site'))).not.toThrow()
  })
})
