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
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000007783', username: 'countdown-ui', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits'] } })
  return render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('eight-column countdown dialog', () => {
  it('shows three, ten and default five in both previews while treating metadata as text', async () => {
    const view = mount(); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    const text = 'target_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits,intermediate_delay_seconds\nhttps://example.com/three,<b>literal</b>,"[""<img src=x>""]",Team77,intermediate,,1,3\nhttps://example.com/ten,,[],,intermediate,,,10\nhttps://example.com/default,,[],,intermediate,,,'
    const file = new File([text], 'countdowns.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
    const input = view.container.querySelector('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').children).toHaveLength(3))
    const check = (testId: string) => {
      const list = screen.getByTestId(testId), delays = list.querySelectorAll('.bulk-create-item-countdown')
      expect(Array.from(delays, element => element.textContent)).toEqual(['bulkCreate.itemCountdown 3', 'bulkCreate.itemCountdown 10', 'bulkCreate.itemCountdown 5'])
      expect(list.textContent).toContain('<b>literal</b>'); expect(list.textContent).toContain('<img src=x>')
      expect(view.container.querySelector('b,img')).toBeNull(); expect(screen.queryByText('bulkCreate.modeDelay')).toBeNull()
    }
    check('bulk-create-imported-list'); await fireEvent.click(screen.getByTestId('bulk-create-preview')); check('bulk-create-preview-list')
  })
  it('downloads a three/ten/default template without replacing the manual draft', async () => {
    mount(); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/kept77')
    await fireEvent.click(screen.getByRole('button', { name: 'bulkCreate.csvCountdownsDownload' }))
    const template = vi.mocked(downloadCsv).mock.calls[0]![0]
    expect(template.fileName).toBe('moeurl-countdowns-template.csv'); expect(template.contentType).toBe('text/csv;charset=utf-8')
    const parsed = parseBulkCreateImportCsv(template.content)
    if (!parsed.success || parsed.mode !== 'countdowns') throw new Error('Eighth template is not importable')
    expect(parsed.data.map(item => item.intermediateDelaySeconds)).toEqual(['3', '10', ''])
    expect(screen.getByTestId('bulk-create-csv-countdowns-example').textContent).toContain('max_visits,intermediate_delay_seconds')
    expect(screen.getByText('bulkCreate.csvCountdownsRules')).toBeTruthy()
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/kept77')
    expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull()
  })
})
