import { invoke } from '@tauri-apps/api/core'

import type { Song } from '~/App'

const NATIVE_ACCESS_ERROR = 'Music folder access is required. Reconnect the folder in Settings.'

export class PlaybackSourceAccessError extends Error {
  constructor() {
    super(NATIVE_ACCESS_ERROR)
    this.name = 'PlaybackSourceAccessError'
  }
}

export async function authorizePlaybackSource(song: Pick<Song, 'id'>): Promise<string> {
  try {
    return await invoke<string>('authorize_playback_asset', { trackId: song.id })
  } catch (error) {
    if (String(error).includes(NATIVE_ACCESS_ERROR)) throw new PlaybackSourceAccessError()
    throw error
  }
}
