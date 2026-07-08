import type { Component } from 'vue'

export const componentStubs: Record<string, Component> = {
  RouterLink: { props: ['to'], template: '<a :data-to="to" :href="typeof to === \'string\' ? to : to?.path"><slot /></a>' },
  RouterView: { template: '<div data-testid="router-view"><slot :Component="undefined" :route="{ fullPath: \'/\' }" /></div>' },
  VAlert: { props: ['type', 'variant', 'color'], template: '<div role="alert"><slot /></div>' },
  VApp: { template: '<div><slot /></div>' },
  VAppBar: { template: '<nav><slot /></nav>' },
  VAppBarTitle: { template: '<strong><slot /></strong>' },
  VBtn: {
    props: ['color', 'disabled', 'href', 'loading', 'size', 'target', 'to', 'variant'],
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled || loading" :data-href="href" :data-to="to" @click="$emit(\'click\')"><slot /></button>',
  },
  VCard: { template: '<section><slot /></section>' },
  VCardText: { template: '<div><slot /></div>' },
  VContainer: { template: '<main><slot /></main>' },
  VMain: { template: '<div><slot /></div>' },
  VProgressLinear: { template: '<div role="progressbar" />' },
  VSelect: {
    props: ['items', 'label', 'modelValue'],
    emits: ['update:modelValue'],
    template: '<select :aria-label="label || \'select\'" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="typeof item === \'string\' ? item : item.value" :value="typeof item === \'string\' ? item : item.value">{{ typeof item === \'string\' ? item : item.title }}</option></select>',
  },
  VTable: { template: '<table><slot /></table>' },
  VSnackbar: {
    props: ['modelValue', 'timeout'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" role="status"><slot /><slot name="actions" /></div>',
  },
  VTextField: {
    props: ['disabled', 'errorMessages', 'label', 'modelValue', 'placeholder', 'type'],
    emits: ['update:modelValue', 'keyup'],
    template: '<label>{{ label }}<input :aria-label="label" :disabled="disabled" :placeholder="placeholder" :type="type || \'text\'" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup="$emit(\'keyup\', $event)" /><span v-if="errorMessages">{{ errorMessages }}</span></label>',
  },
}
