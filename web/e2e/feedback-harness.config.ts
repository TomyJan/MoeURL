import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    // The caller owns a unique external test-output directory; this never writes web/dist.
    emptyOutDir: true,
    lib: { entry: fileURLToPath(new URL('./feedback-harness.ts', import.meta.url)), name: 'MoeURLFeedbackHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' },
  },
})
