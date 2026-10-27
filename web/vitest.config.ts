import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { loadBuildMetadata } from './scripts/build-version.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const buildMetadata = loadBuildMetadata(repositoryRoot)

export default defineConfig({
  define: { __MOEURL_BUILD__: JSON.stringify(buildMetadata) },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    server: { deps: { inline: ['vuetify'] } },
    execArgv: ['--no-experimental-webstorage'],
    coverage: {
      include: [
        'src/app/**/*.{ts,vue}',
        'src/entities/**/*.ts',
        'src/features/**/*.{ts,vue}',
        'src/pages/**/*.vue',
        'src/shared/**/*.ts',
      ],
      exclude: ['src/main.ts', 'src/**/*.test.ts', 'src/**/*.d.ts', 'src/entities/**/model.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        100: true,
      },
    },
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    globals: true,
  },
})
