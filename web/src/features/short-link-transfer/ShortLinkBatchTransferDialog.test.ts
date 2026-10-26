import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import ShortLinkBatchTransferDialog from './ShortLinkBatchTransferDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const target = { id: '00000000-0000-0000-0000-000000000020', url: 'https://short.example/' + 'long'.repeat(100), owner: { id: 'old', username: 'original'.repeat(40), nickname: '' }, updatedAt: '2026-10-25T00:00:00.123456Z' }
const actor = { id: 'manager', username: 'manager', group: 'admin', permissions: ['admin:access', 'short_link:read_all', 'short_link:update_all'] }
const clients: QueryClient[] = []
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('batch ownership translations and refresh boundaries', () => {
  it.each([
    ['en', 1, 0, 'Transferred 1 link. 0 links unchanged.'],
    ['en', 0, 1, 'Transferred 0 links. 1 link unchanged.'],
    ['en', 2, 0, 'Transferred 2 links. 0 links unchanged.'],
    ['zh-CN', 1, 0, '已转移 1 条短链。 0 条短链归属未变。'],
    ['zh-CN', 0, 2, '已转移 0 条短链。 2 条短链归属未变。'],
  ] as const)('renders accurate counts in %s (%i moved, %i unchanged) and invalidates all ownership views', async (locale, transferredCount, unchangedCount, success) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    clients.push(client); client.setQueryData(['auth', 'me'], { user: actor })
    const keys = ['admin-short-link', 'short-link', 'short-link-overview', 'short-link-statistics', 'insights'].map(key => [key, 'previous-owner'])
    keys.forEach(key => client.setQueryData(key, { total: 5 }))
    const count = transferredCount + unchangedCount
    const targets = Array.from({ length: count }, (_, index) => ({ ...target, id: `00000000-0000-0000-0000-00000000002${index}` }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { transferredCount, unchangedCount }, meta: {} }))))
    const view = render(ShortLinkBatchTransferDialog, { props: { targets }, global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages })], stubs: componentStubs } })
    const recipient = locale === 'en' ? 'Exact recipient username' : '接收账号的准确用户名'
    const acknowledge = locale === 'en' ? 'I verified the recipient and approve transferring management and historical statistics' : '我已核对接收账号，并确认移交管理权及历史统计'
    const save = locale === 'en' ? 'Confirm transfer' : '确认转移'
    expect(screen.getByRole('dialog').textContent).toContain(target.owner.username)
    expect(screen.getByRole('dialog').textContent).toContain(target.url)
    await fireEvent.update(screen.getByLabelText(recipient), '中'.repeat(70))
    expect((screen.getByRole('button', { name: save }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByLabelText(acknowledge))
    await fireEvent.update(screen.getByLabelText(recipient), '')
    expect((screen.getByRole('button', { name: save }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText(recipient), '中'.repeat(70))
    await fireEvent.click(screen.getByRole('button', { name: save }))
    await waitFor(() => expect(view.emitted().transferred).toHaveLength(1))
    expect(view.emitted().close).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith(success)
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
