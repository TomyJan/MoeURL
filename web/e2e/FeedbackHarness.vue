<template>
  <v-app>
    <AppToasts />
    <v-main>
      <button @click="publish(1)">Publish one</button>
      <button @click="publish(5)">Publish five</button>
      <button @click="parent = true">Open parent</button>
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
const parentCancel = ref<{ $el: globalThis.HTMLElement } | null>(null), childCancel = ref<{ $el: globalThis.HTMLElement } | null>(null)
/** Publishes actual library messages without overriding the production duration or queue. */
function publish(count: number) {
  for (let index = 1; index <= count; index++) toast.success((en ? 'Saved notification ' : '已保存提示 ') + index + ': ' + (en ? 'A long message remains readable and individually dismissible. ' : '长消息仍需保持可读并可单独关闭。') + '无空格🙂'.repeat(35) + ' <scr' + 'ipt>literal text</scr' + 'ipt>')
}
</script>
<style>
.feedback-fixture-card { min-width: 0; }
.feedback-fixture-card .v-card-title { white-space: normal; overflow-wrap: anywhere; }
.feedback-fixture-card .v-card-text { display: grid; gap: 12px; }
.feedback-fixture-card .v-card-actions { flex-wrap: wrap; }
</style>
