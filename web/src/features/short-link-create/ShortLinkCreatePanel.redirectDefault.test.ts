import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { domainChoices, globalId, mountRedirectDefaults, redirectResponse } from '@/test/domain-redirect-default'
import { createDeferred } from '@/test/deferred'
import { nextTick } from 'vue'

let view: ReturnType<typeof mountRedirectDefaults>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

/** Waits for real initial reads; fixed sleeps cannot prove readiness. */
async function loaded() { await waitFor(() => expect(view.client.isFetching()).toBe(0)) }

// Catches retaining hardcoded direct for a global empty-string selection.
it('binds the actual global domain confirmation default and submits that explicit mode', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel)
  await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/docs')
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/docs', redirectMode: 'confirmation' })
})

// Catches silently submitting an invented direct value after a failed defaults read.
it('blocks an unknown single-domain default and offers explicit direct recovery', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { domains: [domainChoices[0]!], overrides: { '/api/v1/domain/redirect-defaults': async () => { throw new Error('offline') } } })
  await loaded()
  expect(screen.getByRole('button', { name: 'Create short link' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Use direct redirect for this link' }))
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/docs')
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/docs', redirectMode: 'direct' })
})

it('does not read meaningless defaults without enhanced capabilities and omits the mode', async () => {
  view = mountRedirectDefaults(ShortLinkCreatePanel, { permissions: ['short_link:create', 'domain:use_default'], domains: [domainChoices[0]!] })
  await loaded()
  expect(view.state.requests).not.toContain('/api/v1/domain/redirect-defaults')
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/docs')
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ targetUrl: 'https://target.example/docs' })
  await waitFor(() => expect(view.state.requests).toContain('/api/v1/auth/me'))
  await loaded()
  expect(view.state.requests).not.toContain('/api/v1/domain/redirect-defaults')
})

it('waits for a fresh default after success rather than rebinding the previous policy', async () => {
  const pending = createDeferred<Response>()
  view = mountRedirectDefaults(ShortLinkCreatePanel)
  await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
  view.state.overrides['/api/v1/short-link/create'] = async () => {
    view.state.overrides['/api/v1/domain/redirect-defaults'] = () => pending.promise
    return redirectResponse({ shortLink: { id: 'aaaaaaaa-1111-4111-8111-111111111111', url: 'https://global.example/new', slug: 'new', targetUrl: 'https://target.example/docs', title: '', tags: [], status: 'active', redirectMode: 'confirmation', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' } })
  }
  await fireEvent.update(screen.getByRole('textbox', { name: 'Enter link' }), 'https://target.example/docs')
  await fireEvent.click(screen.getByRole('button', { name: 'Create short link' }))
  await waitFor(() => expect(view.state.requests.filter((path) => path === '/api/v1/domain/redirect-defaults')).toHaveLength(2))
  await nextTick()
  expect(screen.getByRole('button', { name: 'Create short link' })).toHaveProperty('disabled', true)
  pending.resolve(redirectResponse({ items: [{ domainId: globalId, redirectMode: 'intermediate' }] }))
  await loaded()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true'))
  expect(screen.getByRole('slider', { name: 'Intermediate delay (seconds)' }).getAttribute('aria-valuenow')).toBe('5')
})
