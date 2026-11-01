import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { setImmediate as eventLoop } from 'node:timers/promises'
import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { domainChoices, enhanced, globalId, otherId, mountRedirectDefaults, redirectResponse } from '@/test/domain-redirect-default'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

let view: ReturnType<typeof mountRedirectDefaults>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

/** Completes current HTTP reads without a timing-based sleep. */
async function loaded() { await waitFor(() => expect(view.client.isFetching()).toBe(0)) }
/** Uses the real mode buttons rather than component internals. */
async function advanced() { await fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' })) }
/** Selects a domain through the keyboard-accessible real Vuetify popup. */
async function chooseOther() {
  await fireEvent.keyDown(screen.getByRole('combobox', { name: 'Short-link domain' }), { key: 'Enter' })
  await fireEvent.click(await screen.findByRole('option', { name: 'Other (other.example)' }))
}
/** Observes creation only at the real HTTP payload boundary. */
async function submit() {
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/docs')
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
}

it('refreshes real HTTP authorization after a 120001 denial and requires mode reconfirmation without replay', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/short-link/create': async () => redirectResponse(null, 120001) } })
  await loaded(); await advanced()
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  view.state.user = { ...view.state.user, permissions: ['short_link:create', 'domain:use_default', 'domain:use_assigned'] }
  const previousAuthReads = view.state.requests.filter((path) => path === '/api/v1/auth/me').length
  await submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  await waitFor(() => expect(view.state.requests.filter((path) => path === '/api/v1/auth/me')).toHaveLength(previousAuthReads + 1))
  await screen.findByText('Redirect permissions changed. The unavailable mode was cleared; confirm a mode for this link.')
  expect(screen.queryByRole('button', { name: 'Confirmation page' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Enter link' })).toHaveProperty('value', 'https://target.example/docs')
  expect(screen.getByRole('button', { name: 'Create short link' })).toHaveProperty('disabled', true)
  expect(view.state.writes).toHaveLength(1)
  await fireEvent.click(screen.getByRole('button', { name: 'Use direct redirect for this link' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(2))
  expect(view.state.writes[1]).toEqual({ targetUrl: 'https://target.example/docs' })
})

it.each(['direct', 'confirmation'])('keeps an explicit direct click over domain changes even when initially %s', async (initial) => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/redirect-defaults': async () => redirectResponse({ items: [{ domainId: globalId, redirectMode: initial }, { domainId: otherId, redirectMode: 'intermediate' }] }) } })
  await loaded(); await advanced()
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  await chooseOther()
  expect(screen.getByRole('button', { name: 'Direct redirect' }).getAttribute('aria-pressed')).toBe('true')
  await submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/docs', domainId: otherId, redirectMode: 'direct' })
})

it('treats a keyboard delay edit as manual and preserves seven seconds across domains', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/redirect-defaults': async () => redirectResponse({ items: [{ domainId: globalId, redirectMode: 'intermediate' }, { domainId: otherId, redirectMode: 'confirmation' }] }) } })
  await loaded(); await advanced()
  const slider = screen.getByRole('slider', { name: 'Intermediate delay (seconds)' })
  await fireEvent.keyDown(slider, { key: 'ArrowRight' })
  await fireEvent.keyDown(slider, { key: 'ArrowRight' })
  expect(slider.getAttribute('aria-valuenow')).toBe('7')
  await chooseOther()
  expect(screen.getByRole('slider', { name: 'Intermediate delay (seconds)' }).getAttribute('aria-valuenow')).toBe('7')
  await submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/docs', domainId: otherId, redirectMode: 'intermediate', intermediateDelaySeconds: 7 })
})

it('binds a late projection only to the currently selected actual domain', async () => {
  const pending = createDeferred<Response>()
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/redirect-defaults': () => pending.promise } })
  await screen.findByRole('combobox', { name: 'Short-link domain' })
  await advanced(); await chooseOther()
  expect(screen.getByRole('button', { name: 'Create short link' })).toHaveProperty('disabled', true)
  pending.resolve(redirectResponse({ items: [{ domainId: globalId, redirectMode: 'confirmation' }, { domainId: otherId, redirectMode: 'intermediate' }] }))
  await loaded()
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  await submit()
  await waitFor(() => expect(view.state.writes[0]?.domainId).toBe(otherId))
  expect(view.state.writes[0]?.redirectMode).toBe('intermediate')
})

it('preserves an explicit override over late initial defaults', async () => {
  const pending = createDeferred<Response>()
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/redirect-defaults': () => pending.promise } })
  await screen.findByRole('button', { name: 'Advanced settings' })
  await advanced()
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  pending.resolve(redirectResponse({ items: [{ domainId: globalId, redirectMode: 'confirmation' }] }))
  await loaded()
  expect(screen.getByRole('button', { name: 'Direct redirect' }).getAttribute('aria-pressed')).toBe('true')
  await submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]?.redirectMode).toBe('direct')
})

it('keeps a bound draft on background change until the creator explicitly adopts the new default', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel)
  await loaded(); await advanced()
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/preserved')
  view.state.defaults = [{ domainId: globalId, redirectMode: 'direct' }]
  await view.client.invalidateQueries({ queryKey: ['domain-redirect-defaults'] })
  await screen.findByText('A new default redirect mode is available. Your current draft is unchanged.')
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.click(screen.getByRole('button', { name: 'Use saved default' }))
  await loaded()
  expect(screen.getByRole('button', { name: 'Direct redirect' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('textbox', { name: 'Enter link' })).toHaveProperty('value', 'https://target.example/preserved')
})

it('clears a revoked mode and requires explicit recovery without replaying creation', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel)
  await loaded(); await advanced()
  view.state.user = { ...view.state.user, permissions: ['short_link:create', 'domain:use_default', 'domain:use_assigned'] }
  view.client.setQueryData(['auth', 'me'], { user: view.state.user })
  await screen.findByText('Redirect permissions changed. The unavailable mode was cleared; confirm a mode for this link.')
  await submit()
  expect(view.state.writes).toHaveLength(0)
  await fireEvent.click(screen.getByRole('button', { name: 'Use direct redirect for this link' }))
  await submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/docs' })
})

