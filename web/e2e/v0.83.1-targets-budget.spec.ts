import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'
import { csvIssueAttach as attach, csvIssueLinks as links, runCsvIssueScenario } from './csv-issues-fixture'
import type { CsvIssueScenario } from './csv-issues-fixture'

const touchPages = new WeakSet<Page>()
const test = base.extend<{ scenario: CsvIssueScenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    await runCsvIssueScenario({ browser, page: manager }, use, info, { username: e2eAdminUsername, password: e2eAdminPassword }, touchPages)
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390, 320]) {
  test('v0.83.1 ' + language + ' ' + width + 'px refuses oversized targets before preview or draft replacement', async ({ scenario }, info) => {
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex')
    const manual = 'https://example.com/budget831/' + nonce + '/manual', titled = 'https://example.com/budget831/' + nonce + '/titled'
    const oversized = Array.from({ length: 20 }, (_, index) => 'https://example.com/' + '\\'.repeat(1700) + index)
    const text = 'target_url\n' + oversized.join('\n')
    expect(Buffer.byteLength(text)).toBe(34460)
    expect(Buffer.byteLength(JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', targetUrls: oversized }))).toBe(68557)
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), feedback = page.getByTestId('bulk-create-error-feedback')
    await draft.fill(oversized.join('\n')); await activate(page.getByTestId('bulk-create-preview'))
    await expect(feedback).toBeFocused(); await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
    await expect(draft).toHaveValue(oversized.join('\n')); expect(writes).toStrictEqual([])
    await draft.fill(manual); await upload(page, text)
    await expect(feedback).toBeFocused(); await expect(page.getByTestId('bulk-create-csv-issue')).toHaveCount(0)
    await expect(draft).toHaveValue(manual); await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
    expect(writes).toStrictEqual([])
    await capture(info, 'targets-manual-preserved-' + language + '-' + width, page)
    await activate(page.getByTestId('bulk-create-preview'))
    const firstId = await page.getByTestId('bulk-create-request-id').innerText(), targetsPath = '/api/v1/short-link/batch-create'
    const firstResponse = page.waitForResponse(response => new URL(response.url()).pathname === targetsPath)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await firstResponse).json()).toMatchObject({ code: 0, data: { requestId: firstId, createdCount: 1 } })
    await expect(dialog).toBeHidden()
    expect(writes).toStrictEqual([{ path: targetsPath, body: { requestId: firstId, targetUrls: [manual] }, expected: user.id }])

    await activate(page.getByTestId('bulk-create-open'))
    await upload(page, 'target_url,title\n' + titled + ',Original title')
    const imported = page.getByTestId('bulk-create-imported-list')
    await expect(imported.locator('li')).toHaveCount(1); await expect(imported).toContainText('Original title')
    await upload(page, text)
    await expect(feedback).toBeFocused(); await expect(page.getByTestId('bulk-create-csv-issue')).toHaveCount(0)
    await expect(imported.locator('li')).toHaveCount(1); await expect(imported).toContainText(titled)
    await expect(imported).toContainText('Original title'); await expect(draft).toHaveCount(0)
    expect(writes).toHaveLength(1)
    await capture(info, 'targets-titled-preserved-' + language + '-' + width, page)
    await activate(page.getByTestId('bulk-create-preview'))
    const secondId = await page.getByTestId('bulk-create-request-id').innerText(), titlesPath = '/api/v1/short-link/batch-create-with-titles'
    expect(secondId).not.toBe(firstId)
    const secondResponse = page.waitForResponse(response => new URL(response.url()).pathname === titlesPath)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await secondResponse).json()).toMatchObject({ code: 0, data: { requestId: secondId, createdCount: 1 } })
    await expect(dialog).toBeHidden()
    expect(writes).toStrictEqual([
      { path: targetsPath, body: { requestId: firstId, targetUrls: [manual] }, expected: user.id },
      { path: titlesPath, body: { requestId: secondId, items: [{ targetUrl: titled, title: 'Original title' }] }, expected: user.id },
    ])
    const saved = await links(page.request); expect(saved).toHaveLength(2)
    expect(saved.find(link => link.targetUrl === manual)).toMatchObject({ targetUrl: manual, title: '', tags: [], redirectMode: 'direct' })
    expect(saved.find(link => link.targetUrl === titled)).toMatchObject({ targetUrl: titled, title: 'Original title', tags: [], redirectMode: 'direct' })
    await attach(info, 'targets-budget-persistence', { width, language, firstId, secondId, writes, saved, oversizedCsvBytes: 34460, oversizedWireBytes: 68557, manualPreviewRejected: true, manualDraftPreserved: manual, titledDraftPreserved: titled, requestsDuringRefusals: 0 })
  })
}

/** Exercises the original strict entry without altering or mocking its file-read logic. */
async function upload(page: Page, text: string) { await page.getByTestId('bulk-create-standard-file').setInputFiles({ name: 'targets.csv', mimeType: 'text/csv', buffer: Buffer.from(text) }) }
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' })
}
