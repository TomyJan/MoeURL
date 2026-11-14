import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { setImmediate } from 'node:timers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import TargetPolicyBatchCheck from './TargetPolicyBatchCheck.vue'
import { useTargetPolicyBatchCheck } from './useTargetPolicyBatchCheck'

const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: 'private upstream detail', data, meta: {} }))
const decision = (outcome = 'allowed') => ({ items: [{ index: 1, outcome }] })
const checks = vi.fn<(body: unknown) => Promise<Response>>()
const authReads = vi.fn<() => Promise<Response>>()
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
let client: QueryClient
function auth(id = 'admin-a', permissions = ['admin:access', 'system:manage']) {
  client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', group: id ? 'admin' : 'guest', permissions } })
}
function mount(locale: 'keys' | 'en' | 'zh-CN' = 'keys') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, missingWarn: false, fallbackWarn: false, messages: locale === 'keys' ? {} : messages })
  return render(TargetPolicyBatchCheck, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
}
function controllerView() {
  let controller!: ReturnType<typeof useTargetPolicyBatchCheck>
  const view = render(defineComponent({ setup() { controller = useTargetPolicyBatchCheck(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, controller }
}
const input = () => screen.getByRole('textbox', { name: 'targetPolicyBatchCheck.targets' }) as HTMLTextAreaElement
const form = () => screen.getByRole('form', { name: 'targetPolicyBatchCheck.form' })

describe('private batch saved-target-policy check', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
    checks.mockReset().mockImplementation(async () => response(decision()))
    authReads.mockReset().mockImplementation(async () => response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } }))
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      if (path === '/api/v1/admin/system/target-policy/check-batch' && init.method === 'POST') return checks(JSON.parse(String(init.body)))
      if (path === '/api/v1/auth/me' && init.method === 'GET') return authReads()
      throw new Error('Unexpected request: ' + path)
    })
    auth()
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

  it.each(['allowed', 'invalid_target', 'restricted'])('shows only an explicit %s decision and retires the whole result on editing', async outcome => {
    checks.mockResolvedValueOnce(response(decision(outcome)))
    mount(); await flush()
    expect(checks).not.toHaveBeenCalled()
    expect(screen.getByText('targetPolicyBatchCheck.hint')).toBeTruthy()
    expect(screen.getByText('targetPolicyBatchCheck.scope')).toBeTruthy()
    await fireEvent.update(input(), 'https://private.example/?secret=fixture')
    expect(checks).not.toHaveBeenCalled()
    await fireEvent.submit(form()); await flush()
    const results = screen.getByRole('list', { name: 'targetPolicyBatchCheck.results' })
    expect(screen.getByText('targetPolicyBatchCheck.' + outcome)).toBeTruthy()
    expect(results.textContent).not.toContain('private.example')
    expect(checks).toHaveBeenCalledExactlyOnceWith({ targetUrls: ['https://private.example/?secret=fixture'] })
    expect(client.getQueriesData({}).some(([, data]) => JSON.stringify(data).includes('private.example'))).toBe(false)
    await fireEvent.update(input(), 'https://next.example/')
    expect(screen.queryByRole('list', { name: 'targetPolicyBatchCheck.results' })).toBeNull()
  })
  it.each(['', '\n', '\nhttps://example.com/', 'https://example.com/\n', 'https://example.com/\n\nhttps://other.example/', 'a'.repeat(2049), '界'.repeat(683), 'https://example.com/\u0085', 'https://example.com/\ud800', 'https://example.com/\rhttps://other.example/', Array.from({ length: 21 }, () => 'https://example.com/').join('\n')])('rejects empty rows, controls, bytes or too many lines without sending any part', async text => {
    const { controller } = controllerView(); controller.edit(text); await controller.check()
    expect(controller.state.feedback).toBe('invalid'); expect(controller.state.items).toEqual([]); expect(checks).not.toHaveBeenCalled()
  })
  it.each(['\n', '\r\n'])('splits twenty original rows on %j without trimming or removing duplicates', async separator => {
    const targets = Array.from({ length: 20 }, () => ' https://example.com/ ')
    checks.mockResolvedValueOnce(response({ items: Array.from({ length: 20 }, (_, i) => ({ index: i + 1, outcome: 'restricted' })) }))
    const { controller } = controllerView(); controller.edit(targets.join(separator)); await controller.check()
    expect(checks).toHaveBeenCalledExactlyOnceWith({ targetUrls: targets })
    expect(controller.state.items).toHaveLength(20); expect(controller.state.feedback).toBe('')
  })
  it('does not duplicate an in-flight request and requires an explicit retry after failure while retaining its draft', async () => {
    const pending = createDeferred<Response>(); checks.mockReturnValueOnce(pending.promise)
    const { controller } = controllerView(); controller.edit('https://example.com/')
    const running = controller.check(); await controller.check()
    expect(checks).toHaveBeenCalledTimes(1); expect(controller.state.loading).toBe(true)
    pending.reject(new Error('private transport')); await running
    expect(controller.state.targets).toBe('https://example.com/'); expect(controller.state.feedback).toBe('failed'); expect(controller.state.loading).toBe(false)
    await flush(); expect(checks).toHaveBeenCalledTimes(1)
    await controller.check(); expect(controller.state.items).toEqual([{ index: 1, outcome: 'allowed' }]); expect(controller.state.feedback).toBe('')
  })
  it.each(['resolve', 'reject', 'deny'] as const)('retires an old %s and finally while a newer edit remains loading', async result => {
    const old = createDeferred<Response>(), fresh = createDeferred<Response>()
    checks.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const { controller } = controllerView(); controller.edit('https://old.example/')
    const first = controller.check(); controller.edit('https://new.example/')
    expect(controller.state.loading).toBe(false)
    const second = controller.check()
    if (result === 'reject') old.reject(new Error('stale private error'))
    else old.resolve(response(result === 'deny' ? null : decision(), result === 'deny' ? 120001 : 0))
    await first
    expect(controller.state.targets).toBe('https://new.example/'); expect(controller.state.loading).toBe(true)
    expect(controller.state.items).toEqual([]); expect(controller.state.feedback).toBe(''); expect(authReads).not.toHaveBeenCalled()
    fresh.resolve(response(decision('restricted'))); await second
    expect(controller.state.items).toEqual([{ index: 1, outcome: 'restricted' }]); expect(controller.state.loading).toBe(false)
  })
  it.each((['switch', 'relogin', 'revoke', 'revoke-admin', 'remove', 'unmount'] as const).flatMap(change => (['resolve', 'reject', 'deny'] as const).map(result => ({ change, result }))))('clears all private state and ignores a late $result on $change', async ({ change, result }) => {
    const pending = createDeferred<Response>(); checks.mockReturnValueOnce(pending.promise)
    const { controller, unmount } = controllerView(); controller.edit('https://private.example/')
    const running = controller.check()
    if (change === 'switch') auth('admin-b')
    else if (change === 'relogin') { auth(''); auth() }
    else if (change === 'revoke') auth('admin-a', ['admin:access'])
    else if (change === 'revoke-admin') auth('admin-a', ['system:manage'])
    else if (change === 'remove') client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    else unmount()
    expect(controller.state.targets).toBe(''); expect(controller.state.items).toEqual([]); expect(controller.state.loading).toBe(false)
    if (result === 'reject') pending.reject(new Error('retired transport'))
    else pending.resolve(response(result === 'deny' ? null : decision(), result === 'deny' ? 120001 : 0))
    await running
    expect(controller.state.items).toEqual([]); expect(controller.state.feedback).toBe(''); expect(authReads).not.toHaveBeenCalled()
    if (change === 'revoke' || change === 'revoke-admin' || change === 'remove' || change === 'unmount') {
      controller.edit('private'); await controller.check(); expect(controller.state.targets).toBe(''); expect(checks).toHaveBeenCalledTimes(1)
    }
  })
  it.each(['resolve', 'reject', 'deny'] as const)('ignores the old %s after returning to the same input and completing a newer request', async result => {
    const old = createDeferred<Response>(); checks.mockReturnValueOnce(old.promise)
    const { controller } = controllerView(); controller.edit('https://example.com/')
    const running = controller.check(); controller.edit('https://different.example/'); controller.edit('https://example.com/')
    await controller.check(); expect(controller.state.items).toEqual([{ index: 1, outcome: 'allowed' }])
    if (result === 'reject') old.reject(new Error('old'))
    else old.resolve(response(result === 'deny' ? null : decision('restricted'), result === 'deny' ? 120001 : 0))
    await running
    expect(controller.state.items).toEqual([{ index: 1, outcome: 'allowed' }]); expect(controller.state.feedback).toBe(''); expect(controller.state.loading).toBe(false)
    expect(authReads).not.toHaveBeenCalled()
  })
  it('preserves an in-flight draft across equivalent auth refreshes and unrelated query or grant changes', async () => {
    const pending = createDeferred<Response>(); checks.mockReturnValueOnce(pending.promise)
    const { controller } = controllerView(); controller.edit('https://example.com/'); const running = controller.check()
    client.setQueryData(['unrelated'], { value: true })
    auth('admin-a', ['system:manage', 'short_link:read_all', 'admin:access'])
    expect(controller.state.loading).toBe(true); expect(controller.state.targets).toBe('https://example.com/')
    pending.resolve(response(decision())); await running
    expect(controller.state.items).toEqual([{ index: 1, outcome: 'allowed' }])
  })
  it.each([120001, 401, 403])('refreshes current authorization after denial %s without showing any decision', async code => {
    const pending = createDeferred<Response>(); authReads.mockReturnValueOnce(pending.promise)
    checks.mockResolvedValueOnce(code === 120001 ? response(null, code) : new Response('', { status: code }))
    const { controller } = controllerView(); controller.edit('https://example.com/'); await controller.check()
    expect(controller.state.allowed).toBe(false); expect(controller.state.targets).toBe(''); expect(controller.state.items).toEqual([])
    expect(authReads).toHaveBeenCalledTimes(1)
    pending.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } })); await flush()
    expect(controller.state.allowed).toBe(false)
  })
  it.each(['input', 'malformed', 'infrastructure'] as const)('keeps the draft after a current %s failure and suppresses private upstream text', async failure => {
    checks.mockResolvedValueOnce(response(failure === 'malformed' ? { ...decision(), url: 'private' } : null, failure === 'input' ? 900227 : failure === 'infrastructure' ? 900000 : 0))
    mount(); await fireEvent.update(input(), 'https://example.com/'); await fireEvent.submit(form()); await flush()
    expect(input().value).toBe('https://example.com/')
    expect(screen.getByText('targetPolicyBatchCheck.' + (failure === 'input' ? 'invalid' : 'failed'))).toBeTruthy()
    expect(document.body.textContent).not.toContain('private upstream')
    expect(screen.queryByRole('list', { name: 'targetPolicyBatchCheck.results' })).toBeNull(); expect(checks).toHaveBeenCalledTimes(1)
  })
  it('stays closed before authorized login and sends nothing automatically when access returns', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true }); mount(); await flush()
    expect(screen.queryByRole('form')).toBeNull(); auth(); await nextTick()
    expect(form()).toBeTruthy(); expect(input().value).toBe(''); expect(checks).not.toHaveBeenCalled()
  })
  it.each(['en', 'zh-CN'] as const)('renders translated scope, line numbers and all three decisions in %s', async locale => {
    const view = mount(locale), text = messages[locale].targetPolicyBatchCheck
    expect(screen.getByRole('heading', { name: text.heading })).toBeTruthy()
    expect(screen.getByText(text.hint)).toBeTruthy(); expect(screen.getByText(text.scope)).toBeTruthy()
    const field = screen.getByRole('textbox', { name: text.targets })
    for (const outcome of ['allowed', 'invalid_target', 'restricted'] as const) {
      checks.mockResolvedValueOnce(response(decision(outcome))); await fireEvent.update(field, 'https://example.com/' + outcome)
      await fireEvent.submit(screen.getByRole('form', { name: text.form })); await flush()
      expect(screen.getByText(text.row.replace('{index}', '1'))).toBeTruthy()
      expect(screen.getByText(text[outcome])).toBeTruthy()
    }
    view.unmount()
  })
})
