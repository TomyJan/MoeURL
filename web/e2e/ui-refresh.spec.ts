import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { AdminShortLink, ShortLink, ShortLinkStatisticsResponse } from '../src/entities/short-link/model'

import { expectNoHorizontalOverflow } from './support'

/** Supplies isolated read-only page data, including the longest supported brand and footer. */
async function mockWorkspace(page: Page, overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    '/init/status': { initialized: true, setupTokenRequired: false },
    '/system/appearance': { accentPreset: 'iris' },
    '/system/footer-links': { links: [] },
    '/system/public-config': {
      siteName: '长站点名称'.repeat(12) + '测试名称', defaultLanguage: 'zh-CN', defaultTheme: 'system',
      footerText: '很长的页脚文本'.repeat(28) + '页脚测试', showPoweredBy: false,
    },
    '/auth/methods': { local: { enabled: true }, oidc: [] },
    '/auth/me': { user: {
      id: 'admin', username: 'admin', nickname: 'Admin', group: 'admin',
      permissions: ['short_link:read_own', 'short_link:create', 'domain:use_default'],
    } },
    '/user/preferences': { preferences: { language: null, theme: null, updatedAt: null } },
    '/user/time-zone-preference': { preference: { timeZone: null, updatedAt: null } },
    '/user/domain-preference': { preference: { domainId: null, updatedAt: null } },
    '/domain/group-default': { selection: { domainId: null, status: 'not_set' } },
    '/short-link/overview': { totalLinkCount: 12345678, activeLinkCount: 0, visitCount: 0, todayVisitCount: 0 },
    '/short-link/list': { items: [] },
    '/domain/available': { items: [] },
    ...overrides,
  }
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.slice('/api/v1'.length)
    if (!Object.hasOwn(responses, path)) throw new Error(`Unexpected UI fixture request: ${path}`)
    return route.fulfill({ json: { code: 0, message: 'OK', data: responses[path], meta: { page: 1, pageSize: 5, total: 0 } } })
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
        const attribution = page.locator('.site-footer').getByRole('link', { name: /^V\d+\.\d+\.\d+(?:-[a-f0-9]{7})?$/ })
        await expect(page.locator('.site-footer')).toContainText('Powered by MoeURL')
        await expect(attribution).not.toContainText('Powered by MoeURL')
        await expect(attribution).toBeVisible()
        await expect(attribution).toHaveAttribute('href', /^https:\/\/github\.com\/TomyJan\/MoeURL\/(?:commit\/[a-f0-9]{40,64}|tree\/v\d+\.\d+\.\d+)$/)
        await expect(attribution).toHaveAttribute('target', '_blank')
        await expectNoHorizontalOverflow(page)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1000)
        const footer = await page.locator('.site-footer').boundingBox()
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(1001)
      }
    })

    test(`${width}/${language}: standard table menus dismiss outside and restore keyboard focus`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(({ language }) => localStorage.setItem('moeurl.language', language), { language })
      const link: ShortLink = {
        id: 'first-link', slug: 'first123', url: 'https://go.example.com/first123', targetUrl: 'https://example.com',
        title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5,
        expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0,
        visitsRemaining: null, exhausted: false, createdAt: '2026-10-15T00:00:00Z',
      }
      const second = { ...link, id: 'second-link', slug: 'second123', url: 'https://go.example.com/second123' }
      await mockWorkspace(page, { '/short-link/list': { items: [link, second] } })
      await page.goto('/link')
      await expect(page.getByRole('columnheader', { name: language === 'en' ? 'Target URL' : '目标链接', exact: true })).toBeVisible()
      const moreLabel = language === 'en' ? 'More actions' : '更多操作'
      const firstMore = page.getByTestId('console-link-row').nth(0).getByRole('button', { name: moreLabel })
      const secondMore = page.getByTestId('console-link-row').nth(1).getByRole('button', { name: moreLabel })
      const menu = page.getByRole('menu')
      const open = menu.getByRole('menuitem', { name: language === 'en' ? 'Open' : '打开', exact: true })
      await firstMore.click()
      await expect(open).toHaveAttribute('href', link.url)
      await page.getByRole('heading', { level: 1 }).click()
      await expect(menu).toHaveCount(0)
      await secondMore.click()
      await expect(menu).toHaveCount(1)
      await expect(open).toHaveAttribute('href', second.url)
      await secondMore.press('ArrowDown')
      await expect.poll(() => menu.evaluate(element => element.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Home')
      await expect(open).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(secondMore).toBeFocused()
      await firstMore.press('ArrowDown')
      await expect(open).toHaveAttribute('href', link.url)
      await expect.poll(() => menu.evaluate(element => element.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Home')
      await expect(open).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(firstMore).toBeFocused()
      await expectNoHorizontalOverflow(page)
    })

    test(`${width}/${language}: link analytics keeps list context and long targets fit the viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(({ language }) => {
        localStorage.setItem('moeurl.language', language)
        localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light')
      }, { language })

      const targetUrl = `https://example.com/${'a-long-target-segment/'.repeat(40)}?campaign=summer&ref=dashboard`
      const ownLink: ShortLink = {
        id: 'own-link', slug: 'own123', url: 'https://go.example.com/own123', targetUrl,
        title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5,
        expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0,
        visitsRemaining: null, exhausted: false, createdAt: '2026-10-14T00:00:00Z',
        stats: { visitCount: 12, todayVisitCount: 2, lastVisitedAt: '2026-10-14T00:00:00Z' },
      }
      const adminLink: AdminShortLink = {
        ...ownLink, id: 'admin-link', slug: 'all123', url: 'https://go.example.com/all123',
        updatedAt: '2026-10-23T00:00:00.123456Z',
        owner: { id: 'other-user', username: 'alice', nickname: 'Alice' },
      }
      const statistics: ShortLinkStatisticsResponse['stats'] = {
        rangeVisitCount: 12,
        visitCount: 12, todayVisitCount: 2, lastVisitedAt: '2026-10-14T00:00:00Z',
        trend: [{ date: '2026-10-13', visitCount: 10 }, { date: '2026-10-14', visitCount: 2 }],
        referrers: [{ value: 'search.example.com', visitCount: 12 }],
        devices: [{ value: 'mobile', visitCount: 12 }], countries: [{ value: 'unknown', visitCount: 12 }],
      }
      await mockWorkspace(page, {
        '/auth/me': { user: {
          id: 'admin', username: 'admin', nickname: 'Admin', group: 'admin',
          permissions: ['short_link:read_own', 'short_link:read_all', 'admin:access'],
        } },
        '/short-link/list': { items: [ownLink] },
        '/admin/short-link/list': { items: [adminLink] },
        '/short-link/statistics': { shortLink: ownLink, stats: statistics, range: { startDate: '2026-10-08', endDate: '2026-10-14', timeZone: 'UTC' } } satisfies ShortLinkStatisticsResponse,
        '/admin/short-link/statistics': {
          shortLink: { ...ownLink, id: adminLink.id, slug: adminLink.slug, url: adminLink.url }, stats: statistics,
          range: { startDate: '2026-10-08', endDate: '2026-10-14', timeZone: 'UTC' },
        } satisfies ShortLinkStatisticsResponse,
      })
      const statisticsRequests: string[] = []
      page.on('request', request => {
        const url = new URL(request.url())
        if (url.pathname.endsWith('/short-link/statistics')) statisticsRequests.push(url.pathname)
      })

      for (const context of ['own', 'admin'] as const) {
        const link = context === 'own' ? ownLink : adminLink
        const parent = context === 'own' ? '/link' : '/admin/link'
        await page.goto(parent)
        const row = page.getByTestId('console-link-row')
        await expect(row).toHaveCount(1)
        const target = row.locator('.console-link-row__target > a')
        await expect(target).toHaveText(targetUrl)
        await expect(target).toHaveAttribute('title', targetUrl)
        const targetLayout = await target.evaluate(element => ({
          width: element.clientWidth,
          contentWidth: element.scrollWidth,
          overflow: getComputedStyle(element).overflow,
          textOverflow: getComputedStyle(element).textOverflow,
          whiteSpace: getComputedStyle(element).whiteSpace,
          height: element.getBoundingClientRect().height,
        }))
        expect(targetLayout.width).toBeGreaterThan(0)
        expect(targetLayout.contentWidth).toBeGreaterThan(targetLayout.width)
        expect(targetLayout).toMatchObject({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
        expect(targetLayout.height).toBeLessThan(40)
        await expect(row.locator('.console-link-row__main > a')).toHaveAttribute('href', link.url)
        await row.getByRole('button', { name: language === 'en' ? 'More actions' : '更多操作', exact: true }).click()
        await expect(page.getByRole('menu').getByRole('menuitem', { name: language === 'en' ? 'Open' : '打开', exact: true })).toHaveAttribute('href', link.url)
        await page.keyboard.press('Escape')
        await expectNoHorizontalOverflow(page)

        const analytics = row.getByRole('link', { name: language === 'en' ? 'Analytics' : '分析', exact: true })
        await expect(analytics).toHaveAttribute('href', `${parent}/${link.id}/analytics`)
        await analytics.click()
        await expect(page).toHaveURL(new RegExp(`${parent}/${link.id}/analytics$`))
        await expect(page.getByTestId('analytics-summary')).toBeVisible()
        await expect(page.getByTestId('analytics-trend-chart')).toBeVisible()
        const reloaded = await page.reload()
        expect(reloaded?.status()).toBe(200)
        await expect(page.getByTestId('analytics-summary')).toBeVisible()
        await expect(page.getByTestId('analytics-trend-chart')).toBeVisible()
        const expectedTitle = context === 'own'
          ? language === 'en' ? 'Link analytics' : '短链访问分析'
          : language === 'en' ? 'All-link analytics' : '全站短链访问分析'
        await expect(page.getByRole('heading', { name: expectedTitle, exact: true })).toBeVisible()
        if (width <= 900) await page.locator('.console-topbar__menu').click()
        const navigation = width > 900 ? page.locator('.console-sidebar') : page.getByTestId('console-mobile-nav')
        await expect(navigation.locator(`a[href="${parent}"]`)).toHaveClass(/console-nav-list__item--section-active/)
        await expect(navigation.locator('a[href="/analytics"]')).toHaveCount(0)
        if (width <= 900) await page.keyboard.press('Escape')
        const backLabel = context === 'own'
          ? language === 'en' ? 'Back to links' : '返回短链列表'
          : language === 'en' ? 'Back to all links' : '返回全站短链'
        const back = page.getByRole('link', { name: backLabel, exact: true })
        await expect(back).toHaveAttribute('href', parent)
        await expectNoHorizontalOverflow(page)
        await back.click()
        await expect(page).toHaveURL(new RegExp(`${parent}$`))
        await expect(page.getByTestId('console-link-row')).toBeVisible()
        expect(statisticsRequests).toContain(context === 'own' ? '/api/v1/short-link/statistics' : '/api/v1/admin/short-link/statistics')
        if (context === 'own') expect(statisticsRequests).not.toContain('/api/v1/admin/short-link/statistics')
      }
    })
  }
}
