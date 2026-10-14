import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { expectNoHorizontalOverflow } from './support'

/** Supplies isolated read-only page data, including the longest supported brand and footer. */
async function mockWorkspace(page: Page) {
  const responses: Record<string, unknown> = {
    '/init/status': { initialized: true, setupTokenRequired: false },
    '/system/public-config': {
      siteName: '长站点名称'.repeat(12) + '测试名称', defaultLanguage: 'zh-CN', defaultTheme: 'system',
      footerText: '很长的页脚文本'.repeat(28) + '页脚测试', showPoweredBy: true,
    },
    '/auth/methods': { local: { enabled: true }, oidc: [] },
    '/auth/me': { user: {
      id: 'admin', username: 'admin', nickname: 'Admin', group: 'admin',
      permissions: ['short_link:read_own', 'short_link:create', 'domain:use_default'],
    } },
    '/short-link/overview': { totalLinkCount: 12345678, activeLinkCount: 0, visitCount: 0, todayVisitCount: 0 },
    '/short-link/list': { items: [] },
    '/domain/available': { items: [] },
  }
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.slice('/api/v1'.length)
    if (!Object.hasOwn(responses, path)) throw new Error(`Unexpected UI fixture request: ${path}`)
    return route.fulfill({ json: { code: 0, data: responses[path], meta: { page: 1, pageSize: 5, total: 0 } } })
  })
}

for (const width of [1440, 360]) {
  for (const language of ['zh-CN', 'en']) {
    test(`${width}/${language}: translated overview, top creation entry and accessible preferences`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(({ language }) => {
        localStorage.setItem('moeurl.language', language)
        localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light')
      }, { language })
      await mockWorkspace(page)
      await page.goto('/console')
      await expect(page.locator('.overview-metric')).toHaveCount(4)
      await expect(page.locator('.overview-metric').first()).toContainText(language === 'en' ? 'Total links' : '短链总数')
      await expect(page.locator('.overview-metric').first()).toContainText('12345678')
      for (const card of await page.locator('.overview-metric').all()) {
        expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
      await expect(page.locator('body')).not.toContainText('overview.')
      await expectNoHorizontalOverflow(page)

      const navigation = width > 900 ? page.locator('.console-sidebar') : page.locator('.console-topbar')
      const create = navigation.getByRole('button', { name: language === 'en' ? 'New short link' : '新建短链', exact: true })
      const buttonBox = await create.boundingBox()
      expect(buttonBox!.y + buttonBox!.height).toBeLessThan(200)
      await create.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const panel = page.getByTestId('console-create-transition')
      const bounds = await panel.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901)
      expect(await panel.evaluate(element => Number.parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.001)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(create).toBeFocused()

      if (width <= 900) await page.locator('.console-topbar__menu').click()
      const preferences = width > 900 ? navigation : page.getByTestId('console-mobile-nav')
      await preferences.locator('.preference-switcher__trigger--icon').last().click()
      const menu = preferences.getByRole('menu')
      await expect(menu).toBeVisible()
      const menuBounds = await menu.boundingBox()
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0)
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width)
      await menu.getByRole('menuitemradio').last().click()
      await expect(menu).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
    })

    test(`${width}/${language}: public short pages share one footer without excess scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.addInitScript(({ language }) => localStorage.setItem('moeurl.language', language), { language })
      await mockWorkspace(page)
      for (const path of ['/login', '/setup']) {
        await page.goto(path)
        await expect(page.locator('h1')).toBeVisible()
        await expect(page.locator('.site-footer')).toHaveCount(1)
        await expect(page.locator('.site-footer')).toContainText('很长的页脚文本')
        await expectNoHorizontalOverflow(page)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1000)
        const footer = await page.locator('.site-footer').boundingBox()
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(1001)
      }
    })
  }
}
