import { invoke } from '@tauri-apps/api/core'

export interface PlaylistSummary {
  createdAt: string
  entryCount: number
  id: string
  kind: 'manual' | 'smart'
  name: string
  updatedAt: string
}

export interface PlaylistEntry {
  addedAt: string
  album: string
  artist: string
  availability: 'available' | 'unavailable' | 'missing'
  id: string
  playlistId: string
  position: number
  songId: string
  title: string
}

export interface PlaylistPage<Item> {
  items: Item[]
  total: number
}

export interface PlaylistMutation {
  affected: number
}

export interface PlaylistPageQuery {
  limit: number
  offset: number
}

export interface PlaylistCatalogState<Item> {
  error: string
  pages: Record<string, Item[]>
  status: 'loading' | 'ready' | 'error'
  total: number
}

export const PLAYLIST_PAGE_SIZE = 50
export const PLAYLIST_ENTRY_PAGE_SIZE = 100
export const MAX_RETAINED_PLAYLIST_PAGES = 5

export type PlaylistPageFetcher = (query: PlaylistPageQuery) => Promise<PlaylistPage<PlaylistSummary>>
export type PlaylistEntryPageFetcher = (
  playlistId: string,
  query: PlaylistPageQuery
) => Promise<PlaylistPage<PlaylistEntry>>

export function createPlaylist(name: string): Promise<PlaylistSummary> {
  return invoke('create_playlist', { name })
}

export function listPlaylists(query: PlaylistPageQuery): Promise<PlaylistPage<PlaylistSummary>> {
  return invoke('list_playlists', { query })
}

export function renamePlaylist(playlistId: string, name: string): Promise<PlaylistSummary> {
  return invoke('rename_playlist', { playlistId, name })
}

export function deletePlaylist(playlistId: string): Promise<PlaylistMutation> {
  return invoke('delete_playlist', { playlistId })
}

export function addPlaylistEntries(playlistId: string, songIds: string[]): Promise<PlaylistMutation> {
  return invoke('add_playlist_entries', { playlistId, songIds })
}

export function listPlaylistEntries(
  playlistId: string,
  query: PlaylistPageQuery
): Promise<PlaylistPage<PlaylistEntry>> {
  return invoke('list_playlist_entries', { playlistId, query })
}

export function removePlaylistEntries(playlistId: string, entryIds: string[]): Promise<PlaylistMutation> {
  return invoke('remove_playlist_entries', { playlistId, entryIds })
}

type ScopedPageFetcher<Item, Scope> = (scope: Scope, query: PlaylistPageQuery) => Promise<PlaylistPage<Item>>

class BoundedPlaylistPager<Item, Scope> {
  private generation = 0
  private scope?: Scope
  private scopeKey = ''
  private queue = Promise.resolve()

  constructor(
    private readonly state: PlaylistCatalogState<Item>,
    private readonly pageSize: number,
    private readonly fetchPage: ScopedPageFetcher<Item, Scope>
  ) {}

  protected resetScope(scope: Scope, scopeKey: string): Promise<void> {
    if (scopeKey === this.scopeKey && this.state.status !== 'error') return this.queue
    this.scope = scope
    this.scopeKey = scopeKey
    return this.enqueueRange(0, 0, this.beginQuery())
  }

  reload(): Promise<void> {
    if (this.scope === undefined) return Promise.resolve()
    const scopeKey = this.scopeKey
    this.scopeKey = ''
    return this.resetScope(this.scope, scopeKey)
  }

  clear(): void {
    this.scope = undefined
    this.scopeKey = ''
    this.beginQuery()
  }

  ensureRange(startIndex: number, endIndex: number): Promise<void> {
    if (this.state.status === 'error' || endIndex < 0) return Promise.resolve()
    const startPage = Math.max(0, Math.floor(startIndex / this.pageSize))
    const endPage = Math.max(startPage, Math.floor(endIndex / this.pageSize))
    return this.enqueueRange(startPage, endPage, this.generation)
  }

  dispose(): void {
    this.generation += 1
  }

  private enqueueRange(startPage: number, endPage: number, generation: number): Promise<void> {
    this.queue = this.queue.then(() => this.loadRange(startPage, endPage, generation))
    return this.queue
  }

