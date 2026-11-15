import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test'

export interface CsvIssueUser { id: string; username: string }
export interface CsvIssueLink { id: string; slug: string; targetUrl: string; title: string; tags: string[]; redirectMode: string; expiresAt: string | null; maxVisits: number | null; intermediateDelaySeconds: number }
export interface CsvIssueScenario { page: Page; user: CsvIssueUser }
const password = 'csv-csv-issues-disposable-account'

/** Owns the actual CSV issue scenario lifecycle, including initialization and cleanup failures. */
export async function runCsvIssueScenario(
  { browser, page: manager }: { browser: Browser; page: Page },
  use: (scenario: CsvIssueScenario) => Promise<void>,
  info: TestInfo,
  adminCredentials: { username: string; password: string },
  touchPages: WeakSet<Page>,
): Promise<void> {
  let context: BrowserContext | undefined, user: CsvIssueUser | undefined
  const failures: unknown[] = []
  try {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Disposable Compose baseURL required')
    await csvIssuePost(manager.request, '/auth/login', adminCredentials)
    user = (await csvIssuePost<{ user: CsvIssueUser }>(manager.request, '/admin/user/create', { username: 'csvissues-' + randomBytes(7).toString('hex'), password, nickname: 'CSV issue fixture', groupKey: 'admin', status: 'active' })).user
    const width = info.title.includes('1280px') ? 1280 : info.title.includes('320px') ? 320 : 390, language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
    context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : width === 320 ? 500 : 800 }, locale: language, hasTouch: width !== 1280, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
    await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
    const page = await context.newPage(); if (width !== 1280) touchPages.add(page)
    await csvIssuePost(page.request, '/auth/login', { username: user.username, password })
    await csvIssueAttach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: user.id, disposableDatabase: true })
    await use({ page, user })
  } catch (error) { failures.push(error) } finally {
    if (context && user) {
      try { for (const link of await csvIssueLinks(context.request)) { try { await csvIssuePost(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } } } catch (error) { failures.push(error) }
    }
    if (user) {
      try { await csvIssuePost(manager.request, '/admin/user/update', { id: user.id, nickname: 'CSV issue fixture', status: 'disabled' }) } catch (error) { failures.push(error) }
    }
    if (context) await context.close().catch(error => failures.push(error))
  }
  if (failures.length) throw new AggregateError(failures, 'CSV issue scenario or owned cleanup failed')
}

/** Reads the owned account's links and rejects both HTTP and business failures. */
export async function csvIssueLinks(api: APIRequestContext): Promise<CsvIssueLink[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100')
  assert.equal(response.status(), 200); const payload = await response.json(); assert.equal(payload.code, 0)
  return (payload.data as { items: CsvIssueLink[] }).items
}

/** Performs one fixture API write without retrying an unknown result. */
export async function csvIssuePost<T = unknown>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post('/api/v1' + path, { data, timeout: 10_000 })
  assert.equal(response.status(), 200); const payload = await response.json(); assert.equal(payload.code, 0)
  return payload.data as T
}

/** Writes a fixture attachment before registering its exact owned path. */
export async function csvIssueAttach(info: TestInfo, name: string, value: unknown): Promise<void> {
  const output = info.outputPath(name + '.json'); await writeFile(output, JSON.stringify(value, null, 2)); await info.attach(name, { path: output, contentType: 'application/json' })
}
