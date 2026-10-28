import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { batchAlice, batchBob, batchManager, confirmBatchMembership, mountBatchMembership, openBatchMembership } from '@/test/user-batch-group'
import UserBatchGroupChangeDialog from './UserBatchGroupChangeDialog.vue'
import { componentStubs } from '@/test/component-stubs'
import { createI18n } from 'vue-i18n'
import { messages } from '@/app/i18n'

let view: ReturnType<typeof mountBatchMembership>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

it('requires an explicit destination, recomputes mixed counts, and clears confirmation when the destination changes', async () => {
  view = mountBatchMembership({ users: [batchAlice, { ...batchBob, group: 'admin' }] })
  const dialog = await openBatchMembership()
  expect(dialog.getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', true)
  await confirmBatchMembership()
  expect(dialog.getByText('1 will change; 1 will remain unchanged.')).toBeTruthy()
  expect(dialog.getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', false)
  await fireEvent.keyDown(dialog.getByRole('combobox', { name: 'Target group' }), { key: 'Enter' })
  await fireEvent.click(await screen.findByRole('option', { name: 'User' }))
  expect(dialog.getByRole('checkbox', { name: 'I confirm the group changes' })).toHaveProperty('checked', false)
  expect(dialog.getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', true)
  expect(dialog.getByText('Switching to User removes this account’s administrative privileges.')).toBeTruthy()
  await fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Change selected groups' }))
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('checkbox', { name: 'I confirm the group changes' })).toHaveProperty('checked', false)
})

it('refuses an all-no-op confirmation and keeps the selection on ordinary cancellation', async () => {
  view = mountBatchMembership()
  await openBatchMembership()
  await confirmBatchMembership('user')
  expect(screen.getByText('0 will change; 2 will remain unchanged.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(view.state.writes).toEqual([])
  expect(screen.getByText('2 accounts selected')).toBeTruthy()
})

it('limits selection to current eligible accounts, maintains indeterminate state, and preserves same-login nickname drafts', async () => {
  view = mountBatchMembership({ users: [batchAlice, { ...batchBob, status: 'disabled' }, { ...batchAlice, ...batchManager, builtin: false, status: 'active' }, { ...batchAlice, id: 'builtin', username: 'guest', builtin: true }, { ...batchAlice, id: 'future', username: 'future', group: 'custom' }] })
  await screen.findByText('alice')
  expect(screen.queryByRole('checkbox', { name: 'Select account manager' })).toBeNull()
  expect(screen.queryByRole('checkbox', { name: 'Select account guest' })).toBeNull()
  expect(screen.queryByRole('checkbox', { name: 'Select account future' })).toBeNull()
  await fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
  await fireEvent.update(screen.getByRole('textbox', { name: 'Nickname' }), 'My draft')
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select account alice' }))
  expect(screen.queryByRole('textbox', { name: 'Nickname' })).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Select eligible accounts in this list' })).toHaveProperty('indeterminate', true)
  expect(screen.getAllByRole('button', { name: 'More actions' })[0]).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select account bob' }))
  expect(screen.getByRole('checkbox', { name: 'Select eligible accounts in this list' })).toHaveProperty('checked', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  await fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveProperty('value', 'My draft')
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select account bob' }))
  view.state.users = [batchAlice]
  await view.client.invalidateQueries({ queryKey: ['admin-user'] })
  await waitFor(() => expect(screen.queryByText('1 accounts selected')).toBeNull())
})

it('rejects a queued cancellation and submission after the parent marks the request pending', async () => {
  // The presentation-only button double deliberately delivers a previously queued click even when disabled.
  const dialog = render(UserBatchGroupChangeDialog, { props: { snapshot: [batchAlice], pending: false }, global: { stubs: componentStubs, plugins: [createI18n({ legacy: false, locale: 'en', messages })] } })
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  expect(dialog.emitted().submit).toBeUndefined()
  await dialog.rerender({ snapshot: [batchAlice], pending: true })
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(dialog.emitted().close).toBeUndefined()
})
