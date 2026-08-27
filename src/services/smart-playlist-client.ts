import { invoke } from '@tauri-apps/api/core'

import type { Song } from '~/App'
import type { PlaylistMutation, PlaylistSummary } from '~/services/playlist-client'

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
