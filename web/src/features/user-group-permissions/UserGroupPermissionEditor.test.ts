import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import type { PermissionDefinition, PermissionPreset, UserGroup } from '@/entities/user-group/api'

import UserGroupPermissionEditor from './UserGroupPermissionEditor.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'zh-CN' },
    t: (key: string, params?: unknown) => params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

const definitions: PermissionDefinition[] = [
  { key: 'short_link:create', category: 'short_link_basic', protected: false },
  { key: 'short_link:use_intermediate', category: 'short_link_access', protected: false },
  { key: 'domain:use_default', category: 'domain', protected: false },
  { key: 'admin:access', category: 'administration', protected: true },
]
const presets: PermissionPreset[] = [
  { key: 'restricted', applicableGroups: ['user', 'admin'], permissions: [] },
  { key: 'basic', applicableGroups: ['user', 'admin'], permissions: ['short_link:create', 'domain:use_default'] },
  { key: 'standard', applicableGroups: ['user', 'admin'], permissions: ['short_link:create', 'short_link:use_intermediate', 'domain:use_default'] },
]
const admin: UserGroup = {
  key: 'admin', name: 'Admin', description: 'Administrators', builtin: true, editable: true,
  permissions: ['short_link:create', 'admin:access'], updatedAt: '2026-08-20T12:34:00Z',
}

const stubs = {
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VBtn: { props: ['disabled', 'loading'], emits: ['click'], template: '<button v-bind="$attrs" :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>' },
  VCheckbox: {
    inheritAttrs: false,
    props: ['disabled', 'label', 'modelValue'],
    emits: ['update:modelValue'],
    template: '<label><input v-bind="$attrs" type="checkbox" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
  },
  VSelect: {
    props: ['disabled', 'items', 'label', 'modelValue'],
    emits: ['update:modelValue'],
    template: '<select :aria-label="label" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="" /><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
  },
}

/** Mounts the permission editor with concise defaults for interaction tests. */
function mountEditor(group = admin, draftPermissions = admin.permissions, dirty = false, pending = false, dataValid = true) {
  return render(UserGroupPermissionEditor, {
    props: { dataValid, definitions, dirty, draftPermissions, group, pending, presets },
    global: {
      mocks: { $t: (key: string) => key },
      stubs,
    },
  })
}

describe('UserGroupPermissionEditor', () => {
  it('groups permissions and disables protected entries', () => {
    mountEditor()

    for (const category of ['short_link_basic', 'short_link_access', 'domain', 'administration']) {
      expect(screen.getByText(`userGroups.categories.${category}`)).toBeTruthy()
    }
    expect(screen.getByText('userGroups.builtin')).toBeTruthy()
    const protectedCheckbox = screen.getByLabelText('userGroups.permissions.admin:access.label') as HTMLInputElement
    expect(protectedCheckbox.disabled).toBe(true)
    expect((screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement).disabled).toBe(false)

    const descriptionIds = protectedCheckbox.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(descriptionIds).toHaveLength(2)
    expect(descriptionIds.every((id) => document.getElementById(id))).toBe(true)
  })

  it('emits draft-only preset and permission changes without saving', async () => {
    const view = mountEditor()

    await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'basic')
    expect((screen.getByLabelText('userGroups.preset') as HTMLSelectElement).value).toBe('basic')
    await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))

    expect(view.emitted('apply-preset')).toEqual([['basic']])
    expect(view.emitted('set-permission')).toEqual([['short_link:create', false]])
    expect((screen.getByLabelText('userGroups.preset') as HTMLSelectElement).value).toBe('')
    await fireEvent.update(screen.getByLabelText('userGroups.preset'), '')
    expect(view.emitted('apply-preset')).toEqual([['basic']])
    expect(view.emitted('save')).toBeUndefined()
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('locks all guest controls and pending editable controls', () => {
    const guest: UserGroup = {
      key: 'guest', name: 'Guest', description: 'Guest', builtin: true, editable: false,
      permissions: [], updatedAt: 'guest-v1',
    }
    const guestView = mountEditor(guest, [], false)
    expect((screen.getByLabelText('userGroups.preset') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).disabled)).toBe(true)
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('userGroups.guestRestricted')).toBeTruthy()
    guestView.unmount()

    mountEditor(admin, admin.permissions, true, true)
    expect((screen.getByLabelText('userGroups.preset') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).disabled)).toBe(true)
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('locks a stale draft until fresh server state is available', () => {
    mountEditor(admin, [...admin.permissions, 'short_link:use_intermediate'], true, false, false)

    expect(screen.getByText('userGroups.dataStale')).toBeTruthy()
    expect((screen.getByLabelText('userGroups.preset') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).disabled)).toBe(true)
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps preset, permission, and action regions in mobile DOM order', () => {
    const { container } = mountEditor()
    const editor = container.querySelector('[data-testid="user-group-permission-editor"]')
    expect([...editor!.children].map((element) => element.getAttribute('data-testid'))).toEqual([
      'user-group-summary',
      'user-group-preset',
      'user-group-permissions',
      'user-group-actions',
    ])
  })

  it('formats the permission version using the active interface locale', () => {
    mountEditor()
    const expected = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(admin.updatedAt))

    expect(screen.getByText(`userGroups.updatedAt:${JSON.stringify({ value: expected })}`)).toBeTruthy()
    expect(screen.queryByText(`userGroups.updatedAt:${JSON.stringify({ value: admin.updatedAt })}`)).toBeNull()
  })
})
