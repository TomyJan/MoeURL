import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import AdminDomainsPage from './AdminDomainsPage.vue'
import { messages } from '@/app/i18n'
import { globalId, mountRedirectDefaults, nextRevision, revision } from '@/test/domain-redirect-default'

let view: ReturnType<typeof mountRedirectDefaults>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })
/** Waits for all reads instead of depending on a fixed UI delay. */
async function loaded() { await waitFor(() => expect(view.client.isFetching()).toBe(0)) }
/** Finds the existing details form independently of the new mode form. */
function details() { return within(screen.getByRole('textbox', { name: messages.en.domains.host }).closest('form')!) }

it('discards the mode draft when reselecting the same domain without losing editor interlocks', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  expect(screen.getByRole('textbox', { name: messages.en.domains.displayName })).toHaveProperty('disabled', true)
  await fireEvent.click(within(screen.getByRole('complementary', { name: messages.en.domains.listLabel })).getByText('Global'))
  await screen.findByText(messages.en.domains.discardWarning)
  await fireEvent.click(screen.getByRole('button', { name: messages.en.domains.confirmDiscard }))
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('textbox', { name: messages.en.domains.displayName })).toHaveProperty('disabled', false)
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  expect(screen.getByRole('textbox', { name: messages.en.domains.displayName })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: messages.en.domainOrder.save })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ id: globalId, redirectMode: 'direct', expectedUpdatedAt: revision })
})

it('saves only mode and exact shared version, then renews legacy details from the new revision', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('textbox', { name: messages.en.domains.host })
  await screen.findByRole('heading', { name: 'Default redirect mode' })
  await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: messages.en.domainOrder.save })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writePaths[0]).toBe('/api/v1/admin/domain/set-redirect-default')
  expect(view.state.writes[0]).toEqual({ id: globalId, redirectMode: 'intermediate', expectedUpdatedAt: revision })
  await loaded()
  await waitFor(() => expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', false))
  await fireEvent.update(screen.getByRole('textbox', { name: messages.en.domains.displayName }), 'Updated global')
  await fireEvent.click(details().getByRole('button', { name: messages.en.domains.save }))
  await waitFor(() => expect(view.state.writes).toHaveLength(2))
  expect(view.state.writes[1]).toMatchObject({ id: globalId, expectedUpdatedAt: nextRevision, displayName: 'Updated global' })
  expect(view.state.writes[1]).not.toHaveProperty('redirectMode')
})

it('keeps three drafts mutually exclusive and confirms discarding a mode draft on domain switch', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' })
  await loaded()
  await fireEvent.update(screen.getByRole('textbox', { name: messages.en.domains.displayName }), 'Unsaved details')
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  await fireEvent.update(screen.getByRole('textbox', { name: messages.en.domains.displayName }), 'Global')
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByText('Other'))
  await screen.findByText(messages.en.domains.discardWarning)
  expect(screen.getByRole('textbox', { name: messages.en.domains.host })).toHaveProperty('value', 'global.example')
  await fireEvent.click(screen.getByRole('button', { name: messages.en.domains.confirmDiscard }))
  await loaded()
  expect(screen.getByRole('textbox', { name: messages.en.domains.host })).toHaveProperty('value', 'other.example')
  expect(view.state.writes).toHaveLength(0)
})
