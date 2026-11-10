import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const clients: QueryClient[] = []

it('shows the chosen normalized code or random intent in the imported draft and frozen preview', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000003881', username: 'creator', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug'] } })
  const view = render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  const text = 'target_url,title,tags,custom_slug\nhttps://example.com,<b>literal</b>,[],TeamDocs56\nhttps://example.org,,[],'
  const file = new File([text], 'custom-codes.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  await fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('teamdocs56'))
  expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('bulkCreate.randomSlug')
  expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('<b>literal</b>')
  expect(view.container.querySelector('b')).toBeNull()
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('teamdocs56')
  expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('bulkCreate.randomSlug')
})

it('offers an actual fourth public template download without changing the current input', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000003881', username: 'creator', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default'] } })
  render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  const create = vi.fn(() => 'blob:public-custom-template')
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: vi.fn() }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  await fireEvent.click(screen.getByRole('button', { name: 'bulkCreate.csvCustomSlugsDownload' }))
  expect(create).toHaveBeenCalledTimes(1)
  expect(click).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('bulk-create-csv-custom-slugs-example').textContent).toContain('target_url,title,tags,custom_slug')
  expect((screen.getByLabelText('bulkCreate.targets') as HTMLTextAreaElement).value).toBe('')
  expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull()
  click.mockRestore()
})

it('renders raw metadata tags as text in both import and preview, including explicit empty tags', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000003881', username: 'creator', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] } })
  const view = render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  const tags = [' <b>literal</b> ', '工具,a'], cell = JSON.stringify(tags).replaceAll('"', '""')
  const text = 'target_url,title,tags\nhttps://example.com,title,"' + cell + '"\nhttps://example.org,,[]'
  const file = new File([text], 'metadata.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  await fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain(tags[0]))
  for (const tag of tags) expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain(tag)
  expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('bulkCreate.emptyTags')
  expect(view.container.querySelector('b')).toBeNull()
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  for (const tag of tags) expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain(tag)
  expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('bulkCreate.emptyTags')
  expect(view.container.querySelector('b')).toBeNull()
})

it('shows literal imported titles in the draft and preview and explicitly clears them for manual input', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000003881', username: 'creator', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] } })
  const view = render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  const text = 'target_url,title\nhttps://example.com,"<img src=x onerror=alert(1)>"\nhttps://example.org,'
  const file = new File([text], 'titles.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  await fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('<img src=x onerror=alert(1)>'))
  expect(view.container.querySelector('textarea')).toBeNull()
  expect(view.container.querySelector('img')).toBeNull()
  expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('bulkCreate.emptyTitle')
  await fireEvent.click(screen.getByTestId('bulk-create-preview'))
  expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('<img src=x onerror=alert(1)>')
  expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('bulkCreate.emptyTitle')
  await fireEvent.click(screen.getByTestId('bulk-create-edit'))
  await fireEvent.click(screen.getByTestId('bulk-create-clear-import'))
  expect(view.container.querySelector('textarea')!.value).toBe('')
  expect(screen.queryByTestId('bulk-create-imported-list')).toBeNull()
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('rechecks a live parent operation lock before a queued creation click can open its draft', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000003881', username: 'creator', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default'] } })
  let allowed = true
  const view = render(BulkCreateDialog, { props: { canOpen: () => allowed }, global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  allowed = false
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  expect(screen.queryByTestId('bulk-create-dialog')).toBeNull()
  allowed = true; await view.rerender({ canOpen: () => allowed })
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  expect(screen.getByTestId('bulk-create-dialog')).toBeTruthy()
})
