import { invoke } from '@tauri-apps/api/core'

export interface PlayHistoryItem {
  album: string
  artist: string
  availability: 'available' | 'unavailable' | 'missing'
  completed: boolean
  durationMs: number
  endedAt?: string | null
  id: number
  listenedMs: number
  positionMs: number
  sourceKind: 'context' | 'queue'
  startedAt: string
  title: string
  trackId: string
}

export interface PlayHistoryPage {
  items: PlayHistoryItem[]
  total: number
}

export interface PlayHistoryQuery {
  limit: number
  offset: number
}

export interface PlayHistoryMutation {
  affected: number
}

export function listPlayHistory(query: PlayHistoryQuery): Promise<PlayHistoryPage> {
  return invoke('list_play_history', { query })
}

export function clearPlayHistory(): Promise<PlayHistoryMutation> {
  return invoke('clear_play_history')
}
