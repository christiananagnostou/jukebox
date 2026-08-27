import { invoke } from '@tauri-apps/api/core'
import { $, noSerialize, useSignal, useTask$, useVisibleTask$, type NoSerialize } from '@builder.io/qwik'

import type {
  AggregateCatalogState,
  AlbumSummary,
  ArtistSummary,
  LibraryCatalogState,
  Song,
  StorageNode,
  Store,
} from '~/App'

export type { AggregateCatalogState, AlbumSummary, ArtistSummary } from '~/App'

export const LIBRARY_PAGE_SIZE = 100
export const MAX_RETAINED_LIBRARY_PAGES = 5
export const AGGREGATE_PAGE_SIZE = 100
export const MAX_RETAINED_AGGREGATE_PAGES = 5
export const BUILT_IN_COLLECTION_PAGE_SIZE = 100
export const MAX_RETAINED_BUILT_IN_COLLECTION_PAGES = 5

type NativeTrackSort =
  'default' | 'album' | 'artist' | 'date' | 'date_added' | 'favorite' | 'sample_rate' | 'title' | 'track'

export interface TrackQuery {
  album?: string
  artist?: string
  availability?: 'available' | 'unavailable' | 'any'
  codec?: string
  cursor?: string
  direction: 'asc' | 'desc'
  genre?: string
  limit: number
  minFavoriteRating?: Song['favorRating']
  pathPrefix?: string
  q: string
  rootId?: number
  sort: NativeTrackSort
  year?: number
}

export type TrackFacet = 'codec' | 'genre' | 'year'

export interface FacetQuery {
  filters: TrackQuery
  kind: TrackFacet
  limit: number
  offset: number
}

export interface FacetItem {
  count: number
  value: string
}

export interface AggregateQuery {
  artist?: string
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  q: string
}

export interface AggregatePage<Item> {
  items: Item[]
  revision: number
  total: number
}

export interface StorageQuery {
  direction: 'asc' | 'desc'
  limit: number
  offset: number
  parent: string
  q: string
  rootId?: number
}

interface NativeTrackSummary {
  album: string
  artist: string
  bpm: number
  codec: string
  compilation: number
  date: string
  dateAdded: string
  duration: string
  encoder: string
  favorRating: Song['favorRating']
  file: string
  genre: string
  id: string
  path: string
  sampleRate: string
  side: number
  startTime: number
  title: string
  trackNumber: number
  trackTotal: number
  visualsPath: string
}

interface NativeTrackPage {
  items: NativeTrackSummary[]
  nextCursor?: string
  revision: number
  total: number
}

export interface TrackPage {
  items: Song[]
  nextCursor?: string
  revision: number
  total: number
}

export type BuiltInCollectionKind = 'recently_played' | 'most_played' | 'never_played'

export interface BuiltInCollectionQuery {
  kind: BuiltInCollectionKind
  limit: number
  offset: number
}

export interface BuiltInCollectionItem {
  lastPlayedAt?: string | null
  listenedMs: number
  playCount: number
  track: Song
}

export interface BuiltInCollectionPage {
  items: BuiltInCollectionItem[]
  revision: string
  total: number
}

export interface BuiltInCollectionCatalogState {
  error: string
  pages: Record<string, BuiltInCollectionItem[]>
  revision: string
  status: 'loading' | 'ready' | 'error'
  total: number
}

export type BuiltInCollectionPageFetcher = (query: BuiltInCollectionQuery) => Promise<BuiltInCollectionPage>

export type TrackPageFetcher = (query: TrackQuery) => Promise<TrackPage>
export type AggregatePageFetcher<Item> = (query: AggregateQuery) => Promise<AggregatePage<Item>>
export type StoragePageFetcher = (query: StorageQuery) => Promise<AggregatePage<StorageNode>>

function toSong(track: NativeTrackSummary): Song {
  return track
}

export async function resolvePlaybackTracks(trackIds: string[]): Promise<Song[]> {
  const tracks = await invoke<NativeTrackSummary[]>('resolve_playback_tracks', { trackIds })
  return tracks.map(toSong)
}

export async function queryTracks(query: TrackQuery): Promise<TrackPage> {
  const page = await invoke<NativeTrackPage>('query_tracks', { query })
  return { ...page, items: page.items.map(toSong) }
}

export function queryBuiltInCollection(query: BuiltInCollectionQuery): Promise<BuiltInCollectionPage> {
  return invoke('query_built_in_collection', { query })
}

export class BuiltInCollectionPager {
  private generation = 0
  private kind: BuiltInCollectionKind = 'recently_played'
  private queryKey = ''
  private queue = Promise.resolve()

