import { invoke } from '@tauri-apps/api/core'

import type { Song } from '~/App'

export async function upsertSongs(songs: Song[]): Promise<void> {
  if (!songs.length) return
  await invoke('upsert_songs', { songs })
}

export async function updateFavoriteRating(id: string, rating: Song['favorRating']): Promise<void> {
  await invoke('update_favorite_rating', { id, rating })
}

export async function deleteSongs(ids: string[]): Promise<void> {
  if (!ids.length) return
  await invoke('delete_songs', { ids })
}

export async function clearLibrarySongs(): Promise<void> {
  await invoke('clear_library_songs')
}
