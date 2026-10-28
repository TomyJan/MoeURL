import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { setImmediate as eventLoop } from 'node:timers/promises'
import { useUserBatchGroupChange } from './useUserBatchGroupChange'
import { batchAlice, batchBob, batchManager, membershipResponse, mountBatchMembership } from '@/test/user-batch-group'
import { listUsers } from '@/entities/user/api'
import { createDeferred } from '@/test/deferred'

let view: ReturnType<typeof mountBatchMembership>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

/** Models callbacks already queued by the UI before controls become disabled, using the public composable boundary. */
function queuedControls(count = 2) {
  return defineComponent({
    setup() {
      const users = ref(count === 2 ? [batchAlice, batchBob] : Array.from({ length: count }, (_, i) => ({ ...batchAlice, id: String(i), username: 'account-' + i })))
      const blocked = ref(false)
      const allowed = ref(true)
      const batch = useUserBatchGroupChange({ users, allowed, blocked, onSelect: () => {}, read: () => listUsers() })
      return { batch, users, blocked, allowed }
    },
    template: `<div>
      <output data-testid="selection">{{ batch.selected.value.join(',') }}</output>
      <output data-testid="snapshot">{{ batch.snapshot.value?.map(item => item.username).join(',') }}</output>
      <output data-testid="locked">{{ batch.pending.value || batch.barrier.value }}</output>
      <button @click="blocked = !blocked">Other write</button>
      <button @click="batch.toggle(users[0].id, true)">Select first</button>
      <button @click="batch.toggle(users[0].id, false)">Unselect first</button>
      <button @click="batch.toggle(users[users.length - 1].id, true)">Select last</button>
      <button @click="batch.toggle('missing', true)">Select stale row</button>
      <button @click="batch.toggleAll(true)">Select all</button><button @click="batch.toggleAll(false)">Unselect all</button>
      <button @click="batch.clear">Clear</button><button @click="batch.open">Open</button><button @click="batch.close">Close</button>
      <button @click="batch.submit('user')">No-op write</button><button @click="batch.submit('admin')">Write</button>
      <button @click="batch.reload">Read</button>
    </div>`,
  })
}

/** Delivers an already queued action, deliberately without a disabled presentation wrapper. */
async function queued(name: string) { await fireEvent.click(screen.getByRole('button', { name })) }

it('rejects stale, duplicate, empty, blocked and confirmation-locked queued actions without changing the original batch', async () => {
  view = mountBatchMembership({ component: queuedControls() })
  await queued('Open'); await queued('Write'); await queued('Select stale row')
  expect(screen.getByTestId('selection').textContent).toBe('')
  await queued('Other write'); await queued('Select first'); await queued('Select all'); await queued('Open'); await queued('Write')
  expect(screen.getByTestId('selection').textContent).toBe('')
  await queued('Other write'); await queued('Select first'); await queued('Select first'); await queued('Select last'); await queued('Unselect first')
  expect(screen.getByTestId('selection').textContent).toBe(batchBob.id)
  await queued('Unselect all'); await queued('Select first'); await queued('Select all'); await queued('Unselect first'); await queued('Open')
  expect(screen.getByTestId('snapshot').textContent).toBe('bob')
  await queued('Select first'); await queued('Select all'); await queued('Clear'); await queued('Open'); await queued('No-op write')
  expect(screen.getByTestId('snapshot').textContent).toBe('bob')
  expect(view.state.writes).toEqual([])
  await queued('Close'); await queued('Clear')
  expect(screen.getByTestId('selection').textContent).toBe('')
})

it('keeps the 100-account bound when a queued individual selection follows select-all', async () => {
  view = mountBatchMembership({ component: queuedControls(101) })
  await queued('Select all'); await queued('Select last')
  const selected = screen.getByTestId('selection').textContent!.split(',')
  expect(selected).toHaveLength(100)
  expect(selected).not.toContain('100')
})

it('keeps all confirmation actions locked while a real HTTP write is pending and ignores its unmounted result', async () => {
  const write = createDeferred<Response>()
  view = mountBatchMembership({ component: queuedControls(), overrides: { '/api/v1/admin/user/batch-change-group': () => write.promise } })
  await queued('Select all'); await queued('Open'); await queued('Write')
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  await queued('Write'); await queued('Clear'); await queued('Close'); await queued('Unselect first'); await queued('Select all')
  expect(screen.getByTestId('snapshot').textContent).toBe('alice,bob')
  expect(view.state.writes).toHaveLength(1)
  view.unmount()
  write.resolve(membershipResponse({ changedCount: 2, unchangedCount: 0 }))
  await eventLoop()
  expect(view.state.requests).toHaveLength(1)
})

it('does not release a new login’s barrier using a delayed prior-login list read', async () => {
  const read = createDeferred<Response>()
  const fresh = createDeferred<Response>()
  let calls = 0
  view = mountBatchMembership({ component: queuedControls(), overrides: { '/api/v1/admin/user/list?page=1&pageSize=20': () => ++calls === 1 ? read.promise : fresh.promise } })
  await queued('Read')
  view.client.setQueryData(['auth', 'me'], { user: { ...batchManager, id: batchBob.id } })
  await queued('Read')
  read.resolve(membershipResponse({ items: [batchAlice] }, 0, 200, { total: 1 }))
  await eventLoop()
  expect(screen.getByTestId('locked').textContent).toBe('true')
  fresh.resolve(membershipResponse({ items: [batchAlice] }, 0, 200, { total: 1 }))
  await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('false'))
  // Both reads are HTTP observations; only the current one can release its own barrier.
  expect(view.state.requests).toHaveLength(2)
})