  constructor(
    private readonly state: BuiltInCollectionCatalogState,
    private readonly fetchPage: BuiltInCollectionPageFetcher = queryBuiltInCollection
  ) {}

  reset(kind: BuiltInCollectionKind): Promise<void> {
    if (kind === this.queryKey && this.state.status !== 'error') return this.queue
    this.kind = kind
    this.queryKey = kind
    return this.enqueueRange(0, 0, this.beginQuery())
  }

  reload(): Promise<void> {
    this.queryKey = ''
    return this.reset(this.kind)
  }

  clear(): void {
    this.queryKey = ''
    this.beginQuery()
  }

  ensureRange(startIndex: number, endIndex: number): Promise<void> {
    if (this.state.status === 'error' || endIndex < 0) return Promise.resolve()
    const startPage = Math.max(0, Math.floor(startIndex / BUILT_IN_COLLECTION_PAGE_SIZE))
    const endPage = Math.max(startPage, Math.floor(endIndex / BUILT_IN_COLLECTION_PAGE_SIZE))
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
        if (generation !== this.generation) return
        if (this.state.pages[String(pageIndex)]) continue
        const page = await this.fetchPage({
          kind: this.kind,
          limit: BUILT_IN_COLLECTION_PAGE_SIZE,
          offset: pageIndex * BUILT_IN_COLLECTION_PAGE_SIZE,
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
      this.state.error = libraryErrorMessage(error)
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
      .slice(0, MAX_RETAINED_BUILT_IN_COLLECTION_PAGES)
    const keep = new Set(retained.map(String))
    for (const pageIndex of Object.keys(this.state.pages)) {
      if (!keep.has(pageIndex)) delete this.state.pages[pageIndex]
    }
  }
}

export function builtInCollectionItemAt(
  state: BuiltInCollectionCatalogState,
  index: number
): BuiltInCollectionItem | undefined {
  const pageIndex = Math.floor(index / BUILT_IN_COLLECTION_PAGE_SIZE)
  return state.pages[String(pageIndex)]?.[index % BUILT_IN_COLLECTION_PAGE_SIZE]
}

export function builtInCollectionPlaybackAt(
  state: BuiltInCollectionCatalogState,
  index: number
): { playlist: Song[]; playlistIndex: number; song: Song } | undefined {
  const page = state.pages[String(Math.floor(index / BUILT_IN_COLLECTION_PAGE_SIZE))]
  const playlistIndex = index % BUILT_IN_COLLECTION_PAGE_SIZE
  const song = page?.[playlistIndex]?.track
  return song ? { playlist: page.map((item) => item.track), playlistIndex, song } : undefined
}

export function queryFacets(query: FacetQuery): Promise<AggregatePage<FacetItem>> {
  return invoke('query_facets', { query })
}

export function queryArtists(query: AggregateQuery): Promise<AggregatePage<ArtistSummary>> {
  return invoke('query_artists', { query })
}

export function queryAlbums(query: AggregateQuery): Promise<AggregatePage<AlbumSummary>> {
  return invoke('query_albums', { query })
}

export function queryStorage(query: StorageQuery): Promise<AggregatePage<StorageNode>> {
  return invoke('query_storage', { query })
}

interface OffsetQuery {
  limit: number
  offset: number
}

type OffsetPageFetcher<Item, Query extends OffsetQuery> = (query: Query) => Promise<AggregatePage<Item>>

export class OffsetPager<Item, Query extends OffsetQuery> {
  private generation = 0
  private query?: Omit<Query, 'limit' | 'offset'>
  private queryKey = ''
  private queue = Promise.resolve()

  constructor(
    private readonly state: AggregateCatalogState<Item>,
    private readonly fetchPage: OffsetPageFetcher<Item, Query>
  ) {}

  reset(query: Omit<Query, 'limit' | 'offset'>): Promise<void> {
    const queryKey = JSON.stringify(query)
    if (queryKey === this.queryKey && this.state.status !== 'error') return this.queue
    this.query = query
    this.queryKey = queryKey
    return this.enqueueRange(0, 0, this.beginQuery())
  }

  reload(): Promise<void> {
    if (!this.query) return Promise.resolve()
    this.queryKey = ''
    return this.reset(this.query)
  }

  clear(): void {
    this.queryKey = ''
    this.beginQuery()
  }

  ensureRange(startIndex: number, endIndex: number): Promise<void> {
    if (this.state.status === 'error' || endIndex < 0) return Promise.resolve()
    const startPage = Math.max(0, Math.floor(startIndex / AGGREGATE_PAGE_SIZE))
    const endPage = Math.max(startPage, Math.floor(endIndex / AGGREGATE_PAGE_SIZE))
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
    if (!this.query) return
    try {
      for (let pageIndex = startPage; pageIndex <= endPage; pageIndex += 1) {
        if (generation !== this.generation) return
        if (this.state.pages[String(pageIndex)]) continue
        const page = await this.fetchPage({
          ...this.query,
          limit: AGGREGATE_PAGE_SIZE,
          offset: pageIndex * AGGREGATE_PAGE_SIZE,
        } as Query)
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
      this.state.error = libraryErrorMessage(error)
      this.state.status = 'error'
    }
  }

  private beginQuery(): number {
    this.generation += 1
    this.state.error = ''
    this.state.pages = {}
    this.state.revision = 0
    this.state.status = 'loading'
    this.state.total = 0
    return this.generation
  }

  private evictDistantPages(startPage: number, endPage: number): void {
    const center = (startPage + endPage) / 2
    const retained = Object.keys(this.state.pages)
      .map(Number)
      .sort((left, right) => Math.abs(left - center) - Math.abs(right - center))
      .slice(0, MAX_RETAINED_AGGREGATE_PAGES)
    const keep = new Set(retained.map(String))
    for (const pageIndex of Object.keys(this.state.pages)) {
      if (!keep.has(pageIndex)) delete this.state.pages[pageIndex]
    }
  }
}

export class AggregatePager<Item> extends OffsetPager<Item, AggregateQuery> {}

export class StoragePager extends OffsetPager<StorageNode, StorageQuery> {}

export function aggregateItemAt<Item>(state: AggregateCatalogState<Item>, index: number): Item | undefined {
  const pageIndex = Math.floor(index / AGGREGATE_PAGE_SIZE)
  return state.pages[String(pageIndex)]?.[index % AGGREGATE_PAGE_SIZE]
}

export const storageNodeAt = aggregateItemAt<StorageNode>

export function catalogQuery(searchTerm: string, sorting: Store['sorting']): Omit<TrackQuery, 'cursor' | 'limit'> {
  if (sorting === 'default') return { direction: 'asc', q: searchTerm, sort: 'default' }

  const direction = sorting.endsWith('-desc') ? 'desc' : 'asc'
  const field = sorting.replace(/-(asc|desc)$/, '')
  const sorts: Record<string, NativeTrackSort> = {
    album: 'album',
    artist: 'artist',
    date: 'date',
    'date-added': 'date_added',
    fave: 'favorite',
    hertz: 'sample_rate',
    title: 'title',
    track: 'track',
  }
  return { direction, q: searchTerm, sort: sorts[field] || 'default' }
}

function libraryErrorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') return error.code
  return ''
}

function libraryErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Jukebox could not load this part of the library.'
}

export class LibraryPager {
  private readonly cursors = new Map<number, string | null>([[0, null]])
  private generation = 0
  private query: Omit<TrackQuery, 'cursor' | 'limit'> = catalogQuery('', 'default')
  private queryKey = ''
  private queue = Promise.resolve()

