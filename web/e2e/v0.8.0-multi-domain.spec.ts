import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { e2eAdminPassword, e2eAdminUsername, e2ePort, expectNoHorizontalOverflow, findShortLink, readVisitCount } from './support'

const primaryOrigin = `http://127.0.0.1:${e2ePort}`
const secondaryOrigin = `http://localhost:${e2ePort}`
const targetURL = 'https://example.com/multi-domain-e2e'

interface DomainRecord {
  id: string
  host: string
  displayName: string
  allowedGroups: Array<'user' | 'admin'>
  enabled: boolean
  isDefault: boolean
  updatedAt: string
}

// The linked secondary domain cannot be deleted even after its link is soft-deleted.
// Playwright tears down the entire disposable Compose project after this scenario.
test('v0.8.0 lets an authorized member create a link served only on its assigned Host', async ({ browser, page }, testInfo) => {
  test.skip(process.env.MOEURL_E2E_SKIP_DOCKER === '1' || process.env.MOEURL_E2E_SKIP_DOCKER === 'true', 'Requires an isolated Compose database')
  testInfo.setTimeout(120_000)
  await login(page)
  const initial = await listDomains(page)
  const originalDefault = initial.find((item) => item.isDefault)
  expect(originalDefault).toBeTruthy()
  let secondary: DomainRecord | undefined

    await page.goto('/admin/domain')
    await expect(page.getByTestId('admin-domains-page')).toBeVisible()
    await page.getByRole('button', { name: '新增域名' }).click()
    await page.getByLabel('HTTPS Origin').fill(secondaryOrigin)
    await page.getByLabel('显示名称').fill('E2E secondary')
    await page.getByLabel('普通用户').check()
    await page.getByLabel('管理员').check()
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('域名设置已保存。')).toBeVisible()
    secondary = (await listDomains(page)).find((item) => item.host === secondaryOrigin)
    expect(new Set(secondary?.allowedGroups)).toEqual(new Set(['user', 'admin']))

    const memberUsername = 'domain-e2e-member'
    const memberPassword = 'domain-e2e-member-password'
    const createMember = await page.request.post('/api/v1/admin/user/create', {
      data: { groupKey: 'user', nickname: 'Domain E2E', password: memberPassword, status: 'active', username: memberUsername },
    })
    await expect(createMember).toBeOK()
    expect((await createMember.json() as { code: number }).code).toBe(0)
    const memberContext = await browser.newContext({ baseURL: primaryOrigin, viewport: { width: 1280, height: 800 } })
    try {
      const memberPage = await memberContext.newPage()
      await login(memberPage, memberUsername, memberPassword)
      const identity = await memberPage.request.get('/api/v1/auth/me')
      const member = await identity.json() as { code: number; data: { user: { permissions: string[] } } }
      expect(member.code).toBe(0)
      expect(member.data.user.permissions).toContain('domain:use_assigned')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await memberPage.goto('/')
    await memberPage.getByRole('combobox', { name: '短链域名' }).press('Enter')
    await memberPage.getByRole('option', { name: /E2E secondary/ }).click()
    await memberPage.getByLabel('输入链接').fill(targetURL)
    await memberPage.getByRole('button', { name: '创建短链' }).click()
    const result = memberPage.getByTestId('short-link-create-result')
    await expect(result).toBeVisible()
    const publishedURL = await result.getByRole('link').first().getAttribute('href')
    expect(new URL(publishedURL!).origin).toBe(secondaryOrigin)
    const slug = new URL(publishedURL!).pathname.slice(1)
    expect(slug).toMatch(/^[a-z0-9]{6}$/)
    const linkID = (await findShortLink(memberPage, slug))?.id
    expect(linkID).toBeTruthy()

    const wrongHost = await page.request.get(`${primaryOrigin}/${slug}`, { maxRedirects: 0 })
    expect(wrongHost.status()).toBe(404)
    const firstVisit = await page.request.get(publishedURL!, { maxRedirects: 0 })
    expect(firstVisit.status()).toBe(302)
    expect(firstVisit.headers().location).toBe(targetURL)
    await expect.poll(() => readVisitCount(memberPage, linkID!)).toBe(1)

    await page.goto('/admin/domain')
    await page.getByRole('button', { name: /E2E secondary/ }).click()
    await page.getByRole('button', { name: '设为默认' }).click()
    await expect(page.getByText('域名设置已保存。')).toBeVisible()
    expect((await listDomains(page)).find((item) => item.isDefault)?.id).toBe(secondary.id)
    expect((await memberPage.request.get('/api/v1/short-link/list?page=1&pageSize=100').then((response) => response.json()) as {
      data: { items: Array<{ id: string; url: string }> }
    }).data.items.find((item) => item.id === linkID)?.url).toBe(publishedURL)

    const previous = (await listDomains(page)).find((item) => item.id === originalDefault?.id)!
    await changeDefault(page, previous)
    secondary = (await listDomains(page)).find((item) => item.id === secondary?.id)!
    await updateEnabled(page, secondary, false)
    expect((await page.request.get(publishedURL!, { maxRedirects: 0 })).status()).toBe(404)
    secondary = (await listDomains(page)).find((item) => item.id === secondary?.id)!
    await updateEnabled(page, secondary, true)
    const restored = await page.request.get(publishedURL!, { maxRedirects: 0 })
    expect(restored.status()).toBe(302)
    expect(restored.headers().location).toBe(targetURL)
    await expect.poll(() => readVisitCount(memberPage, linkID!)).toBe(2)
    } finally {
      await memberContext.close()
    }
})

async function login(page: Page, username = e2eAdminUsername, password = e2eAdminPassword) {
  await page.goto('/login')
  await page.getByLabel('账号').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function listDomains(page: Page): Promise<DomainRecord[]> {
  const response = await page.request.get('/api/v1/admin/domain/list')
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number; data: { items: DomainRecord[] } }
  expect(payload.code).toBe(0)
  return payload.data.items
}

async function changeDefault(page: Page, domain: DomainRecord) {
  const response = await page.request.post('/api/v1/admin/domain/set-default', {
    data: { id: domain.id, expectedUpdatedAt: domain.updatedAt },
  })
  expect((await response.json() as { code: number }).code).toBe(0)
}

async function updateEnabled(page: Page, domain: DomainRecord, enabled: boolean) {
  const response = await page.request.post('/api/v1/admin/domain/update', {
    data: {
      id: domain.id, expectedUpdatedAt: domain.updatedAt, host: domain.host,
      displayName: domain.displayName, allowedGroups: domain.allowedGroups, enabled,
    },
  })
  expect((await response.json() as { code: number }).code).toBe(0)
}
