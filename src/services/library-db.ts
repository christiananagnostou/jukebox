import { invoke } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'

import type { Song } from '~/App'

export const LIBRARY_DB = 'sqlite:library.db'

export async function upsertSongs(songs: Song[]): Promise<void> {
  if (!songs.length) return
  await invoke('upsert_songs', { songs })
}

export async function updateFavoriteRating(id: string, rating: Song['favorRating']): Promise<void> {
  const db = await Database.load(LIBRARY_DB)

  try {
    await db.execute('UPDATE songs SET favorRating = $1 WHERE id = $2', [rating, id])
  } finally {
    await db.close()
  }
}

export async function deleteSongs(ids: string[]): Promise<void> {
  if (!ids.length) return
  await invoke('delete_songs', { ids })
}

export async function clearLibrarySongs(): Promise<void> {
  await invoke('clear_library_songs')
}