  constructor(
    private readonly state: LibraryCatalogState,
    private readonly fetchPage: TrackPageFetcher = queryTracks
  ) {}

  reset(searchTerm: string, sorting: Store['sorting']): Promise<void> {
    return this.resetQuery(catalogQuery(searchTerm, sorting))
  }

  resetQuery(query: Omit<TrackQuery, 'cursor' | 'limit'>): Promise<void> {
    const queryKey = JSON.stringify(query)
    if (queryKey === this.queryKey && this.state.status !== 'error') return this.queue

    this.query = query
    this.queryKey = queryKey
    return this.enqueueRange(0, 0, this.beginQuery())
  }

  reload(): Promise<void> {
    this.queryKey = ''
    return this.resetQuery(this.query)
  }

  clear(): void {
    this.queryKey = ''
    this.beginQuery()
  }

  ensureRange(startIndex: number, endIndex: number): Promise<void> {
    if (this.state.status === 'error' || endIndex < 0) return Promise.resolve()
    const startPage = Math.max(0, Math.floor(startIndex / LIBRARY_PAGE_SIZE))
    const endPage = Math.max(startPage, Math.floor(endIndex / LIBRARY_PAGE_SIZE))
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
      for (let pageIndex = 0; pageIndex <= endPage; pageIndex += 1) {
        if (generation !== this.generation) return
        if (this.state.pages[String(pageIndex)]) continue
        if (pageIndex < startPage && this.cursors.has(pageIndex + 1)) continue

        const cursor = this.cursors.get(pageIndex)
        if (cursor === undefined) return
        const page = await this.fetchPage({
          ...this.query,
          cursor: cursor || undefined,
          limit: LIBRARY_PAGE_SIZE,
        })
        if (generation !== this.generation) return

        this.state.pages[String(pageIndex)] = page.items
        this.state.revision = page.revision
        this.state.total = page.total
        if (page.nextCursor) this.cursors.set(pageIndex + 1, page.nextCursor)
        if (!page.nextCursor && page.items.length === LIBRARY_PAGE_SIZE) {
          this.cursors.delete(pageIndex + 1)
        }
      }
      if (generation !== this.generation) return
      this.evictDistantPages(startPage, endPage)
      this.state.loadedSongCount = Object.values(this.state.pages).reduce((total, page) => total + page.length, 0)
      this.state.error = ''
      this.state.status = 'ready'
    } catch (error) {
      if (generation !== this.generation) return
      if (libraryErrorCode(error) === 'stale_cursor') {
        await this.loadRange(0, 0, this.beginQuery())
        return
      }
      this.state.error = libraryErrorMessage(error)
      this.state.status = 'error'
    }
  }

