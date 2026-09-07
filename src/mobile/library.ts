import { createLibraryClient } from '../../src-tauri/src/remote_access/data-cache.js'
import { MAX_QUEUE_LENGTH, createPlayerState, replaceQueue } from '../../src-tauri/src/remote_access/player-core.js'
import type { Album, Artist, LibraryModel, View } from './model'

/** HTTP adapter only: no Qwik, native IPC, rendering, or playback side effects. */
export class LibraryController {
  private generation = 0
  private client
  constructor(
    readonly state: LibraryModel,
    fetcher: typeof fetch = fetch,
    private onRevision: (revision: string) => void = () => {}
  ) {
    this.client = createLibraryClient(fetcher)
  }
  dispose() {
    ++this.generation
    this.client.clear()
  }
  invalidate() {
    this.client.clear()
  }
  async navigate(view: View, artist = '', album = '') {
    Object.assign(this.state, { view, artist, album, search: '' })
    await this.load()
  }
  async back() {
    const s = this.state
    await this.navigate(s.album ? 'albums' : 'artists', s.album ? s.artist : '')
  }
  async load(append = false, refresh = false): Promise<void> {
    const s = this.state
    const generation = ++this.generation
    if (refresh) this.client.clear()
    if (!append)
      Object.assign(s, { cursor: '', offset: 0, total: 0, revision: '', tracks: [], albums: [], artists: [] })
    s.loading = true
    s.error = ''
    s.more = false
    const params = new URLSearchParams({ limit: '50', q: s.search })
    if (s.view === 'tracks') {
      if (s.cursor) params.set('cursor', s.cursor)
      if (s.album) params.set('album', s.album)
      if (s.artist) params.set('artist', s.artist)
    } else {
      params.set('offset', String(s.offset))
      if (s.view === 'albums' && s.artist) params.set('artist', s.artist)
    }
    try {
      const response = await this.client.get(`/api/${s.view}?${params}`, { refresh })
      if (generation !== this.generation) return
      if (response.status === 409 && append) return this.load(false, true)
      if (!response.ok) throw new Error('Could not load the library. Try again.')
      const body = await response.json()
      if (generation !== this.generation) return
      const revision =
        s.view === 'tracks' ? response.headers.get('x-jukebox-catalog-revision') || '' : String(body.revision)
      if (append && s.revision && s.revision !== revision) return this.load(false, true)
      if (s.view === 'tracks') {
        const rows = replaceQueue(createPlayerState(), body).queue
        s.tracks = [...s.tracks, ...rows].slice(0, MAX_QUEUE_LENGTH)
        s.cursor = response.headers.get('x-jukebox-next-cursor') || ''
        s.offset = s.tracks.length
        s.more = Boolean(s.cursor) && s.offset < MAX_QUEUE_LENGTH
      } else {
        if (!Array.isArray(body.items) || !Number.isFinite(body.total)) throw new Error('Invalid library response.')
        if (s.view === 'albums') s.albums = [...s.albums, ...(body.items as Album[])]
        else s.artists = [...s.artists, ...(body.items as Artist[])]
        s.offset += body.items.length
        s.total = body.total
        s.more = s.offset < s.total
      }
      s.revision = revision
      s.offline = response.headers.get('x-jukebox-offline') === 'true'
      this.onRevision(revision)
    } catch (error) {
      if (generation === this.generation)
        s.error = error instanceof Error ? error.message : 'Could not load the library.'
    } finally {
      if (generation === this.generation) s.loading = false
    }
  }
}
