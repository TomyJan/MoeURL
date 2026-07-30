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

  it('keeps English preference system labels distinct for full and compact UI', () => {
    expect(messages.en.preferences.system).toBe('System default')
    expect(messages.en.preferences.systemShort).toBe('System')
  })

  it('keeps placeholder copy limited to capabilities that are still planned', () => {
    expect(messages['zh-CN'].placeholder).not.toHaveProperty('analytics')
    expect(messages.en.placeholder).not.toHaveProperty('analytics')
    expect(messages['zh-CN'].placeholder).not.toHaveProperty('overview')
    expect(messages.en.placeholder).not.toHaveProperty('overview')
    expect(JSON.stringify(messages['zh-CN'].placeholder)).not.toMatch(/v\d+\.\d+\.\d+/)
    expect(JSON.stringify(messages.en.placeholder)).not.toMatch(/v\d+\.\d+\.\d+/)
  })

  it('contains complete personal overview labels for supported locales', () => {
    expect(messages['zh-CN'].overview.metrics.totalLinkCount).toBe('短链总数')
    expect(messages.en.overview.metrics.totalLinkCount).toBe('Total links')
    expect(messages['zh-CN'].overview.retryRecent).toBeTruthy()
    expect(messages.en.overview.retryRecent).toBeTruthy()
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
