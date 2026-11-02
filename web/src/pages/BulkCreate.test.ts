import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { File as NodeFile } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import MyLinksPage from './MyLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000003881', username: 'bulk-ui', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:create', 'domain:use_default'] }
const clients: QueryClient[] = []
/** Preserves the real page, auth observer, entity decoder and external wire boundary. */
function mount(grants = actor.permissions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: grants } })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const input = String(url).endsWith('/batch-create') ? JSON.parse(init!.body as string) as { requestId: string; targetUrls: string[] } : null
    return new Response(JSON.stringify({ code: 0, message: '', data: input ? { requestId: input.requestId, createdCount: input.targetUrls.length } : { items: [] }, meta: { total: 0 } }))
  })
  vi.stubGlobal('fetch', fetcher)
  return { ...render(MyLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } }), client, fetcher }
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })

/** Opens and previews through the actual rendered controls. */
async function openPreview() {
  await fireEvent.click(await screen.findByTestId('bulk-create-open'))
  await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/one\nhttps://example.org/two')
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
}
/** Dispatches the native file-selection event after providing the browser-owned file list. */
async function chooseFile(file?: File | NodeFile) {
  const input = screen.getByLabelText('bulkCreate.csvLabel') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] })
  await fireEvent(input, new Event('change', { bubbles: true }))
  expect(input.value).toBe('')
}