it.each(['other-account', 'same-account'])('ignores old default responses across a %s login transition', async (kind) => {
  const pending = createDeferred<Response>()
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/redirect-defaults': () => pending.promise } })
  await screen.findByRole('button', { name: 'Advanced settings' })
  await advanced()
  delete view.state.overrides['/api/v1/domain/redirect-defaults']
  view.state.defaults = [{ domainId: globalId, redirectMode: 'intermediate' }]
  if (kind === 'same-account') revokeAccountIdentity(view.client)
  else view.state.user = { ...view.state.user, id: 'B', username: 'bob' }
  view.client.setQueryData(['auth', 'me'], { user: view.state.user })
  await loaded()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true'))
  pending.resolve(redirectResponse({ items: [{ domainId: globalId, redirectMode: 'confirmation' }] }))
  await eventLoop()
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  await submit()
  await waitFor(() => expect(view.state.writes[0]?.redirectMode).toBe('intermediate'))
})

it('intersects a stale enhanced default with current auth capabilities again', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { permissions: enhanced.filter((permission) => permission !== 'short_link:use_confirmation') })
  await loaded(); await advanced()
  expect(screen.queryByRole('button', { name: 'Confirmation page' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Direct redirect' }).getAttribute('aria-pressed')).toBe('true')
  await submit()
  await waitFor(() => expect(view.state.writes[0]?.redirectMode).toBe('direct'))
})

it('blocks a missing current-domain entry and retries without inventing a default', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { domains: [domainChoices[0]!], overrides: { '/api/v1/domain/redirect-defaults': async () => redirectResponse({ items: [] }) } })
  await loaded()
  expect(screen.getByRole('button', { name: 'Create short link' })).toHaveProperty('disabled', true)
  delete view.state.overrides['/api/v1/domain/redirect-defaults']
  await fireEvent.click(screen.getByRole('button', { name: 'Retry default redirect mode' }))
  await loaded(); await advanced()
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
})
