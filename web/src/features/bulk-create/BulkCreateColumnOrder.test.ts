import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('bilingual reordered CSV dialog', () => {
  it.each([
    { locale: 'zh-CN', help: '标准列名可任意排列；不能使用未知、重复或缺少 target_url 的表头。示例和模板仍使用完整标准顺序。' },
    { locale: 'en', help: 'Standard columns may appear in any order. Unknown or duplicate names and headers without target_url are rejected. Examples and templates keep the complete standard order.' },
  ])('explains complete column sets and renders reordered raw fields as text ($locale)', async ({ locale, help }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
    client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000008102', username: 'order-ui', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] } })
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
    const view = render(BulkCreateDialog, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
    await fireEvent.click(screen.getByTestId('bulk-create-open'))
    expect(screen.getByText(help)).toBeTruthy()
    const text = 'title,target_url\n" <b>标题 😀</b> ",https://example.com/raw'
    const file = new File([text], 'reordered.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
    const input = view.container.querySelector('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').children).toHaveLength(1))
    expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain(' <b>标题 😀</b> ')
    expect(view.container.querySelector('b')).toBeNull()
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('https://example.com/raw')
    expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain(' <b>标题 😀</b> ')
    expect(view.container.querySelector('b')).toBeNull()
  })
})
