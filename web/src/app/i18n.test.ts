import { describe, expect, it } from 'vitest'

import { i18n, messages } from './i18n'

describe('i18n', () => {
  it('defines default and fallback locales', () => {
    expect(i18n.global.locale.value).toBe('zh-CN')
    expect(i18n.global.fallbackLocale.value).toBe('en')
  })

  it('contains navigation labels for supported locales', () => {
    expect(messages['zh-CN'].nav.home).toBe('首页')
    expect(messages.en.nav.home).toBe('Home')
  })
})
