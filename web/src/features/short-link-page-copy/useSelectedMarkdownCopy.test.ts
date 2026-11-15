import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import type { ShortLink } from '@/entities/short-link/model'
import { usePageLinksCopy } from './usePageLinksCopy'
import ShortLinkPageCopyButton from './ShortLinkPageCopyButton.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const ownKey = ['short-link', 'markdown-reader', 1] as const
const reader = { id: 'markdown-reader', username: 'reader', nickname: '', group: 'user', permissions: ['short_link:read_own'] }
/** Complete records keep private destinations different from the public link being copied. */
function row(id: string, title = '', url = `https://sho.rt/${id}`): ShortLink {
  return { id, slug: id, title, url, targetUrl: `https://private.test/${id}`, tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5,
    expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
    createdAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z' }
}
/** Real access, cache, component and lifecycle; only clipboard and toast cross an external boundary. */
function mount(options: { items?: ShortLink[]; selection?: string[]; noSelection?: boolean; plain?: boolean; locale?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: reader })
  const items = options.items ?? [row('1', 'Read [docs] & <help> `now`'), row('2')]
  client.setQueryData(ownKey, { items })
  const key = ref<readonly unknown[]>(ownKey), blocked = ref(false), context = ref('page1')
  const selection = ref(options.selection ?? items.map(link => link.id)), lock = ref<symbol | null>(null)
  let clipboard = ''
  const writeText = vi.fn(async (text: string) => { clipboard = text })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  let state!: ReturnType<typeof usePageLinksCopy>, selected!: ReturnType<typeof usePageLinksCopy>, page!: ReturnType<typeof usePageLinksCopy>
  const host = defineComponent({ setup() {
    const access = useShortLinkAccess('own'), common = { access, queryKey: key, blocked, context, lock }
    const input = { ...common, ...(!options.noSelection ? { selection } : {}), ...(!options.plain ? { format: 'markdown' as const } : {}) }
    state = usePageLinksCopy(input)
    selected = usePageLinksCopy({ ...common, selection })
    page = usePageLinksCopy(common)
    return () => h(ShortLinkPageCopyButton, { state, mode: 'selected-markdown' })
  } })
  const view = render(host, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: options.locale ?? 'en', messages })], stubs: componentStubs } })
  return { ...view, client, key, blocked, context, items, selection, state, selected, page, lock, writeText, readClipboard: () => clipboard }
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); Reflect.deleteProperty(navigator, 'clipboard') })

