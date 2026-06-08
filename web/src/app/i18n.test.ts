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

  it('keeps locale message trees aligned', () => {
    function flattenKeys(value: unknown, prefix = ''): string[] {
      if (!value || typeof value !== 'object') {
        return [prefix]
      }

      return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
    }

    expect(flattenKeys(messages.en).sort()).toEqual(flattenKeys(messages['zh-CN']).sort())
  })
})
