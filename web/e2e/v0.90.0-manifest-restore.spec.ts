import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Link { id: string; slug: string; url: string; status: string; maxVisits: number | null; visitsUsed: number }
interface RestoreItem {
  domainOrigin: string; slug: string; targetUrl: string; title: string; tags: string[]
  status: 'active' | 'disabled'; redirectMode: 'direct' | 'intermediate' | 'confirmation'
  intermediateDelaySeconds: string; expiresAt: string; maxVisits: string
}

const restorePath = '/api/v1/short-link/manifest/restore'

/** Uses the real cookie session and unified business envelope for fixture setup. */
async function api<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined
    ? await request.get('/api/v1' + path)
    : await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as T
}

/** Verifies a failed second-row conflict leaves the preceding fresh slug absent. */
async function ownLinks(request: APIRequestContext, slug: string): Promise<Link[]> {
  return (await api<{ items: Link[] }>(request, `/short-link/list?q=${encodeURIComponent(slug)}&page=1&pageSize=20`)).items
}

for (const scenario of [
  { language: 'zh-CN', width: 1280, height: 900 },
  { language: 'en', width: 390, height: 844 },
]) {
  test(`v0.90.0 restores a real management export with an unknown same-key retry (${scenario.language}, ${scenario.width}px)`, async ({ page }, info: TestInfo) => {
    test.setTimeout(90_000)
    const sourceSlug = 'src' + randomBytes(6).toString('hex')
    const restoredSlug = 'rst' + randomBytes(7).toString('hex')
    const targetUrl = `https://example.com/manifest-restore/${randomBytes(5).toString('hex')}`
    const restoredStatus = scenario.width === 390 ? 'disabled' : 'active'
    let source: Link | undefined
    let restored: Link | undefined
    try {
      const login = await api<{ user: { id: string } }>(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const actor = login.user.id
      source = (await api<{ shortLink: Link }>(page.request, '/short-link/create', {
        targetUrl, customSlug: sourceSlug, maxVisits: 2,
        metadata: { title: 'Manifest restore source', tags: ['manifest-e2e'] },
      })).shortLink
      const visit = await page.request.get(source.url, { maxRedirects: 0 })
      expect(visit.status()).toBe(302)
      expect(visit.headers().location).toBe(targetUrl)
      const used = await api<{ shortLink: Link }>(page.request, `/short-link/statistics?id=${encodeURIComponent(source.id)}`)
      expect(used.shortLink).toMatchObject({ maxVisits: 2, visitsUsed: 1 })
      if (restoredStatus === 'disabled') await api(page.request, '/short-link/update', { id: source.id, status: restoredStatus })
      const exported = await api<{ content: string }>(page.request, `/short-link/export?q=${encodeURIComponent(sourceSlug)}`)
      expect(exported.content.startsWith('\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode')).toBe(true)
      // A same-database restore must use an unused slug; all other columns remain the real export.
      const csv = exported.content.replaceAll(sourceSlug, restoredSlug)

      await page.addInitScript(language => localStorage.setItem('moeurl.language', language), scenario.language)
      await page.setViewportSize({ width: scenario.width, height: scenario.height })
      await page.goto('/link')
      await page.getByTestId('bulk-create-open').click()
      await page.getByTestId('bulk-create-dialog').locator('textarea').fill('https://ordinary.example')
      await page.getByTestId('manifest-restore-open').click()
      const panel = page.getByTestId('manifest-restore-dialog')
      await expect(panel.getByTestId('manifest-restore-impact')).toBeVisible()
      await panel.getByTestId('manifest-restore-file').setInputFiles({
        name: 'moeurl-links-own.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8'),
      })
      await expect(panel.getByTestId('manifest-restore-preview')).toContainText('1')
      await expect(panel.getByTestId('manifest-restore-preview')).toContainText(new URL(source.url).origin)
      await panel.getByTestId('manifest-restore-acknowledge').check()
      await expectNoHorizontalOverflow(page)
      const confirm = panel.getByTestId('manifest-restore-confirm')
      await expect(confirm).toBeEnabled()
      await expect(confirm).toBeInViewport()
      await panel.getByTestId('manifest-restore-impact').scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`manifest-restore-preview-${scenario.width}.png`), animations: 'disabled' })

      let capturedBody: { requestId: string; items: RestoreItem[] } | undefined
      let serverReceipt: { code: number; data: { requestId: string; createdCount: number } } | undefined
      let serverStatus: number | undefined
      let serverCacheControl: string | undefined
      await page.route(`**${restorePath}`, async route => {
        const request = route.request()
        capturedBody = request.postDataJSON() as typeof capturedBody
        const actual = await route.fetch()
        serverStatus = actual.status()
        serverCacheControl = actual.headers()['cache-control']
        serverReceipt = await actual.json() as typeof serverReceipt
        await route.abort('failed')
      }, { times: 1 })
      await confirm.click()
      await expect(panel.getByTestId('manifest-restore-unknown')).toBeVisible()
      await expect(page.getByTestId('bulk-create-preview')).toBeDisabled()
      await expect(page.getByTestId('bulk-create-close')).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(panel.getByTestId('manifest-restore-unknown')).toBeVisible()
      expect(serverStatus).toBe(200)
      expect(serverCacheControl).toBe('no-store')
      expect(serverReceipt).toMatchObject({ code: 0, data: { createdCount: 1 } })
      expect(serverReceipt?.data.requestId).toBe(capturedBody?.requestId)
      expect(capturedBody?.items).toHaveLength(1)
      expect(capturedBody?.items[0]).toMatchObject({
        slug: restoredSlug, targetUrl, title: 'Manifest restore source', tags: ['manifest-e2e'],
        status: restoredStatus, redirectMode: 'direct', intermediateDelaySeconds: '5', expiresAt: '', maxVisits: '2',
      })
      const requestId = await panel.getByTestId('manifest-restore-request-id').textContent()
      expect(requestId).toBe(capturedBody?.requestId)
      const identity = (await api<{ user: { id: string } }>(page.request, '/auth/me')).user.id
      expect(identity).toBe(actor)

      const retryRequest = page.waitForRequest(request => new URL(request.url()).pathname === restorePath)
      const retryResponse = page.waitForResponse(response => new URL(response.url()).pathname === restorePath)
      await panel.getByTestId('manifest-restore-retry').click()
      const replay = await retryRequest
      expect(replay.postDataJSON()).toEqual(capturedBody)
      const replayed = await retryResponse
      expect(replayed.headers()['cache-control']).toBe('no-store')
      expect(await replayed.json()).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
      await expect(panel.getByTestId('manifest-restore-success')).toBeVisible()
      await expect(panel.getByTestId('manifest-restore-success')).toContainText('1')
      await expect(panel.getByTestId('manifest-restore-error')).toHaveCount(0)

      const found = await ownLinks(page.request, restoredSlug)
      expect(found).toHaveLength(1)
      restored = found[0]
      expect(restored).toMatchObject({ status: restoredStatus, maxVisits: 2, visitsUsed: 0 })
      expect(new URL(restored.url).origin).toBe(new URL(source.url).origin)
      expect(restored.id).not.toBe(source.id)
      const statistics = await api<{ stats: { visitCount: number } }>(page.request, `/short-link/statistics?id=${encodeURIComponent(restored.id)}`)
      expect(statistics.stats.visitCount).toBe(0)

      const lateConflictSlug = 'late' + randomBytes(6).toString('hex')
      const conflict = await page.request.post(restorePath, {
        headers: { 'X-MoeURL-Expected-User-ID': actor },
        data: {
          requestId: randomUUID(),
          items: [
            { ...capturedBody!.items[0]!, slug: lateConflictSlug, targetUrl: targetUrl + '/first' },
            capturedBody!.items[0]!,
          ],
        },
      })
      expect(conflict.status()).toBe(200)
      expect(conflict.headers()['cache-control']).toBe('no-store')
      expect(await conflict.json()).toMatchObject({ code: 200101 })
      expect(await ownLinks(page.request, lateConflictSlug)).toHaveLength(0)
      expect(await ownLinks(page.request, restoredSlug)).toHaveLength(1)

      await info.attach('manifest-restore-runtime', {
        body: JSON.stringify({ node: process.version, language: scenario.language, width: scenario.width, sameKeyReplay: true, atomicLateConflict: true }),
        contentType: 'application/json',
      })
      const image = info.outputPath(`manifest-restore-${scenario.width}.png`)
      await page.screenshot({ path: image, animations: 'disabled' })
      await info.attach(`manifest-restore-${scenario.width}`, { path: image, contentType: 'image/png' })
    } finally {
      for (const link of [restored, source]) {
        if (link) await api(page.request, '/admin/short-link/delete', { id: link.id })
      }
    }
  })
}
