<template><span hidden aria-hidden="true" /></template>

<script setup lang="ts">
import { defineComponent, h, onBeforeUnmount, onMounted, onUnmounted, useAttrs, useSlots, watch, type VNode } from 'vue'
import { toast } from 'vue-sonner'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ type?: 'success' | 'error' | 'warning' | 'info' }>(), { type: 'info' })
const slots = useSlots()
const attrs = useAttrs()
let id: string | number | undefined
let active = true
let lastChildren: VNode[] | undefined
const content = defineComponent({
  /** Renders feedback as Vue text and controls, never as HTML strings. */
  setup: () => () => {
    if (active) lastChildren = slots.default?.()
    return h('div', attrs, lastChildren)
  },
})
/** Publishes one owned notification to the application-wide stack. */
function show() {
  id = toast[props.type](content, { id })
}
onMounted(show)
watch(() => props.type, show)
// The toaster retains dismissed content during its exit animation.
onBeforeUnmount(() => { active = false })
onUnmounted(() => { if (id !== undefined) toast.dismiss(id) })
</script>
