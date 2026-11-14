import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import { downloadCsv } from '@/shared/download/csv'
import { parseBulkCreateImportCsv } from '@/entities/short-link/bulk-create-csv'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000007683', username: 'cap-ui', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits'] } })
  return render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('seven-column visit-limit dialog', () => {
  it('shows literal visit limits and unlimited values in both previews without rendering markup', async () => {
    const view = mount(); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    const text = 'target_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits\nhttps://example.com/one,<b>literal</b>,"[""<img src=x>""]",Team76,intermediate,2099-01-01T00:00:00Z,1\nhttps://example.com/max,,[],Max76,confirmation,,2147483647\nhttps://example.com/unlimited,,[],,,,'
    const file = new File([text], 'limits.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
    const input = view.container.querySelector('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').children).toHaveLength(3))
    const check = (testId: string) => {
      const list = screen.getByTestId(testId), caps = list.querySelectorAll('.bulk-create-item-limit')
      expect(caps).toHaveLength(3)
      expect(caps[0]!.textContent).toContain('bulkCreate.itemVisitLimit 1')
      expect(caps[1]!.textContent).toContain('2147483647'); expect(caps[2]!.textContent).toContain('bulkCreate.unlimitedVisits')
      expect(list.textContent).toContain('<b>literal</b>'); expect(list.textContent).toContain('<img src=x>')
      expect(view.container.querySelector('b,img')).toBeNull(); expect(screen.getByText('bulkCreate.modeDelay')).toBeTruthy()
    }
    check('bulk-create-imported-list'); await fireEvent.click(screen.getByTestId('bulk-create-preview')); check('bulk-create-preview-list')
  })
  it('downloads an importable seventh template without changing the manual draft', async () => {
    mount(); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/kept76')
    await fireEvent.click(screen.getByRole('button', { name: 'bulkCreate.csvVisitLimitsDownload' }))
    const template = vi.mocked(downloadCsv).mock.calls[0]![0]
    expect(template.fileName).toBe('moeurl-visit-limits-template.csv'); expect(template.contentType).toBe('text/csv;charset=utf-8')
    const parsed = parseBulkCreateImportCsv(template.content)
    if (!parsed.success || parsed.mode !== 'visit-limits') throw new Error('Seventh template is not importable')
    expect(parsed.data.map(item => item.maxVisits)).toEqual(['1', '', '2147483647'])
    expect(screen.getByTestId('bulk-create-csv-visit-limits-example').textContent).toContain('expires_at,max_visits')
    expect(screen.getByText('bulkCreate.csvVisitLimitsRules')).toBeTruthy()
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/kept76')
    expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull()
  })
})
