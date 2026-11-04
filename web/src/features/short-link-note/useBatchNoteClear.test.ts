import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { defineComponent, h, nextTick, type Component, type SetupContext } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { useBatchNoteClear } from './useBatchNoteClear'
import BatchNoteClearDialog from './BatchNoteClearDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = '00000000-0000-0000-0000-000000000001', other = '00000000-0000-0000-0000-000000000002'
const target = { id: '00000000-0000-0000-0000-000000000020', expectedUpdatedAt: '2026-11-04T06:00:00.123456Z' }
const version = '2026-11-04T07:00:00.123456789Z'
const grants = ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata', 'admin:access', 'short_link:read_all', 'short_link:update_all']
const user = (permissions = grants, id = actor) => ({ id, username: 'note-owner', nickname: '', group: 'admin', permissions })
const preview = (hasNote = true) => ({ items: [{ ...target, expectedNoteUpdatedAt: version, hasNote }], nonemptyCount: hasNote ? 1 : 0, emptyCount: hasNote ? 0 : 1 })
const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'Result', data, meta: {} }), { status })
const clients: QueryClient[] = []
/** Exercises the real cache identity, controller, entity and dialog with controlled network boundaries. */
function mount(context: 'own' | 'admin' = 'own', permissions = grants, stubs: Record<string, Component> = {}, fallbackFocus?: HTMLElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: user(permissions) })
  const fetcher = vi.fn<typeof fetch>(async input => response(String(input).endsWith('/auth/me') ? { user: user(permissions) }
    : String(input).endsWith('/preview') ? preview() : { changedCount: 1, unchangedCount: 0 }))
  vi.stubGlobal('fetch', fetcher)
  const cleared = vi.fn()
  let state!: ReturnType<typeof useBatchNoteClear>
  const view = render(defineComponent({ setup() {
    state = useBatchNoteClear(context, useShortLinkAccess(context), cleared)
    return () => h(BatchNoteClearDialog, { state, fallbackFocus })
  } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, ...stubs } } })
  return { ...view, state, client, fetcher, cleared }
}
/** Waits for a completed actual preview, not a cached value or a render tick. */
async function opened(view: ReturnType<typeof mount>) {
  view.state.open([target]); await waitFor(() => expect(view.state.data.value).toEqual(preview()))
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('batch note clear confirmation', () => {
  it.each(['selection', 'invalidation', 'notification'] as const)('stops remaining success effects if %s synchronously retires the login', async phase => {
    const view = mount(); await opened(view)
    const retire = () => { view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }) }
    const invalidate = vi.spyOn(view.client, 'invalidateQueries')
    if (phase === 'selection') view.cleared.mockImplementationOnce(retire)
    else if (phase === 'invalidation') invalidate.mockImplementationOnce(() => { retire(); return Promise.resolve() })
    else vi.mocked(toast.success).mockImplementationOnce(() => { retire(); return '' })
    await view.state.confirm()
    expect(view.cleared).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledTimes(phase === 'selection' ? 0 : 1)
    expect(toast.success).toHaveBeenCalledTimes(phase === 'notification' ? 1 : 0)
    expect(view.state.targets.value).toBeNull(); expect(view.state.canRestoreFocus()).toBe(false)
  })
  it('keeps a newer opening focused when an old closing transition completes', async () => {
    let entered!: () => void, left!: () => void
    const view = mount('own', grants, { VDialog: { props: ['modelValue'], emits: ['after-enter', 'after-leave'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      entered = () => ctx.emit('after-enter'); left = () => ctx.emit('after-leave'); return {}
    }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } })
    await opened(view); view.state.close(); await nextTick()
    await opened(view); entered(); left()
    expect(document.activeElement).toBe(screen.getByTestId('batch-note-clear-cancel'))
    expect(view.state.canConfirm.value).toBe(true)
  })
  it('falls back to the current page when the opener is an SVG control', async () => {
    let left!: () => void
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), fallback = document.createElement('section')
    svg.setAttribute('tabindex', '0'); fallback.tabIndex = -1; document.body.append(svg, fallback)
    const view = mount('own', grants, { VDialog: { props: ['modelValue'], emits: ['after-leave'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      left = () => ctx.emit('after-leave'); return {}
    }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } }, fallback)
    try {
      svg.focus(); expect(document.activeElement).toBe(svg)
      await opened(view); view.state.close(); await nextTick(); left()
      expect(document.activeElement).toBe(fallback)
    } finally { svg.remove(); fallback.remove() }
  })
  it.each(['own', 'admin'] as const)('previews first, keeps the pinned main version, then sends one explicitly confirmed clear (%s)', async context => {
    const view = mount(context)
    const value = preview(); value.items[0]!.expectedUpdatedAt = '2026-11-04T14:00:00.123456000+08:00'
    view.fetcher.mockResolvedValueOnce(response(value))
    view.state.open([target]); await waitFor(() => expect(view.state.canConfirm.value).toBe(true))
    expect(view.fetcher).toHaveBeenCalledTimes(1)
    const request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
    const saving = view.state.confirm()
    await view.state.confirm(); view.state.close(); view.state.open([target]); await view.state.reload()
    expect(view.state.saving.value).toBe(true); expect(view.fetcher).toHaveBeenCalledTimes(2)
    const input = JSON.parse(view.fetcher.mock.calls[1]![1]!.body as string)
    expect(input).toEqual({ items: [{ ...target, expectedNoteUpdatedAt: version }] })
    expect(screen.getByRole('dialog')).toBeTruthy()
    request.resolve(response({ changedCount: 1, unchangedCount: 0 })); await saving
    expect(view.state.targets.value).toBeNull(); expect(view.cleared).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledOnce()
  })
  it('does not write when all notes are already empty', async () => {
    const view = mount(); view.fetcher.mockResolvedValueOnce(response(preview(false)))
    view.state.open([target]); await waitFor(() => expect(view.state.data.value).toEqual(preview(false)))
    expect(screen.getByText('batchNoteClear.empty')).toBeTruthy()
    await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledTimes(1)
    await fireEvent.click(screen.getByRole('button', { name: 'batchNoteClear.cancel' }))
    expect(view.state.targets.value).toBeNull()
  })
  it.each(['transport', 'http500', 'badEnvelope', 'badResult', 'infrastructureCode'] as const)('freezes a %s write and requires a fresh preview plus a new confirmation', async kind => {
    const view = mount(); await opened(view)
    if (kind === 'transport') view.fetcher.mockRejectedValueOnce(new Error('offline'))
    else view.fetcher.mockResolvedValueOnce(kind === 'http500' ? response(null, 900000, 500) : kind === 'badEnvelope' ? new Response('broken')
      : kind === 'badResult' ? response({ note: 'PRIVATE' }) : response(null, 900000))
    await view.state.confirm()
    expect(view.state.unknown.value).toBe(true); expect(view.state.canConfirm.value).toBe(false)
    await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledTimes(2)
    view.fetcher.mockRejectedValueOnce(new Error('readback failed')); await view.state.reload()
    expect(view.state.unknown.value).toBe(true); expect(view.state.data.value).toBeNull()
    await view.state.reload()
    expect(view.state.unknown.value).toBe(false); expect(view.state.canConfirm.value).toBe(true)
    expect(view.fetcher).toHaveBeenCalledTimes(4)
    await view.state.confirm(); expect(view.cleared).toHaveBeenCalledOnce()
  })
  it('offers explicit preview recovery and known business-failure feedback without retrying writes', async () => {
    const view = mount(); await view.state.confirm(); await view.state.reload()
    view.fetcher.mockRejectedValueOnce(new Error('offline')); view.state.open([target])
    await waitFor(() => expect(view.state.error.value).toBe('loadFailed'))
    await view.state.reload(); expect(view.state.canConfirm.value).toBe(true)
    view.fetcher.mockResolvedValueOnce(response(null, 100001)); await view.state.confirm()
    expect(view.state.error.value).toBe('saveFailed'); expect(view.state.canConfirm.value).toBe(true)
    expect(view.cleared).not.toHaveBeenCalled()
  })
  it.each([200116, 200104, 120001, 401, 403])('retires the confirmation after a clear is denied with %s', async code => {
    const view = mount(); await opened(view)
    view.fetcher.mockResolvedValueOnce(response(null, code, code >= 400 && code < 500 ? code : 200))
    await view.state.confirm()
    expect(view.state.targets.value).toBeNull(); expect(view.state.data.value).toBeNull()
    expect(view.cleared).not.toHaveBeenCalled(); expect(toast.error).toHaveBeenCalledOnce()
  })
  it.each([200116, 200104, 120001])('retires a rejected preview with %s', async code => {
    const view = mount(); view.fetcher.mockResolvedValueOnce(response(null, code)); view.state.open([target])
    await waitFor(() => expect(view.state.targets.value).toBeNull())
    expect(view.cleared).not.toHaveBeenCalled()
  })
  it('rejects missing grants, invalid identities and empty openings without dispatch', () => {
    const view = mount('own', ['short_link:read_own'])
    view.state.open([target]); expect(view.state.targets.value).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: user(grants, 'invalid') }); view.state.open([target])
    expect(view.fetcher).not.toHaveBeenCalled()
    view.client.setQueryData(['auth', 'me'], { user: user() }); view.state.open([])
    expect(view.state.targets.value).toBeNull(); expect(view.fetcher).not.toHaveBeenCalled()
  })
  it('rejects invalid fixed targets, duplicate IDs and oversized collections', () => {
    const view = mount()
    for (const items of [[{ ...target, id: 'bad' }], [{ ...target, expectedUpdatedAt: 'bad' }], [target, target], Array.from({ length: 101 }, () => target)]) view.state.open(items)
    expect(view.fetcher).not.toHaveBeenCalled()
    view.unmount(); view.state.open([target]); expect(view.fetcher).not.toHaveBeenCalled(); expect(view.state.canRestoreFocus()).toBe(false)
  })
  it('retires immediately when auth becomes unconfirmed even if old data and grants return in the same tick', async () => {
    const view = mount(), request = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(request.promise); view.state.open([target])
    view.client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: 'error' })
    view.client.setQueryData(['auth', 'me'], { user: user() })
    try { expect(view.state.targets.value).toBeNull() }
    finally { request.resolve(response(preview())); await request.promise; await nextTick() }
    expect(view.state.data.value).toBeNull()
  })
  it('keeps the safe cancel action focused and never focuses a retired or saving confirmation', async () => {
    let entered!: () => void
    const view = mount('own', grants, { VDialog: { props: ['modelValue'], emits: ['after-enter', 'update:modelValue'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      entered = () => ctx.emit('after-enter'); return {}
    }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } })
    view.state.open([target]); entered()
    await waitFor(() => expect(view.state.canConfirm.value).toBe(true))
    entered(); expect(document.activeElement).toBe(screen.getByTestId('batch-note-clear-cancel'))
    const request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
    const saving = view.state.confirm(); entered()
    request.resolve(response({ changedCount: 1, unchangedCount: 0 })); await saving
    entered(); expect(view.state.targets.value).toBeNull()
  })
  it.each(['close', 'revoked', 'detached', 'success'] as const)('restores focus safely after %s without focusing an old account element', async reason => {
    let entered!: () => void, left!: () => void
    const opener = document.createElement('button'), fallback = document.createElement('section')
    fallback.tabIndex = -1; document.body.append(opener, fallback); opener.focus()
    const view = mount('own', grants, { VDialog: { props: ['modelValue'], emits: ['after-enter', 'after-leave', 'update:modelValue'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      entered = () => ctx.emit('after-enter'); left = () => ctx.emit('after-leave'); return {}
    }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } }, fallback)
    try {
      await opened(view); entered()
      if (reason === 'revoked') {
        view.client.setQueryData(['auth', 'me'], { user: user(['short_link:read_own']) })
        view.client.setQueryData(['auth', 'me'], { user: user() })
      } else if (reason === 'success') {
        view.cleared.mockImplementationOnce(() => { opener.disabled = true })
        await view.state.confirm()
        expect(opener.disabled).toBe(true)
        expect(view.state.targets.value).toBeNull()
      } else { if (reason === 'detached') opener.remove(); view.state.close() }
      await nextTick(); left()
      expect(document.activeElement).toBe(reason === 'close' ? opener : fallback)
    } finally { opener.remove(); fallback.remove() }
  })
  for (const phase of ['preview', 'clear'] as const) {
    for (const outcome of ['success', 'failure'] as const) {
      it.each(['identity', 'grants', 'reopen', 'unmount', 'reset'] as const)(`drops late ${phase} ${outcome} and its finally after %s retirement`, async retirement => {
        const view = mount(); if (phase === 'clear') await opened(view)
        const request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
        const operation = phase === 'clear' ? view.state.confirm() : (view.state.open([target]), Promise.resolve())
        if (retirement === 'identity') {
          view.client.setQueryData(['auth', 'me'], { user: user(grants, other) })
          view.client.setQueryData(['auth', 'me'], { user: user() })
        } else if (retirement === 'grants') {
          view.client.setQueryData(['auth', 'me'], { user: user(['short_link:read_own']) })
          view.client.setQueryData(['auth', 'me'], { user: user() })
        } else if (retirement === 'unmount') view.unmount()
        else if (retirement === 'reopen' && phase === 'preview') view.state.close()
        else view.state.reset()
        const newRequest = createDeferred<Response>()
        if (retirement !== 'unmount') {
          view.fetcher.mockReturnValueOnce(newRequest.promise); view.state.open([target])
          expect(view.state.loading.value).toBe(true)
        }
        const invalidate = vi.spyOn(view.client, 'invalidateQueries')
        if (outcome === 'success') request.resolve(response(phase === 'preview' ? preview() : { changedCount: 1, unchangedCount: 0 }))
        else request.reject(new Error('old failure'))
        await operation; await nextTick(); await Promise.resolve(); await nextTick()
        expect(view.cleared).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
        if (retirement !== 'unmount') {
          expect(view.state.loading.value).toBe(true); expect(view.state.data.value).toBeNull()
          newRequest.resolve(response(preview())); await waitFor(() => expect(view.state.canConfirm.value).toBe(true))
        }
      })
    }
  }
})
