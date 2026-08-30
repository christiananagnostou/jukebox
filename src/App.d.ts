export interface Store {
  libraryCatalog: LibraryCatalogState
  playlist: Song[]
  searchTerm: string
  settings: Settings
  bootstrap: BootstrapState
  sync: SyncState

  sorting:
    | 'title-desc'
    | 'title-asc'
    | 'artist-desc'
    | 'artist-asc'
    | 'album-desc'
    | 'album-asc'
    | 'track-asc'
    | 'track-desc'
    | 'hertz-asc'
    | 'hertz-desc'
    | 'date-asc'
    | 'date-desc'
    | 'fave-asc'
    | 'fave-desc'
    | 'date-added-asc'
    | 'date-added-desc'
    | 'default'

  libraryView: {
    cursorIdx: number
  }

  artistView: {
    artistIdx: number
    albumIdx: number
    trackIdx: number
    cursorCol: number

    artists: AggregateCatalogState<ArtistSummary>
    albums: AggregateCatalogState<AlbumSummary>
    tracks: LibraryCatalogState
    selectedArtistKey: string
    selectedAlbumKey: string
  }

  storageView: {
    cursorIdx: number
    nodes: AggregateCatalogState<StorageNode>
    parent: string
    rootDisplayPath: string
    rootId: number | null
    rootName: string
  }

  isTyping: boolean
  showKeyShortcuts: boolean
  queue: QueuedSong[]

  player: {
    canUndoQueueEdit: boolean
    currSong?: Song
    currSongIndex: number
    audioElem?: HTMLAudioElement
    error: string
    isPaused: boolean
    currentTime: number
    duration: number
  }
}

export interface Settings {
  closeOnX: boolean
  musicFolder: string
  remoteAccessEnabled: boolean
}

export interface SettingsWarning {
  code: 'unreadable' | 'invalid_json'
  message: string
}

export interface SettingsSnapshot {
  settings: Settings
  warning?: SettingsWarning | null
}

export interface BootstrapState {
  libraryStatus: 'loading' | 'ready' | 'error'
  libraryError: string
  settingsWarning: string
}

export interface RemoteAccessStatus {
  enabled: boolean
  error?: string
  port: number
  running: boolean
  url: string
}

export interface TailscaleStatus {
  backendState?: string
  connected: boolean
  dnsName?: string
  error?: string
  httpsPort?: number
  installed: boolean
  recommendedHttpsPort?: number
  serveConfigured: boolean
  serveManaged: boolean
  url?: string
}

export interface SyncState {
  status: 'idle' | 'scanning' | 'importing' | 'error'
  processed: number
  total: number
  lastRunAt: string
  message: string
}

export interface LibraryCatalogState {
  error: string
  loadedSongCount: number
  pages: Record<string, Song[]>
  refreshKey: number
  revision: number
  status: 'loading' | 'ready' | 'error'
  total: number
}

export interface AggregateCatalogState<Item> {
  error: string
  pages: Record<string, Item[]>
  revision: number
  status: 'loading' | 'ready' | 'error'
  total: number
}

export interface ArtistSummary {
  albumCount: number
  name: string
  trackCount: number
  value: string
}

export interface AlbumSummary {
  artist: string
  artistValue: string
  date: string
  name: string
  trackCount: number
  value: string
  visualsPath: string
}

export interface Song {
  id: string
  path: string
  file: string
  title: string
  album: string
  artist: string
  genre: string
  bpm: number
  compilation: number
  date: string
  encoder: string
  trackTotal: number
  trackNumber: number
  codec: string
  duration: string
  sampleRate: string
  side: number
  startTime: number
  favorRating: 0 | 1 | 2
  dateAdded: string
  visualsPath: string
}

export interface QueuedSong {
  entryId: string
  song: Song
}

export interface Metadata {
  id: string
  codec: string
  duration: string
  sample_rate: number
  meta_tags: { [key: string]: string }
  visual_info: {
    media_type: string
    image_path: string
  }
}

export interface AlbumArt {
  mediaType: string
  mediaData: number[]
}

export type ListItemStyle = {
  position: 'absolute'
  top: string
  width: '100%'
}

export interface StoreActions {
  clearUpcoming: QRL<() => Promise<void>>
  clearPlayback: QRL<() => Promise<void>>
  enqueueSong: QRL<(song: Song) => Promise<void>>
  moveQueuedSong: QRL<(entryId: string, beforeEntryId?: string | null) => Promise<void>>
  playSong: QRL<(song: Song, index: number) => Promise<void> | undefined>
  pauseSong: QRL<() => Promise<void> | undefined>
  resumeSong: QRL<() => Promise<void> | undefined>
  nextSong: QRL<() => Promise<void> | undefined>
  prevSong: QRL<() => Promise<void> | undefined>
  seekSong: QRL<(positionSeconds: number) => Promise<void> | undefined>
  reloadLibrary: QRL<() => Promise<void>>
  requestLibraryRange: QRL<(startIndex: number, endIndex: number) => Promise<void>>
  removeQueuedSong: QRL<(entryId: string) => Promise<void>>
  undoQueueEdit: QRL<() => Promise<void>>
}

export interface StorageNode {
  displayPath: string
  kind: 'directory' | 'root' | 'track'
  name: string
  relativePath: string
  rootId: number
  songId?: string
  trackCount: number
}
