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
import { useBatchNoteReplace } from './useBatchNoteReplace'
import BatchNoteReplaceDialog from './BatchNoteReplaceDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'owner', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata'] }
const item = (index: number) => ({ id: `00000000-0000-0000-0000-${String(index + 20).padStart(12, '0')}`, expectedUpdatedAt: '2026-11-05T00:00:00Z' })
/** Exercises real translations and Vuetify controls, with deterministic optional transition hooks. */
function mount(locale = 'en', count = 1, stubs?: Record<string, Component>, fallbackFocus?: HTMLElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  const items = Array.from({ length: Math.max(1, count) }, (_, i) => item(i))
  const fetcher = vi.fn(async (path: RequestInfo | URL) => new Response(JSON.stringify({ code: 0, message: 'OK', data: String(path).endsWith('/preview') ? {
    items: items.map(target => ({ ...target, expectedNoteUpdatedAt: '2026-11-05T01:00:00Z', willChange: count > 0 })), changedCount: count, unchangedCount: count === 0 ? 1 : 0,
  } : { changedCount: count, unchangedCount: count === 0 ? 1 : 0 }, meta: {} }))); vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  let state!: ReturnType<typeof useBatchNoteReplace>
  const approvals: Array<() => Promise<void>> = []
  /** Captures the real rendered listener to deliver a click that was queued before an edit. */
  function captureApproval() {
    const instance = getCurrentInstance()
    if (instance?.attrs['data-testid'] === 'batch-note-replace-confirm' && typeof instance.vnode.props?.onClick === 'function') approvals.push(instance.vnode.props.onClick as () => Promise<void>)
  }
  const view = render(defineComponent({ setup() {
    state = useBatchNoteReplace('own', useShortLinkAccess('own'), () => {})
    return () => h(BatchNoteReplaceDialog, { state, fallbackFocus })
  } }), { global: { mixins: [{ mounted: captureApproval, updated: captureApproval }], plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages }), createVuetify({ components, directives })], stubs } })
  state.open(items)
  return { ...view, state, client, fetcher, approvals }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
