<template>
  <v-app>
    <AppToasts />
    <v-main>
      <button @click="publish(1)">Publish one</button>
      <button @click="publish(5)">Publish five</button>
      <button @click="parent = true">Open parent</button>
      <button @click="custom = true">Open custom</button>
      <v-dialog v-model="custom" aria-label="Custom fixture" max-width="560" @after-enter="customCancel?.focus()">
        <div class="feedback-empty-panel" :class="'feedback-empty-panel--' + layout" data-toast-modal-root data-testid="empty-panel" tabindex="-1">
          <h2 data-testid="empty-heading">Empty notification spacing</h2>
          <button @click="publish(1)">Publish inside</button>
          <button ref="customCancel" data-testid="empty-cancel" @click="custom = false">Close custom</button>
        </div>
      </v-dialog>
      <v-dialog v-model="parent" aria-label="Parent fixture" max-width="560" scrollable @after-enter="parentCancel?.$el.focus()">
        <v-card class="feedback-fixture-card">
          <v-card-title data-testid="fixture-title">{{ en ? 'Review the selected operation' : '请确认所选操作' }}</v-card-title>
          <v-card-text>
            <v-alert type="warning" variant="tonal" data-testid="fixture-warning">{{ en ? 'This operation cannot be undone.' : '此操作无法撤销。' }}</v-alert>
            <p data-testid="fixture-summary">{{ en ? '5 selected items; confirmation is required.' : '已选择 5 项，必须主动确认。' }}</p>
            <button @click="child = true">Open child</button>
          </v-card-text>
          <v-card-actions data-testid="fixture-actions">
            <v-btn ref="parentCancel" data-testid="fixture-cancel" @click="parent = false">{{ en ? 'Cancel' : '取消' }}</v-btn>
            <v-btn data-testid="fixture-confirm" color="error" @click="parent = false">{{ en ? 'Confirm' : '确认' }}</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <v-dialog v-model="child" aria-label="Child fixture" max-width="420" scrollable @after-enter="childCancel?.$el.focus()">
        <v-card class="feedback-fixture-card">
          <v-card-title>Nested confirmation</v-card-title>
          <v-card-text>Keep the existing notification in the highest active modal.</v-card-text>
          <v-card-actions><v-btn ref="childCancel" @click="child = false">Close child</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
    </v-main>
  </v-app>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import AppToasts from '../src/shared/feedback/AppToasts.vue'
const en = new globalThis.URLSearchParams(globalThis.location.search).get('language') === 'en'
const parent = ref(false), child = ref(false)
const custom = ref(false)
const layout = new globalThis.URLSearchParams(globalThis.location.search).get('layout') === 'grid' ? 'grid' : 'flex'
const customCancel = ref<globalThis.HTMLButtonElement | null>(null)
const parentCancel = ref<{ $el: globalThis.HTMLElement } | null>(null), childCancel = ref<{ $el: globalThis.HTMLElement } | null>(null)
/** Publishes actual library messages without overriding the production duration or queue. */
function publish(count: number) {
  for (let index = 1; index <= count; index++) toast.success((en ? 'Saved notification ' : '已保存提示 ') + index + ': ' + (en ? 'A long message remains readable and individually dismissible. ' : '长消息仍需保持可读并可单独关闭。') + '无空格🙂'.repeat(35) + ' <scr' + 'ipt>literal text</scr' + 'ipt>')
}
</script>
<style>
.feedback-fixture-card { min-width: 0; }
.feedback-empty-panel { position: relative; min-width: 0; padding: 18px; border: 1px solid; background: rgb(var(--v-theme-surface)); }
.feedback-empty-panel--flex { display: flex; flex-direction: column; gap: 14px; }
.feedback-empty-panel--grid { display: grid; gap: 16px; }
.feedback-empty-panel h2 { margin: 0; }
.feedback-fixture-card .v-card-title { white-space: normal; overflow-wrap: anywhere; }
.feedback-fixture-card .v-card-text { display: grid; grid-auto-rows: max-content; gap: 12px; }
.feedback-fixture-card .v-card-actions { flex-wrap: wrap; }
</style>
