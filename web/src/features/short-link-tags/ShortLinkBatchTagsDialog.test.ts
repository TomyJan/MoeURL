import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { toast } from 'vue-sonner'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import ShortLinkBatchTagsDialog from './ShortLinkBatchTagsDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const target = { id: '00000000-0000-0000-0000-000000000020', url: 'https://go.example/' + 'long'.repeat(100), tags: ['Original'], updatedAt: '2026-10-26T00:00:00.123456Z' }
const actor = { id: 'manager', username: 'manager', group: 'admin', permissions: ['admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:set_metadata'] }
const clients: QueryClient[] = []
/** Supplies actual translations, HTTP validation and account guards. */
function mount(locale = 'en', count = 1, changedCount = 1, unchangedCount = 0) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: actor })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount, unchangedCount }, meta: {} }))))
  const targets = Array.from({ length: count }, (_, index) => ({ ...target, id: `00000000-0000-0000-0000-00000000002${index}` }))
  return { ...render(ShortLinkBatchTagsDialog, { props: { targets, context: 'admin' }, global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages })], stubs: componentStubs } }), client }
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('batch tags dialog', () => {
  it.each([
    ['en', 1, 0, 'Updated tags on 1 link. 0 links unchanged.', 'Organize tags for 1 link'],
    ['en', 0, 1, 'Updated tags on 0 links. 1 link unchanged.', 'Organize tags for 1 link'],
    ['en', 2, 0, 'Updated tags on 2 links. 0 links unchanged.', 'Organize tags for 2 links'],
    ['zh-CN', 1, 0, '已更新 1 条短链的标签。 0 条短链标签未变。', '整理 1 条短链的标签'],
    ['zh-CN', 0, 2, '已更新 0 条短链的标签。 2 条短链标签未变。', '整理 2 条短链的标签'],
  ] as const)('renders accurate %s counts (%i/%i)', async (locale, changed, unchanged, message, title) => {
    const view = mount(locale, changed + unchanged, changed, unchanged)
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain(target.url)
    expect(screen.getByRole('dialog').textContent).toContain('Original')
    await fireEvent.update(screen.getByLabelText(locale === 'en' ? 'Tags, one per line' : '标签，每行一个'), ' 项目 A ')
    expect((screen.getByTestId('batch-tags-save') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByLabelText(locale === 'en' ? 'I confirm this tag operation for every selected link' : '我确认对全部所选短链执行此标签操作'))
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(view.emitted().saved).toHaveLength(1))
    expect(view.emitted().close).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith(message)
  })
  it('requires nonempty add/remove, validates shared metadata, permits only acknowledged empty replacement', async () => {
    const view = mount()
    await fireEvent.click(screen.getByLabelText('I confirm this tag operation for every selected link'))
    for (const invalid of ['', 'A\n A ', 'x'.repeat(33), 'a\u0000b', '\ud800', Array.from({ length: 11 }, (_, i) => `tag${i}`).join('\n'), 'A\n\nB']) {
      await fireEvent.update(screen.getByLabelText('Tags, one per line'), invalid)
      expect((screen.getByTestId('batch-tags-save') as HTMLButtonElement).disabled).toBe(true)
    }
    await fireEvent.update(screen.getByLabelText('Operation'), 'remove')
    await fireEvent.update(screen.getByLabelText('Tags, one per line'), '')
    expect((screen.getByTestId('batch-tags-save') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('Operation'), 'replace')
    expect(screen.getByRole('alert', { }).textContent).toContain('This removes every existing tag from the selected links.')
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(view.emitted().saved).toHaveLength(1))
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({ items: [{ id: target.id, expectedUpdatedAt: target.updatedAt }], operation: 'replace', tags: [] })
  })
  it('guards dismissal while pending including dialog model events and ignores a queued save after dismissal', async () => {
    const view = mount()
    const pending = createDeferred<Response>(); vi.mocked(fetch).mockReturnValue(pending.promise)
    await fireEvent.update(screen.getByLabelText('Tags, one per line'), 'A')
    await fireEvent.click(screen.getByLabelText('I confirm this tag operation for every selected link'))
    await fireEvent.click(screen.getByTestId('batch-tags-save')); await waitFor(() => expect(view.client.isMutating()).toBe(1))
    await fireEvent.click(screen.getByTestId('batch-tags-cancel'))
    expect(view.emitted().close).toBeUndefined()
    expect((screen.getByLabelText('Operation') as HTMLSelectElement).disabled).toBe(true)
    pending.resolve(new Response(JSON.stringify({ code: 900000, message: 'failure', data: null, meta: {} })))
    await waitFor(() => expect(view.client.isMutating()).toBe(0)); await nextTick()
    await fireEvent.click(screen.getByTestId('batch-tags-cancel'))
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    expect(view.emitted().close).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
