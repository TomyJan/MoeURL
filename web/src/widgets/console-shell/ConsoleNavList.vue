<template>
  <nav class="console-nav-list" :class="`console-nav-list--${variant}`">
    <section v-for="group in navGroups" :key="group.labelKey" class="console-nav-list__group">
      <p class="console-nav-list__label">{{ t(group.labelKey) }}</p>
      <template v-for="item in group.items" :key="item.to || item.labelKey">
        <v-btn
          v-if="item.to"
          :to="item.to"
          class="console-nav-list__item console-nav-list__item--primary"
          data-testid="console-nav-primary-item"
          variant="text"
          @click="$emit('navigate')"
        >
          <span class="console-nav-list__rail" aria-hidden="true" />
          <span class="console-nav-list__text">{{ t(item.labelKey) }}</span>
          <span v-if="item.planned" class="console-nav-list__badge" data-testid="console-nav-planned-badge">
            {{ t('placeholder.status') }}
          </span>
        </v-btn>

        <div v-else class="console-nav-list__subgroup">
          <button
            class="console-nav-list__item console-nav-list__item--primary console-nav-list__item--parent"
            data-testid="console-nav-parent-item"
            type="button"
            :aria-expanded="expandedGroups.has(item.labelKey)"
            @click="toggleGroup(item.labelKey)"
          >
            <span class="console-nav-list__rail" aria-hidden="true" />
            <span class="console-nav-list__text">{{ t(item.labelKey) }}</span>
            <span class="console-nav-list__caret" aria-hidden="true" />
          </button>
          <Transition name="console-nav-children">
            <div v-if="expandedGroups.has(item.labelKey)" class="console-nav-list__children">
              <v-btn
                v-for="child in item.children"
                :key="child.to"
                :to="child.to"
                class="console-nav-list__item console-nav-list__item--child"
                data-testid="console-nav-child-item"
                variant="text"
                @click="$emit('navigate')"
              >
                <span class="console-nav-list__rail" aria-hidden="true" />
                <span class="console-nav-list__text">{{ t(child.labelKey) }}</span>
                <span v-if="child.planned" class="console-nav-list__badge" data-testid="console-nav-planned-badge">
                  {{ t('placeholder.status') }}
                </span>
              </v-btn>
            </div>
          </Transition>
        </div>
      </template>
    </section>
  </nav>
</template>

<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

export interface ConsoleNavItem {
  children?: ConsoleNavItem[]
  labelKey: string
  level?: 1 | 2
  planned?: boolean
  to?: string
}

export interface ConsoleNavGroup {
  items: ConsoleNavItem[]
  labelKey: string
}

const props = withDefaults(
  defineProps<{
    navGroups: ConsoleNavGroup[]
    variant?: 'desktop' | 'mobile'
  }>(),
  {
    variant: 'desktop',
  },
)

defineEmits<{
  navigate: []
}>()

const { t } = useI18n()
const route = useRoute()
const expandedGroups = ref(new Set<string>())

watchEffect(() => {
  const nextExpandedGroups = new Set<string>()
  for (const group of props.navGroups) {
    for (const item of group.items) {
      if (item.children?.some((child) => child.to === route.path)) {
        nextExpandedGroups.add(item.labelKey)
      }
    }
  }
  expandedGroups.value = nextExpandedGroups
})

function toggleGroup(labelKey: string) {
  const nextExpandedGroups = new Set(expandedGroups.value)
  if (nextExpandedGroups.has(labelKey)) {
    nextExpandedGroups.delete(labelKey)
    expandedGroups.value = nextExpandedGroups
    return
  }
  nextExpandedGroups.add(labelKey)
  expandedGroups.value = nextExpandedGroups
}
</script>

<style scoped>
.console-nav-list,
.console-nav-list__group,
.console-nav-list__subgroup,
.console-nav-list__children {
  display: grid;
}

.console-nav-list {
  align-content: start;
  gap: 18px;
  padding: 4px 2px;
}

.console-nav-list__group,
.console-nav-list__subgroup {
  gap: 5px;
}

.console-nav-list__label {
  margin: 0 0 2px;
  padding: 0 13px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.71rem;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
}

.console-nav-list__item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  gap: 8px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 20px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
  font: inherit;
  font-size: 0.93rem;
  font-weight: 790;
  text-align: left;
  text-decoration: none;
  transition:
    background 170ms ease,
    border-color 170ms ease,
    color 170ms ease,
    transform 170ms ease;
}

.console-nav-list__item:hover {
  border-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 14%, transparent);
  background: color-mix(in srgb, var(--moeurl-surface-strong) 32%, transparent);
  color: rgb(var(--v-theme-on-surface));
}

.console-nav-list__item :deep(.v-btn__content) {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  gap: 8px;
}

.console-nav-list__rail {
  display: inline-block;
  flex: 0 0 auto;
  width: 3px;
  height: 17px;
  border-radius: 999px;
  background: transparent;
  transition: background 170ms ease;
}

.console-nav-list__text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-nav-list__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-height: 20px;
  max-width: 72px;
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-secondary)) 22%, transparent);
  border-radius: var(--moeurl-radius-pill);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.68rem;
  font-weight: 880;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-nav-list__caret {
  width: 8px;
  height: 8px;
  margin-left: auto;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  transform: rotate(-45deg);
  transition: transform 180ms ease;
}

.console-nav-list__item--parent[aria-expanded="true"] {
  border-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
  background: color-mix(in srgb, var(--moeurl-surface-strong) 40%, transparent);
  color: rgb(var(--v-theme-on-surface));
}

.console-nav-list__item.router-link-active .console-nav-list__rail,
.console-nav-list__item[aria-current="page"] .console-nav-list__rail {
  background: rgb(var(--v-theme-secondary));
}

.console-nav-list__item--parent[aria-expanded="true"] .console-nav-list__caret {
  transform: rotate(45deg) translateY(-1px);
}

.console-nav-list__item.router-link-active,
.console-nav-list__item[aria-current="page"] {
  border-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent);
  background: color-mix(in srgb, var(--moeurl-surface-strong) 52%, transparent);
  color: rgb(var(--v-theme-primary));
  font-weight: 870;
}

.console-nav-list__children {
  gap: 4px;
  margin: 4px 0 5px 14px;
  padding-left: 9px;
  border-left: 1px solid var(--moeurl-outline-strong);
}

.console-nav-list__item--child {
  min-height: 38px;
  border-radius: 18px;
  font-size: 0.9rem;
}

.console-nav-list--mobile {
  gap: 16px;
  padding: 0;
}

.console-nav-list--mobile .console-nav-list__item {
  min-height: 44px;
}

.console-nav-children-enter-active,
.console-nav-children-leave-active {
  overflow: hidden;
  transition: opacity 170ms ease, transform 170ms ease, max-height 170ms ease;
}

.console-nav-children-enter-from,
.console-nav-children-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.console-nav-children-enter-to,
.console-nav-children-leave-from {
  max-height: 180px;
  opacity: 1;
  transform: translateY(0);
}
</style>
