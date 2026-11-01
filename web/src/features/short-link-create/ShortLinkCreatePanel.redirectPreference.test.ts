import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { enhanced, globalId, otherId, mountRedirectDefaults, redirectResponse } from '@/test/domain-redirect-default'
import { onlineManager } from '@tanstack/vue-query'
import { nextTick } from 'vue'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

let view: ReturnType<typeof mountRedirectDefaults> | undefined
afterEach(() => { cleanup(); onlineManager.setOnline(true); view?.client.clear(); vi.unstubAllGlobals() })

const saved = (redirectMode: string | null) => redirectResponse({ preference: { redirectMode, updatedAt: '2026-11-02T00:00:00.123456Z' } })
async function loaded() { await waitFor(() => expect(view!.client.isFetching()).toBe(0)) }
async function submit() {
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/personal')
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
}

// Retaining domain-only defaults would submit intermediate instead of the owner's confirmation preference.
it('DefaultPriority submits the personal confirmation mode ahead of the actual domain intermediate default', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: {
    '/api/v1/user/redirect-preference': async () => redirectResponse({ preference: { redirectMode: 'confirmation', updatedAt: '2026-11-02T00:00:00.123456Z' } }),
    '/api/v1/domain/redirect-defaults': async () => redirectResponse({ items: [{ domainId: globalId, redirectMode: 'intermediate' }] }),
  } })
  await waitFor(() => expect(view!.client.isFetching()).toBe(0))
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/personal')
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
  await waitFor(() => expect(view!.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/personal', redirectMode: 'confirmation' })
})

it.each(['direct', 'intermediate', 'confirmation'])('uses an authorized personal %s despite domain-default read failure', async mode => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: {
    '/api/v1/user/redirect-preference': async () => saved(mode),
    '/api/v1/domain/redirect-defaults': async () => { throw new Error('domain offline') },
  } })
  await loaded(); await submit()
  await waitFor(() => expect(view!.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/personal', redirectMode: mode, ...mode === 'intermediate' ? { intermediateDelaySeconds: 5 } : {} })
})
it.each([null, 'confirmation'])('falls back from personal %s to the actual authorized domain default', async mode => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { permissions: enhanced.filter(value => value !== 'short_link:use_confirmation'), overrides: {
    '/api/v1/user/redirect-preference': async () => saved(mode),
    '/api/v1/domain/redirect-defaults': async () => redirectResponse({ items: [{ domainId: globalId, redirectMode: 'intermediate' }] }),
  } })
  await loaded(); await submit()
  await waitFor(() => expect(view!.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toMatchObject({ redirectMode: 'intermediate', intermediateDelaySeconds: 5 })
})
it.each([true, false])('blocks an unknown personal mode and allows an explicit manual override, failure=%s', async failure => {
  const pending = createDeferred<Response>()
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: {
    '/api/v1/user/redirect-preference': () => failure ? Promise.reject(new Error('personal offline')) : pending.promise,
  } })
  await waitFor(() => expect(view!.state.requests).toContain('/api/v1/user/redirect-preference'))
  if (failure) await loaded()
  expect(screen.getByRole('button', { name: 'Create short link' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  if (!failure) { pending.resolve(saved('confirmation')); await loaded() }
  await submit()
  await waitFor(() => expect(view!.state.writes[0]?.redirectMode).toBe('direct'))
})
it('keeps the bound draft after a personal background update, and explicitly reloads it', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/user/redirect-preference': async () => saved('confirmation') } })
  await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
  view.state.overrides['/api/v1/user/redirect-preference'] = async () => saved('intermediate')
  await view.client.refetchQueries({ queryKey: ['user', 'redirect-preference'] })
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.click(screen.getByRole('button', { name: 'Use saved default' }))
  await loaded(); await submit()
  await waitFor(() => expect(view!.state.writes[0]).toMatchObject({ redirectMode: 'intermediate', intermediateDelaySeconds: 5 }))
})
it('recomputes an automatic personal fallback for the actual selected domain', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel)
  await loaded()
  await fireEvent.keyDown(screen.getByRole('combobox', { name: 'Short-link domain' }), { key: 'Enter' })
  await fireEvent.click(await screen.findByRole('option', { name: 'Other (other.example)' }))
  await submit()
  await waitFor(() => expect(view!.state.writes[0]).toMatchObject({ domainId: otherId, redirectMode: 'intermediate', intermediateDelaySeconds: 5 }))
})
it('rereads personal defaults after creation and again on an explicit reset', async () => {
  let mode = 'direct'
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: {
    '/api/v1/user/redirect-preference': async () => saved(mode),
    '/api/v1/short-link/create': async () => {
      mode = 'intermediate'
      return redirectResponse({ shortLink: { id: 'aaaaaaaa-1111-4111-8111-111111111111', url: 'https://global.example/new', slug: 'new', targetUrl: 'https://target.example/personal', title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' } })
    },
  } })
  await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
  await submit()
  await waitFor(() => expect(view!.state.requests.filter(path => path === '/api/v1/user/redirect-preference')).toHaveLength(2))
  await loaded()
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  mode = 'confirmation'
  await fireEvent.click(screen.getByRole('button', { name: 'Create another' }))
  await waitFor(() => expect(view!.state.requests.filter(path => path === '/api/v1/user/redirect-preference')).toHaveLength(3))
  await loaded()
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
})
it.each(['identity', 'same-login', 'unmount', 'permissions', 'auth-removed'] as const)('guards the actual creation send after an offline %s transition', async change => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { overrides: { '/api/v1/user/redirect-preference': async () => saved('confirmation') } })
  await loaded()
  onlineManager.setOnline(false)
  await submit()
  await waitFor(() => expect(view!.client.getMutationCache().getAll().some(mutation => mutation.state.isPaused)).toBe(true))
  if (change === 'unmount') view.unmount()
  else if (change === 'auth-removed') view.client.removeQueries({ queryKey: ['auth', 'me'] })
  else {
    if (change === 'same-login') revokeAccountIdentity(view.client)
    view.state.user = { ...view.state.user, ...change === 'identity' ? { id: 'B', username: 'bob' } : {}, ...change === 'permissions' ? { permissions: ['short_link:create', 'domain:use_default'] } : {} }
    view.client.setQueryData(['auth', 'me'], { user: view.state.user })
  }
  await nextTick()
  onlineManager.setOnline(true)
  await view.client.resumePausedMutations()
  await waitFor(() => expect(view!.client.getMutationCache().getAll().every(mutation => mutation.state.status !== 'pending')).toBe(true))
  expect(view.state.writes).toEqual([])
})
