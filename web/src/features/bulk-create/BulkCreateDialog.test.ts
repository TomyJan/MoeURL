import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const clients: QueryClient[] = []

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
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
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
