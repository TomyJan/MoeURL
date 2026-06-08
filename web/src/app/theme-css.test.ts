import { describe, expect, it } from 'vitest'

import { installMoeurlThemeCss, moeurlThemeCss } from './theme-css'

describe('moeurlThemeCss', () => {
  it('defines global application surfaces and radius tokens', () => {
    expect(moeurlThemeCss).toContain('background: rgb(var(--v-theme-background))')
    expect(moeurlThemeCss).toContain('--moeurl-surface-soft: var(--v-app-soft-surface)')
    expect(moeurlThemeCss).toContain('--moeurl-surface-glass: var(--v-app-glass-surface)')
    expect(moeurlThemeCss).toContain('--moeurl-hero-glow: var(--v-app-hero-glow)')
    expect(moeurlThemeCss).toContain('--moeurl-radius-page: var(--v-radius-page)')
    expect(moeurlThemeCss).toContain('border-radius: var(--moeurl-radius-panel)')
    expect(moeurlThemeCss).toContain('backdrop-filter: blur(22px)')
    expect(moeurlThemeCss).toContain(':where(a, button, [role="button"]):focus-visible')
    expect(moeurlThemeCss).not.toContain(':where(a, button, input, select, textarea):focus-visible')
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
