import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-vue',
              test: /node_modules[\\/](?:@vue|vue|vue-i18n|vue-router|pinia|@tanstack)[\\/]/,
              priority: 40,
            },
            {
              name: 'vendor-vuetify',
              test: /node_modules[\\/]vuetify[\\/]/,
              priority: 30,
            },
            {
              name: 'vendor-chart',
              test: /node_modules[\\/]chart\.js[\\/]/,
              priority: 20,
            },
            {
              name: 'vendor-qrcode',
              // dijkstrajs and pngjs are transitive qrcode dependencies. Revalidate this pattern whenever qrcode is upgraded.
              test: /node_modules[\\/](?:qrcode|dijkstrajs|pngjs)[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
})
