import type { Component } from 'vue'

export const componentStubs: Record<string, Component> = {
  RouterLink: { props: ['to'], template: '<a :data-to="to" :href="typeof to === \'string\' ? to : to?.path"><slot /></a>' },
  RouterView: { template: '<div data-testid="router-view"><slot :Component="undefined" :route="{ fullPath: \'/\' }" /></div>' },
  ShortLinkQrDialog: {
    props: ['open', 'slug', 'url'],
    emits: ['update:open'],
    template: '<div v-if="open" data-testid="short-link-qr-dialog-stub"><span>{{ slug }}</span><span>{{ url }}</span><button aria-label="short-link-qr-close" @click="$emit(\'update:open\', false)" /></div>',
  },
  VAlert: { props: ['type', 'variant', 'color'], template: '<div role="alert"><slot /></div>' },
  VApp: { template: '<div><slot /></div>' },
  VAppBar: { template: '<nav><slot /></nav>' },
  VAppBarTitle: { template: '<strong><slot /></strong>' },
  VBtn: {
    props: ['color', 'disabled', 'href', 'loading', 'size', 'target', 'to', 'variant'],
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled || loading" :data-href="href" :data-to="to" @click="$emit(\'click\')"><slot /></button>',
  },
	VBtnToggle: {
		props: ['modelValue'],
		emits: ['update:modelValue'],
		template: '<div role="radiogroup" @click="$emit(\'update:modelValue\', $event.target.value)"><slot /></div>',
	},
  VCard: { template: '<section><slot /></section>' },
  VCardActions: { template: '<div><slot /></div>' },
  VCardTitle: { template: '<h2><slot /></h2>' },
  VCardText: { template: '<div><slot /></div>' },
  VContainer: { template: '<main><slot /></main>' },
  VDialog: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" role="dialog"><slot /></div>',
  },
  VMain: { template: '<div><slot /></div>' },
  VList: { template: '<ul><slot /></ul>' },
  VListItem: { template: '<li><slot /><slot name="append" /></li>' },
  VListItemTitle: { template: '<span><slot /></span>' },
  VProgressLinear: { template: '<div role="progressbar" />' },
  VSelect: {
    props: ['items', 'label', 'modelValue'],
    emits: ['update:modelValue'],
    template: '<select :aria-label="label || \'select\'" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="typeof item === \'string\' ? item : item.value" :value="typeof item === \'string\' ? item : item.value">{{ typeof item === \'string\' ? item : item.title }}</option></select>',
  },
	VSlider: {
		props: ['disabled', 'label', 'max', 'min', 'modelValue', 'step'],
		emits: ['update:modelValue'],
		template: '<label>{{ label }}<input v-bind="$attrs" type="range" :aria-label="label" :disabled="disabled" :max="max" :min="min" :step="step" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" /></label>',
	},
	VSwitch: {
		props: ['disabled', 'label', 'modelValue'],
		emits: ['update:modelValue'],
		template: '<label><input type="checkbox" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
	},
  VTable: { template: '<table><slot /></table>' },
  VSnackbar: {
    props: ['modelValue', 'timeout'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" role="status"><slot /><slot name="actions" /></div>',
  },
  VTextField: {
    props: ['autocomplete', 'disabled', 'errorMessages', 'label', 'modelValue', 'name', 'placeholder', 'step', 'type'],
    emits: ['update:modelValue', 'keyup'],
    template: '<label>{{ label }}<input :aria-label="label" :autocomplete="autocomplete" :disabled="disabled" :name="name" :placeholder="placeholder" :step="step" :type="type || \'text\'" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup="$emit(\'keyup\', $event)" /><span v-if="errorMessages">{{ errorMessages }}</span></label>',
  },
}
