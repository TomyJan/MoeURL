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

  it('defines bilingual advanced short-link settings', () => {
    expect(messages['zh-CN'].shortLinkCreate.advanced).toBe('高级设置')
    expect(messages['zh-CN'].shortLinkCreate.redirectModes.intermediate).toBe('中间页')
    expect(messages['zh-CN'].shortLinkCreate.redirectModes.confirmation).toBe('确认页')
    expect(messages['zh-CN'].shortLinkCreate.expiresAt).toBe('过期时间（本地时间）')
    expect(messages['zh-CN'].shortLinkSettings.expiresAt).toBe('过期时间（本地时间）')
    expect(messages['zh-CN'].shortLinkCreate.expirationFuture).toBe('过期时间必须晚于当前时间')
    expect(messages.en.shortLinkCreate.advanced).toBe('Advanced settings')
    expect(messages.en.shortLinkCreate.redirectModes.intermediate).toBe('Intermediate page')
    expect(messages.en.shortLinkCreate.redirectModes.confirmation).toBe('Confirmation page')
    expect(messages.en.shortLinkCreate.expiresAt).toBe('Expiration time (local time)')
    expect(messages.en.shortLinkSettings.expiresAt).toBe('Expiration time (local time)')
    expect(messages.en.shortLinkCreate.expirationFuture).toBe('Expiration must be in the future')
    expect(messages['zh-CN'].shortLinkCreate.qrCode).toBe('二维码')
    expect(messages.en.shortLinkCreate.qrCode).toBe('QR code')
    expect(messages['zh-CN'].shortLinkQr.download).toBe('下载 PNG')
    expect(messages.en.shortLinkQr.generateFailed).toBe('Failed to generate the QR code. Try again.')
    expect(messages['zh-CN'].redirect.continue).toBe('立即前往')
    expect(messages['zh-CN'].redirect.expired).toBe('该短链已过期。')
    expect(messages['zh-CN'].redirect.confirmationTitle).toBe('确认访问外部网站')
    expect(messages['zh-CN'].redirect.shortCode).toBe('短码')
    expect(messages['zh-CN'].redirect.expiresAt).toBe('有效期至')
    expect(messages.en.redirect.confirmationContinue).toBe('Continue to site')
    expect(messages.en.redirect.shortCode).toBe('Short code')
    expect(messages.en.redirect.expiresAt).toBe('Expires at')
    expect(messages.en.redirect.unavailable).toBe('This short link is no longer available.')
    expect(messages.en.redirect.loadFailed).toBe('Unable to load this short link. Try again.')
  })

  it('reuses the shared password-length validation copy', () => {
    expect(messages['zh-CN'].shortLinkCreate.passwordInvalid).toBe('@:validation.passwordLength')
    expect(messages['zh-CN'].shortLinkSettings.passwordInvalid).toBe('@:validation.passwordLength')
    expect(messages.en.shortLinkCreate.passwordInvalid).toBe('@:validation.passwordLength')
    expect(messages.en.shortLinkSettings.passwordInvalid).toBe('@:validation.passwordLength')
    expect(i18n.global.t('shortLinkCreate.passwordInvalid')).toBe(messages['zh-CN'].validation.passwordLength)
    expect(i18n.global.t('shortLinkSettings.passwordInvalid')).toBe(messages['zh-CN'].validation.passwordLength)

    const originalLocale = i18n.global.locale.value
    try {
      i18n.global.locale.value = 'en'
      expect(i18n.global.t('shortLinkCreate.passwordInvalid')).toBe(messages.en.validation.passwordLength)
      expect(i18n.global.t('shortLinkSettings.passwordInvalid')).toBe(messages.en.validation.passwordLength)
    } finally {
      i18n.global.locale.value = originalLocale
    }
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
