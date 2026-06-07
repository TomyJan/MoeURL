const APP_SHELL_CACHE = 'moeurl-app-shell-v1'
const APP_SHELL_ASSETS = ['/', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL_ASSETS)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (url.pathname.startsWith('/api/v1/')) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request))
  }
})
