<template><span hidden aria-hidden="true" /></template>

<script setup lang="ts">
import { defineComponent, h, onMounted, onUnmounted, useAttrs, useSlots, watch } from 'vue'
import { toast } from 'vue-sonner'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ type?: 'success' | 'error' | 'warning' | 'info' }>(), { type: 'info' })
const slots = useSlots()
const attrs = useAttrs()
let id: string | number | undefined
const content = defineComponent({
  /** Renders feedback as Vue text and controls, never as HTML strings. */
  setup: () => () => h('div', attrs, slots.default?.()),
})
/** Publishes one owned notification to the application-wide stack. */
function show() {
  id = toast[props.type](content, { id })
}
onMounted(show)
watch(() => props.type, show)
onUnmounted(() => { if (id !== undefined) toast.dismiss(id) })
</script>
