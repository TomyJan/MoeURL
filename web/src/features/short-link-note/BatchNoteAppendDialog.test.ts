import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { defineComponent, getCurrentInstance, h, nextTick, type Component, type SetupContext } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { useBatchNoteAppend } from './useBatchNoteAppend'
import BatchNoteAppendDialog from './BatchNoteAppendDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'owner', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata'] }
const item = (index: number) => ({ id: '00000000-0000-0000-0000-' + String(index + 20).padStart(12, '0'), expectedUpdatedAt: '2026-11-09T00:00:00Z' })
/** Uses real Vuetify controls and translations; optional hooks make transitions deterministic. */
function mount(locale = 'en', count = 1, stubs?: Record<string, Component>, fallbackFocus?: HTMLElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  const items = Array.from({ length: Math.max(1, count) }, (_, i) => item(i))
  const fetcher = vi.fn<typeof fetch>(async (path, init) => new Response(JSON.stringify({ code: 0, message: 'OK', data: String(path).endsWith('/preview') ? {
    items: items.map(target => ({ ...target, expectedNoteUpdatedAt: '2026-11-09T01:00:00Z' })), appendableCount: count, overflowCount: count === 0 ? 1 : 0,
  } : { requestId: JSON.parse(init!.body as string).requestId, appendedCount: Math.max(1, count) }, meta: {} }))); vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  let state!: ReturnType<typeof useBatchNoteAppend>
  const approvals: Array<() => Promise<void>> = []
  /** Captures a real rendered callback that can already be queued when text is edited. */
  function captureApproval() {
    const instance = getCurrentInstance()
    if (instance?.attrs['data-testid'] === 'batch-note-append-confirm' && typeof instance.vnode.props?.onClick === 'function') approvals.push(instance.vnode.props.onClick as () => Promise<void>)
  }
  const view = render(defineComponent({ setup() {
    state = useBatchNoteAppend('own', useShortLinkAccess('own'), () => {})
    return () => h(BatchNoteAppendDialog, { state, fallbackFocus })
  } }), { global: { mixins: [{ mounted: captureApproval, updated: captureApproval }], plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages }), createVuetify({ components, directives })], stubs } })
  state.open(items)
  return { ...view, state, client, fetcher, approvals }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
