import { describe, expect, it } from 'vitest'

import { installMoeurlThemeCss, moeurlThemeCss } from './theme-css'

describe('moeurlThemeCss', () => {
  it('defines global application surfaces and radius tokens', () => {
    expect(moeurlThemeCss).toContain('background: rgb(var(--v-theme-background))')
    expect(moeurlThemeCss).toContain('--moeurl-surface-soft: rgb(var(--v-app-soft-surface))')
    expect(moeurlThemeCss).toContain('--moeurl-surface-workspace: rgb(var(--v-app-workspace-surface))')
    expect(moeurlThemeCss).toContain('--moeurl-surface-glass: var(--v-app-glass-surface)')
    expect(moeurlThemeCss).toContain('--moeurl-surface-strong: rgb(var(--v-app-strong-surface))')
    expect(moeurlThemeCss).toContain('--moeurl-outline-strong: var(--v-app-outline-strong)')
    expect(moeurlThemeCss).toContain('--moeurl-hero-glow: var(--v-app-hero-glow)')
    expect(moeurlThemeCss).toContain('--moeurl-radius-page: var(--v-radius-page)')
    expect(moeurlThemeCss).toContain('border-radius: var(--moeurl-radius-panel)')
    expect(moeurlThemeCss).toContain('.console-page__tools')
    expect(moeurlThemeCss).toContain('.v-btn--variant-flat:hover')
    expect(moeurlThemeCss).toContain('transform: translateY(-1px)')
    expect(moeurlThemeCss).toContain('.v-field {\n  border-radius: var(--moeurl-radius-control);\n  background: transparent;')
    expect(moeurlThemeCss).toContain('0 0 0 4px color-mix(in srgb, rgb(var(--v-theme-primary)) 24%, transparent)')
    expect(moeurlThemeCss).toContain('0 16px 34px color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent)')
    expect(moeurlThemeCss).toContain('background: color-mix(in srgb, var(--moeurl-surface-strong) 32%, transparent)')
    expect(moeurlThemeCss).toContain('background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 12%, transparent)')
    expect(moeurlThemeCss).toContain('--v-field-border-opacity: 0.18')
    expect(moeurlThemeCss).not.toContain('background: color-mix(in srgb, var(--moeurl-surface-elevated) 70%, var(--moeurl-surface-soft) 30%)')
    expect(moeurlThemeCss).not.toContain('background: color-mix(in srgb, var(--moeurl-surface-elevated) 88%, var(--moeurl-surface-workspace) 12%)')
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
