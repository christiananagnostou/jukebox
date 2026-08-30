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
