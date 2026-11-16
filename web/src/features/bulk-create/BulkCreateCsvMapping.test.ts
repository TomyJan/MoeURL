import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

const clients: QueryClient[] = []
const words = [
  { locale: 'zh-CN', url: '网址列', title: '标题列（可不导入）', tags: '标签列（可不导入）', ignored: '仅导入所选网址、标题和标签，其他列会被忽略。这不是历史数据恢复。' },
  { locale: 'en', url: 'URL column', title: 'Title column (optional)', tags: 'Tags column (optional)', ignored: 'Only the selected URL, title and tags are imported. Other columns are ignored. This does not restore historical data.' },
]
const csvCell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
function mount(locale: string, metadata = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000008303', username: 'mapping-ui', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', ...(metadata ? ['short_link:set_metadata'] : [])] } })
  const writes: { path: string; input: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
    const input = JSON.parse(init!.body as string) as { requestId: string; items?: unknown[]; targetUrls?: string[] }
    writes.push({ path: String(url), input })
    return new Response(JSON.stringify({ code: 0, message: '', data: { requestId: input.requestId, createdCount: (input.items ?? input.targetUrls)!.length }, meta: {} }))
  }))
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  const view = render(BulkCreateDialog, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { view, writes }
}
async function select(container: Element, text: string) {
  const file = new File([text], 'local-only.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  const input = container.querySelector<HTMLInputElement>('[data-testid=bulk-create-mapping-file]') ?? container.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true }); await fireEvent.change(input)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  return input
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('explicit bilingual mapped CSV controls', () => {
  // A dropped authority guard or an accidental titles projection would change the actual HTTP payload.
  it('disables title mapping without metadata and creates the selected URLs through the original targets protocol', async () => {
    const { view, writes } = mount('en', false); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'Secret,Address,Name\nprivate,https://example.com/url-only,Ignored title')
    expect((screen.getByRole('combobox', { name: 'Title column (optional)' }) as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Tags column (optional)' }) as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('This account can import URLs only because it lacks metadata permission.')).toBeTruthy()
    await fireEvent.update(screen.getByRole('combobox', { name: 'URL column' }), '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/url-only')
    expect(view.container.textContent).not.toContain('Ignored title'); expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create', input: { requestId: expect.any(String), targetUrls: ['https://example.com/url-only'] } }])
  })

  it('requires JSON tags, preserves the prior draft on refusal and writes only explicit fields', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(view.container.querySelector('textarea')!, 'https://example.com/manual')
    await select(view.container, 'Address,Category,Private\nhttps://example.com/first,[1],private-secret')
    expect(screen.getByText('Tags must be a JSON array of strings, for example ["docs","engineering"]. [] means no tags; an empty cell is invalid.')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Tags column (optional)' }) as HTMLSelectElement).disabled).toBe(false)
    await fireEvent.update(screen.getByRole('combobox', { name: 'URL column' }), '0')
    await fireEvent.update(screen.getByRole('combobox', { name: 'Tags column (optional)' }), '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy(); expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    expect(view.container.textContent).not.toContain('private-secret'); expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-cancel'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, 'Address,Category,Private\nhttps://example.com/tagged,' + csvCell(JSON.stringify(['docs', '工程'])) + ',private-secret')
    await fireEvent.update(screen.getByRole('combobox', { name: 'URL column' }), '0')
    await fireEvent.update(screen.getByRole('combobox', { name: 'Tags column (optional)' }), '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.textContent).toContain('工程'); expect(view.container.textContent).not.toContain('private-secret')
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create-with-metadata', input: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/tagged', title: '', tags: ['docs', '工程'] }] } }])
  })

  // Unescaped markup, missing control replacement or UTF-16 slicing must break these user-visible labels.
  it('numbers empty and duplicate headers and shows only bounded plain-text header labels', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, ',Same,Same,<img src=x onerror=secret>,Control\u0000,"' + '😀'.repeat(61) + '"\n,one,two,private,hidden,https://example.com')
    const options = [...(screen.getByRole('combobox', { name: 'URL column' }) as HTMLSelectElement).options].map(option => option.textContent)
    expect(options).toEqual(['Choose the URL column', 'Column 1: Unnamed header', 'Column 2: Same', 'Column 3: Same', 'Column 4: <img src=x onerror=secret>', 'Column 5: Control�', 'Column 6: ' + '😀'.repeat(60) + '…'])
    expect(view.container.querySelector('img')).toBeNull(); expect(view.container.querySelector('[title]')).toBeNull()
    expect(view.container.textContent).not.toContain('private'); expect(view.container.textContent).not.toContain('hidden'); expect(writes).toEqual([])
  })

  it('clears optional title and tags without importing either or bypassing the required URL choice', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'Address,Name\nhttps://example.com/cleared,Should not import')
    const url = screen.getByRole('combobox', { name: 'URL column' }), title = screen.getByRole('combobox', { name: 'Title column (optional)' }), tags = screen.getByRole('combobox', { name: 'Tags column (optional)' })
    await fireEvent.update(url, '0'); await fireEvent.update(title, '1'); await fireEvent.update(tags, '1'); await fireEvent.update(url, '')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy(); expect(writes).toEqual([])
    await fireEvent.update(url, '0'); await fireEvent.update(title, ''); await fireEvent.update(tags, '');
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/cleared')
    expect(screen.queryByTestId('bulk-create-imported-list')).toBeNull()
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create', input: { requestId: expect.any(String), targetUrls: ['https://example.com/cleared'] } }])
  })

  it('keeps the manual draft after empty file selection and safe structural rejection without a standard-header diagnosis', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(view.container.querySelector('textarea')!, 'https://example.com/manual')
    await fireEvent.change(screen.getByTestId('bulk-create-mapping-file'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, 'A,B\nhttps://secret.invalid')
    expect(screen.getByTestId('bulk-create-csv-issue').textContent).toBe('CSV record 2 has a different field count from the header.')
    expect(screen.getByTestId('bulk-create-error').textContent).not.toContain('secret')
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, 'A,B,C,D,E,F,G,H,I\n1,2,3,4,5,6,7,8,9')
    expect(screen.queryByTestId('bulk-create-csv-issue')).toBeNull()
    expect(screen.getByTestId('bulk-create-error').textContent).not.toContain('standard column')
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual'); expect(writes).toEqual([])
  })

  it.each(words)('preserves a draft on cancel, requires valid choices and sends selected URL, title and JSON tags in $locale', async text => {
    const { view, writes } = mount(text.locale); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(view.container.querySelector('textarea')!, 'https://example.com/manual')
    const csv = '<img src=x onerror=secret>,Address,Name,Categories\nprivate,https://example.com/chosen,Chosen title,' + csvCell(JSON.stringify(['工程', 'docs']))
    const input = await select(view.container, csv)
    expect(screen.queryByTestId('bulk-create-error')).toBeNull()
    expect(input.value).toBe(''); expect(screen.getByText(text.ignored)).toBeTruthy()
    expect(view.container.querySelector('img')).toBeNull()
    expect((screen.getByTestId('bulk-create-preview') as HTMLButtonElement).disabled).toBe(true)
    expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-cancel'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, csv)
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    const url = screen.getByRole('combobox', { name: text.url }), title = screen.getByRole('combobox', { name: text.title })
    const tags = screen.getByRole('combobox', { name: text.tags })
    await fireEvent.update(url, '1'); await fireEvent.update(title, '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    await fireEvent.update(title, '2'); await fireEvent.update(tags, '2'); await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy(); expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    await fireEvent.update(tags, '3'); await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.queryByTestId('bulk-create-csv-mapping')).toBeNull()
    expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('Chosen title')
    expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('工程')
    expect(view.container.textContent).not.toContain('private'); expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create-with-metadata', input: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/chosen', title: 'Chosen title', tags: ['工程', 'docs'] }] } }])
  })
})
