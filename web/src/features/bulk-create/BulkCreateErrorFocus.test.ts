import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { setImmediate } from 'node:timers/promises'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const flushPromises = () => setImmediate()
const actor = { id: '00000000-0000-0000-0000-000000007521', username: 'error-focus', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default'] }
const targetUrl = 'https://example.com/retained-focus-draft'
type Input = { requestId: string; targetUrls: string[] }

/** Exercises the actual dialog, parser and client, controlling only the external API response. */
function mount(reply: (input: Input, attempt: number) => Promise<Response>, locale: 'zh-CN' | 'en' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: actor })
  const requests: Input[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/auth/me')) return response(0, { user: actor })
    if (String(url) !== '/api/v1/short-link/batch-create') throw new Error('Unexpected API protocol')
    const input = JSON.parse(init!.body as string) as Input
    requests.push(input); return reply(input, requests.length)
  })
  const outside = document.createElement('button'); outside.textContent = 'Outside dialog'; document.body.append(outside)
  const view = render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })], stubs: componentStubs } })
  return { ...view, client, requests, outside }
}
function response(code: number, data: unknown = null) { return new Response(JSON.stringify({ code, data, message: 'Private upstream detail', meta: {} })) }
async function preview() {
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  await fireEvent.update(screen.getByRole('textbox'), targetUrl)
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  return screen.getByTestId('bulk-create-request-id').textContent
}
async function focusedError(text: RegExp) {
  await waitFor(() => {
    const error = screen.getByTestId('bulk-create-error')
    expect(error.textContent).toMatch(text)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.contains(error)).toBe(true)
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
  })
}
afterEach(() => { cleanup(); document.body.replaceChildren(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

// Removing error positioning must fail the activeElement assertion while the actual refusal still renders.
it.each(['zh-CN', 'en'] as const)('focuses a current %s definite refusal without changing its frozen batch', async locale => {
  const view = mount(async () => response(200121), locale), id = await preview()
  await fireEvent.click(screen.getByTestId('bulk-create-submit'))
  await focusedError(locale === 'en' ? /restricts a target host/ : /目标主机被站点规则限制/)
  expect(view.requests).toEqual([{ requestId: id, targetUrls: [targetUrl] }])
  expect(screen.getByTestId('bulk-create-request-id').textContent).toBe(id)
  expect((screen.getByTestId('bulk-create-edit') as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByTestId('bulk-create-error').textContent).not.toContain('Private upstream detail')
  await fireEvent.click(screen.getByTestId('bulk-create-edit'))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(targetUrl)
  view.outside.focus(); await nextTick()
  expect(document.activeElement).toBe(view.outside)
  expect(view.requests).toHaveLength(1)
})

it('focuses a parse failure without a preview or network write and preserves its input', async () => {
  const view = mount(async () => { throw new Error('Must not write invalid input') })
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  await fireEvent.update(screen.getByRole('textbox'), 'not a printable HTTP URL')
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  await focusedError(/HTTP/)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('not a printable HTTP URL')
  expect(screen.queryByTestId('bulk-create-request-id')).toBeNull()
  expect(view.requests).toEqual([])
})

it('refocuses a repeated unknown result while preserving the original request and locked editing', async () => {
  const view = mount(async (_input, attempt) => { if (attempt === 1) throw new Error('Lost acknowledgement'); return response(200121) })
  const id = await preview()
  for (const count of [1, 2]) {
    await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await focusedError(/result is unknown/)
    await waitFor(() => expect((screen.getByTestId('bulk-create-submit') as HTMLButtonElement).disabled).toBe(false))
    expect(view.requests).toHaveLength(count)
    expect(screen.getByTestId('bulk-create-request-id').textContent).toBe(id)
    expect((screen.getByTestId('bulk-create-edit') as HTMLButtonElement).disabled).toBe(true)
    view.outside.focus()
  }
  expect(view.requests[1]).toEqual(view.requests[0])
  expect(screen.getByTestId('bulk-create-error').textContent).not.toContain('No links were created')
})

it('does not focus an invalid preview that is closed in the same render turn', async () => {
  const view = mount(async () => response(200121))
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  await fireEvent.update(screen.getByRole('textbox'), 'invalid')
  screen.getByTestId('bulk-create-preview').click()
  screen.getByTestId('bulk-create-close').click()
  view.outside.focus(); await nextTick(); await flushPromises()
  expect(screen.queryByTestId('bulk-create-error')).toBeNull()
  expect(document.activeElement).toBe(view.outside)
  expect(view.requests).toEqual([])
})

it('keeps a newer identity draft focused after an old request is refused', async () => {
  let settle!: (value: Response) => void
  const view = mount(() => new Promise<Response>(resolve => { settle = resolve }))
  await preview(); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
  await waitFor(() => expect(view.requests).toHaveLength(1))
  view.client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000007522', username: 'next-identity' } })
  await nextTick()
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  const current = screen.getByRole('textbox')
  await fireEvent.update(current, 'https://example.com/new-account'); current.focus()
  settle(response(200121)); await flushPromises(); await nextTick()
  expect(screen.queryByTestId('bulk-create-error')).toBeNull()
  expect(document.activeElement).toBe(current)
  expect((current as HTMLTextAreaElement).value).toBe('https://example.com/new-account')
  expect(view.requests).toHaveLength(1)
})

it('does not move focus after unmount while a previous request finishes', async () => {
  let settle!: (value: Response) => void
  const view = mount(() => new Promise<Response>(resolve => { settle = resolve }))
  await preview(); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
  await waitFor(() => expect(view.requests).toHaveLength(1))
  view.unmount(); view.outside.focus()
  settle(response(200121)); await flushPromises(); await nextTick()
  expect(document.activeElement).toBe(view.outside)
  expect(screen.queryByTestId('bulk-create-error')).toBeNull()
})
