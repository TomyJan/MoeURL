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
  test('v0.83.0 ' + language + ' ' + width + 'px explicitly maps safe columns and saves both existing protocols', async ({ scenario }, info) => {
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex'), english = language === 'en'
    const targets = ['https://example.com/mapping83/' + nonce + '/first', 'https://example.com/mapping83/' + nonce + '/second']
    const title = '<b>工具 😀</b>', privateValue = 'never-upload-' + nonce, manual = 'https://example.com/mapping83/manual'
    const rows = [
      ['', 'ignore-one', 'ignore-two', privateValue, 'private control data', 'private emoji data', targets[0]!, ' ' + title + ' '],
      ['', 'other-one', 'other-two', privateValue, 'private control data', 'private emoji data', targets[1]!, 'Second'],
    ]
    const input = csv(['', 'Same', 'Same', '<img src=x onerror=secret>', 'Control\u0000', '😀'.repeat(61), 'Address', 'Name'], rows)
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), mapping = page.getByTestId('bulk-create-csv-mapping')
    await draft.fill(manual)
    // The original strict entry must still refuse custom headers; it must never silently fall back.
    await upload(page, input, 'standard')
    await expect(page.getByTestId('bulk-create-csv-issue')).toContainText(english ? 'standard column set' : '标准列集合')
    await expect(draft).toHaveValue(manual)
    await upload(page, 'A,B\nhttps://secret.invalid', 'mapped')
    await expect(page.getByTestId('bulk-create-csv-issue')).toContainText(english ? 'record 2' : '第 2 条')
    await expect(draft).toHaveValue(manual); expect(writes).toStrictEqual([])
    await upload(page, 'target_url\nhttps://example.com/staged', 'mapped')
    await expect(mapping).toBeVisible(); await expect(draft).toHaveCount(0)
    await expect(page.getByTestId('bulk-create-preview')).toBeDisabled()
    await activate(page.getByTestId('bulk-create-mapping-cancel')); await expect(draft).toHaveValue(manual)
    await upload(page, input, 'mapped'); await expect(mapping).toBeVisible()
    await expect(dialog).not.toContainText(privateValue); await expect(dialog.locator('img')).toHaveCount(0)
    await expect(mapping).toContainText(english ? 'Other columns are ignored.' : '其余列会被忽略。')
    await expect(mapping).toContainText(english ? 'This does not restore historical data.' : '这不是历史数据恢复。')
    const url = mapping.getByRole('combobox', { name: english ? 'URL column' : '网址列', exact: true })
    const titleColumn = mapping.getByRole('combobox', { name: english ? 'Title column (optional)' : '标题列（可不导入）', exact: true })
    await activate(url)
    for (const name of [column(1, english ? 'Unnamed header' : '无表头名称', english), column(2, 'Same', english), column(3, 'Same', english), column(4, '<img src=x onerror=secret>', english), column(5, 'Control�', english), column(6, '😀'.repeat(60) + '…', english)]) {
      await expect(page.getByRole('option', { name, exact: true })).toHaveCount(1)
    }
    await expect(dialog.locator('img')).toHaveCount(0)
    await activate(page.getByRole('option', { name: column(7, 'Address', english), exact: true }))
    await choose(page, titleColumn, column(7, 'Address', english))
    const feedback = page.getByTestId('bulk-create-error-feedback')
    for (let attempt = 0; attempt < 2; attempt++) {
      await activate(page.getByTestId('bulk-create-mapping-apply')); await expect(feedback).toBeFocused()
      await expect(mapping).toBeVisible(); expect(writes).toStrictEqual([])
    }
    await choose(page, titleColumn, column(8, 'Name', english))
    await capture(info, 'csv-mapping-choice-' + language + '-' + width, page)
    await activate(page.getByTestId('bulk-create-mapping-apply'))
    await expect(mapping).toHaveCount(0); await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(2)
    await expect(dialog).toContainText(title); await expect(dialog).not.toContainText(privateValue); await expect(dialog.locator('b')).toHaveCount(0)
    expect(writes).toStrictEqual([])
    await activate(page.getByTestId('bulk-create-preview'))
    const firstId = await page.getByTestId('bulk-create-request-id').innerText(), titlesPath = '/api/v1/short-link/batch-create-with-titles'
    await capture(info, 'csv-mapping-preview-' + language + '-' + width, page)
    const firstResponse = page.waitForResponse(response => new URL(response.url()).pathname === titlesPath)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await firstResponse).json()).toMatchObject({ code: 0, data: { requestId: firstId, createdCount: 2 } }); await expect(dialog).toBeHidden()
    const expectedItems = [{ targetUrl: targets[0], title: ' ' + title + ' ' }, { targetUrl: targets[1], title: 'Second' }]
    expect(writes).toStrictEqual([{ path: titlesPath, body: { requestId: firstId, items: expectedItems }, expected: user.id }])
    const firstSaved = await links(page.request); expect(firstSaved).toHaveLength(2)
    expect(firstSaved.find(link => link.targetUrl === targets[0])).toMatchObject({ targetUrl: targets[0], title, tags: [], redirectMode: 'direct' })
    expect(firstSaved.find(link => link.targetUrl === targets[1])).toMatchObject({ targetUrl: targets[1], title: 'Second', tags: [], redirectMode: 'direct' })
    // Omitting the title choice must use targets, even though a valid-looking title column exists.
    await activate(page.getByTestId('bulk-create-open'))
    const onlyTarget = 'https://example.com/mapping83/' + nonce + '/url-only'
    await upload(page, csv(['Address', 'Name', 'Secret'], [[onlyTarget, 'Ignored title', privateValue]]), 'mapped')
    await choose(page, mapping.getByRole('combobox', { name: english ? 'URL column' : '网址列', exact: true }), column(1, 'Address', english))
    await activate(page.getByTestId('bulk-create-mapping-apply')); await expect(draft).toHaveValue(onlyTarget)
    expect(writes).toHaveLength(1); await activate(page.getByTestId('bulk-create-preview'))
    const secondId = await page.getByTestId('bulk-create-request-id').innerText(), targetsPath = '/api/v1/short-link/batch-create'
    expect(secondId).not.toBe(firstId)
    const secondResponse = page.waitForResponse(response => new URL(response.url()).pathname === targetsPath)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await secondResponse).json()).toMatchObject({ code: 0, data: { requestId: secondId, createdCount: 1 } }); await expect(dialog).toBeHidden()
    expect(writes).toStrictEqual([{ path: titlesPath, body: { requestId: firstId, items: expectedItems }, expected: user.id }, { path: targetsPath, body: { requestId: secondId, targetUrls: [onlyTarget] }, expected: user.id }])
    const saved = await links(page.request); expect(saved).toHaveLength(3)
    expect(saved.find(link => link.targetUrl === onlyTarget)).toMatchObject({ title: '', tags: [], redirectMode: 'direct' })
    expect(JSON.stringify(writes)).not.toContain(privateValue); expect(JSON.stringify(saved)).not.toContain(privateValue)
    await attach(info, 'csv-mapping-persistence', { width, language, firstId, secondId, writes, saved, cancelledDraftPreserved: manual, ignoredColumnsNotSent: true, safeHeaderCodePoints: 60 })
  })
}

/** Encodes only the input fixture; the expected wire objects above remain explicit. */
function csv(headers: string[], rows: string[][]) { return '\uFEFF' + [headers, ...rows].map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n' }
function column(number: number, name: string, english: boolean) { return english ? 'Column ' + number + ': ' + name : '第 ' + number + ' 列：' + name }
async function choose(page: Page, control: Locator, name: string) { await activate(control); await activate(page.getByRole('option', { name, exact: true })) }
async function upload(page: Page, text: string, mode: 'standard' | 'mapped') { await page.getByTestId(mode === 'standard' ? 'bulk-create-standard-file' : 'bulk-create-mapping-file').setInputFiles({ name: 'column-mapping.csv', mimeType: 'text/csv', buffer: Buffer.from(text) }) }
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
async function capture(info: TestInfo, name: string, page: Page) { await expectNoHorizontalOverflow(page); await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0); const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' }) }
