import { AUDIO_CACHE, cachedAudioResponse, trimCache } from './data-cache.js'

const CACHE_NAME = 'jukebox-shell-v9'
const LIBRARY_CACHE = 'jukebox-library-v1'
const ART_CACHE = 'jukebox-art-v1'
const SHELL_PATHS = new Set([
  '/',
  '/app.css',
  '/app.js',
  '/player-core.js',
  '/player-sheet.js',
  '/data-cache.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
])
const OWNED_CACHES = new Set([CACHE_NAME, LIBRARY_CACHE, ART_CACHE, AUDIO_CACHE])

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...SHELL_PATHS].map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('jukebox-') && !OWNED_CACHES.has(key)).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

const offlineCopy = async (response) => {
  const headers = new Headers(response.headers)
  headers.set('x-jukebox-offline', 'true')
  return new Response(await response.arrayBuffer(), { status: response.status, headers })
}
const networkWithFallback = async (request, cacheName, limit, offline = false) => {
  let cache
  try {
    cache = await caches.open(cacheName)
  } catch {
    return fetch(request)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(new Request(request, { cache: 'reload', signal: controller.signal }))
    if (response.status >= 500) throw new Error('Server unavailable')
    if (response.ok) {
      // Cache failure must never turn a successful library request into an error.
      try {
        await cache.put(request, response.clone())
        await trimCache(cache, limit)
      } catch {
        /* Storage is full or unavailable. */
      }
    } else {
      await cache.delete(request)
    }
    return response
  } catch {
    const saved = await cache.match(request)
    return saved ? (offline ? offlineCopy(saved) : saved) : new Response('Not available offline', { status: 503 })
  } finally {
    clearTimeout(timeout)
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (SHELL_PATHS.has(url.pathname)) {
    event.respondWith(networkWithFallback(event.request, CACHE_NAME, SHELL_PATHS.size))
  } else if (/^\/api\/(tracks|albums|artists)$/.test(url.pathname)) {
    event.respondWith(networkWithFallback(event.request, LIBRARY_CACHE, 40, true))
  } else if (url.pathname === '/api/artwork' || /^\/api\/tracks\/[^/]+\/artwork$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        let cache
        try {
          cache = await caches.open(ART_CACHE)
        } catch {
          return fetch(event.request)
        }
        const saved = await cache.match(event.request)
        // Artwork is reused immediately, then refreshed while connected.
        if (saved) {
          event.waitUntil(networkWithFallback(event.request, ART_CACHE, 96))
          return saved
        }
        return networkWithFallback(event.request, ART_CACHE, 96)
      })()
    )
  } else if (/^\/api\/tracks\/[^/]+\/stream$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        let saved
        try {
          saved = await (await caches.open(AUDIO_CACHE)).match(url.href)
        } catch {
          return fetch(event.request)
        }
        if (saved) return cachedAudioResponse(saved, event.request.headers.get('range'))
        return fetch(event.request)
      })()
    )
  }
})
