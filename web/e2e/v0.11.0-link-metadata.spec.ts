import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Link = { id: string; slug: string; url: string; title: string; tags: string[] }

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { username: e2eAdminUsername, password: e2eAdminPassword },
  })
  expect(await response.json()).toMatchObject({ code: 0 })
})

/** Reads saved metadata through the same management contract used by statistics. */
async function readLink(page: Page, id: string): Promise<Link> {
  const response = await page.request.get(`/api/v1/short-link/statistics?id=${encodeURIComponent(id)}`)
  const payload = await response.json() as { code: number; data: { shortLink: Link } }
  expect(payload.code).toBe(0)
  return payload.data.shortLink
}

test('creates, filters, edits and clears metadata without publishing it', async ({ page }) => {
  const title = '团队文档 % _ 标题'
  const tag = 'Release 计划'
  let link: Link | undefined
  try {
    await page.goto('/')
    await page.getByLabel('输入链接', { exact: true }).fill('https://example.com/e2e-metadata')
    await page.getByRole('button', { name: '高级设置' }).click()
    await page.getByRole('button', { name: '确认页', exact: true }).click()
    await page.getByLabel('短链标题', { exact: true }).fill(`  ${title}  `)
    await page.getByLabel('标签（每行一个）', { exact: true }).fill(`团队资料\n ${tag} `)
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
    await page.getByRole('button', { name: '创建短链', exact: true }).click()
    const payload = await (await created).json() as { code: number; data: { shortLink: Link } }
    expect(payload.code).toBe(0)
    link = payload.data.shortLink
    expect(link).toMatchObject({ title, tags: ['团队资料', tag] })

    const preview = await page.request.get(`/go/${link.slug}/preview`)
    const publicPayload = await preview.json()
    expect(publicPayload.code).toBe(0)
    for (const field of ['title', 'tags', 'metadata']) expect(publicPayload.data).not.toHaveProperty(field)

    for (const path of ['/link', '/admin/link']) {
      await page.goto(path)
      const search = page.getByRole('textbox', { name: /搜索/ })
      await search.fill(title)
      await page.getByLabel('标签', { exact: true }).fill(tag)
      const row = page.getByTestId('console-link-row').filter({ hasText: link.url })
      await expect(row).toContainText(title)
      await expect(row).toContainText(tag)
      await page.getByLabel('标签', { exact: true }).fill('release 计划')
      await expect(row).toHaveCount(0)
      await page.getByLabel('标签', { exact: true }).fill(tag)
      await expect(row).toBeVisible()
    }

    await page.goto('/link')
    const row = page.getByTestId('console-link-row').filter({ hasText: link.url })
    await row.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '访问配置' }).click()
    let dialog = page.getByRole('dialog')
    const longTitle = '界'.repeat(120)
    await dialog.getByLabel('短链标题', { exact: true }).fill(longTitle)
    await dialog.getByLabel('标签（每行一个）', { exact: true }).fill('A'.repeat(32))
    await page.setViewportSize({ width: 390, height: 800 })
    await expectNoHorizontalOverflow(page)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(await readLink(page, link.id)).toMatchObject({ title: longTitle, tags: ['A'.repeat(32)] })
    await expect(row).toContainText(longTitle)
    await expectNoHorizontalOverflow(page)

    await row.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '访问配置' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('短链标题', { exact: true }).fill('')
    await dialog.getByLabel('标签（每行一个）', { exact: true }).fill('')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(await readLink(page, link.id)).toMatchObject({ title: '', tags: [] })
  } finally {
    if (link) {
      const response = await page.request.post('/api/v1/short-link/delete', { data: { id: link.id } })
      expect(await response.json()).toMatchObject({ code: 0 })
    }
  }
})
