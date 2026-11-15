import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

const clients: QueryClient[] = []
const translations = [
  { locale: 'zh-CN', header: 'CSV 表头不符合标准列集合（第 1 条记录）。', syntax: '第 3 条 CSV 记录的引号或换行格式不正确。', width: '第 3 条 CSV 记录的字段数量与表头不一致。', help: '按 CSV 记录计数，表头为第 1 条，单元格中的换行不另计。' },
  { locale: 'en', header: 'Invalid standard column set in CSV record 1.', syntax: 'Invalid quoting or line ending in CSV record 3.', width: 'CSV record 3 has a different field count from the header.', help: 'Count CSV records with the header as record 1. Line breaks inside cells do not add records.' },
]
function mount(locale: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000008203', username: 'issue-ui', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] } })
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  const view = render(BulkCreateDialog, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { view, fetcher }
}
async function select(container: Element, text: string) {
  const file = new File([text], 'secret-file.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true }); await fireEvent.change(input)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  return input
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('safe bilingual CSV issue feedback', () => {
  it.each(translations)('renders trusted diagnostics, logical counting and repeat focus in $locale', async words => {
    const { view, fetcher } = mount(words.locale); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    const textarea = view.container.querySelector('textarea')!; await fireEvent.update(textarea, 'https://example.com/manual')
    const input = await select(view.container, '<img src=x onerror=secret>\nhttps://secret.invalid')
    expect(screen.getByTestId('bulk-create-error').textContent).toContain(words.header)
    expect(screen.getByText(words.help)).toBeTruthy(); expect(input.value).toBe('')
    expect(view.container.querySelector('img')).toBeNull(); expect(view.container.textContent).not.toContain('secret')
    expect(textarea.value).toBe('https://example.com/manual'); expect(fetcher).not.toHaveBeenCalled()
    textarea.focus(); await select(view.container, 'target_url\nhttps://example.com\n"secret')
    expect(screen.getByTestId('bulk-create-error').textContent).toContain(words.syntax)
    expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    textarea.focus(); await select(view.container, 'target_url,title\nhttps://example.com,"line1\nline2"\nhttps://example.org')
    expect(screen.getByTestId('bulk-create-error').textContent).toContain(words.width)
    textarea.focus(); await select(view.container, 'target_url,title\nhttps://example.com,"line1\nline2"\nhttps://example.org')
    expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    expect(screen.getByTestId('bulk-create-error').textContent).toContain(words.width)
    await select(view.container, 'target_url\nftp://secret.invalid')
    expect(screen.queryByTestId('bulk-create-csv-issue')).toBeNull()
    expect(screen.getByTestId('bulk-create-error').textContent).not.toContain(words.width)
    expect(fetcher).not.toHaveBeenCalled()
    await select(view.container, 'target_url\nhttps://example.com/valid')
    expect(screen.queryByTestId('bulk-create-error')).toBeNull(); expect(textarea.value).toBe('https://example.com/valid')
  })
})
