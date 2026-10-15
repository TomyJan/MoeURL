import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'
import type { UserGroup } from '../src/entities/user-group/api'

type Link = { id: string; slug: string; url: string }
const targetUrl = 'https://example.com/e2e-custom-slug'

test.use({ serviceWorkers: 'block' })

for (const width of [1280, 390]) {
  test(`creates a stable custom address and recovers from conflicts at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 })
    const login = await page.request.post('/api/v1/auth/login', {
      data: { username: e2eAdminUsername, password: e2eAdminPassword },
    })
    expect(await login.json()).toMatchObject({ code: 0 })
    const customSlug = `Team${randomBytes(6).toString('hex')}`
    const links: Link[] = []
    let cleanupFailure: Error | undefined
    try {
      await page.goto('/')
      await page.getByLabel('输入链接', { exact: true }).fill(targetUrl)
      await page.getByRole('button', { name: '高级设置', exact: true }).click()
      const input = page.getByLabel('自定义短码', { exact: true })
      await input.fill(customSlug)
      await expect(page.getByTestId('custom-slug-preview')).toContainText(customSlug.toLowerCase())
      await expectNoHorizontalOverflow(page)
      await testInfo.attach(`custom-slug-${width}px`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
      let created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: '创建短链', exact: true }).click()
      let payload = await (await created).json() as { code: number; data: { shortLink: Link } }
      expect(payload.code).toBe(0)
      links.push(payload.data.shortLink)
      expect(payload.data.shortLink.slug).toBe(customSlug.toLowerCase())

      // Inspect the real redirect without making the test depend on the external target.
      const redirect = await page.request.get(`/${customSlug.toUpperCase()}`, { maxRedirects: 0 })
      expect(redirect.status()).toBe(302)
      expect(redirect.headers().location).toBe(targetUrl)

      // Start a second independent draft, keeping the already occupied address.
      await page.goto('/')
      await page.getByLabel('输入链接', { exact: true }).fill(targetUrl)
      await page.getByRole('button', { name: '高级设置', exact: true }).click()
      await input.fill(customSlug)
      created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: '创建短链', exact: true }).click()
      expect(await (await created).json()).toMatchObject({ code: 200101 })
      await expect(input).toHaveValue(customSlug)
      await expect(page.getByLabel('输入链接', { exact: true })).toHaveValue(targetUrl)
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '这个短码已被占用，请更换或留空使用随机短码。' })).toBeVisible()

      await input.fill('LOGIN')
      created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: '创建短链', exact: true }).click()
      expect(await (await created).json()).toMatchObject({ code: 200102 })
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '这个短码是系统保留路径，请选择其他短码。' })).toBeVisible()

      // An empty optional input must omit customSlug and retain the random creation flow.
      await input.fill('')
      created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: '创建短链', exact: true }).click()
      const response = await created
      expect(response.request().postDataJSON()).not.toHaveProperty('customSlug')
      payload = await response.json() as typeof payload
      expect(payload.code).toBe(0)
      links.push(payload.data.shortLink)
      expect(payload.data.shortLink.slug).toMatch(/^[a-z0-9]{6}$/)
      await expectNoHorizontalOverflow(page)
    } finally {
      const cleanupErrors: string[] = []
      for (const link of links) {
        try {
          const deleted = await page.request.post('/api/v1/short-link/delete', { data: { id: link.id } })
          expect(await deleted.json()).toMatchObject({ code: 0 })
        } catch (error) {
          cleanupErrors.push(String(error))
        }
      }
      if (cleanupErrors.length > 0) {
        await testInfo.attach('custom-slug-cleanup-errors', { body: cleanupErrors.join('\n'), contentType: 'text/plain' })
        cleanupFailure = new Error(`Custom slug cleanup failed: ${cleanupErrors.join('; ')}`)
      }
    }
    if (cleanupFailure) throw cleanupFailure
  })
}

test('revoking custom-slug permission hides the field and preserves random creation', async ({ page }, testInfo) => {
  const login = await page.request.post('/api/v1/auth/login', {
    data: { username: e2eAdminUsername, password: e2eAdminPassword },
  })
  expect(await login.json()).toMatchObject({ code: 0 })
  const catalog = await page.request.get('/api/v1/admin/user-group/list')
  const payload = await catalog.json() as { code: number; data: { groups: UserGroup[] } }
  expect(payload.code).toBe(0)
  const original = payload.data.groups.find(({ key }) => key === 'admin')!
  expect(original.permissions).toContain('short_link:custom_slug')
  let linkID: string | undefined
  let cleanupFailure: unknown
  try {
    await page.goto('/')
    await page.getByRole('button', { name: '高级设置', exact: true }).click()
    await page.getByLabel('自定义短码', { exact: true }).fill('StaleDraft')
    const update = await page.request.post('/api/v1/admin/user-group/update-permissions', {
      data: {
        groupKey: 'admin', expectedUpdatedAt: original.updatedAt,
        permissions: original.permissions.filter((permission) => permission !== 'short_link:custom_slug'),
      },
    })
    expect(await update.json()).toMatchObject({ code: 0 })
    const rejected = await page.request.post('/api/v1/short-link/create', {
      data: { targetUrl, customSlug: 'DeniedCustom' },
    })
    expect(await rejected.json()).toMatchObject({ code: 120001 })
    await page.reload()
    await page.getByRole('button', { name: '高级设置', exact: true }).click()
    await expect(page.getByLabel('自定义短码', { exact: true })).toHaveCount(0)
    await page.getByLabel('输入链接', { exact: true }).fill(targetUrl)
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
    await page.getByRole('button', { name: '创建短链', exact: true }).click()
    const response = await created
    expect(response.request().postDataJSON()).not.toHaveProperty('customSlug')
    const result = await response.json() as { code: number; data: { shortLink: Link } }
    expect(result.code).toBe(0)
    linkID = result.data.shortLink.id
    expect(result.data.shortLink.slug).toMatch(/^[a-z0-9]{6}$/)
  } finally {
    try {
      const refreshed = await page.request.get('/api/v1/admin/user-group/list')
      const current = (await refreshed.json() as typeof payload).data.groups.find(({ key }) => key === 'admin')!
      const restored = await page.request.post('/api/v1/admin/user-group/update-permissions', {
        data: { groupKey: 'admin', permissions: original.permissions, expectedUpdatedAt: current.updatedAt },
      })
      expect(await restored.json()).toMatchObject({ code: 0 })
      if (linkID) {
        const deleted = await page.request.post('/api/v1/short-link/delete', { data: { id: linkID } })
        expect(await deleted.json()).toMatchObject({ code: 0 })
      }
    } catch (error) {
      await testInfo.attach('custom-slug-permission-cleanup-error', { body: String(error), contentType: 'text/plain' })
      cleanupFailure = error
    }
  }
  if (cleanupFailure) throw cleanupFailure
})