describe('private append dialog', () => {
  it('does not focus a retired discard warning after its asynchronous DOM wait', async () => {
    const view = mount('en', 1, componentStubs); await nextTick()
    view.state.setDraft('new'); await view.state.preview(); view.fetcher.mockRejectedValueOnce(new Error('lost')); await view.state.confirm()
    view.state.close(); await nextTick()
    view.state.reset(); await nextTick()
    expect(screen.queryByTestId('batch-note-append-keep')).toBeNull(); expect(view.state.requestId.value).toBe('')
  })
  it('shows read errors, saving progress/locks, operation ID and explicit same-key recovery', async () => {
    let entered!: () => void
    const view = mount('en', 1, { VDialog: { props: ['modelValue'], emits: ['after-enter'], setup(_props: Record<string, unknown>, ctx: SetupContext) { entered = () => ctx.emit('after-enter'); return {} }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } })
    await nextTick(); const textarea = screen.getByRole('textbox')
    await fireEvent.update(textarea, 'new'); view.fetcher.mockRejectedValueOnce(new Error('offline'))
    await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await screen.findByText('Could not preview. Please retry.')
    await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await screen.findByTestId('batch-note-append-confirm')
    const request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
    await fireEvent.click(screen.getByTestId('batch-note-append-confirm')); entered()
    expect(textarea).toHaveProperty('readOnly', true); expect(screen.getByTestId('batch-note-append-cancel')).toHaveProperty('disabled', true); expect(screen.getByText('Appending notes…')).toBeTruthy()
    request.reject(new Error('offline')); await waitFor(() => expect(view.state.unknown.value).toBe(true)); entered()
    expect(document.activeElement).toBe(screen.getByTestId('batch-note-append-cancel')); expect(textarea).toHaveProperty('readOnly', true)
    expect(screen.getByTestId('batch-note-append-unknown').textContent).toContain(view.state.requestId.value)
    view.state.open([item(0)]); expect(view.state.unknown.value).toBe(true)
    await fireEvent.click(screen.getByTestId('batch-note-append-cancel')); await nextTick()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('batch-note-append-keep')))
    expect(screen.getByTestId('batch-note-append-discard-warning').textContent).toContain('does not undo')
    await fireEvent.click(screen.getByTestId('batch-note-append-keep')); await fireEvent.click(screen.getByTestId('batch-note-append-retry'))
    await waitFor(() => expect(view.state.targets.value).toBeNull()); expect(view.fetcher).toHaveBeenCalledTimes(4)
    entered()
  })
  it('requires explicit abandon after a rejected retry and never calls that a server cancellation', async () => {
    const view = mount(); await nextTick(); await fireEvent.update(screen.getByRole('textbox'), 'new')
    await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await screen.findByTestId('batch-note-append-confirm')
    view.fetcher.mockRejectedValueOnce(new Error('lost')); await fireEvent.click(screen.getByTestId('batch-note-append-confirm')); await screen.findByTestId('batch-note-append-unknown')
    await fireEvent.click(screen.getByTestId('batch-note-append-cancel')); await screen.findByTestId('batch-note-append-discard-warning')
    const count = view.fetcher.mock.calls.length; await fireEvent.click(screen.getByTestId('batch-note-append-discard'))
    expect(view.state.targets.value).toBeNull(); expect(view.fetcher).toHaveBeenCalledTimes(count)
  })
  it('rejects the actual old rendered confirmation after draft ABA and a new preview', async () => {
    const view = mount(); await nextTick(); const textarea = screen.getByRole('textbox')
    await fireEvent.update(textarea, 'A'); await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await screen.findByTestId('batch-note-append-confirm')
    const queued = view.approvals.at(-1)!; expect(queued).toBeTypeOf('function')
    await fireEvent.update(textarea, 'B'); await fireEvent.update(textarea, 'A'); await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await screen.findByTestId('batch-note-append-confirm')
    await queued(); expect(view.fetcher).toHaveBeenCalledTimes(2)
    await fireEvent.click(screen.getByTestId('batch-note-append-confirm')); await waitFor(() => expect(view.state.targets.value).toBeNull())
    expect(view.fetcher).toHaveBeenCalledTimes(3)
  })
  for (const locale of ['en', 'zh-CN']) {
    it.each([0, 1, 100])('shows actual aggregate counts, Unicode limit and no implicit Enter action in ' + locale + ': %s', async count => {
      const view = mount(locale, count); await nextTick()
      expect(screen.getByRole('dialog', { name: locale === 'en' ? 'Append to selected internal notes' : '追加到所选内部备注' })).toBeTruthy()
      const textarea = screen.getByRole('textbox'); await fireEvent.update(textarea, '😀'.repeat(1000)); expect(view.state.draft.value).toHaveLength(2000)
      expect(textarea.hasAttribute('maxlength')).toBe(false); await fireEvent.keyDown(textarea, { key: 'Enter' }); expect(view.fetcher).not.toHaveBeenCalled()
      await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await waitFor(() => expect(view.state.data.value?.appendableCount).toBe(count))
      if (count === 0) { expect(screen.queryByTestId('batch-note-append-confirm')).toBeNull(); expect(screen.getByText(locale === 'en' ? 'Nothing in this batch will be saved. Shorten the text and preview again.' : '整批不会保存。请缩短追加内容，再预览。')).toBeTruthy() }
      else expect(screen.getByTestId('batch-note-append-confirm').textContent).toBe(locale === 'en' ? 'Append to ' + count + (count === 1 ? ' note' : ' notes') : '追加到 ' + count + ' 条备注')
      await fireEvent.update(textarea, '😀'.repeat(1001)); expect(view.state.error.value).toBe('invalidNote'); expect(screen.queryByTestId('batch-note-append-confirm')).toBeNull()
      expect(screen.getByTestId('batch-note-append-preview')).toHaveProperty('disabled', true)
    })
  }
  it.each(['ordinary', 'revoked', 'detached', 'disabled', 'svg'] as const)('restores a safe focus after %s and ignores old leave events during a newer opening', async reason => {
    let entered!: () => void, left!: () => void
    const fallback = document.createElement('section'), opener = document.createElement('button'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    fallback.tabIndex = -1; svg.setAttribute('tabindex', '0'); document.body.append(opener, fallback, svg)
    if (reason === 'svg') svg.focus(); else opener.focus()
    try {
      const view = mount('en', 1, { ...componentStubs, VDialog: { props: ['modelValue'], emits: ['after-enter', 'after-leave'], setup(_props: Record<string, unknown>, ctx: SetupContext) { entered = () => ctx.emit('after-enter'); left = () => ctx.emit('after-leave'); return {} }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } }, fallback)
      await nextTick(); entered(); expect(document.activeElement).toBe(screen.getByRole('textbox'))
      if (reason === 'revoked') view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:read_own'] } })
      else { if (reason === 'detached') opener.remove(); if (reason === 'disabled') opener.disabled = true; view.state.close() }
      await nextTick(); left(); expect(document.activeElement).toBe(reason === 'ordinary' ? opener : fallback)
      if (reason !== 'revoked') { view.state.open([item(0)]); await nextTick(); entered(); left(); expect(document.activeElement).toBe(screen.getByRole('textbox')) }
    } finally { opener.remove(); fallback.remove(); svg.remove() }
  })
})
