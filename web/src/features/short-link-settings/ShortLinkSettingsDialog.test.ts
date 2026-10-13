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
  title: '', tags: [],
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
  maxVisits: null,
  visitsUsed: 0,
  visitsRemaining: null,
  exhausted: false,
  createdAt: '2026-08-01T00:00:00Z',
}

/** Mounts the settings dialog with shared link and permission defaults. */
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

/** Configures the permission query mock for settings tests. */
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
  it('omits untouched metadata after a refetch and preserves dirty drafts until explicitly cleared', async () => {
    setPermissions(['short_link:set_metadata'])
    const link = { ...directLink, title: 'Original', tags: ['原有标签'] }
    const view = mountDialog({ link })
    await view.rerender({ link: { ...link, title: 'Server update', tags: ['New'] } })
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[0]).toEqual([{ id: link.id }])
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), ' 我的草稿 ')
    await fireEvent.update(screen.getByLabelText('linkMetadata.tags'), ' 团队 资料 \nRelease')
    await view.rerender({ link: { ...link, title: 'Another update', tags: [] } })
    expect((screen.getByLabelText('linkMetadata.title') as HTMLInputElement).value).toBe(' 我的草稿 ')
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[1]).toEqual([{ id: link.id, metadata: { title: '我的草稿', tags: ['团队 资料', 'Release'] } }])
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), '')
    await fireEvent.update(screen.getByLabelText('linkMetadata.tags'), '')
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[2]).toEqual([{ id: link.id, metadata: { title: '', tags: [] } }])
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    expect((screen.getByLabelText('linkMetadata.title') as HTMLInputElement).value).toBe('Another update')
  })

  it('validates only changed metadata and omits hidden drafts when permission is revoked', async () => {
    const data = ref({ user: { permissions: ['short_link:set_metadata'] } })
    state.queryResult = { data }
    const view = mountDialog({ link: { ...directLink, title: 'Old\u0000invalid', tags: [] } })
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save).toEqual([[{ id: directLink.id }]])
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), '😀'.repeat(121))
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save).toHaveLength(1)
    expect(screen.getByText('linkMetadata.titleInvalid')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), 'Valid')
    await fireEvent.update(screen.getByLabelText('linkMetadata.tags'), 'A\nA')
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(screen.getByText('linkMetadata.tagsInvalid')).toBeTruthy()
    expect(view.emitted().save).toHaveLength(1)
    data.value.user.permissions = []
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(screen.queryByLabelText('linkMetadata.title')).toBeNull()
    expect(view.emitted().save?.[1]).toEqual([{ id: directLink.id }])
  })

  it('saves quota changes without validating or resubmitting the unchanged stored target URL', async () => {
    setPermissions(['short_link:set_max_visits'])
    const link = { ...directLink, targetUrl: 'https://example.com:65536' }
    const view = mountDialog({ link })
    await fireEvent.click(screen.getByLabelText('visitLimit.enabled'))
    await fireEvent.update(screen.getByLabelText('visitLimit.maximum'), '10')
    await view.rerender({ link: { ...link, targetUrl: 'https://example.com/refreshed' } })
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))

    expect(screen.queryByText('shortLinkSettings.invalidUrl')).toBeNull()
    expect(view.emitted().save).toEqual([[{ id: 'link-id', visitLimit: { mode: 'limited', maxVisits: 10 } }]])
  })

  it.each([false, true])('blocks saving until permissions are loaded without a query error (%s)', async (failed) => {
    state.queryResult = { data: ref(failed ? { user: { permissions: ['short_link:set_max_visits'] } } : undefined), isError: ref(failed) }
    const view = mountDialog()
    expect((screen.getByText('shortLinkSettings.save') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save).toBeUndefined()
  })

  it('keeps the current quota when saving unrelated fields, then submits a lower limit with a warning', async () => {
    setPermissions(['short_link:set_max_visits'])
    const view = mountDialog({ link: { ...directLink, maxVisits: 5, visitsUsed: 3, visitsRemaining: 2 } })
    expect(screen.getByText('visitLimit.usage')).toBeTruthy()
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[0]).toEqual([{ id: 'link-id' }])
    await fireEvent.update(screen.getByLabelText('visitLimit.maximum'), '2')
    expect(screen.getByText('visitLimit.lowerWarning')).toBeTruthy()
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[1]).toEqual([{ id: 'link-id', visitLimit: { mode: 'limited', maxVisits: 2 } }])
  })

  it('warns before clearing a quota period and preserves the draft on failed saves', async () => {
    setPermissions(['short_link:set_max_visits'])
    const view = mountDialog({ link: { ...directLink, maxVisits: 5, visitsUsed: 3, visitsRemaining: 2 } })
    await fireEvent.click(screen.getByLabelText('visitLimit.enabled'))
    expect(screen.getByText('visitLimit.clearWarning')).toBeTruthy()
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[0]).toEqual([{ id: 'link-id', visitLimit: { mode: 'unlimited' } }])
    await view.rerender({ pending: true })
    expect((screen.getByLabelText('visitLimit.enabled') as HTMLInputElement).disabled).toBe(true)
    await view.rerender({ pending: false, errorMessage: 'save failed' })
    expect((screen.getByLabelText('visitLimit.enabled') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('save failed')).toBeTruthy()
  })

  it('validates a new quota and hides editing from users without the capability', async () => {
    setPermissions(['short_link:set_max_visits'])
    const view = mountDialog()
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[0]).toEqual([{ id: 'link-id' }])
    await fireEvent.click(screen.getByLabelText('visitLimit.enabled'))
    await fireEvent.update(screen.getByLabelText('visitLimit.maximum'), '0')
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save).toHaveLength(1)
    expect(screen.getByText('visitLimit.invalid')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('visitLimit.maximum'), '1')
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(view.emitted().save?.[1]).toEqual([{ id: 'link-id', visitLimit: { mode: 'limited', maxVisits: 1 } }])
    view.unmount()
    setPermissions([])
    const readOnly = mountDialog({ link: { ...directLink, maxVisits: 1, visitsUsed: 1, visitsRemaining: 0, exhausted: true } })
    expect(screen.queryByLabelText('visitLimit.enabled')).toBeNull()
    expect(screen.getByText('visitLimit.exhausted')).toBeTruthy()
    await fireEvent.click(screen.getByText('shortLinkSettings.save'))
    expect(readOnly.emitted().save?.[0]).toEqual([{ id: 'link-id' }])
  })

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
        redirectMode: 'intermediate',
        intermediateDelaySeconds: 5,
      },
    ]])
  })

  it('submits confirmation without an intermediate delay when only confirmation permission is present', async () => {
    setPermissions(['short_link:use_confirmation'])
    const view = mountDialog()

    expect(screen.queryByRole('button', { name: 'shortLinkSettings.intermediate' })).toBeNull()
    expect(screen.getByRole('button', { name: 'shortLinkSettings.direct' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.confirmation' }))
    expect(screen.queryByLabelText('shortLinkSettings.intermediateDelay')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        redirectMode: 'confirmation',
      },
    ]])
  })

  it('does not submit a persisted confirmation mode after confirmation permission is removed', async () => {
    setPermissions(['short_link:use_intermediate'])
    const view = mountDialog({ link: { ...directLink, redirectMode: 'confirmation' } })

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
      },
    ]])

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.direct' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(view.emitted().save?.[1]).toEqual([{
      id: 'link-id',
      redirectMode: 'direct',
    }])
  })

  it.each([
    ['intermediate', 'shortLinkSettings.intermediate'],
    ['confirmation', 'shortLinkSettings.confirmation'],
  ] as const)('allows a persisted %s mode to be downgraded after its permission is removed', async (redirectMode, label) => {
    setPermissions([])
    const view = mountDialog({ link: { ...directLink, redirectMode } })

    const currentModeButton = screen.getByRole('button', { name: label }) as HTMLButtonElement
    expect(currentModeButton.disabled).toBe(true)
    expect(currentModeButton.getAttribute('aria-pressed')).toBe('true')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.direct' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        redirectMode: 'direct',
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
        expiration: { mode: 'at', expiresAt: new Date('2026-08-04T10:30').toISOString() },
      },
    ]])
  })

  it('shows password settings with permission and sets a new password', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog()

    expect(screen.getByLabelText('shortLinkSettings.passwordEnabled')).toBeTruthy()
    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    const passwordInput = screen.getByLabelText('shortLinkSettings.password')
    expect(passwordInput.getAttribute('autocomplete')).toBe('new-password')
    expect(passwordInput.closest('[data-testid="short-link-password-input"]')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        password: { mode: 'set', value: 'correct horse' },
      },
    ]])
  })

  it('reads the password only on submit and clears it immediately after save submission', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog({}, {
      ...componentStubs,
      VTextField: {
        inheritAttrs: false,
        props: ['disabled', 'errorMessages', 'label', 'type'],
        emits: ['input', 'update:modelValue'],
        data: () => ({ internalValue: '' }),
        template: '<label v-bind="$attrs">{{ label }}<input :aria-label="label" :disabled="disabled" :type="type || \'text\'" :value="internalValue" @input="internalValue = $event.target.value; $emit(\'input\', $event); $emit(\'update:modelValue\', internalValue)" /><span v-if="errorMessages">{{ errorMessages }}</span></label>',
      },
    })

    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    const passwordInput = screen.getByLabelText('shortLinkSettings.password') as HTMLInputElement
    await fireEvent.update(passwordInput, 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
        password: { mode: 'set', value: 'correct horse' },
      },
    ]])
    expect(passwordInput.value).toBe('')
    await view.rerender({ pending: true })
    expect(passwordInput.value).toBe('')
  })

  it('clears the password when the dialog is externally closed', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog({}, {
      ...componentStubs,
      VDialog: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template: '<div><slot /></div>',
      },
    })

    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    const passwordInput = screen.getByLabelText('shortLinkSettings.password') as HTMLInputElement
    passwordInput.value = 'correct horse'

    await view.rerender({ open: false })

    expect(passwordInput.value).toBe('')
  })

  it('requires a password when enabling protection on an unprotected link', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog()

    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(screen.getByText('shortLinkSettings.passwordRequired')).toBeTruthy()
    expect(view.emitted().save).toBeUndefined()
  })

  it('clears the password validation error when the input changes', async () => {
    setPermissions(['short_link:set_password'])
    mountDialog()

    await fireEvent.click(screen.getByLabelText('shortLinkSettings.passwordEnabled'))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(screen.getByText('shortLinkSettings.passwordRequired')).toBeTruthy()

    await fireEvent.update(screen.getByLabelText('shortLinkSettings.password'), 'correct horse')

    expect(screen.queryByText('shortLinkSettings.passwordRequired')).toBeNull()
  })

  it('reports a missing password input instead of silently preserving protection', async () => {
    setPermissions(['short_link:set_password'])
    const view = mountDialog(
      { link: { ...directLink, passwordEnabled: true } },
      {
        ...componentStubs,
        VTextField: {
          inheritAttrs: false,
          props: ['disabled', 'errorMessages', 'label', 'modelValue', 'type'],
          emits: ['update:modelValue'],
          template: '<label v-bind="$attrs">{{ label }}<input v-if="type !== \'password\'" :aria-label="label" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><span v-if="errorMessages">{{ errorMessages }}</span></label>',
        },
      },
    )

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(screen.getByText('shortLinkSettings.passwordRequired')).toBeTruthy()
    expect(view.emitted().save).toBeUndefined()
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

  it('omits password settings without permission', async () => {
    setPermissions([])
    const view = mountDialog({ link: { ...directLink, passwordEnabled: true } })

    expect(screen.queryByLabelText('shortLinkSettings.passwordEnabled')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(view.emitted().save).toEqual([[
      {
        id: 'link-id',
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
