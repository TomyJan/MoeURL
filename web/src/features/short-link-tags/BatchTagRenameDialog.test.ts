import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { defineComponent, getCurrentInstance, h, nextTick, type Component, type SetupContext } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { vuetify } from '@/app/vuetify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { useBatchTagRename } from './useBatchTagRename'
import BatchTagRenameDialog from './BatchTagRenameDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'owner', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata'] }
const item = (index: number, old = 'old') => ({ id: `00000000-0000-0000-0000-${String(index + 20).padStart(12, '0')}`, expectedUpdatedAt: '2026-11-05T00:00:00Z', url: 'https://short.example/' + 'a'.repeat(160), tags: [old, 'other'] })
/** Runs real translations and controls; hook overrides expose transition focus deterministically. */
function mount(locale = 'en', count = 1, stubs?: Record<string, Component>, fallbackFocus?: HTMLElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: count, unchangedCount: count === 0 ? 1 : 0 }, meta: {} }))); vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  let state!: ReturnType<typeof useBatchTagRename>
  const callbacks: Record<string, Array<() => void | Promise<void>>> = { approve: [], confirm: [] }
  function capture() {
    const instance = getCurrentInstance(), id = instance?.attrs['data-testid']
    const event = instance?.vnode.props?.onClick
    if (typeof event === 'function' && (id === 'batch-tag-rename-approve' || id === 'batch-tag-rename-confirm')) callbacks[id.endsWith('approve') ? 'approve' : 'confirm']!.push(event as () => void)
  }
  const view = render(defineComponent({ setup() {
    state = useBatchTagRename('own', useShortLinkAccess('own'), () => {}, async () => true)
    return () => h(BatchTagRenameDialog, { state, fallbackFocus })
  } }), { global: { mixins: [{ mounted: capture, updated: capture }], plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages }), vuetify], stubs } })
  state.open(Array.from({ length: Math.max(1, count) }, (_, index) => item(index, count ? 'old' : 'absent')))
  return { ...view, state, client, fetcher, callbacks }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('batch tag rename dialog', () => {
  // Retiring approval must not replace the in-flight save with an approval button.
  it.each(['en', 'zh-CN'])('keeps an accessible saving action after approval retires in %s', async locale => {
    const view = mount(locale), request = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(request.promise)
    await nextTick()
    await fireEvent.update(screen.getByRole('textbox', { name: locale === 'en' ? 'Current tag' : '原标签' }), 'old')
    await fireEvent.update(screen.getByRole('textbox', { name: locale === 'en' ? 'New tag' : '新标签' }), 'new')
    await fireEvent.click(screen.getByTestId('batch-tag-rename-approve'))
    await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm'))
    try {
      await waitFor(() => expect(view.state.saving.value).toBe(true))
      expect(view.state.approved.value).toBeNull()
      const save = screen.getByRole('button', { name: locale === 'en' ? 'Saving…' : '正在保存…' })
      expect(save).toBe(screen.getByTestId('batch-tag-rename-confirm'))
      expect(save).toHaveProperty('disabled', true)
      expect(save.getAttribute('aria-busy')).toBe('true')
      expect(save.querySelector('.v-btn__loader')?.textContent).toContain(locale === 'en' ? 'Saving…' : '正在保存…')
      expect(save.querySelector('.v-progress-circular--indeterminate svg')).not.toBeNull()
      expect(screen.queryByTestId('batch-tag-rename-approve')).toBeNull()
      await fireEvent.click(save)
      await fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Cancel' : '取消' }))
      expect(view.state.targets.value).not.toBeNull()
      expect(view.fetcher).toHaveBeenCalledOnce()
    } finally {
      request.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: 1, unchangedCount: 0 }, meta: {} })))
      await waitFor(() => expect(view.state.targets.value).toBeNull())
    }
  })
  it.each(['rejected', 'stale', 'unknown'] as const)('replaces saving feedback with the actual %s outcome', async outcome => {
    const view = mount(), request = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(request.promise)
    await nextTick()
    await fireEvent.update(screen.getByLabelText('Current tag'), 'old')
    await fireEvent.update(screen.getByLabelText('New tag'), 'new')
    await fireEvent.click(screen.getByTestId('batch-tag-rename-approve'))
    await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm'))
    expect(view.state.saving.value).toBe(true)
    if (outcome === 'unknown') request.reject(new Error('lost response'))
    else request.resolve(new Response(JSON.stringify({ code: outcome === 'stale' ? 200116 : 100001, message: 'Rejected', data: null, meta: {} })))
    await screen.findByText(outcome === 'unknown' ? /The save result is unknown/ : outcome === 'stale' ? /Selected links changed/ : /The request was rejected/)
    expect(view.state.saving.value).toBe(false)
    expect(view.state.approved.value).toBeNull()
    expect(screen.queryByTestId('batch-tag-rename-confirm')).toBeNull()
    expect(screen.getByLabelText('New tag')).toHaveProperty('value', 'new')
    expect(view.fetcher).toHaveBeenCalledOnce()
    if (outcome === 'rejected') expect(screen.getByTestId('batch-tag-rename-approve')).toHaveProperty('disabled', false)
    else expect(screen.getByTestId('batch-tag-rename-reload')).toHaveProperty('disabled', false)
  })
  it.each(['account', 'permission', 'unmount'] as const)('retires the pending action on %s without reviving it after a late response', async reason => {
    const view = mount(), request = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(request.promise)
    await nextTick()
    await fireEvent.update(screen.getByLabelText('Current tag'), 'old')
    await fireEvent.update(screen.getByLabelText('New tag'), 'new')
    await fireEvent.click(screen.getByTestId('batch-tag-rename-approve'))
    await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm'))
    expect(view.state.saving.value).toBe(true)
    if (reason === 'unmount') view.unmount()
    else view.client.setQueryData(['auth', 'me'], { user: reason === 'account' ? { ...actor, id: '00000000-0000-0000-0000-000000000002' } : { ...actor, permissions: [] } })
    await waitFor(() => expect(view.state.targets.value).toBeNull())
    request.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: 1, unchangedCount: 0 }, meta: {} })))
    await request.promise; await nextTick(); await nextTick()
    expect(view.state.targets.value).toBeNull()
    expect(view.state.saving.value).toBe(false)
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull()
    expect(view.fetcher).toHaveBeenCalledOnce()
  })
  for (const locale of ['en', 'zh-CN']) it.each([0, 1, 100])(`renders before/after and correct counts in ${locale}: %s`, async count => {
    const view = mount(locale, count); await nextTick()
    const from = screen.getByRole('textbox', { name: locale === 'en' ? 'Current tag' : '原标签' }), to = screen.getByRole('textbox', { name: locale === 'en' ? 'New tag' : '新标签' })
    await fireEvent.update(from, 'old'); await fireEvent.update(to, '😀'.repeat(32))
    await fireEvent.keyDown(to, { key: 'Enter' }); expect(view.fetcher).not.toHaveBeenCalled(); expect(to.hasAttribute('maxlength')).toBe(false)
    expect(view.state.preview.value?.changedCount).toBe(count)
    expect(screen.getByTestId('batch-tag-rename-preview').textContent).toContain(locale === 'en' ? count === 1 ? '1 link will change' : `${count} links will change` : `预计 ${count} 条短链变化`)
    if (count === 0) expect(screen.getByTestId('batch-tag-rename-approve')).toHaveProperty('disabled', true)
    else {
      await fireEvent.click(screen.getByTestId('batch-tag-rename-approve')); expect(screen.getByTestId('batch-tag-rename-confirm')).toHaveProperty('disabled', false)
      await fireEvent.update(to, '😀'.repeat(33)); expect(view.state.canConfirm.value).toBe(false); expect(screen.queryByTestId('batch-tag-rename-preview')).toBeNull()
    }
    expect(view.fetcher).not.toHaveBeenCalled()
  })
  it('rejects rendered old approval and confirmation listeners after draft ABA', async () => {
    const view = mount(); await nextTick(); const from = screen.getByLabelText('Current tag'), to = screen.getByLabelText('New tag')
    await fireEvent.update(from, 'old'); await fireEvent.update(to, 'new'); const approve = view.callbacks.approve!.at(-1)!
    await fireEvent.click(screen.getByTestId('batch-tag-rename-approve')); const confirm = view.callbacks.confirm!.at(-1)!
    await fireEvent.update(to, 'other'); await fireEvent.update(to, 'new'); await approve(); await confirm()
    expect(view.state.approved.value).toBeNull(); expect(view.fetcher).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByTestId('batch-tag-rename-approve')); await confirm(); expect(view.fetcher).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm')); await waitFor(() => expect(view.state.targets.value).toBeNull()); expect(view.fetcher).toHaveBeenCalledOnce()
  })
  it('shows saving, known failure, stale and unknown recovery without implicit retries', async () => {
    let entered!: () => void
    const view = mount('en', 1, { VDialog: { props: ['modelValue'], emits: ['after-enter'], setup(_props: Record<string, unknown>, ctx: SetupContext) { entered = () => ctx.emit('after-enter'); return {} }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } })
    await nextTick(); entered(); const to = screen.getByLabelText('New tag')
    await fireEvent.update(screen.getByLabelText('Current tag'), 'old'); await fireEvent.update(to, 'new')
    await fireEvent.click(screen.getByTestId('batch-tag-rename-approve'))
    view.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: 100001, message: 'bad', data: null, meta: {} })))
    await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm')); await screen.findByText(/The request was rejected/)
    await fireEvent.click(screen.getByTestId('batch-tag-rename-approve')); const request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
    await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm')); entered()
    expect(to).toHaveProperty('readOnly', true); expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
    request.reject(new Error('lost')); await screen.findByText(/The save result is unknown/); entered()
    expect(document.activeElement).toBe(screen.getByTestId('batch-tag-rename-reload'))
    await fireEvent.click(screen.getByTestId('batch-tag-rename-reload')); await waitFor(() => expect(view.state.targets.value).toBeNull()); entered()
    expect(view.fetcher).toHaveBeenCalledTimes(2)
    view.state.open([item(0)]); view.state.setFromTag('old'); view.state.setToTag('new'); view.state.approve()
    view.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: 200116, message: 'stale', data: null, meta: {} })))
    await view.state.confirm(); await screen.findByText(/Selected links changed/)
  })
  it.each(['opener', 'detached', 'disabled', 'svg', 'revoked'] as const)('restores safe focus after %s without acting on a late close from an older opening', async reason => {
    let entered!: () => void, left!: () => void
    const fallback = document.createElement('section'), button = document.createElement('button'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    fallback.tabIndex = -1; svg.setAttribute('tabindex', '0'); document.body.append(button, fallback, svg)
    if (reason === 'svg') svg.focus(); else button.focus()
    try {
      const view = mount('en', 1, { ...componentStubs, VDialog: { props: ['modelValue'], emits: ['after-enter', 'after-leave'], setup(_props: Record<string, unknown>, ctx: SetupContext) { entered = () => ctx.emit('after-enter'); left = () => ctx.emit('after-leave'); return {} }, template: '<div v-if="modelValue" role="dialog"><slot /></div>' } }, fallback)
      await nextTick(); entered()
      if (reason === 'revoked') { fallback.focus(); view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } }) }
      else { if (reason === 'detached') button.remove(); if (reason === 'disabled') button.disabled = true; view.state.close() }
      await nextTick(); left(); expect(document.activeElement).toBe(reason === 'opener' ? button : fallback)
      if (reason !== 'revoked') { view.state.open([item(0)]); await nextTick(); entered(); left(); expect(document.activeElement).toBe(screen.getByLabelText('Current tag')) }
    } finally { fallback.remove(); button.remove(); svg.remove() }
  })
})
