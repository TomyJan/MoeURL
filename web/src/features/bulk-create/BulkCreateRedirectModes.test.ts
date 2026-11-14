import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import { parseBulkCreateImportCsv } from '@/entities/short-link/bulk-create-csv'
import { bulkCreateRedirectModesCsvTemplate } from './csvTemplate'
import BulkCreateDialog from './BulkCreateDialog.vue'
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const clients: QueryClient[] = []
function mount(permissions = ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000007482', username: 'creator', nickname: '', group: 'user', permissions } })
  return render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('five-column redirect-mode import dialog', () => {
  it('renders all modes, literal metadata and empty direct in both draft and frozen preview', async () => {
    const view = mount()
    await fireEvent.click(screen.getByTestId('bulk-create-open'))
    const text = 'target_url,title,tags,custom_slug,redirect_mode\n'
      + 'https://example.com/a,<b>literal</b>,"[""<img src=x>""]",Team74,direct\n'
      + 'https://example.com/b,,[],,intermediate\nhttps://example.com/c,,[],Confirm74,confirmation\nhttps://example.com/d,,[],,'
    const file = new File([text], 'modes.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
    const input = view.container.querySelector('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').children).toHaveLength(4))
    function check(testId: string) {
      const list = screen.getByTestId(testId)
      expect(list.textContent).toContain('team74'); expect(list.textContent).toContain('confirm74')
      expect(list.textContent).toContain('<b>literal</b>'); expect(list.textContent).toContain('<img src=x>')
      expect(list.textContent).toContain('bulkCreate.modes.intermediate'); expect(list.textContent).toContain('bulkCreate.modes.confirmation')
      expect(list.children[0]!.textContent).toContain('bulkCreate.modes.direct')
      expect(list.children[3]!.textContent).toContain('bulkCreate.modes.direct')
      expect(view.container.querySelector('b,img')).toBeNull()
      expect(screen.getByText('bulkCreate.modeDelay')).toBeTruthy()
    }
    check('bulk-create-imported-list')
    await fireEvent.click(screen.getByTestId('bulk-create-preview'))
    check('bulk-create-preview-list')
    await fireEvent.click(screen.getByTestId('bulk-create-edit'))
    await fireEvent.click(screen.getByTestId('bulk-create-clear-import'))
    expect(screen.queryByText('bulkCreate.modeDelay')).toBeNull()
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('')
  })
  it('downloads the real fifth template without changing the current draft', async () => {
    mount(['short_link:create', 'domain:use_default'])
    const create = vi.fn(() => 'blob:public-modes-template')
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(screen.getByLabelText('bulkCreate.targets'), 'https://example.com/kept')
    await fireEvent.click(screen.getByRole('button', { name: 'bulkCreate.csvRedirectModesDownload' }))
    expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('bulk-create-csv-redirect-modes-example').textContent).toContain('target_url,title,tags,custom_slug,redirect_mode')
    expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('https://example.com/kept')
    expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull()
    const parsed = parseBulkCreateImportCsv(bulkCreateRedirectModesCsvTemplate.content)
    expect(parsed.success).toBe(true)
    if (!parsed.success || parsed.mode !== 'redirect-modes') throw new Error('Fifth template failed import')
    expect(parsed.data.map(item => item.redirectMode)).toEqual(['direct', 'intermediate', 'confirmation', ''])
    expect(bulkCreateRedirectModesCsvTemplate.fileName).toBe('moeurl-redirect-modes-template.csv')
  })
})
