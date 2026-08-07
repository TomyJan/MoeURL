import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

/** Escapes user-controlled text before embedding it in an E2E regular expression. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Finds a short link by slug through the authenticated list API. */
export async function findShortLink(page: Page, slug: string) {
  const pageSize = 100
  for (let pageNumber = 1; ; pageNumber += 1) {
    const response = await page.request.get(`/api/v1/short-link/list?page=${pageNumber}&pageSize=${pageSize}`)
    await expect(response).toBeOK()
    const payload = await response.json() as {
      data: { items: Array<{ id: string; passwordEnabled: boolean; slug: string }> }
      meta: { page: number; pageSize: number; total: number }
    }
    const link = payload.data.items.find((item) => item.slug === slug)
    if (link) {
      return link
    }
    if (payload.meta.page * payload.meta.pageSize >= payload.meta.total) {
      return undefined
    }
  }
}

/** Reads the successful-redirect count for a short link. */
export async function readVisitCount(page: Page, id: string) {
  const response = await page.request.get(`/api/v1/short-link/statistics?id=${encodeURIComponent(id)}`)
  await expect(response).toBeOK()
  const payload = await response.json() as {
    code: number
    data: { stats: { visitCount: number } }
  }
  expect(payload.code).toBe(0)
  return payload.data.stats.visitCount
}

/** Verifies that the password form remains usable within the active viewport. */
export async function expectPasswordLayout(page: Page) {
  await expectNoHorizontalOverflow(page)
  const [stateBox, passwordBox, actionsBox] = await Promise.all([
    page.locator('.redirect-page__state').boundingBox(),
    page.locator('.redirect-page__password').boundingBox(),
    page.locator('.redirect-page__actions').boundingBox(),
  ])
  expect(stateBox).not.toBeNull()
  expect(passwordBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (!stateBox || !passwordBox || !actionsBox || !viewport) {
    return
  }
  expect(stateBox.x).toBeGreaterThanOrEqual(0)
  expect(stateBox.x + stateBox.width).toBeLessThanOrEqual(viewport.width)
  expect(passwordBox.y + passwordBox.height).toBeLessThanOrEqual(actionsBox.y + 1)
}

/** Verifies that the rendered document does not overflow horizontally. */
export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
}

/** Attaches the current page image to the Playwright report. */
export async function attachScreenshot(testInfo: TestInfo, name: string, page: Page) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
}
