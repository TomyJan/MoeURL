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
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000007583', username: 'expiry-ui', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:set_expiration'] } })
  return render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })
describe('six-column expiration import dialog', () => {
  it('shows literal UTC and empty expiry in imported and frozen previews without markup', async () => {
    const view = mount(); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    const text = 'target_url,title,tags,custom_slug,redirect_mode,expires_at\nhttps://example.com/expiry-ui,<b>literal</b>,"[""<img src=x>""]",Team75,intermediate,2030-01-01T01:02:03Z\nhttps://example.com/no-expiry,,[],,,'
    const file = new File([text], 'expiry-ui.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
    const input = view.container.querySelector('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').children).toHaveLength(2))
    const check = (testId: string) => {
      const list = screen.getByTestId(testId), expirations = list.querySelectorAll('.bulk-create-item-expiration')
      expect(expirations).toHaveLength(2); expect(expirations[0]!.textContent).toContain('2030-01-01T01:02:03Z'); expect(expirations[1]!.textContent).toContain('bulkCreate.noExpiration')
      expect(list.textContent).toContain('<b>literal</b>'); expect(list.textContent).toContain('<img src=x>'); expect(view.container.querySelector('b,img')).toBeNull()
      expect(screen.getByText('bulkCreate.modeDelay')).toBeTruthy()
    }
    check('bulk-create-imported-list'); await fireEvent.click(screen.getByTestId('bulk-create-preview')); check('bulk-create-preview-list')
  })

  it('downloads the real sixth template while preserving a manual draft', async () => {
    mount(); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/kept75')
    await fireEvent.click(screen.getByRole('button', { name: 'bulkCreate.csvExpirationsDownload' }))
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const template = vi.mocked(downloadCsv).mock.calls[0]![0]
    expect(template.fileName).toBe('moeurl-expirations-template.csv'); expect(template.contentType).toBe('text/csv;charset=utf-8')
    const parsed = parseBulkCreateImportCsv(template.content)
    expect(parsed.success).toBe(true)
    if (!parsed.success || parsed.mode !== 'expirations') throw new Error('Sixth template failed import')
    expect(parsed.data.map(item => item.redirectMode)).toEqual(['direct', 'intermediate', 'confirmation', ''])
    expect(parsed.data.map(item => item.expiresAt)).toEqual(['2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '', ''])
    expect(screen.getByTestId('bulk-create-csv-expirations-example').textContent).toContain('redirect_mode,expires_at')
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/kept75')
    expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull()
    expect(screen.getByText('bulkCreate.csvExpirationsRules')).toBeTruthy()
  })
})
