import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'
import { csvIssueAttach as attach, csvIssueLinks as links, runCsvIssueScenario } from './csv-issues-fixture'
import type { CsvIssueScenario } from './csv-issues-fixture'

interface Item { targetUrl: string; title: string; tags: string[]; customSlug: string; redirectMode: string; expiresAt: string; maxVisits: string; intermediateDelaySeconds: string }
const endpoint = '/api/v1/short-link/batch-create-with-countdowns', touchPages = new WeakSet<Page>()
const test = base.extend<{ scenario: CsvIssueScenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    await runCsvIssueScenario({ browser, page: manager }, use, info, { username: e2eAdminUsername, password: e2eAdminPassword }, touchPages)
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390, 320]) {
  test('v0.82.0 ' + language + ' ' + width + 'px locates safe CSV issues and preserves drafts before a real ordered save', async ({ scenario }, info) => {
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex')
    const items: Item[] = [
      { targetUrl: 'https://example.com/issues82/' + nonce + '/first', title: ' <b>工具 😀</b> ', tags: [' 工具 ', 'a,b'], customSlug: 'IssuesA' + nonce, redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12', intermediateDelaySeconds: '3' },
      { targetUrl: 'https://example.com/issues82/' + nonce + '/second', title: ' Second ', tags: [], customSlug: 'IssuesB' + nonce, redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '10' },
    ]
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), manual = 'https://example.com/manual-issues82'
    await draft.fill(manual)
    const issue = page.getByTestId('bulk-create-csv-issue'), feedback = page.getByTestId('bulk-create-error-feedback')
    const cases = [
      { text: '<img src=x onerror=secret>\nhttps://secret.invalid', expected: language === 'en' ? 'Invalid standard column set in CSV record 1.' : 'CSV 表头不符合标准列集合（第 1 条记录）。' },
      { text: 'target_url\nhttps://example.com\n"secret', expected: language === 'en' ? 'Invalid quoting or line ending in CSV record 3.' : '第 3 条 CSV 记录的引号或换行格式不正确。' },
      { text: 'target_url,title\r\nhttps://example.com,"line1\r\nline2"\r\nhttps://example.org', expected: language === 'en' ? 'CSV record 3 has a different field count from the header.' : '第 3 条 CSV 记录的字段数量与表头不一致。' },
    ]
    for (const sample of cases) {
      await upload(page, sample.text)
      await expect(issue).toHaveText(sample.expected); await expect(feedback).toBeFocused()
      await expect(draft).toHaveValue(manual); await expect(page.getByTestId('bulk-create-error')).not.toContainText('secret')
      await expect(dialog.locator('img')).toHaveCount(0); expect(writes).toStrictEqual([])
    }
    await draft.focus(); await upload(page, cases[2]!.text)
    await expect(feedback).toBeFocused(); await expect(issue).toHaveText(cases[2]!.expected)
    await expect(dialog.getByTestId('bulk-create-standard-file')).toHaveValue('')
    await capture(info, 'csv-issues-location-' + language + '-' + width, page)
    await attach(info, 'csv-issues-diagnosis', { cases: cases.map(({ expected }) => expected), writes, manualKept: await draft.inputValue(), logicalRecord: 3, inputEchoed: false, width, language })
    await upload(page, 'target_url\nftp://secret.invalid')
    await expect(page.getByTestId('bulk-create-error')).toBeVisible(); await expect(issue).toHaveCount(0); await expect(draft).toHaveValue(manual)
    expect(writes).toStrictEqual([]); expect(await links(page.request)).toStrictEqual([])
    const help = page.getByTestId('bulk-create-csv-help'); await activate(help.locator('summary'))
    const rule = help.getByText(language === 'en'
      ? 'Standard columns may appear in any order. Unknown or duplicate names and headers without target_url are rejected. Examples and templates keep the complete standard order.'
      : '标准列名可任意排列；不能使用未知、重复或缺少 target_url 的表头。示例和模板仍使用完整标准顺序。', { exact: true })
    await rule.scrollIntoViewIfNeeded(); await expect(rule).toBeVisible(); await expect(rule).toBeInViewport({ ratio: 1 })
    const counting = help.getByText(language === 'en'
      ? 'Count CSV records with the header as record 1. Line breaks inside cells do not add records.'
      : '按 CSV 记录计数，表头为第 1 条，单元格中的换行不另计。', { exact: true })
    await counting.scrollIntoViewIfNeeded(); await expect(counting).toBeVisible(); await expect(counting).toBeInViewport({ ratio: 1 })
    await capture(info, 'csv-issues-help-' + language + '-' + width, page)
    await activate(help.locator('summary'))
    await upload(page, reversedCsv(items))
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(2)
    await upload(page, 'target_url,title\nhttps://example.com')
    await expect(issue).toHaveText(language === 'en' ? 'CSV record 2 has a different field count from the header.' : '第 2 条 CSV 记录的字段数量与表头不一致。')
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(2); expect(writes).toStrictEqual([])
    await upload(page, reversedCsv(items)); await expect(page.getByTestId('bulk-create-error')).toHaveCount(0)
    for (const stage of ['imported', 'preview']) {
      if (stage === 'preview') await activate(page.getByTestId('bulk-create-preview'))
      const list = page.getByTestId('bulk-create-' + stage + '-list'); await expect(list.locator('li')).toHaveCount(2)
      await expect(list.locator('li').nth(0)).toContainText(items[0]!.targetUrl); await expect(list.locator('li').nth(1)).toContainText(items[1]!.targetUrl)
      await expect(list).toContainText('<b>工具 😀</b>'); await expect(dialog.locator('b')).toHaveCount(0)
      await expect(list.locator('.bulk-create-item-countdown').nth(0)).toContainText('3'); await expect(list.locator('.bulk-create-item-countdown').nth(1)).toContainText('10')
    }
    await capture(info, 'csv-issues-preview-' + language + '-' + width, page)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText(), response = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit')); expect(await (await response).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 2 } })
    await expect(dialog).toBeHidden(); expect(writes).toStrictEqual([{ path: endpoint, body: { requestId, items }, expected: user.id }])
    const persisted = await links(page.request); expect(persisted).toHaveLength(2)
    const first = persisted.find(link => link.targetUrl === items[0]!.targetUrl), second = persisted.find(link => link.targetUrl === items[1]!.targetUrl)
    expect(first).toMatchObject({ targetUrl: items[0]!.targetUrl, title: '<b>工具 😀</b>', tags: ['工具', 'a,b'], slug: items[0]!.customSlug.toLowerCase(), redirectMode: 'intermediate', maxVisits: 12, intermediateDelaySeconds: 3 })
    expect(Date.parse(first!.expiresAt!)).toBe(Date.parse(items[0]!.expiresAt))
    expect(second).toMatchObject({ targetUrl: items[1]!.targetUrl, title: 'Second', tags: [], slug: items[1]!.customSlug.toLowerCase(), redirectMode: 'intermediate', expiresAt: null, maxVisits: null, intermediateDelaySeconds: 10 })
    await attach(info, 'csv-issues-persistence', { requestId, items, writes, persisted, invalidKeptManualDraft: true, csvHeader: 'intermediate_delay_seconds,max_visits,expires_at,redirect_mode,custom_slug,tags,title,target_url' })
  })
}

/** Builds the input fixture only; expected wire objects are specified independently above. */
function reversedCsv(items: readonly Item[]) {
  return '\uFEFFintermediate_delay_seconds,max_visits,expires_at,redirect_mode,custom_slug,tags,title,target_url\r\n' + items.map(item => [item.intermediateDelaySeconds, item.maxVisits, item.expiresAt, item.redirectMode, item.customSlug, JSON.stringify(item.tags), item.title, item.targetUrl].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'
}
async function upload(page: Page, text: string) { await page.getByRole('dialog').getByTestId('bulk-create-standard-file').setInputFiles({ name: 'csv-issues.csv', mimeType: 'text/csv', buffer: Buffer.from(text) }) }
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
async function capture(info: TestInfo, name: string, page: Page) { await expectNoHorizontalOverflow(page); await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0); const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' }) }
