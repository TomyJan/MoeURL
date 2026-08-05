import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import ShortLinkSettingsDialog from './ShortLinkSettingsDialog.vue'
import type { ShortLink } from '@/entities/short-link/model'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  queryResult: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/entities/auth/api', () => ({
  me: vi.fn(),
}))

vi.mock('@tanstack/vue-query', () => ({
  useQuery: vi.fn(() => state.queryResult),
}))

const directLink: ShortLink = {
  id: 'link-id',
  url: 'https://go.example.com/abc123',
  slug: 'abc123',
  targetUrl: 'https://example.com/original',
  status: 'active',
  redirectMode: 'direct',
  intermediateDelaySeconds: 5,
  expiresAt: null,
  expired: false,
  passwordEnabled: false,
  createdAt: '2026-08-01T00:00:00Z',
}

function mountDialog(props: Partial<{
  errorMessage: string
  link: ShortLink
  open: boolean
  pending: boolean
}> = {}, stubs = componentStubs) {
  return render(ShortLinkSettingsDialog, {
    props: {
      errorMessage: '',
      link: directLink,
      open: true,
      pending: false,
      ...props,
    },
    global: {
      stubs,
    },
  })
}

function setPermissions(permissions: string[]) {
  state.queryResult = {
    data: ref({
      user: {
        permissions,
      },
    }),
  }
}

