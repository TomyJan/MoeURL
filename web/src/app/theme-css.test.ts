import { describe, expect, it } from 'vitest'

import { installMoeurlThemeCss, moeurlThemeCss } from './theme-css'

describe('moeurlThemeCss', () => {
  it('defines global application surfaces and radius tokens', () => {
    expect(moeurlThemeCss).toContain('background: rgb(var(--v-theme-background))')
    expect(moeurlThemeCss).toContain('--moeurl-surface-soft: var(--v-app-soft-surface)')
    expect(moeurlThemeCss).toContain('--moeurl-radius-page: var(--v-radius-page)')
    expect(moeurlThemeCss).toContain('border-radius: var(--moeurl-radius-panel)')
  })

  it('installs the global style element idempotently', () => {
    document.head.innerHTML = ''

    const firstStyle = installMoeurlThemeCss()
    const secondStyle = installMoeurlThemeCss()

    expect(firstStyle).toBe(secondStyle)
    expect(document.querySelectorAll('#moeurl-theme-css')).toHaveLength(1)
    expect(firstStyle.textContent).toBe(moeurlThemeCss)
  })
})
