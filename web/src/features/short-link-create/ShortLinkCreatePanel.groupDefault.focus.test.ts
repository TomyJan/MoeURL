import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { focusManager, QueryClient } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { queryClient as productionClient } from '@/app/query'
import { domains, groupId, mountGroupDefault, personalId } from '@/test/group-default'
import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let view: ReturnType<typeof mountGroupDefault>

afterEach(() => { cleanup(); view.client.clear(); focusManager.setFocused(undefined); vi.unstubAllGlobals() })

/** Keeps the production focus policy rather than the isolated fixture's permissive defaults. */
function mount(personal: string | null = null, initialDomains = domains) {
  focusManager.setFocused(false)
  const client = new QueryClient({ defaultOptions: productionClient.getDefaultOptions() })
  view = mountGroupDefault(ShortLinkCreatePanel, { client, personal, domains: initialDomains })
}

/** Observes selection through the real parent and submits its actual HTTP request. */
async function createOn(expected: string, expectedPayload: Record<string, string>) {
  await waitFor(() => expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', expected))
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/focus')
  await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.submit' }))
  await waitFor(() => expect(view.writes).toHaveLength(1))
  expect(view.writes[0]?.input).toEqual(expectedPayload)
}

it('refreshes both the group default and newly granted candidates on focus before creating', async () => {
  mount(null, [domains[0]!, domains[1]!])
  await waitFor(() => expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', groupId))
  view.state.domains = [...domains]
  view.state.selection = { domainId: personalId, status: 'available' }
  focusManager.setFocused(true)
  await createOn(personalId, { targetUrl: 'https://target.example/focus', domainId: personalId })
})

it.each(['personal', 'manual'])('preserves a valid %s choice when focus refreshes a changed group default', async (priority) => {
  mount(priority === 'personal' ? personalId : null)
  const select = await screen.findByLabelText('shortLinkCreate.domainLabel')
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  if (priority === 'manual') await fireEvent.update(select, personalId)
  view.state.selection = { domainId: domains[0]!.id, status: 'available' }
  focusManager.setFocused(true)
  await waitFor(() => expect(view.client.getQueriesData({ queryKey: ['group-default-domain'] })[0]?.[1]).toEqual({ domainId: domains[0]!.id, status: 'available' }))
  await createOn(personalId, { targetUrl: 'https://target.example/focus', domainId: personalId })
})

it('refreshes the selected domain role on focus and omits its now-global UUID', async () => {
  mount()
  await waitFor(() => expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', groupId))
  view.state.domains = domains.map((domain) => ({ ...domain, isDefault: domain.id === groupId }))
  focusManager.setFocused(true)
  await createOn('', { targetUrl: 'https://target.example/focus' })
})