  private beginQuery(): number {
    this.generation += 1
    this.cursors.clear()
    this.cursors.set(0, null)
    this.state.error = ''
    this.state.loadedSongCount = 0
    this.state.pages = {}
    this.state.revision = 0
    this.state.status = 'loading'
    this.state.total = 0
    return this.generation
  }

  private evictDistantPages(startPage: number, endPage: number): void {
    const center = (startPage + endPage) / 2
    const retained = Object.keys(this.state.pages)
      .map(Number)
      .sort((left, right) => Math.abs(left - center) - Math.abs(right - center))
      .slice(0, MAX_RETAINED_LIBRARY_PAGES)
    const keep = new Set(retained.map(String))
    for (const pageIndex of Object.keys(this.state.pages)) {
      if (!keep.has(pageIndex)) delete this.state.pages[pageIndex]
    }
  }
}

export function librarySongAt(state: LibraryCatalogState, index: number): Song | undefined {
  const pageIndex = Math.floor(index / LIBRARY_PAGE_SIZE)
  return state.pages[String(pageIndex)]?.[index % LIBRARY_PAGE_SIZE]
}

export function libraryPlaybackAt(
  state: LibraryCatalogState,
  index: number
): { playlist: Song[]; playlistIndex: number; song: Song } | undefined {
  const playlist = state.pages[String(Math.floor(index / LIBRARY_PAGE_SIZE))]
  const playlistIndex = index % LIBRARY_PAGE_SIZE
  const song = playlist?.[playlistIndex]
  return song ? { playlist, playlistIndex, song } : undefined
}

export function lastLoadedLibraryIndex(state: LibraryCatalogState): number {
  return Object.entries(state.pages).reduce((lastIndex, [pageIndex, items]) => {
    if (!items.length) return lastIndex
    return Math.max(lastIndex, Number(pageIndex) * LIBRARY_PAGE_SIZE + items.length - 1)
  }, 0)
}

export async function loadTrackSelection(
  query: Omit<TrackQuery, 'cursor' | 'limit'>,
  fetchPage: TrackPageFetcher = queryTracks
): Promise<Song[]> {
  const songs: Song[] = []
  let cursor: string | undefined

  do {
    const page = await fetchPage({ ...query, cursor, limit: LIBRARY_PAGE_SIZE })
    songs.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)

  return songs
}

export function useLibraryCatalog(store: Store) {
  const pager = useSignal<NoSerialize<LibraryPager>>()
  const observedRefreshKey = useSignal(store.libraryCatalog.refreshKey)

  useTask$(({ track }) => {
    const status = track(() => store.libraryCatalog.status)
    const error = track(() => store.libraryCatalog.error)
    store.bootstrap.libraryStatus = status
    store.bootstrap.libraryError = error
  })

  useVisibleTask$(({ cleanup }) => {
    const controller = new LibraryPager(store.libraryCatalog)
    pager.value = noSerialize(controller)
    void controller.reset(store.searchTerm, store.sorting)

    cleanup(() => {
      controller.dispose()
      pager.value = undefined
    })
  })

  useTask$(({ cleanup, track }) => {
    const searchTerm = track(() => store.searchTerm)
    const sorting = track(() => store.sorting)

    const timeout = setTimeout(() => {
      void pager.value?.reset(searchTerm, sorting)
    }, 120)
    cleanup(() => clearTimeout(timeout))
  })

  useTask$(({ track }) => {
    const refreshKey = track(() => store.libraryCatalog.refreshKey)
    if (refreshKey === observedRefreshKey.value) return
    observedRefreshKey.value = refreshKey
    void pager.value?.reload()
  })

  return {
    reloadLibrary: $(async () => {
      await pager.value?.reload()
    }),
    requestLibraryRange: $(async (startIndex: number, endIndex: number) => {
      await pager.value?.ensureRange(startIndex, endIndex)
    }),
  }
}
