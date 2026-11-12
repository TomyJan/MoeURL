import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { componentStubs } from '@/test/component-stubs'
import ConsoleOverviewPage from './ConsoleOverviewPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
let client: QueryClient
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals() })

// A real page and fetch boundary catch leaving the quota snapshot out of the
// overview while its two original data regions still load independently.
it('shows the current creator usage beside independent overview data', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
  client.setQueryData(['auth', 'me'], { user: { id: '55ac4abf-b6fe-4e7d-ae50-aa2965fe276e', username: 'creator', nickname: 'Creator', group: 'user', permissions: ['short_link:create', 'short_link:read_own'] } })
  vi.stubGlobal('fetch', async (path: string) => {
    const data = path.endsWith('/account/daily-create-usage')
      ? { usageDay: '2026-11-12', used: '7', dailyLimit: 10, remaining: 3 }
      : path.endsWith('/short-link/overview')
        ? { totalLinkCount: 12, activeLinkCount: 9, visitCount: 840, todayVisitCount: 31 }
        : { items: [] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
  render(ConsoleOverviewPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  await waitFor(() => expect(screen.getByText('840')).toBeTruthy())
  expect(screen.getByTestId('overview-empty')).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'ownDailyCreateUsage.heading' })).toBeTruthy())
  await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
  expect(screen.getByText('3')).toBeTruthy()
})

it('keeps overview and recent links usable while usage fails and retries locally', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['auth', 'me'], { user: { id: '55ac4abf-b6fe-4e7d-ae50-aa2965fe276e', username: 'creator', nickname: 'Creator', group: 'user', permissions: ['short_link:create', 'short_link:read_own'] } })
  let unavailable = true
  vi.stubGlobal('fetch', async (path: string) => {
    if (path.endsWith('/account/daily-create-usage') && unavailable) throw Error('offline')
    const data = path.endsWith('/account/daily-create-usage')
      ? { usageDay: '2026-11-12', used: '7', dailyLimit: 10, remaining: 3 }
      : path.endsWith('/short-link/overview')
        ? { totalLinkCount: 12, activeLinkCount: 9, visitCount: 840, todayVisitCount: 31 }
        : { items: [] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
  render(ConsoleOverviewPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  await waitFor(() => expect(screen.getByTestId('own-usage-error')).toBeTruthy())
  expect(screen.getByText('840')).toBeTruthy()
  expect(screen.getByTestId('overview-empty')).toBeTruthy()
  unavailable = false
  screen.getByRole('button', { name: 'ownDailyCreateUsage.retry' }).click()
  await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
  expect(screen.getByText('840')).toBeTruthy()
})
