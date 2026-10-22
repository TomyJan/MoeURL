<template><div class="insight-trend"><canvas ref="canvas" :aria-label="label" role="img" /></div></template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } from 'chart.js'
import type { TrendPoint } from '@/entities/insights/model'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)
const props = defineProps<{ points: TrendPoint[]; label: string }>()
const canvas = ref<globalThis.HTMLCanvasElement>()
const theme = useTheme()
const colors = computed(() => theme.global.current.value.colors)
onMounted(() => {
watch([() => props.points, colors], ([points, palette]: [TrendPoint[], Record<string, string>], _previous, onCleanup) => {
  const element = canvas.value!
  const chart = new Chart(element, { type: 'line', data: { labels: points.map((point) => point.date), datasets: [{ data: points.map((point) => point.visitCount), borderColor: palette.primary, backgroundColor: palette.primary, tension: 0.25 }] }, options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: palette['on-surface-variant'] }, grid: { color: palette.outline } }, y: { min: 0, suggestedMax: 1, ticks: { color: palette['on-surface-variant'], precision: 0 }, grid: { color: palette.outline } } } } })
  onCleanup(() => chart.destroy())
}, { immediate: true, flush: 'post' })
})
</script>
<style scoped>
.insight-trend { position: relative; height: 280px; }
.insight-trend canvas { max-width: 100%; }
@media (max-width: 760px) { .insight-trend { height: 220px; } }
</style>
