import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Domain { id: string; host: string; displayName: string; enabled: boolean; allowedGroups: string[]; updatedAt: string }
const target = 'https://example.com/auth-recovery-preserved'
const retryLabel = /^(重试|Retry)$/
const errorText = /身份信息读取失败，请重试。|Could not load your account. Please retry\./
const domainLabel = /^(短链域名|Short-link domain)$/
const targetLabel = /^(输入链接|Enter link)$/
const submitLabel = /^(创建短链|Create short link)$/

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const width of [1280, 390]) {
  for (const mode of ['initial', 'background'] as const) {
    test(`recovers ${mode} identity reads without automatic creation at ${width}px`, async ({ page, request }, info) => {
      const suffix = randomBytes(6).toString('hex')
      const username = `recovery-${suffix}`
      const password = 'auth-recovery-test-password'
      let accountId: string | undefined
      let assigned: Domain | undefined
      const links: string[] = []
      const errors: unknown[] = []
      let scenarioError: unknown
      let failing = true
      let reads = 0
      let writes = 0
      const started = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      const onRequest = (event: { url(): string }) => {
        if (new URL(event.url()).pathname === '/api/v1/short-link/create') writes++
      }
      const authRoute = async (route: import('@playwright/test').Route) => {
        reads++
        if (failing) { await route.abort('failed'); return }
        started.resolve()
        await released.promise
        await route.continue()
      }
      try {
        await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
        accountId = (await post<{ user: { id: string } }>(request, '/admin/user/create', { username, nickname: 'Auth recovery test', password, groupKey: 'user', status: 'active' })).user.id
        assigned = (await post<{ domain: Domain }>(request, '/admin/domain/create', { host: `https://recovery-${suffix}.example`, displayName: `Recovery ${suffix}`, enabled: true, allowedGroups: ['user', 'admin'] })).domain
        await post(page.request, '/auth/login', { username, password })
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
        page.on('request', onRequest)
        if (mode === 'initial') await page.route('**/api/v1/auth/me', authRoute)
        await page.goto('/')
        if (mode === 'background') {
          await expect(page.getByLabel(targetLabel)).toBeEnabled()
          await page.getByLabel(targetLabel).fill(target)
          await page.getByRole('combobox', { name: domainLabel }).press('Enter')
          await page.getByRole('option', { name: `${assigned.displayName} (${assigned.host})`, exact: true }).click()
          await page.route('**/api/v1/auth/me', authRoute)
          await page.context().setOffline(true)
          await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
          await page.context().setOffline(false)
        }
        const authError = page.getByRole('alert').filter({ has: page.getByRole('button', { name: retryLabel, exact: true }) })
        await expect(authError).toBeVisible()
        await expect(authError).toContainText(errorText)
        await expect(page.getByRole('button', { name: submitLabel })).toBeDisabled()
        await expect(page.getByLabel(targetLabel)).toBeDisabled()
        expect(reads).toBeGreaterThan(0)
        expect(writes).toBe(0)
        await layout(page, info, `auth-${mode}-error-${width}`)

        failing = false
        const retry = page.getByRole('button', { name: retryLabel, exact: true })
        await retry.focus()
        await retry.press('Enter')
        await started.promise
        await expect(page.getByRole('button', { name: submitLabel })).toBeDisabled()
        if (mode === 'background') await expect(retry).toBeDisabled()
        expect(writes).toBe(0)
        await layout(page, info, `auth-${mode}-pending-${width}`)
        const authResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
        released.resolve()
        expect((await (await authResponse).json()).code).toBe(0)
        await expect(authError).toHaveCount(0)
        await expect(page.getByLabel(targetLabel)).toBeEnabled()
        await expect(page.getByRole('button', { name: submitLabel })).toBeEnabled()
        if (mode === 'background') {
          await expect(page.getByLabel(targetLabel)).toHaveValue(target)
          await expect(page.getByRole('combobox', { name: domainLabel })).toHaveValue(`${assigned.displayName} (${assigned.host})`)
        } else await page.getByLabel(targetLabel).fill(target)
        expect(writes).toBe(0)
        await layout(page, info, `auth-${mode}-recovered-${width}`)
        const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
        await page.getByRole('button', { name: submitLabel }).click()
        const response = await created
        const payload = await response.json()
        expect(payload.code).toBe(0)
        links.push(payload.data.shortLink.id)
        expect(response.request().postDataJSON().targetUrl).toBe(target)
        if (mode === 'background') {
          expect(response.request().postDataJSON().domainId).toBe(assigned.id)
          expect(new URL(payload.data.shortLink.url).origin).toBe(new URL(assigned.host).origin)
        }
        await expect(page.getByTestId('short-link-create-result')).toBeVisible()
        expect(writes).toBe(1)
        await info.attach('auth-recovery-contract', { body: Buffer.from(JSON.stringify({ width, mode, reads, writes, accountId, assignedDomain: assigned.id, links })), contentType: 'application/json' })
      } catch (error) { scenarioError = error } finally {
        released.resolve()
        try { await page.unroute('**/api/v1/auth/me', authRoute) } catch (error) { errors.push(error) }
        page.off('request', onRequest)
        for (const id of links) {
          try { await post(request, '/admin/short-link/delete', { id }) } catch (error) { errors.push(error) }
        }
        if (assigned) {
          try {
            const response = await request.get('/api/v1/admin/domain/list')
            const payload = await response.json()
            expect(payload.code).toBe(0)
            const current = (payload.data.items as Domain[]).find(item => item.id === assigned!.id)!
            expect(current).toBeDefined()
            await post(request, '/admin/domain/update', { id: current.id, host: current.host, displayName: current.displayName, enabled: false, allowedGroups: ['admin'], expectedUpdatedAt: current.updatedAt })
          } catch (error) { errors.push(error) }
        }
        if (accountId) {
          try { await post(request, '/admin/user/update', { id: accountId, nickname: 'Auth recovery test', status: 'disabled' }) } catch (error) { errors.push(error) }
        }
      }
      if (scenarioError || errors.length) throw new AggregateError([...(scenarioError ? [scenarioError] : []), ...errors], 'Identity recovery scenario or owned cleanup failed')
    })
  }
}

/** Requires genuine HTTP/business success for isolated setup and cleanup. */
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`/api/v1${path}`, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as T
}

/** Keeps failure, pending and restored layouts visible without hiding product content. */
async function layout(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
}
