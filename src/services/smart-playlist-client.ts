import { invoke } from '@tauri-apps/api/core'

import type { Song } from '~/App'
import { playlistErrorMessage, type PlaylistMutation, type PlaylistSummary } from '~/services/playlist-client'

export type SmartMatchMode = 'all' | 'any'
export type SmartTextOperator = 'is' | 'is_not' | 'contains' | 'does_not_contain' | 'starts_with' | 'ends_with'
export type SmartNumberOperator =
  'equal' | 'not_equal' | 'greater_than' | 'greater_than_or_equal' | 'less_than' | 'less_than_or_equal'
export type SmartDateOperator = 'before' | 'on_or_before' | 'after' | 'on_or_after' | 'is_set' | 'is_not_set'
export type SmartEqualityOperator = 'is' | 'is_not'

export type SmartRule =
  | { field: 'text'; value: string }
  | {
      field: 'artist' | 'album' | 'genre' | 'codec'
      operator: SmartTextOperator
      value: string
    }
  | {
      field: 'year' | 'favorite' | 'play_count' | 'duration_ms' | 'sample_rate'
      operator: SmartNumberOperator
      value: number
    }
  | { field: 'date_added' | 'last_played'; operator: SmartDateOperator; value?: string | null }
  | {
      field: 'availability'
      operator: SmartEqualityOperator
      value: 'available' | 'unavailable'
    }
  | { field: 'root'; operator: SmartEqualityOperator; value: number }

export type SmartPlaylistSort =
  | 'default'
  | 'title'
  | 'artist'
  | 'album'
  | 'year'
  | 'date_added'
  | 'favorite'
  | 'last_played'
  | 'play_count'
  | 'duration'
  | 'sample_rate'

export interface SmartPlaylistDefinition {
  version: 1
  matchMode: SmartMatchMode
  rules: SmartRule[]
  resultLimit: number
  sort: SmartPlaylistSort
  direction: 'asc' | 'desc'
}

export interface SmartPlaylist {
  definition: SmartPlaylistDefinition
  summary: PlaylistSummary
}

export interface SmartPlaylistQuery {
  limit: number
  offset: number
}

export interface SmartPlaylistItem {
  availability: 'available' | 'unavailable'
  lastPlayedAt?: string | null
  listenedMs: number
  playCount: number
  track: Song
}

export interface SmartPlaylistPage {
  items: SmartPlaylistItem[]
  revision: string
  total: number
}

export interface SmartPlaylistCatalogState {
  error: string
  pages: Record<string, SmartPlaylistItem[]>
  revision: string
  status: 'loading' | 'ready' | 'error'
  total: number
}

export const SMART_PLAYLIST_PAGE_SIZE = 100
export const MAX_RETAINED_SMART_PLAYLIST_PAGES = 5

export type SmartPlaylistPageFetcher = (playlistId: string, query: SmartPlaylistQuery) => Promise<SmartPlaylistPage>

export function createSmartPlaylist(name: string, definition: SmartPlaylistDefinition): Promise<SmartPlaylist> {
  return invoke('create_smart_playlist', { definition, name })
}

export function getSmartPlaylist(playlistId: string): Promise<SmartPlaylist> {
  return invoke('get_smart_playlist', { playlistId })
}

export function updateSmartPlaylist(
  playlistId: string,
  name: string,
  definition: SmartPlaylistDefinition
): Promise<SmartPlaylist> {
  return invoke('update_smart_playlist', { definition, name, playlistId })
}

export function deleteSmartPlaylist(playlistId: string): Promise<PlaylistMutation> {
  return invoke('delete_smart_playlist', { playlistId })
}

export function querySmartPlaylist(playlistId: string, query: SmartPlaylistQuery): Promise<SmartPlaylistPage> {
  return invoke('query_smart_playlist', { playlistId, query })
}

export class SmartPlaylistPager {
  private generation = 0
  private lastEndPage = 0
  private lastStartPage = 0
  private playlistId = ''
  private queue = Promise.resolve()

