import { createPlayerState } from '../../src-tauri/src/remote_access/player-core.js'
import type { PlayerTrack } from '../../src-tauri/src/remote_access/player-core.js'

export type { PlayerTrack }
export type View = 'tracks' | 'albums' | 'artists'
export type Recovery = 'retry' | 'skip' | 'remove'
export interface Feedback {
  heading: string
  message: string
  actions: Recovery[]
}
export interface Album {
  name: string
  value: string
  artist: string
  artistValue: string
  date: string
  trackCount: number
}
export interface Artist {
  name: string
  value: string
  albumCount: number
  trackCount: number
}
export const initialLibrary = () => ({
  view: 'albums' as View,
  artist: '',
  album: '',
  search: '',
  revision: '',
  cursor: '',
  offset: 0,
  total: 0,
  tracks: [] as PlayerTrack[],
  albums: [] as Album[],
  artists: [] as Artist[],
  loading: false,
  error: '',
  offline: false,
  more: false,
})
export const initialPlayer = () => ({
  queue: createPlayerState(),
  revision: '',
  active: null as PlayerTrack | null,
  paused: true,
  position: 0,
  duration: 0,
  ready: false,
  scrubbing: false,
  preview: 0,
  feedback: { heading: 'Now playing', message: '', actions: [] } as Feedback,
  offline: 'available' as 'available' | 'saved' | 'saving' | 'unavailable',
})
export type LibraryModel = ReturnType<typeof initialLibrary>
export type PlayerModel = ReturnType<typeof initialPlayer>
export const trackArtwork = (track: PlayerTrack | null) =>
  track ? `/api/tracks/${encodeURIComponent(track.id)}/artwork` : ''
export const streamUrl = (track: PlayerTrack) => `/api/tracks/${encodeURIComponent(track.id)}/stream`
export const albumArtwork = (album: Album) =>
  `/api/artwork?${new URLSearchParams({ album: album.value, ...(album.artistValue ? { artist: album.artistValue } : {}) })}`
export const formatTime = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
export const detail = (values: string[], fallback = '') => values.filter(Boolean).join(' · ') || fallback
export const libraryTitle = (state: LibraryModel) =>
  state.view === 'tracks' ? 'Songs' : state.view === 'albums' ? 'Albums' : 'Artists'
export const libraryStatus = (state: LibraryModel) =>
  state.error ||
  (state.loading
    ? 'Loading library…'
    : `${state.offline ? 'Offline · ' : ''}${state.offset ? `${state.offset}${state.more ? '+' : ''} ${state.view}` : `No matching ${state.view}`}`)