describe('ShortLinkSettingsDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T00:00:00Z'))
    setPermissions(['short_link:use_intermediate', 'short_link:set_expiration'])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits the full direct-mode payload and explicitly clears expiration', async () => {
    const view = mountDialog()

    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), ' https://example.com/updated ')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/updated',
        redirectMode: 'direct',
        intermediateDelaySeconds: 5,
        expiration: { mode: 'never' },
      },
    ]])
  })

  it('edits intermediate mode, delay, and a future expiration', async () => {
    const view = mountDialog({
      link: {
        ...directLink,
        redirectMode: 'intermediate',
        intermediateDelaySeconds: 7,
        expiresAt: '2026-08-03T02:30:00Z',
      },
    })

    expect(screen.getByRole('button', { name: 'shortLinkSettings.intermediate' }).getAttribute('aria-pressed')).toBe('true')
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.intermediateDelay'), '10')
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.expiresAt'), '2026-08-04T10:30')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/original',
        redirectMode: 'intermediate',
        intermediateDelaySeconds: 10,
        expiration: { mode: 'at', expiresAt: new Date('2026-08-04T10:30').toISOString() },
      },
    ]])
  })

  it('omits an unchanged persisted expiration when saving other fields', async () => {
    vi.setSystemTime(new Date('2026-08-04T00:00:00Z'))
    const persistedExpiresAt = '2026-08-03T02:30:45Z'
    const view = mountDialog({
      link: {
        ...directLink,
        expiresAt: persistedExpiresAt,
      },
    })

    expect(screen.getByLabelText('shortLinkSettings.expiresAt').getAttribute('step')).toBeNull()
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/updated')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/updated',
        redirectMode: 'direct',
        intermediateDelaySeconds: 5,
      },
    ]])
  })

  it('omits access configuration fields when the user lacks advanced permissions', async () => {
    setPermissions([])
    const view = mountDialog()

    expect(screen.queryByLabelText('shortLinkSettings.redirectMode')).toBeNull()
    expect(screen.queryByLabelText('shortLinkSettings.expirationEnabled')).toBeNull()
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/updated')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/updated',
      },
    ]])
  })

  it('submits only the intermediate configuration when expiration permission is absent', async () => {
    setPermissions(['short_link:use_intermediate'])
    const view = mountDialog()

    expect(screen.queryByLabelText('shortLinkSettings.expirationEnabled')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.intermediate' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/original',
        redirectMode: 'intermediate',
        intermediateDelaySeconds: 5,
      },
    ]])
  })

  it('submits only expiration when intermediate permission is absent', async () => {
    setPermissions(['short_link:set_expiration'])
    const view = mountDialog()

    expect(screen.queryByLabelText('shortLinkSettings.redirectMode')).toBeNull()
    await fireEvent.click(screen.getByLabelText('shortLinkSettings.expirationEnabled'))
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.expiresAt'), '2026-08-04T10:30')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/original',
        expiration: { mode: 'at', expiresAt: new Date('2026-08-04T10:30').toISOString() },
      },
    ]])
  })

  it('shows password settings with permission and sets a new password', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog()

    expect(screen.getByLabelText('shortLinkSettings.passwordEnabled')).toBeTruthy()
    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    expect(screen.getByLabelText('shortLinkSettings.password').getAttribute('autocomplete')).toBe('new-password')
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/original',
        password: { mode: 'set', value: 'correct horse' },
      },
    ]])
  })

  it('omits an unchanged password while saving another field', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog({ link: { ...directLink, passwordEnabled: true } })

    expect(screen.getByLabelText('shortLinkSettings.passwordEnabled')).toBeTruthy()
    expect((screen.getByLabelText('shortLinkSettings.password') as HTMLInputElement).value).toBe('')
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/updated')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/updated',
      },
    ]])
  })

  it('omits a disabled password that was never configured', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog()

    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/updated')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/updated',
      },
    ]])
  })

  it('clears a password only when the protected toggle is explicitly turned off', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog({ link: { ...directLink, passwordEnabled: true } })

    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        targetUrl: 'https://example.com/original',
        password: { mode: 'never' },
      },
    ]])
  })

  it('rejects a password shorter than the minimum length', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog()

    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.password'), 'short')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(screen.getByText('shortLinkSettings.passwordInvalid')).toBeTruthy()
    expect(view.emitted().save).toBeUndefined()
  })

  it('switches between direct and intermediate modes', async () => {
    mountDialog()

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.intermediate' }))
    expect(screen.getByLabelText('shortLinkSettings.intermediateDelay')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.direct' }))
    expect(screen.queryByLabelText('shortLinkSettings.intermediateDelay')).toBeNull()
  })

  it('keeps validation and mutation errors inside the dialog', async () => {
    const view = mountDialog({ errorMessage: 'save failed' })

    expect(screen.getByRole('alert').textContent).toContain('save failed')
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'not-a-url')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(screen.getByText('shortLinkSettings.invalidUrl')).toBeTruthy()
    expect(view.emitted().save).toBeUndefined()

    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/valid')
    await fireEvent.click(screen.getByLabelText('shortLinkSettings.expirationEnabled'))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(screen.getByText('shortLinkSettings.expirationRequired')).toBeTruthy()

    await fireEvent.update(screen.getByLabelText('shortLinkSettings.expiresAt'), '2026-08-01T10:30')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(screen.getByText('shortLinkSettings.expirationFuture')).toBeTruthy()
    expect(view.emitted().save).toBeUndefined()
  })

  it('disables actions and rejects close requests while pending', async () => {
    const view = mountDialog(
      { pending: true },
      {
        ...componentStubs,
        VDialog: {
          props: ['modelValue', 'persistent'],
          emits: ['update:modelValue'],
          template: '<div v-if="modelValue" role="dialog" :data-persistent="persistent"><button aria-label="dialog-model-close" @click="$emit(\'update:modelValue\', false)" /><slot /></div>',
        },
      },
    )
    expect((screen.getByRole('button', { name: 'shortLinkSettings.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('dialog').getAttribute('data-persistent')).toBe('true')

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.cancel' }))
    await fireEvent.click(screen.getByLabelText('dialog-model-close'))
    expect(view.emitted()['update:open']).toBeUndefined()
  })

  it('keeps the save guard when a pending button still dispatches a click', async () => {
    const view = mountDialog(
      { pending: true },
      {
        ...componentStubs,
        VBtn: {
          props: ['disabled', 'loading'],
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot /></button>',
        },
      },
    )

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(view.emitted().save).toBeUndefined()
  })

  it('resets when reopened and forwards dialog model updates', async () => {
    const view = mountDialog(
      { open: false },
      {
        ...componentStubs,
        VDialog: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<div v-if="modelValue" role="dialog"><button aria-label="dialog-model-update" @click="$emit(\'update:modelValue\', true)" /><slot /></div>',
        },
      },
    )

    expect(screen.queryByRole('dialog')).toBeNull()
    await view.rerender({ open: true })
    expect((screen.getByLabelText('shortLinkSettings.targetUrl') as HTMLInputElement).value).toBe(directLink.targetUrl)

    await fireEvent.click(screen.getByLabelText('dialog-model-update'))
    expect(view.emitted()['update:open']).toEqual([[true]])
  })

  it('preserves edits when the open dialog receives a refreshed link reference', async () => {
    const view = mountDialog()

    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/edited')
    await view.rerender({ link: { ...directLink } })

    expect((screen.getByLabelText('shortLinkSettings.targetUrl') as HTMLInputElement).value).toBe('https://example.com/edited')
  })

  it('treats an invalid persisted expiration as an empty local date', () => {
    mountDialog({
      link: {
        ...directLink,
        expiresAt: 'invalid-date',
      },
    })

    expect((screen.getByLabelText('shortLinkSettings.expiresAt') as HTMLInputElement).value).toBe('')
  })
})
