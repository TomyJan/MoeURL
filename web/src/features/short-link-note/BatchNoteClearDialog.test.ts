import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { defineComponent, h } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { componentStubs } from '@/test/component-stubs'
import { messages } from '@/app/i18n'
import { useBatchNoteClear } from './useBatchNoteClear'
import BatchNoteClearDialog from './BatchNoteClearDialog.vue'

const clients: QueryClient[] = []
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
describe('localized batch note clear counts', () => {
  for (const locale of ['en', 'zh-CN']) {
    it.each([0, 1, 100])(`shows accurate safe counts and confirmation in ${locale}: %s`, async count => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
      client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000000001', username: 'owner', group: 'user', nickname: '', permissions: ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata'] } })
      const items = Array.from({ length: Math.max(1, count) }, (_, index) => ({ id: `00000000-0000-0000-0000-${(index + 1).toString().padStart(12, '0')}`, expectedUpdatedAt: '2026-11-04T06:00:00Z' }))
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: items.map(item => ({ ...item, expectedNoteUpdatedAt: '2026-11-04T07:00:00Z', hasNote: count > 0 })), nonemptyCount: count, emptyCount: count === 0 ? 1 : 0 }, meta: {} }))))
      let state!: ReturnType<typeof useBatchNoteClear>
      render(defineComponent({ setup() { state = useBatchNoteClear('own', useShortLinkAccess('own'), () => {}); return () => h(BatchNoteClearDialog, { state }) } }), {
        global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages })], stubs: componentStubs },
      })
      state.open(items); await waitFor(() => expect(state.data.value?.nonemptyCount).toBe(count))
      if (locale === 'en') expect(screen.getByTestId('batch-note-clear-summary').textContent).toContain(`${Math.max(1, count)} ${count === 100 ? 'links' : 'link'} selected.`)
      expect(screen.getByRole('dialog', { name: locale === 'en' ? 'Clear selected internal notes' : '清空所选内部备注' })).toBeTruthy()
      if (count === 0) expect(screen.queryByTestId('batch-note-clear-confirm')).toBeNull()
      else expect(screen.getByTestId('batch-note-clear-confirm').textContent).toBe(locale === 'en' ? `Clear ${count} ${count === 1 ? 'note' : 'notes'}` : `清空 ${count} 条备注`)
      expect(screen.getByTestId('batch-note-clear-summary').textContent).not.toContain('1 notes')
    })
  }
})
