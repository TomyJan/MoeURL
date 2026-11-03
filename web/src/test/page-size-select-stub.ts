import { defineComponent, h, type PropType } from 'vue'
import { componentStubs } from './component-stubs'

/** Preserves Vuetify's numeric size options while leaving other existing select fixtures unchanged. */
export function createPageSizeSelectStub(capture: (emit: (value: unknown) => void) => void) {
  return defineComponent({
    inheritAttrs: false,
    props: {
      disabled: Boolean,
      items: { type: Array as PropType<readonly unknown[]>, default: () => [] },
      label: { type: String, default: '' },
      modelValue: { type: [Number, String], default: '' },
      errorMessages: { type: [String, Array], default: undefined },
    },
    emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      if (props.label === 'pagination.pageSize') capture(value => emit('update:modelValue', value))
      return () => props.label === 'pagination.pageSize'
        ? h('select', { 'aria-label': props.label, disabled: props.disabled, value: props.modelValue, onChange: (event: Event) => emit('update:modelValue', Number((event.target as HTMLSelectElement).value)) }, (props.items as number[]).map(value => h('option', { value }, String(value))))
        : h(componentStubs.VSelect!, { ...attrs, ...props, 'onUpdate:modelValue': (value: unknown) => emit('update:modelValue', value) })
    },
  })
}
