import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    coverage: {
      include: [
        'src/app/{i18n,query,router,vuetify}.ts',
        'src/entities/**/*.ts',
        'src/shared/**/*.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/entities/**/model.ts'],
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