describe('personal bounded creation', () => {
  // Missing/early file ingestion must not write or alter literal ordered targets.
  it('imports a local CSV into ordered preview without writing until confirmation', async () => {
    const view = mount()
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    await fireEvent.click(await screen.findByTestId('bulk-create-open'))
    const file = new NodeFile(['\uFEFFtarget_url\r\nhttps://example.com/one\r\n"https://example.org/search?q=a,b"\r\n'], 'targets.csv', { type: 'text/csv' })
    await chooseFile(file)
    await waitFor(() => expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/one\nhttps://example.org/search?q=a,b'))
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))).toHaveLength(0)
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    expect([...screen.getByTestId('bulk-create-preview-list').querySelectorAll('li')].map(item => item.textContent)).toEqual(['https://example.com/one', 'https://example.org/search?q=a,b'])
    expect(screen.queryByLabelText('bulkCreate.csvLabel')).toBeNull()
    await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const writes = view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]![1]!.body as string).targetUrls).toEqual(['https://example.com/one', 'https://example.org/search?q=a,b'])
  })
  it('shows reading, blocks premature preview and lets manual edits retire a pending file', async () => {
    const view = mount(); await fireEvent.click(await screen.findByTestId('bulk-create-open'))
    const pending = createDeferred<ArrayBuffer>(), file = new File([], 'targets.csv')
    Object.defineProperty(file, 'arrayBuffer', { value: () => pending.promise })
    await chooseFile(file)
    expect(screen.getByRole('status').textContent).toBe('bulkCreate.csvReading')
    expect((screen.getByTestId('bulk-create-preview') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/manual')
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByTestId('bulk-create-preview') as HTMLButtonElement).disabled).toBe(false)
    pending.reject(new Error('late private detail'))
    await waitFor(() => expect(screen.queryByTestId('bulk-create-error')).toBeNull())
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    expect(screen.getByTestId('bulk-create-preview-list').textContent).toBe('https://example.com/manual')
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))).toHaveLength(0)
  })
  it('keeps a draft after invalid columns, accepts a corrected same-name file and ignores picker cancellation', async () => {
    const view = mount(); await fireEvent.click(await screen.findByTestId('bulk-create-open'))
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/keep')
    await chooseFile(new NodeFile(['target_url,slug\nhttps://example.com/changed,old'], 'targets.csv'))
    await waitFor(() => expect(screen.getByTestId('bulk-create-error').textContent).toBe('bulkCreate.csvInvalid'))
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/keep')
    await chooseFile()
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/keep')
    await chooseFile(new NodeFile(['target_url\nhttps://example.com/corrected'], 'targets.csv'))
    await waitFor(() => expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/corrected'))
    expect(screen.queryByTestId('bulk-create-error')).toBeNull()
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))).toHaveLength(0)
  })
  it('opens from the real personal list and previews two trimmed targets without writing', async () => {
    const view = mount()
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    await fireEvent.click(await screen.findByTestId('bulk-create-open'))
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), ' https://example.com/one \r\n\t https://example.org/two\t\n\n')
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    const preview = screen.getByTestId('bulk-create-preview-list')
    expect(preview.textContent).toContain('https://example.com/one')
    expect(preview.textContent).toContain('https://example.org/two')
    expect(preview.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByRole('dialog').textContent).toContain('bulkCreate.policy')
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))).toHaveLength(0)
  })
  it('shows validation, renders literal markup safely and permits an explicit new preview', async () => {
    mount(); await fireEvent.click(await screen.findByTestId('bulk-create-open'))
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/x\nhttps://example.com/x')
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    expect(screen.getByTestId('bulk-create-error').textContent).toBe('bulkCreate.invalid')
    const literal = 'https://example.com/<script>alert(1)</script>'
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), literal)
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain(literal)
    expect(screen.getByTestId('bulk-create-preview-list').querySelector('script')).toBeNull()
    const firstKey = screen.getByTestId('bulk-create-request-id').textContent
    await fireEvent.click(screen.getByTestId('bulk-create-edit'))
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe(literal)
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    expect(screen.getByTestId('bulk-create-request-id').textContent).not.toBe(firstKey)
    await fireEvent.click(screen.getByTestId('bulk-create-close'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('keeps an unknown batch through the close warning and retries its exact wire body', async () => {
    const view = mount(); await openPreview()
    const original = view.fetcher.getMockImplementation()!
    let attempts = 0
    view.fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith('/batch-create') && attempts++ === 0) return Promise.resolve(new Response(JSON.stringify({ code: 900000, message: 'private detail', data: null }), { status: 500 }))
      return original(url, init)
    })
    const key = screen.getByTestId('bulk-create-request-id').textContent
    await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.getByTestId('bulk-create-error').textContent).toBe('bulkCreate.unknown'))
    expect((screen.getByTestId('bulk-create-edit') as HTMLButtonElement).disabled).toBe(true)
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))).toHaveLength(1)
    await fireEvent.click(screen.getByTestId('bulk-create-close'))
    expect(screen.getByTestId('bulk-create-close-warning').textContent).toContain('bulkCreate.discardWarning')
    expect((screen.getByTestId('bulk-create-submit') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByTestId('bulk-create-keep'))
    expect(screen.getByTestId('bulk-create-request-id').textContent).toBe(key)
    await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const writes = view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))
    expect(writes).toHaveLength(2); expect(writes[0]![1]!.body).toBe(writes[1]![1]!.body)
    expect(toast.success).toHaveBeenCalledWith('bulkCreate.success')
    await fireEvent.click(screen.getByTestId('bulk-create-open'))
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('')
  })
  it('requires explicit discard after a lost result and does not promise reload recovery', async () => {
    const view = mount(); await openPreview()
    view.fetcher.mockRejectedValueOnce(new Error('offline'))
    await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.getByTestId('bulk-create-error').textContent).toBe('bulkCreate.unknown'))
    expect(screen.getByRole('dialog').textContent).toContain('bulkCreate.recovery')
    await fireEvent.click(screen.getByTestId('bulk-create-close'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await fireEvent.click(screen.getByTestId('bulk-create-discard'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))).toHaveLength(1)
  })
  it.each(['short_link:create', 'domain:use_default'])('does not expose creation when %s is absent', async grant => {
    const view = mount(actor.permissions.filter(value => value !== grant))
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    expect(screen.queryByTestId('bulk-create-open')).toBeNull()
  })
})
