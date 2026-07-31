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
    expect(messages['zh-CN'].placeholder.overview.items).not.toHaveProperty('analytics')
    expect(messages.en.placeholder.overview.items).not.toHaveProperty('analytics')
    expect(JSON.stringify(messages['zh-CN'].placeholder)).not.toMatch(/v\d+\.\d+\.\d+/)
    expect(JSON.stringify(messages.en.placeholder)).not.toMatch(/v\d+\.\d+\.\d+/)
  })

  it('keeps deployment-managed domains separate from frontend theme preferences', () => {
    expect(messages['zh-CN'].placeholder.settings.description).toBe(
      '系统设置页暂不开放表单；域名仍通过初始化或部署配置维护，主题偏好由前端控制，并保留跟随系统、浅色和深色模式切换。',
    )
    expect(messages.en.placeholder.settings.description).toBe(
      'The settings page does not expose forms yet. Domains remain managed through setup or deployment configuration, while theme preferences stay in the frontend with system, light, and dark modes.',
    )
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
