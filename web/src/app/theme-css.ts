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
    radial-gradient(circle at 16% 8%, var(--moeurl-hero-glow), transparent 26rem),
    radial-gradient(circle at 86% 0%, color-mix(in srgb, rgb(var(--v-theme-primary)) 14%, transparent), transparent 24rem),
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
}

.v-field__outline {
  --v-field-border-opacity: 0.18;
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

:where(a, button, input, select, textarea):focus-visible {
  outline: 3px solid var(--moeurl-ring);
  outline-offset: 3px;
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
