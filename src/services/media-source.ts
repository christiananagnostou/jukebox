import { convertFileSrc, invoke } from '@tauri-apps/api/core'

import type { Song } from '~/App'

export async function authorizePlaybackSource(song: Pick<Song, 'id'>): Promise<string> {
  const path = await invoke<string>('authorize_playback_asset', { trackId: song.id })
  return convertFileSrc(path)
}
