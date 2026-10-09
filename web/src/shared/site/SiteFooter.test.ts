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
    expect(screen.getByText('Powered by MoeURL')).toBeTruthy()
    expect(document.querySelector('.site-footer strong')).toBeNull()
  })

  it('hides attribution and the empty footer when both fields are disabled', () => {
    setSiteConfig({ ...productDefaultSiteConfig, footerText: '', showPoweredBy: false })
    const view = render(SiteFooter)
    expect(view.container.querySelector('footer')).toBeNull()
  })

  it('skips title updates when no browser document exists', () => {
    vi.stubGlobal('document', undefined)
    expect(() => bindSiteTitle(ref('Headless site'))).not.toThrow()
  })
})
