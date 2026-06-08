export const moeurlThemeCss = `
:root {
  color: rgb(var(--v-theme-on-background));
  background: rgb(var(--v-theme-background));
  --moeurl-surface-elevated: var(--v-app-elevated-surface);
  --moeurl-surface-glass: var(--v-app-glass-surface);
  --moeurl-surface-soft: var(--v-app-soft-surface);
  --moeurl-hero-glow: var(--v-app-hero-glow);
  --moeurl-outline: var(--v-app-outline);
  --moeurl-ring: var(--v-app-ring);
  --moeurl-shadow: var(--v-app-shadow);
  --moeurl-shadow-strong: var(--v-app-shadow-strong);
  --moeurl-radius-page: var(--v-radius-page);
  --moeurl-radius-panel: var(--v-radius-panel);
  --moeurl-radius-card: var(--v-radius-card);
  --moeurl-radius-control: var(--v-radius-control);
}

html,
body,
#app {
  min-height: 100%;
}

body {
  margin: 0;
  background:
    radial-gradient(circle at 16% 8%, var(--moeurl-hero-glow), transparent 24rem),
    radial-gradient(circle at 86% 0%, color-mix(in srgb, rgb(var(--v-theme-secondary)) 9%, transparent), transparent 22rem),
    rgb(var(--v-theme-background));
  font-feature-settings: "liga" 1, "kern" 1;
}

.v-application {
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
}

.v-card,
.v-dialog > .v-overlay__content > .v-card,
.v-table,
.v-navigation-drawer {
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
}

.v-card,
.v-navigation-drawer {
  background: var(--moeurl-surface-glass);
  backdrop-filter: blur(22px);
}

.v-btn {
  letter-spacing: 0;
  text-transform: none;
}

.v-field {
  border-radius: 24px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 56%, transparent);
  transition: background 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.v-field__outline {
  --v-field-border-opacity: 0.18;
}

.v-field--focused {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(var(--v-theme-primary)) 42%, transparent);
}

.v-table {
  overflow: hidden;
  background: transparent;
}

.v-table th {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
}

.v-table td,
.v-table th {
  border-color: var(--moeurl-outline);
}

:where(a, button, [role="button"]):focus-visible {
  outline: 3px solid var(--moeurl-ring);
  outline-offset: 3px;
}

.moe-route-enter-active,
.moe-route-leave-active,
.moe-layout-enter-active,
.moe-layout-leave-active,
.moe-overlay-enter-active,
.moe-overlay-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.moe-route-enter-from,
.moe-layout-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.moe-route-leave-to,
.moe-layout-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.moe-overlay-enter-from,
.moe-overlay-leave-to {
  opacity: 0;
}

.moe-overlay-enter-from .moe-overlay-panel,
.moe-overlay-leave-to .moe-overlay-panel {
  transform: translateY(16px) scale(0.98);
}

.console-page {
  display: grid;
  gap: 16px;
}

.console-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.console-page__eyebrow,
.console-form-panel__mark {
  margin: 0 0 6px;
  color: rgb(var(--v-theme-secondary));
  font-size: 0.8rem;
  font-weight: 900;
  letter-spacing: 0;
}

.console-page__header h1 {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.35rem);
  line-height: 1.2;
}

.console-page__total,
.console-page__muted,
.console-page__notice {
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-page__toolbar,
.console-page__filters,
.console-page__actions-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 100%;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 78%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--moeurl-surface-glass) 74%, transparent);
  box-shadow: 0 14px 34px color-mix(in srgb, rgb(var(--v-theme-primary)) 5%, transparent);
  backdrop-filter: blur(18px);
}

.console-page__toolbar {
  min-width: min(230px, 100%);
}

.console-page__filters {
  display: grid;
  grid-template-columns: minmax(150px, 190px) minmax(220px, 310px);
}

.console-page__actions-bar {
  justify-self: end;
  justify-content: flex-end;
  border-style: solid;
  background: color-mix(in srgb, var(--moeurl-surface-glass) 58%, transparent);
}

.console-page__panel,
.console-data-panel,
.console-form-panel {
  overflow: hidden;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 5%, transparent), transparent 30%),
    var(--moeurl-surface-glass);
  box-shadow: 0 18px 48px color-mix(in srgb, black 18%, transparent);
  backdrop-filter: blur(18px);
}

.console-page__panel {
  padding: 10px;
}

.console-data-panel {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.console-page__table {
  overflow-x: auto;
}

.console-page__table a,
.console-page__mobile-card a,
.console-link-row a {
  color: rgb(var(--v-theme-primary));
  font-weight: 800;
  text-decoration: none;
}

.console-page__table a:hover,
.console-page__mobile-card a:hover,
.console-link-row a:hover {
  text-decoration: underline;
}

.console-link-list,
.console-user-list {
  display: grid;
  gap: 10px;
}

.console-link-row,
.console-user-row {
  display: grid;
  align-items: start;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: 26px;
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 6%, transparent), transparent 38%),
    color-mix(in srgb, var(--moeurl-surface-elevated) 82%, rgb(var(--v-theme-surface)) 18%);
}

.console-link-row {
  grid-template-columns: minmax(190px, 1.1fr) minmax(240px, 1.45fr) minmax(80px, auto) minmax(190px, auto);
}

.console-link-row:has(.console-link-row__owner) {
  grid-template-columns: minmax(160px, 0.85fr) minmax(230px, 1.2fr) minmax(110px, 0.6fr) minmax(76px, auto) minmax(190px, auto);
}

.console-link-row__main,
.console-link-row__target,
.console-link-row__owner,
.console-user-row__identity {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.console-link-row__actions {
  min-width: 0;
}

.console-link-row__actions .v-btn,
.console-user-row__actions .v-btn,
.console-user-row__summary-actions .v-btn {
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 58%, transparent);
}

.console-link-row__target span:last-child,
.console-link-row__owner small {
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-link-row a,
.console-link-row__target span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.console-link-row__label {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.72rem;
  font-weight: 900;
}

.console-link-row__meta,
.console-link-row__actions,
.console-user-row__actions,
.console-user-row__badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.console-link-row__actions {
  position: relative;
  justify-content: flex-end;
}

.console-link-row__more,
.console-user-row__more {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 74%, transparent);
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 58%, transparent);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 850;
}

.console-link-row__more-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 8;
  display: grid;
  min-width: 150px;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 18px;
  background: var(--moeurl-surface-glass);
  box-shadow: var(--moeurl-shadow);
  backdrop-filter: blur(22px);
}

.console-link-row__status {
  display: inline-flex;
  padding: 6px 11px;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface-variant)) 10%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 850;
}

.console-link-row__status--active {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 14%, transparent);
  color: rgb(var(--v-theme-primary));
}

.console-link-row__status--disabled {
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 16%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-user-row {
  grid-template-columns: minmax(190px, 1fr) minmax(150px, auto) minmax(170px, auto);
}

.console-user-row__identity {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
}

.console-user-row__badges,
.console-user-row__summary-actions {
  align-self: center;
}

.console-user-row__identity strong {
  font-size: 1.02rem;
}

.console-user-row__identity small {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.5;
}

.console-user-row__avatar {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 18px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent);
  color: rgb(var(--v-theme-primary));
  font-weight: 900;
}

.console-user-row__summary-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.console-user-row__actions {
  grid-column: 1 / -1;
  display: grid;
  width: min(760px, 100%);
  gap: 8px;
  margin-top: -2px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: 20px;
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 7%, transparent), transparent 68%),
    color-mix(in srgb, var(--moeurl-surface-glass) 62%, transparent);
}

.console-user-row__actions--more {
  width: min(620px, 100%);
  grid-template-columns: minmax(116px, auto) minmax(260px, 1fr);
  align-items: center;
}

.console-user-row__panel-title {
  grid-column: 1 / -1;
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 900;
}

.console-user-row__nickname,
.console-user-row__password {
  display: grid;
  grid-template-columns: minmax(180px, 260px) minmax(120px, auto);
  align-items: center;
  gap: 8px;
}

.console-user-row__nickname > .v-btn,
.console-user-row__password > .v-btn {
  width: fit-content;
  min-width: 120px;
  justify-self: start;
}

.console-page__mobile-list {
  display: none;
}

.console-page__mobile-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 72%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 72%, transparent);
}

.console-page__mobile-card + .console-page__mobile-card {
  margin-top: 12px;
}

.console-page__mobile-card-head,
.console-page__owner {
  display: grid;
  gap: 8px;
}

.console-page__mobile-card a,
.console-page__mobile-card p {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.console-page__mobile-card p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-page__empty {
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 168px;
  padding: 26px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: calc(var(--moeurl-radius-panel) - 10px);
  background:
    radial-gradient(circle at 12% 12%, color-mix(in srgb, rgb(var(--v-theme-primary)) 13%, transparent), transparent 18rem),
    color-mix(in srgb, var(--moeurl-surface-elevated) 74%, transparent);
}

.console-page__empty-mark {
  display: grid;
  flex: 0 0 54px;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 20px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 900;
}

.console-page__empty h2 {
  margin: 0 0 6px;
  font-size: 1.1rem;
}

.console-page__empty p {
  max-width: 36rem;
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-page__actions,
.console-page__row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.console-page__row-actions {
  align-items: center;
  min-width: 360px;
}

.console-page__status,
.console-page__type {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface-variant)) 10%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 800;
}

.console-page__status--active {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 13%, transparent);
  color: rgb(var(--v-theme-primary));
}

.console-page__status--disabled {
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 16%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-page__notice {
  margin: 14px 0 0;
  font-size: 0.86rem;
}

.console-form-panel {
  display: grid;
  width: min(860px, 100%);
  justify-self: start;
  gap: 18px;
  padding: clamp(18px, 3vw, 26px);
}

.console-form-panel__intro {
  display: grid;
  gap: 8px;
  max-width: 540px;
}

.console-form-panel__mark {
  width: fit-content;
  padding: 6px 12px;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 15%, transparent);
}

.console-form-panel__intro h2 {
  margin: 0;
  font-size: clamp(1.3rem, 2.4vw, 1.7rem);
}

.console-form-panel__intro p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.7;
}

.console-form-panel__body {
  display: grid;
  gap: 14px;
}

.console-form-panel__group {
  min-width: 0;
  margin: 0;
  padding: 15px 15px 0;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 76%, transparent);
  border-radius: 28px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 58%, transparent);
}

.console-form-panel__group legend {
  padding: 0 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  font-weight: 900;
}

.console-form-panel__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.console-form-panel__grid--compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.console-form-panel__actions {
  display: flex;
  justify-content: flex-end;
}

.console-form-panel__submit {
  min-width: 136px;
  min-height: 48px;
}

@media (max-width: 1240px) {
  .console-link-row,
  .console-link-row:has(.console-link-row__owner) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  }

  .console-link-row__actions {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .console-page__header {
    display: grid;
    align-items: start;
  }

  .console-page__toolbar,
  .console-page__filters,
  .console-page__actions-bar {
    width: 100%;
  }

  .console-page__actions-bar {
    width: fit-content;
    justify-self: start;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
  }

  .console-page__filters,
  .console-form-panel__grid,
  .console-form-panel__grid--compact {
    grid-template-columns: 1fr;
  }

  .console-page__table {
    display: none;
  }

  .console-link-row,
  .console-link-row:has(.console-link-row__owner),
  .console-user-row {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .console-link-row__actions,
  .console-user-row__summary-actions {
    justify-content: flex-start;
  }

  .console-user-row__actions {
    display: grid;
    width: 100%;
    grid-template-columns: 1fr;
  }

  .console-user-row__actions--more {
    grid-template-columns: 1fr;
  }

  .console-page__empty {
    display: grid;
    justify-items: center;
    text-align: center;
  }

  .console-form-panel__actions {
    display: grid;
  }

  .console-user-row__nickname,
  .console-user-row__password {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .console-user-row__actions > .v-btn,
  .console-user-row__nickname > .v-btn,
  .console-user-row__password > .v-btn {
    width: fit-content;
    min-width: 120px;
  }
}
`

export function installMoeurlThemeCss(documentRef: Document = document): HTMLStyleElement {
  const styleId = 'moeurl-theme-css'
  const existing = documentRef.getElementById(styleId)

  if (existing instanceof HTMLStyleElement) {
    existing.textContent = moeurlThemeCss
    return existing
  }

  const style = documentRef.createElement('style')
  style.id = styleId
  style.textContent = moeurlThemeCss
  documentRef.head.append(style)
  return style
}
