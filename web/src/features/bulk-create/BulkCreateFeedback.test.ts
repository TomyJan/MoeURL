import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const actor = { id: '00000000-0000-0000-0000-000000005611', username: 'csv-feedback', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug'] }
type Request = { requestId: string; items: { targetUrl: string; title: string; tags: string[]; customSlug: string }[] }
/** Uses real parsing, i18n, composition lifecycle and API transport; only the external fetch is controlled. */
function mount(locale: 'zh-CN' | 'en', code: number, firstUnknown = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  const requests: Request[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/auth/me')) return new Response(JSON.stringify({ code: 0, data: { user: actor }, meta: {} }))
    if (String(url) !== '/api/v1/short-link/batch-create-with-custom-slugs') throw new Error('Wrong creation protocol')
    const body = JSON.parse(init!.body as string) as Request
    requests.push(body)
    if (firstUnknown && requests.length === 1) throw new Error('Lost acknowledgement')
    const resultCode = requests.length === (firstUnknown ? 2 : 1) ? code : 0
    return new Response(JSON.stringify({ code: resultCode, message: 'private backend detail', data: resultCode ? null : { requestId: body.requestId, createdCount: body.items.length }, meta: {} }))
  })
  const view = render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })], stubs: componentStubs } })
  return { ...view, requests }
}
/** Reads a real bounded CSV through the native file input. */
async function selectCsv(container: Element, slug = 'TeamDocs56') {
  const valid = 'target_url,title,tags,custom_slug\nhttps://example.com/feedback, raw title ,[],' + slug
  const file = new File([valid], 'custom.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(valid).buffer })
  await fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('https://example.com/feedback'))
}
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

// Missing fifth-format guidance must fail at the visible summary and parser-error boundary.
it.each(['zh-CN', 'en'] as const)('describes all five formats in the visible %s summary and invalid-file recovery', async locale => {
  const view = mount(locale, 200101)
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  const summary = screen.getByText(locale === 'zh-CN' ? /五种固定格式/ : /five fixed formats/i)
  expect(summary.textContent).toMatch(locale === 'zh-CN' ? /自定义短码/ : /custom code/)
  expect(summary.textContent).toMatch(locale === 'zh-CN' ? /跳转方式/ : /redirect mode/)
  const helpTitle = screen.getByTestId('bulk-create-csv-help').querySelector('summary')!.textContent!.trim()
  expect(helpTitle).toBe(locale === 'zh-CN' ? 'CSV 格式示例与模板' : 'CSV format example and template')
  const bytes = new TextEncoder().encode('target_url,title,tags,custom_slug\nhttps://example.com,bad')
  const file = new File([bytes], 'invalid.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  const input = view.container.querySelector('input[type=file]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(() => expect(screen.getByTestId('bulk-create-error').textContent).toContain('target_url,title,tags,custom_slug'))
  expect(screen.getByTestId('bulk-create-error').textContent).toContain('redirect_mode')
  expect(screen.getByTestId('bulk-create-error').textContent).toContain(helpTitle)
  expect(view.requests).toHaveLength(0)
})

// The old generic rejection cannot tell the user which short-code correction is required.
it.each([
  ['zh-CN', 200101, '已被占用'], ['zh-CN', 200102, '系统保留字'],
  ['en', 200101, 'already in use'], ['en', 200102, 'reserved'],
  ['zh-CN', 200121, '目标主机被站点规则限制'], ['en', 200121, 'restricts a target host'],
  ['zh-CN', 200122, '账号今日剩余额度不足'], ['en', 200122, 'remaining daily quota'],
] as const)('lets %s correct definite short-code refusal %i after explaining %s', async (locale, code, reason) => {
  const view = mount(locale, code)
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  await selectCsv(view.container)
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  const originalId = screen.getByTestId('bulk-create-request-id').textContent
  await fireEvent.click(screen.getByTestId('bulk-create-submit'))
  await waitFor(() => expect(screen.getByTestId('bulk-create-error').textContent).toContain(reason))
  expect(screen.getByTestId('bulk-create-error').textContent).not.toContain('private backend detail')
  expect(screen.getByTestId('bulk-create-error').textContent).toMatch(locale === 'zh-CN' ? /整批未创建/ : /No links were created/)
  expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('teamdocs56')
  expect(screen.getByTestId('bulk-create-request-id').textContent).toBe(originalId)
  expect(view.requests).toHaveLength(1)
  await fireEvent.click(screen.getByTestId('bulk-create-edit'))
  await selectCsv(view.container, '')
  await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain(locale === 'zh-CN' ? '随机生成' : 'randomly generated'))
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  expect(screen.getByTestId('bulk-create-request-id').textContent).not.toBe(originalId)
  await fireEvent.click(screen.getByTestId('bulk-create-submit'))
  await waitFor(() => expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull())
  expect(view.requests).toHaveLength(2)
  expect(view.requests[0]!.items[0]).toEqual({ targetUrl: 'https://example.com/feedback', title: ' raw title ', tags: [], customSlug: 'TeamDocs56' })
  expect(view.requests[1]!.items[0]!.customSlug).toBe('')
})

// An unknown write followed by refusal never justifies telling the user that nothing was created.
it.each([['zh-CN', 200101], ['zh-CN', 200102], ['en', 200101], ['en', 200102], ['zh-CN', 200121], ['en', 200121], ['zh-CN', 200122], ['en', 200122]] as const)('keeps %s unknown retry %i immutable and avoids a false rollback claim', async (locale, code) => {
  const view = mount(locale, code, true)
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  await selectCsv(view.container)
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  const id = screen.getByTestId('bulk-create-request-id').textContent
  await fireEvent.click(screen.getByTestId('bulk-create-submit'))
  await waitFor(() => expect(screen.getByTestId('bulk-create-error').textContent).toMatch(locale === 'zh-CN' ? /结果未确认/ : /result is unknown/))
  await fireEvent.click(screen.getByTestId('bulk-create-submit'))
  await waitFor(() => expect(view.requests).toHaveLength(2))
  await waitFor(() => expect((screen.getByTestId('bulk-create-submit') as HTMLButtonElement).disabled).toBe(false))
  expect(screen.getByTestId('bulk-create-error').textContent).toMatch(locale === 'zh-CN' ? /结果未确认/ : /result is unknown/)
  expect(screen.getByTestId('bulk-create-error').textContent).not.toMatch(/整批未创建|No links were created/)
  expect(screen.getByTestId('bulk-create-request-id').textContent).toBe(id)
  expect((screen.getByTestId('bulk-create-edit') as HTMLButtonElement).disabled).toBe(true)
  expect(view.requests[1]).toEqual(view.requests[0])
})
