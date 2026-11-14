import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { setImmediate } from 'node:timers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import TargetPolicyCheck from './TargetPolicyCheck.vue'
import { useTargetPolicyCheck } from './useTargetPolicyCheck'

const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: 'private upstream detail', data, meta: {} }))
const checks = vi.fn<(body: unknown) => Promise<Response>>()
const authReads = vi.fn<() => Promise<Response>>()
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
let client: QueryClient
function auth(id = 'admin-a', permissions = ['admin:access', 'system:manage']) {
  client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', group: id ? 'admin' : 'guest', permissions } })
}
function mount(locale: 'keys' | 'en' | 'zh-CN' = 'keys') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, missingWarn: false, fallbackWarn: false, messages: locale === 'keys' ? {} : messages })
  return render(TargetPolicyCheck, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
}
function controllerView() {
  let controller!: ReturnType<typeof useTargetPolicyCheck>
  const view = render(defineComponent({ setup() { controller = useTargetPolicyCheck(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, controller }
}
const input = () => screen.getByRole('textbox', { name: 'targetPolicyCheck.target' }) as HTMLTextAreaElement
const form = () => screen.getByRole('form', { name: 'targetPolicyCheck.form' })

describe('private saved-target-policy check', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
    checks.mockReset().mockImplementation(async () => response({ outcome: 'allowed' }))
    authReads.mockReset().mockImplementation(async () => response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } }))
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      if (path === '/api/v1/admin/system/target-policy/check' && init.method === 'POST') return checks(JSON.parse(String(init.body)))
      if (path === '/api/v1/auth/me' && init.method === 'GET') return authReads()
      throw new Error('Unexpected request: ' + path)
    })
    auth()
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

  it.each(['allowed', 'invalid_target', 'restricted'])('shows only the explicit %s decision and invalidates it on editing', async outcome => {
    checks.mockResolvedValueOnce(response({ outcome }))
    mount(); await flush()
    expect(checks).not.toHaveBeenCalled()
    expect(screen.getByText('targetPolicyCheck.hint')).toBeTruthy()
    expect(screen.getByText('targetPolicyCheck.scope')).toBeTruthy()
    await fireEvent.update(input(), 'https://private.example/?secret=fixture')
    expect(checks).not.toHaveBeenCalled()
    await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetPolicyCheck.' + outcome)).toBeTruthy()
    expect(checks).toHaveBeenCalledExactlyOnceWith({ targetUrl: 'https://private.example/?secret=fixture' })
    expect(client.getQueriesData({}).some(([, data]) => JSON.stringify(data).includes('private.example'))).toBe(false)
    await fireEvent.update(input(), 'https://next.example/')
    expect(screen.queryByText('targetPolicyCheck.' + outcome)).toBeNull()
  })
  it.each(['', 'a'.repeat(2049), '界'.repeat(683), 'https://example.com/\u0085'])('rejects invalid bytes and controls without sending a check', async target => {
    const { controller } = controllerView(); controller.edit(target); await controller.check()
    expect(controller.state.feedback).toBe('invalid'); expect(checks).not.toHaveBeenCalled()
  })
  it('does not duplicate an in-flight request, but accepts an explicit retry after failure without losing the draft', async () => {
    const pending = createDeferred<Response>(); checks.mockReturnValueOnce(pending.promise)
    const { controller } = controllerView(); controller.edit('https://example.com/')
    const running = controller.check(); await controller.check()
    expect(checks).toHaveBeenCalledTimes(1); expect(controller.state.loading).toBe(true)
    pending.reject(new Error('private transport')); await running
    expect(controller.state.targetUrl).toBe('https://example.com/'); expect(controller.state.feedback).toBe('failed'); expect(controller.state.loading).toBe(false)
    await flush(); expect(checks).toHaveBeenCalledTimes(1)
    await controller.check(); expect(controller.state.outcome).toBe('allowed'); expect(controller.state.feedback).toBe('')
  })
  it.each(['resolve', 'reject', 'deny'] as const)('retires an old %s and its finally while a newer edit is still loading', async result => {
    const old = createDeferred<Response>(), fresh = createDeferred<Response>()
    checks.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const { controller } = controllerView(); controller.edit('https://old.example/')
    const first = controller.check(); controller.edit('https://new.example/')
    expect(controller.state.loading).toBe(false)
    const second = controller.check()
    if (result === 'reject') old.reject(new Error('stale private error'))
    else old.resolve(response(result === 'deny' ? null : { outcome: 'allowed' }, result === 'deny' ? 120001 : 0))
    await first
    expect(controller.state.targetUrl).toBe('https://new.example/'); expect(controller.state.loading).toBe(true)
    expect(controller.state.outcome).toBe(''); expect(controller.state.feedback).toBe(''); expect(authReads).not.toHaveBeenCalled()
    fresh.resolve(response({ outcome: 'restricted' })); await second
    expect(controller.state.outcome).toBe('restricted'); expect(controller.state.loading).toBe(false)
  })
  it.each((['switch', 'relogin', 'revoke', 'remove', 'unmount'] as const).flatMap(change => (['resolve', 'reject', 'deny'] as const).map(result => ({ change, result }))))('retires all private state and late $result on $change', async ({ change, result }) => {
    const pending = createDeferred<Response>(); checks.mockReturnValueOnce(pending.promise)
    const { controller, unmount } = controllerView(); controller.edit('https://private.example/')
    const running = controller.check()
    if (change === 'switch') auth('admin-b')
    else if (change === 'relogin') { auth(''); auth() }
    else if (change === 'revoke') auth('admin-a', ['admin:access'])
    else if (change === 'remove') client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    else unmount()
    expect(controller.state.targetUrl).toBe(''); expect(controller.state.loading).toBe(false)
    if (result === 'reject') pending.reject(new Error('retired transport'))
    else pending.resolve(response(result === 'deny' ? null : { outcome: 'allowed' }, result === 'deny' ? 120001 : 0))
    await running
    expect(controller.state.outcome).toBe(''); expect(controller.state.feedback).toBe('')
    expect(authReads).not.toHaveBeenCalled()
    if (change === 'revoke' || change === 'remove' || change === 'unmount') {
      controller.edit('private'); await controller.check(); expect(controller.state.targetUrl).toBe(''); expect(checks).toHaveBeenCalledTimes(1)
    }
  })
  it.each(['resolve', 'reject', 'deny'] as const)('ignores the old %s after a same-input newer request has already completed', async result => {
    const old = createDeferred<Response>(); checks.mockReturnValueOnce(old.promise)
    const { controller } = controllerView(); controller.edit('https://example.com/')
    const running = controller.check(); controller.edit('https://different.example/'); controller.edit('https://example.com/')
    await controller.check(); expect(controller.state.outcome).toBe('allowed')
    if (result === 'reject') old.reject(new Error('old'))
    else old.resolve(response(result === 'deny' ? null : { outcome: 'restricted' }, result === 'deny' ? 120001 : 0))
    await running
    expect(controller.state.outcome).toBe('allowed'); expect(controller.state.feedback).toBe(''); expect(controller.state.loading).toBe(false)
    expect(authReads).not.toHaveBeenCalled()
  })
  it('preserves input and an in-flight check across unrelated grants and equivalent auth refreshes', async () => {
    const pending = createDeferred<Response>(); checks.mockReturnValueOnce(pending.promise)
    const { controller } = controllerView(); controller.edit('https://example.com/'); const running = controller.check()
    auth('admin-a', ['system:manage', 'short_link:read_all', 'admin:access'])
    expect(controller.state.loading).toBe(true); expect(controller.state.targetUrl).toBe('https://example.com/')
    pending.resolve(response({ outcome: 'allowed' })); await running
    expect(controller.state.outcome).toBe('allowed')
  })
  it.each([120001, 401, 403])('refreshes current authorization after denial %s and never shows a decision', async code => {
    const pending = createDeferred<Response>(); authReads.mockReturnValueOnce(pending.promise)
    checks.mockResolvedValueOnce(code === 120001 ? response(null, code) : new Response('', { status: code }))
    const { controller } = controllerView(); controller.edit('https://example.com/'); await controller.check()
    expect(controller.state.allowed).toBe(false); expect(controller.state.targetUrl).toBe(''); expect(controller.state.outcome).toBe('')
    expect(authReads).toHaveBeenCalledTimes(1)
    pending.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } })); await flush()
    expect(controller.state.allowed).toBe(false)
  })
  it.each(['input', 'malformed', 'infrastructure'] as const)('keeps the editable draft after a current %s failure without echoing details', async failure => {
    checks.mockResolvedValueOnce(response(failure === 'malformed' ? { outcome: 'allowed', url: 'private' } : null, failure === 'input' ? 900226 : failure === 'infrastructure' ? 900000 : 0))
    mount(); await fireEvent.update(input(), 'https://example.com/'); await fireEvent.submit(form()); await flush()
    expect(input().value).toBe('https://example.com/')
    expect(screen.getByText('targetPolicyCheck.' + (failure === 'input' ? 'invalid' : 'failed'))).toBeTruthy()
    expect(document.body.textContent).not.toContain('private upstream')
    expect(screen.queryByText('targetPolicyCheck.allowed')).toBeNull(); expect(checks).toHaveBeenCalledTimes(1)
  })
  it('stays closed before authorized login and starts no automatic check when access returns', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true }); mount(); await flush()
    expect(screen.queryByRole('form')).toBeNull(); auth(); await nextTick()
    expect(form()).toBeTruthy(); expect(input().value).toBe(''); expect(checks).not.toHaveBeenCalled()
  })
  it.each(['en', 'zh-CN'] as const)('renders translated scope and all three outcome messages in %s', async locale => {
    const view = mount(locale), text = messages[locale].targetPolicyCheck
    expect(screen.getByRole('heading', { name: text.heading })).toBeTruthy()
    expect(screen.getByText(text.hint)).toBeTruthy(); expect(screen.getByText(text.scope)).toBeTruthy()
    const field = screen.getByRole('textbox', { name: text.target })
    for (const outcome of ['allowed', 'invalid_target', 'restricted'] as const) {
      checks.mockResolvedValueOnce(response({ outcome })); await fireEvent.update(field, 'https://example.com/' + outcome)
      await fireEvent.submit(screen.getByRole('form', { name: text.form })); await flush()
      expect(screen.getByText(text[outcome])).toBeTruthy()
    }
    view.unmount()
  })
})