  private async loadRange(startPage: number, endPage: number, generation: number): Promise<void> {
    if (this.scope === undefined) return
    try {
      for (let pageIndex = startPage; pageIndex <= endPage; pageIndex += 1) {
        if (generation !== this.generation) return
        if (this.state.pages[String(pageIndex)]) continue
        const page = await this.fetchPage(this.scope, {
          limit: this.pageSize,
          offset: pageIndex * this.pageSize,
        })
        if (generation !== this.generation) return
        this.state.pages[String(pageIndex)] = page.items
        this.state.total = page.total
      }
      if (generation !== this.generation) return
      this.evictDistantPages(startPage, endPage)
      this.state.error = ''
      this.state.status = 'ready'
    } catch (error) {
      if (generation !== this.generation) return
      this.state.error = playlistErrorMessage(error)
      this.state.status = 'error'
    }
  }

  private beginQuery(): number {
    this.generation += 1
    this.state.error = ''
    this.state.pages = {}
    this.state.status = 'loading'
    this.state.total = 0
    return this.generation
  }

  private evictDistantPages(startPage: number, endPage: number): void {
    const center = (startPage + endPage) / 2
    const retained = Object.keys(this.state.pages)
      .map(Number)
      .sort((left, right) => Math.abs(left - center) - Math.abs(right - center))
      .slice(0, MAX_RETAINED_PLAYLIST_PAGES)
    const keep = new Set(retained.map(String))
    for (const pageIndex of Object.keys(this.state.pages)) {
      if (!keep.has(pageIndex)) delete this.state.pages[pageIndex]
    }
  }
}

export class PlaylistPager extends BoundedPlaylistPager<PlaylistSummary, string> {
  constructor(state: PlaylistCatalogState<PlaylistSummary>, fetchPage: PlaylistPageFetcher = listPlaylists) {
    super(state, PLAYLIST_PAGE_SIZE, (_scope, query) => fetchPage(query))
  }

  reset(): Promise<void> {
    return this.resetScope('playlists', 'playlists')
  }
}

export class PlaylistEntryPager extends BoundedPlaylistPager<PlaylistEntry, string> {
  constructor(state: PlaylistCatalogState<PlaylistEntry>, fetchPage: PlaylistEntryPageFetcher = listPlaylistEntries) {
    super(state, PLAYLIST_ENTRY_PAGE_SIZE, fetchPage)
  }

  reset(playlistId: string): Promise<void> {
    return this.resetScope(playlistId, playlistId)
  }
}

function itemAt<Item>(state: PlaylistCatalogState<Item>, index: number, pageSize: number): Item | undefined {
  const pageIndex = Math.floor(index / pageSize)
  return state.pages[String(pageIndex)]?.[index % pageSize]
}

export function playlistAt(state: PlaylistCatalogState<PlaylistSummary>, index: number): PlaylistSummary | undefined {
  return itemAt(state, index, PLAYLIST_PAGE_SIZE)
}

export function playlistEntryAt(state: PlaylistCatalogState<PlaylistEntry>, index: number): PlaylistEntry | undefined {
  return itemAt(state, index, PLAYLIST_ENTRY_PAGE_SIZE)
}

export function playlistPagePlaybackAt(
  state: PlaylistCatalogState<PlaylistEntry>,
  index: number
): { playlistIndex: number; trackIds: string[] } | undefined {
  const pageIndex = Math.floor(index / PLAYLIST_ENTRY_PAGE_SIZE)
  const page = state.pages[String(pageIndex)]
  const itemIndex = index % PLAYLIST_ENTRY_PAGE_SIZE
  if (!page?.[itemIndex] || page[itemIndex].availability !== 'available') return undefined

  const availableEntries = page.filter((entry) => entry.availability === 'available')
  return {
    playlistIndex: page.slice(0, itemIndex).filter((entry) => entry.availability === 'available').length,
    trackIds: availableEntries.map((entry) => entry.songId),
  }
}

export function playlistErrorMessage(
  error: unknown,
  fallback = 'Jukebox could not load this part of the playlist.'
): string {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}
