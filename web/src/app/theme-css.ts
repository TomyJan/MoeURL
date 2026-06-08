export const moeurlThemeCss = `
:root {
  color: rgb(var(--v-theme-on-background));
  background: rgb(var(--v-theme-background));
  --moeurl-surface-soft: var(--v-app-soft-surface);
  --moeurl-outline: var(--v-app-outline);
  --moeurl-shadow: var(--v-app-shadow);
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
  background: rgb(var(--v-theme-background));
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
