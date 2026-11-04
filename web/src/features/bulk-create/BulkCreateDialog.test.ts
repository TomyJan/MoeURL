import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const clients: QueryClient[] = []
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
