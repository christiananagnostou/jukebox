export const AUDIO_CACHE = 'jukebox-audio-v1'
export const MAX_OFFLINE_TRACKS = 5
export const MAX_OFFLINE_TRACK_BYTES = 32 * 1024 * 1024

/** Coalesce concurrent reads, bound memory, and invalidate all pages on revision changes. */
export const createLibraryClient = (fetcher = fetch, now = Date.now) => {
  const entries = new Map()
  const pending = new Map()
  let revision = ''
  return {
    clear: () => entries.clear(),
    async get(url, { refresh = false } = {}) {
      const cached = entries.get(url)
      if (!refresh && cached && now() - cached.saved < 45_000) return cached.response.clone()
      if (pending.has(url)) return (await pending.get(url)).clone()
      const request = (async () => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8_000)
        try {
          const response = await fetcher(url, { signal: controller.signal })
          if (response.ok) {
            const body = await response.clone().json()
            const nextRevision = response.headers.get('x-jukebox-catalog-revision') || String(body.revision ?? '')
            if (revision && nextRevision && revision !== nextRevision) entries.clear()
            if (nextRevision) revision = nextRevision
            entries.delete(url)
            entries.set(url, { saved: now(), response: response.clone() })
            while (entries.size > 40) entries.delete(entries.keys().next().value)
          }
          return response
        } finally {
          clearTimeout(timeout)
          pending.delete(url)
        }
      })()
      pending.set(url, request)
      return (await request).clone()
    },
  }
}

export const trimCache = async (cache, limit) => {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)))
}

/** Serve Safari's bounded, open, and suffix byte ranges from a complete saved track. */
export const cachedAudioResponse = async (response, range) => {
  if (!range) return response
  const bytes = await response.arrayBuffer()
  const total = bytes.byteLength
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  const invalid = () => new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
  if (!match || (!match[1] && !match[2]) || !total) return invalid()
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || end < start) return invalid()
  const headers = new Headers(response.headers)
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
  headers.set('Content-Length', String(end - start + 1))
  headers.set('Accept-Ranges', 'bytes')
  return new Response(bytes.slice(start, end + 1), { status: 206, headers })
}

/** Stream into a bounded buffer; never save partial or oversized media responses. */
export const saveOfflineTrack = async (cache, url, fetcher = fetch) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok || response.status === 206 || !response.body)
      throw new Error('Could not save this song. Try again when connected.')
    if (Number(response.headers.get('content-length')) > MAX_OFFLINE_TRACK_BYTES) {
      controller.abort()
      throw new Error('This song is too large to save offline (32 MB maximum).')
    }
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_OFFLINE_TRACK_BYTES) {
        await reader.cancel()
        throw new Error('This song is too large to save offline (32 MB maximum).')
      }
      chunks.push(value)
    }
    if (!size) throw new Error('This song did not download. Try again.')
    const headers = new Headers(response.headers)
    headers.set('Content-Length', String(size))
    await cache.put(url, new Response(new Blob(chunks), { headers }))
    await trimCache(cache, MAX_OFFLINE_TRACKS)
  } finally {
    clearTimeout(timeout)
  }
}
