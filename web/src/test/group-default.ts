import { render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { vi } from 'vitest'
import { inject, provide, type Component, type InjectionKey } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { componentStubs } from './component-stubs'
import type { UserGroupKey } from '@/entities/user-group/api'

export const globalId = '11111111-1111-4111-8111-111111111111'
export const groupId = '22222222-2222-4222-8222-222222222222'
export const personalId = '33333333-3333-4333-8333-333333333333'
export const version = '2026-10-27T00:00:00.123456789Z'
export const nextVersion = '2026-10-27T00:00:01.123456Z'
export const domains = [
  { id: globalId, host: 'global.example', displayName: 'Global', isDefault: true },
  { id: groupId, host: 'group.example', displayName: 'Group', isDefault: false },
  { id: personalId, host: 'personal.example', displayName: 'Personal', isDefault: false },
]
const selectTab: InjectionKey<(value: string) => void> = Symbol('group-default-tab')
const managementStubs = {
  ...componentStubs,
  VSelect: {
    props: ['disabled', 'items', 'label', 'modelValue', 'errorMessages'], emits: ['update:modelValue'],
    setup(props: Record<string, unknown>, { emit }: { emit: (event: 'update:modelValue', value: unknown) => void }) {
      return { change: (event: Event) => { const value = (event.target as HTMLSelectElement).value; const item = (props.items as Array<{ value: unknown }>).find((item) => String(item.value ?? '') === value); emit('update:modelValue', item ? item.value : value) } }
    },
    template: '<select :aria-label="label" :disabled="disabled" :value="modelValue" @change="change"><option v-for="item in items" :key="String(item.value)" :value="item.value">{{ item.title }}</option></select>',
  },
  VTabs: { props: ['modelValue'], emits: ['update:modelValue'], setup(_props: unknown, { emit }: { emit: (event: 'update:modelValue', value: string) => void }) { provide(selectTab, (value) => emit('update:modelValue', value)) }, template: '<div role="tablist"><slot /></div>' },
  VTab: { props: ['value', 'disabled'], setup() { return { select: inject(selectTab)! } }, template: '<button role="tab" :disabled="disabled" @click="select(value)"><slot /></button>' },
  VCheckbox: { props: ['label', 'disabled', 'modelValue'], emits: ['update:modelValue'], template: '<label><input type="checkbox" :aria-label="label" :disabled="disabled" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>' },
}
/** Preserves the real HTTP envelope without replacing transport or response schemas. */
export function response(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: '', data, meta: {} })) }

/** Mounts real parents, editors and queries; controlled HTTP is the only business boundary. */
export function mountGroupDefault(component: Component, options: { real?: boolean; permissions?: string[]; overrides?: Record<string, () => Promise<Response>>; personal?: string | null; selection?: { domainId: string | null; status: string }; domains?: typeof domains } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
  const user = { id: 'A', username: 'alice', nickname: '', group: 'admin', permissions: options.permissions ?? ['short_link:create', 'domain:use_default', 'domain:use_assigned', 'admin:access', 'domain:manage'] }
  client.setQueryData(['auth', 'me'], { user })
  const groups = (['guest', 'user', 'admin'] as const).map((key) => ({ key, name: key, description: '', builtin: true, editable: key !== 'guest', permissions: [] as string[], updatedAt: version }))
  const values: Record<UserGroupKey, string | null> = { guest: null, user: null, admin: null }
  const state = {
    user, groups, values, domains: [...options.domains ?? domains], personal: options.personal ?? null,
    selection: options.selection ?? { domainId: groupId as string | null, status: 'available' },
    overrides: { ...options.overrides } as Record<string, (() => Promise<Response>) | undefined>,
    requests: [] as string[], writes: [] as Array<{ path: string; input: Record<string, unknown> }>,
  }
  /** Supplies the target group's candidate snapshot independently of the acting user's choices. */
  function management(key: UserGroupKey) {
    return { setting: { groupKey: key, domainId: values[key], updatedAt: groups.find((group) => group.key === key)!.updatedAt, editable: key !== 'guest' }, candidates: key === 'guest' ? [] : state.domains }
  }
  /** Supplies the unchanged seven-field group list and full permission catalog. */
  function catalog() {
    return { groups: groups.map((group) => ({ ...group, permissions: [...group.permissions] })), permissions: [{ key: 'short_link:create', category: 'short_link_basic', protected: false }], presets: ['restricted', 'basic', 'standard'].map((key) => ({ key, applicableGroups: ['user', 'admin'], permissions: key === 'restricted' ? [] : ['short_link:create'] })) }
  }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    state.requests.push(path)
    const isWrite = init.method === 'POST'
    const input = isWrite ? JSON.parse(init.body as string) : undefined
    if (isWrite) state.writes.push({ path, input })
    const override = state.overrides[path]
    if (override) return override()
    if (path === '/api/v1/auth/me') return response({ user: state.user })
    if (path === '/api/v1/admin/user-group/list') return response(catalog())
    if (path.startsWith('/api/v1/admin/user-group/domain-default?')) return response(management(new URL(path, 'https://app.example').searchParams.get('groupKey') as UserGroupKey))
    if (path === '/api/v1/admin/user-group/set-domain-default') {
      values[input.groupKey as UserGroupKey] = input.domainId
      groups.find(({ key }) => key === input.groupKey)!.updatedAt = nextVersion
      return response(management(input.groupKey))
    }
    if (path === '/api/v1/admin/user-group/update-permissions') {
      const group = groups.find(({ key }) => key === input.groupKey)!
      group.permissions = input.permissions; group.updatedAt = nextVersion
      return response({ group })
    }
    if (path === '/api/v1/user/domain-preference') return response({ preference: { domainId: state.personal, updatedAt: state.personal ? version : null } })
    if (path === '/api/v1/domain/group-default') return response({ selection: state.selection })
    if (path === '/api/v1/domain/available') return response({ items: state.domains })
    if (path === '/api/v1/short-link/create') return response(null, 200114)
    throw new Error(`Unexpected request ${path}`)
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }))
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  const view = render(component, { global: {
    plugins: options.real ? [[VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives })] : [[VueQueryPlugin, { queryClient: client }]],
    stubs: options.real ? { ShortLinkQrDialog: true, ActionToast: componentStubs.ActionToast } : managementStubs,
  } })
  return { ...view, ...state, state, client, management, catalog }
}