describe('selected Markdown copy', () => {
  // Plain URLs, target URLs, selection order, missing escaping or a trailing LF all break this payload.
  it('writes the exact escaped list synchronously, in page order, without reading another query', async () => {
    const view = mount({ selection: ['2', '1'] })
    screen.getByRole('button').click()
    expect(view.readClipboard()).toBe('- [Read \\[docs\\] &amp; \\<help\\> \\`now\\`](<https://sho.rt/1>)\n- [https://sho\\.rt/2](<https://sho.rt/2>)')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied 2 Markdown links'))
    expect(view.client.getQueryCache().getAll()).toHaveLength(2)
  })
  it.each([
    ['\\', '\\\\'], ['`', '\\`'], ['*', '\\*'], ['_', '\\_'], ['{', '\\{'], ['}', '\\}'], ['[', '\\['], [']', '\\]'],
    ['(', '\\('], [')', '\\)'], ['#', '\\#'], ['+', '\\+'], ['-', '\\-'], ['.', '\\.'], ['!', '\\!'], ['|', '\\|'],
    ['<', '\\<'], ['>', '\\>'], ['~', '\\~'], ['&amp;', '&amp;amp;'], ['标题 😀', '标题 😀'],
  ])('keeps label %j literal as %j', async (title, label) => {
    const view = mount({ items: [row('1', title)] })
    await view.state.copy()
    expect(view.readClipboard()).toBe(`- [${label}](<https://sho.rt/1>)`)
  })
  it('encodes destination delimiters without changing existing percent encoding or query characters', async () => {
    const view = mount({ items: [row('1', 'link', 'https://sho.rt/a\\b<c>d e?x=%20&y=(q)')] })
    await view.state.copy()
    expect(view.readClipboard()).toBe('- [link](<https://sho.rt/a%5Cb%3Cc%3Ed%20e?x=%20&y=(q)>)')
  })
  it.each([1, 100])('copies all %i selected rows without a trailing newline', async count => {
    const view = mount({ items: Array.from({ length: count }, (_, i) => row(String(i + 1), `Link ${i + 1}`)) })
    await view.state.copy()
    const lines = view.readClipboard().split('\n')
    expect(lines).toHaveLength(count)
    expect(lines[0]).toBe('- [Link 1](<https://sho.rt/1>)')
    expect(lines.at(-1)).toBe(`- [Link ${count}](<https://sho.rt/${count}>)`)
    expect(view.readClipboard().endsWith('\n')).toBe(false)
  })
  // Removing the explicit-selection or complete-set guard must not silently turn this into a page copy.
  it.each(['no-selection', 'empty', 'duplicate', 'unknown', 'empty-id', 'too-many', 'duplicate-page', 'empty-page', 'large-page'] as const)('rejects the whole %s selection', async invalid => {
    const view = mount({ noSelection: invalid === 'no-selection' })
    if (invalid === 'empty') view.selection.value = []
    if (invalid === 'duplicate') view.selection.value = ['1', '1']
    if (invalid === 'unknown') view.selection.value = ['1', 'unknown']
    if (invalid === 'empty-id') view.selection.value = ['']
    if (invalid === 'too-many') view.selection.value = Array.from({ length: 101 }, (_, i) => String(i))
    if (invalid === 'duplicate-page') view.client.setQueryData(ownKey, { items: [row('1'), row('1')] })
    if (invalid === 'empty-page') view.client.setQueryData(ownKey, { items: [] })
    if (invalid === 'large-page') view.client.setQueryData(ownKey, { items: Array.from({ length: 101 }, (_, i) => row(String(i))) })
    await view.state.copy()
    expect(view.state.disabled.value).toBe(true)
    expect(view.readClipboard()).toBe('')
  })
  it.each(['line\nbreak', 'tab\t', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029', null, 7])('refuses the complete list with invalid title %j', async title => {
    const view = mount({ items: [row('1'), { ...row('2'), title: title as string }] })
    await view.state.copy()
    expect(view.readClipboard()).toBe('')
    expect(view.state.disabled.value).toBe(true)
  })
  it('leaves the original plain format independent of an unused invalid title', async () => {
    const view = mount({ plain: true, items: [{ ...row('1'), title: null as unknown as string }] })
    await view.state.copy()
    expect(view.readClipboard()).toBe('https://sho.rt/1')
  })
  it.each(['blocked', 'missing', 'invalidated', 'fetching', 'error', 'removed', 'permission', 'invalid-url', 'invalid-scheme'] as const)('rechecks live %s before copying', async stage => {
    const view = mount()
    if (stage === 'blocked') view.blocked.value = true
    if (stage === 'missing') view.key.value = ['short-link', 'unread']
    if (stage === 'invalidated') void view.client.invalidateQueries({ queryKey: ownKey })
    if (stage === 'fetching') view.client.getQueryCache().find({ queryKey: ownKey })!.setState({ fetchStatus: 'fetching' })
    if (stage === 'error') view.client.getQueryCache().find({ queryKey: ownKey })!.setState({ status: 'error', error: new Error('private') })
    if (stage === 'removed') view.client.removeQueries({ queryKey: ownKey })
    if (stage === 'permission') view.client.setQueryData(['auth', 'me'], { user: { ...reader, permissions: [] } })
    if (stage === 'invalid-url') view.client.setQueryData(ownKey, { items: [row('1', '', 'https://sho.rt/a\nb'), row('2')] })
    if (stage === 'invalid-scheme') view.client.setQueryData(ownKey, { items: [row('1', '', 'ftp://sho.rt/a'), row('2')] })
    await view.state.copy()
    expect(view.readClipboard()).toBe('')
  })
  it('shares ownership with both existing copy modes and releases it after success', async () => {
    const view = mount(), delayed = createDeferred<void>()
    view.writeText.mockImplementationOnce(() => delayed.promise)
    const pending = view.state.copy()
    expect(view.state.pending.value).toBe(true)
    expect(view.selected.disabled.value).toBe(true)
    expect(view.page.disabled.value).toBe(true)
    delayed.resolve(); await pending
    expect(view.selected.disabled.value).toBe(false)
    expect(view.page.disabled.value).toBe(false)
    await view.selected.copy()
    expect(view.readClipboard()).toBe('https://sho.rt/1\nhttps://sho.rt/2')
  })
  it('does not let an old finally release a newer copy owner after selection A→B→A', async () => {
    const view = mount(), old = createDeferred<void>(), newer = createDeferred<void>()
    view.writeText.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => newer.promise)
    const first = view.state.copy()
    view.selection.value = ['2']; view.selection.value = ['1', '2']
    const second = view.page.copy(), owner = view.lock.value
    old.resolve(); await first
    expect(view.lock.value).toBe(owner)
    expect(view.page.pending.value).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    newer.resolve(); await second
    expect(view.lock.value).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Copied 2 links from this page')
  })
  it.each(['selection', 'permission', 'context', 'key', 'cache', 'unmount'] as const)('suppresses late rejection after %s changes and allows a fresh operation', async change => {
    const view = mount(), delayed = createDeferred<void>()
    view.writeText.mockImplementationOnce(() => delayed.promise)
    const pending = view.state.copy()
    if (change === 'selection') { view.selection.value = ['2']; view.selection.value = ['1', '2'] }
    if (change === 'permission') { view.client.setQueryData(['auth', 'me'], { user: { ...reader, permissions: [] } }); view.client.setQueryData(['auth', 'me'], { user: reader }) }
    if (change === 'context') { view.context.value = 'page2'; view.context.value = 'page1' }
    if (change === 'key') { view.key.value = ['short-link', 'other']; view.key.value = ownKey }
    if (change === 'cache') view.client.setQueryData(ownKey, { items: [...view.items, row('3')] })
    if (change === 'unmount') view.unmount()
    delayed.reject(new Error('secret destination')); await pending
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(view.lock.value).toBeNull()
    if (change !== 'unmount') { await view.state.copy(); expect(view.readClipboard()).toContain('- ['); expect(view.state.pending.value).toBe(false) }
  })
  it.each(['unsupported', 'sync-throw', 'reject'] as const)('reports safe %s failure and retries only on a new explicit action', async failure => {
    const view = mount({ locale: 'zh-CN' })
    if (failure === 'unsupported') Reflect.deleteProperty(navigator, 'clipboard')
    if (failure === 'sync-throw') view.writeText.mockImplementationOnce(() => { throw new Error('private') })
    if (failure === 'reject') view.writeText.mockRejectedValueOnce(new Error('private'))
    await view.state.copy()
    expect(view.state.pending.value).toBe(false)
    expect(view.lock.value).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('复制失败，请检查浏览器剪贴板权限后重试。')
    expect(view.readClipboard()).toBe('')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: view.writeText } })
    await nextTick(); await view.state.copy()
    expect(view.readClipboard()).toContain('- [')
  })
})
