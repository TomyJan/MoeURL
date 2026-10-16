import { computed, defineComponent, ref, type Component } from 'vue'

export const componentStubs: Record<string, Component> = {
  AppToasts: { template: '<div />' },
  ActionToast: { props: ['type'], template: '<div role="alert"><slot /></div>' },
  RouterLink: { props: ['to'], template: '<a :data-to="to" :href="typeof to === \'string\' ? to : to?.path"><slot /></a>' },
  RouterView: { template: '<div data-testid="router-view"><slot :Component="undefined" :route="{ fullPath: \'/\' }" /></div>' },
  ShortLinkQrDialog: {
    props: ['open', 'slug', 'url'],
    emits: ['update:open'],
    template: '<div v-if="open" data-testid="short-link-qr-dialog-stub"><span>{{ slug }}</span><span>{{ url }}</span><button aria-label="short-link-qr-close" @click="$emit(\'update:open\', false)" /></div>',
  },
  VAlert: { props: ['type', 'variant', 'color'], template: '<div role="alert"><slot /><slot name="append" /></div>' },
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
  VChip: { props: ['color', 'size', 'variant'], template: '<span><slot /></span>' },
  VCheckboxBtn: {
    props: ['modelValue', 'disabled', 'indeterminate'],
    emits: ['update:modelValue'],
    template: '<input type="checkbox" :checked="modelValue" :disabled="disabled" :indeterminate.prop="indeterminate" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  VContainer: { template: '<main><slot /></main>' },
  VDialog: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" role="dialog"><slot /></div>',
  },
  VMain: { template: '<div><slot /></div>' },
  VList: { props: ['density', 'nav'], template: '<ul><slot /></ul>' },
  VListItem: {
    props: { tag: { default: 'li' }, active: Boolean, disabled: Boolean, title: String, subtitle: String, href: String, target: String },
    template: '<component :is="tag" :disabled="disabled" :data-href="href" :data-active="active"><slot name="title">{{ title }}</slot><slot name="subtitle">{{ subtitle }}</slot><slot /><slot name="append" /></component>',
  },
  VListItemTitle: { template: '<span><slot /></span>' },
  VMenu: defineComponent({
    props: { modelValue: { type: Boolean, default: undefined }, location: { type: String, default: undefined } },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      const internalOpen = ref(false)
      const open = computed(() => props.modelValue ?? internalOpen.value)
      /** Toggles the stub's visible content and reports optional model updates. */
      function setOpen(value: boolean) {
        internalOpen.value = value
        emit('update:modelValue', value)
      }
      return { open, setOpen }
    },
    template: '<div><slot name="activator" :props="{ \'aria-haspopup\': \'menu\', \'aria-expanded\': open ? \'true\' : \'false\', onClick: () => setOpen(!open) }" /><div v-if="open" @click="setOpen(false)"><slot /></div></div>',
  }),
  VProgressLinear: { template: '<div role="progressbar" />' },
  VSelect: {
    props: ['disabled', 'items', 'label', 'modelValue'],
    emits: ['update:modelValue'],
    template: '<select :aria-label="label || \'select\'" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="typeof item === \'string\' ? item : item.value" :value="typeof item === \'string\' ? item : item.value">{{ typeof item === \'string\' ? item : item.title }}</option></select>',
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
  VTable: { props: ['density'], template: '<div class="v-table"><div class="v-table__wrapper"><table><slot /></table></div></div>' },
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
  VTextarea: {
    props: ['disabled', 'errorMessages', 'label', 'modelValue'],
    emits: ['update:modelValue'],
    template: '<label>{{ label }}<textarea :aria-label="label" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><span v-if="errorMessages">{{ errorMessages }}</span></label>',
  },
}