  constructor(
    private readonly state: SmartPlaylistCatalogState,
    private readonly fetchPage: SmartPlaylistPageFetcher = querySmartPlaylist
  ) {}

  reset(playlistId: string): Promise<void> {
    if (playlistId === this.playlistId && this.state.status !== 'error') return this.queue
    this.playlistId = playlistId
    this.lastStartPage = 0
    this.lastEndPage = 0
    return this.enqueueRange(0, 0, this.beginQuery())
  }

  reload(): Promise<void> {
    if (!this.playlistId) return Promise.resolve()
    return this.enqueueRange(this.lastStartPage, this.lastEndPage, this.beginQuery())
  }

  clear(): void {
    this.playlistId = ''
    this.lastStartPage = 0
    this.lastEndPage = 0
    this.beginQuery()
  }

  ensureRange(startIndex: number, endIndex: number): Promise<void> {
    if (this.state.status === 'error' || endIndex < 0) return Promise.resolve()
    const startPage = Math.max(0, Math.floor(startIndex / SMART_PLAYLIST_PAGE_SIZE))
    const endPage = Math.max(startPage, Math.floor(endIndex / SMART_PLAYLIST_PAGE_SIZE))
    this.lastStartPage = startPage
    this.lastEndPage = endPage
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
    try {
      for (let pageIndex = startPage; pageIndex <= endPage; pageIndex += 1) {
        if (generation !== this.generation || !this.playlistId) return
        if (this.state.pages[String(pageIndex)]) continue
        const page = await this.fetchPage(this.playlistId, {
          limit: SMART_PLAYLIST_PAGE_SIZE,
          offset: pageIndex * SMART_PLAYLIST_PAGE_SIZE,
        })
        if (generation !== this.generation) return
        if (this.state.revision && page.revision !== this.state.revision) {
          await this.loadRange(0, 0, this.beginQuery())
          return
        }
        this.state.pages[String(pageIndex)] = page.items
        this.state.revision = page.revision
        this.state.total = page.total
      }
      if (generation !== this.generation) return
      this.evictDistantPages(startPage, endPage)
      this.state.error = ''
      this.state.status = 'ready'
    } catch (error) {
      if (generation !== this.generation) return
      this.state.error = playlistErrorMessage(error, 'Jukebox could not load that smart playlist.')
      this.state.status = 'error'
    }
  }

  private beginQuery(): number {
    this.generation += 1
    this.state.error = ''
    this.state.pages = {}
    this.state.revision = ''
    this.state.status = 'loading'
    this.state.total = 0
    return this.generation
  }

  private evictDistantPages(startPage: number, endPage: number): void {
    const center = (startPage + endPage) / 2
    const retained = Object.keys(this.state.pages)
      .map(Number)
      .sort((left, right) => Math.abs(left - center) - Math.abs(right - center))
      .slice(0, MAX_RETAINED_SMART_PLAYLIST_PAGES)
    const keep = new Set(retained.map(String))
    for (const pageIndex of Object.keys(this.state.pages)) {
      if (!keep.has(pageIndex)) delete this.state.pages[pageIndex]
    }
  }
}

export function smartPlaylistItemAt(state: SmartPlaylistCatalogState, index: number): SmartPlaylistItem | undefined {
  const pageIndex = Math.floor(index / SMART_PLAYLIST_PAGE_SIZE)
  return state.pages[String(pageIndex)]?.[index % SMART_PLAYLIST_PAGE_SIZE]
}

export function smartPlaylistPlaybackAt(
  state: SmartPlaylistCatalogState,
  index: number
): { playlist: Song[]; playlistIndex: number; song: Song } | undefined {
  const page = state.pages[String(Math.floor(index / SMART_PLAYLIST_PAGE_SIZE))]
  const itemIndex = index % SMART_PLAYLIST_PAGE_SIZE
  const item = page?.[itemIndex]
  if (!item || item.availability !== 'available') return undefined
  const playlist = page.filter(({ availability }) => availability === 'available').map(({ track }) => track)
  const playlistIndex = page.slice(0, itemIndex).filter(({ availability }) => availability === 'available').length
  return { playlist, playlistIndex, song: item.track }
}