describe('batch replacement dialog', () => {
  it('shows read errors, saving locks and unknown-result recovery without automatically retrying a write', async () => {
    let entered!: () => void
    const view = mount('en', 1, { VDialog: { props: ['modelValue'], emits: ['after-enter'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      entered = () => ctx.emit('after-enter'); return {}
    }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } })
    await nextTick(); const textarea = screen.getByRole('textbox')
    await fireEvent.update(textarea, 'new')
    view.fetcher.mockRejectedValueOnce(new Error('offline')); await fireEvent.click(screen.getByTestId('batch-note-replace-preview'))
    await screen.findByText('Could not check the changes. Please retry.')
    await fireEvent.click(screen.getByTestId('batch-note-replace-preview')); await screen.findByTestId('batch-note-replace-confirm')
    const request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
    await fireEvent.click(screen.getByTestId('batch-note-replace-confirm')); entered()
    expect(textarea).toHaveProperty('readOnly', true); expect(screen.getByTestId('batch-note-replace-cancel')).toHaveProperty('disabled', true)
    request.reject(new Error('offline')); await waitFor(() => expect(view.state.unknown.value).toBe(true)); entered()
    expect(document.activeElement).toBe(screen.getByTestId('batch-note-replace-cancel'))
    expect(screen.getByText(/The replacement result is unknown/)).toBeTruthy(); expect(textarea).toHaveProperty('readOnly', true)
    await fireEvent.click(screen.getByRole('button', { name: 'Check result again' }))
    await screen.findByTestId('batch-note-replace-confirm'); expect(textarea).toHaveProperty('readOnly', false)
    expect(view.fetcher).toHaveBeenCalledTimes(4)
    view.state.close(); await nextTick(); entered(); expect(view.state.targets.value).toBeNull()
  })
  it.each(['revoked', 'detached', 'disabled', 'svg'] as const)('restores to the current page after an unusable %s opener, including an old leave during a new opening', async reason => {
    let entered!: () => void, left!: () => void
    const fallback = document.createElement('section'), button = document.createElement('button')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('tabindex', '0')
    fallback.tabIndex = -1; document.body.append(button, fallback, svg)
    if (reason === 'svg') svg.focus(); else button.focus()
    try {
      const view = mount('en', 1, { ...componentStubs, VDialog: { props: ['modelValue'], emits: ['after-enter', 'after-leave'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
        entered = () => ctx.emit('after-enter'); left = () => ctx.emit('after-leave'); return {}
      }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } }, fallback)
      await nextTick(); entered()
      if (reason === 'revoked') view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:read_own'] } })
      else { if (reason === 'detached') button.remove(); if (reason === 'disabled') button.disabled = true; view.state.close() }
      await nextTick(); left(); expect(document.activeElement).toBe(fallback)
      if (reason !== 'revoked') {
        view.state.open([item(0)]); await nextTick(); entered(); left()
        expect(document.activeElement).toBe(screen.getByRole('textbox'))
      }
    } finally { button.remove(); fallback.remove(); svg.remove() }
  })
  it('rejects an actual rendered old listener after edit ABA and a new preview, but accepts a fresh button click', async () => {
    const view = mount(); await nextTick()
    const textarea = screen.getByRole('textbox')
    await fireEvent.update(textarea, 'A'); await fireEvent.click(screen.getByTestId('batch-note-replace-preview'))
    await screen.findByTestId('batch-note-replace-confirm'); expect(view.approvals.length).toBeGreaterThan(0)
    const queued = view.approvals.at(-1)!
    await fireEvent.update(textarea, 'B'); await fireEvent.update(textarea, 'A')
    await fireEvent.click(screen.getByTestId('batch-note-replace-preview')); await screen.findByTestId('batch-note-replace-confirm')
    await queued(); expect(view.fetcher).toHaveBeenCalledTimes(2)
    await fireEvent.click(screen.getByTestId('batch-note-replace-confirm'))
    await waitFor(() => expect(view.state.targets.value).toBeNull()); expect(view.fetcher).toHaveBeenCalledTimes(3)
  })
  for (const locale of ['en', 'zh-CN']) {
    it.each([0, 1, 100])(`shows actual comparison counts and requires explicit approval in ${locale}: %s`, async count => {
      const view = mount(locale, count); await nextTick()
      expect(screen.getByRole('dialog', { name: locale === 'en' ? 'Replace selected internal notes' : '替换所选内部备注' })).toBeTruthy()
      const textarea = screen.getByRole('textbox')
      await fireEvent.update(textarea, '😀'.repeat(1000)); expect(view.state.draft.value).toHaveLength(2000)
      expect(textarea.hasAttribute('maxlength')).toBe(false)
      await fireEvent.keyDown(textarea, { key: 'Enter' }); expect(view.fetcher).not.toHaveBeenCalled()
      await fireEvent.click(screen.getByTestId('batch-note-replace-preview'))
      await waitFor(() => expect(view.state.data.value?.changedCount).toBe(count))
      if (count === 0) expect(screen.queryByTestId('batch-note-replace-confirm')).toBeNull()
      else expect(screen.getByTestId('batch-note-replace-confirm').textContent).toBe(locale === 'en' ? `Overwrite ${count} ${count === 1 ? 'note' : 'notes'}` : `覆盖 ${count} 条备注`)
      expect(screen.getByTestId('batch-note-replace-summary').textContent).not.toContain('1 notes')
      expect(view.fetcher).toHaveBeenCalledOnce()
      await fireEvent.update(textarea, '😀'.repeat(1001)); expect(view.state.error.value).toBe('invalidNote')
      expect(screen.queryByTestId('batch-note-replace-confirm')).toBeNull(); expect(screen.getByTestId('batch-note-replace-preview')).toHaveProperty('disabled', true)
    })
  }
  it('focuses the editable draft on entry and restores the opener after ordinary close', async () => {
    let entered!: () => void, left!: () => void
    const opener = document.createElement('button'); document.body.append(opener); opener.focus()
    try {
      const view = mount('en', 1, { ...componentStubs, VDialog: { props: ['modelValue'], emits: ['after-enter', 'after-leave'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
        entered = () => ctx.emit('after-enter'); left = () => ctx.emit('after-leave'); return {}
      }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } })
      await nextTick(); entered()
      expect(document.activeElement).toBe(screen.getByRole('textbox'))
      view.state.close(); await nextTick(); left(); expect(document.activeElement).toBe(opener)
    } finally { opener.remove() }
  })
})
