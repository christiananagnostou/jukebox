import type { Song } from '~/App'

export const PREVIOUS_RESTART_THRESHOLD_SECONDS = 10

export type PlaybackCandidate =
  | { kind: 'none' }
  | {
      kind: 'play'
      playlistIndex: number
      song: Song
      source: 'playlist' | 'queue'
    }

export type PreviousPlaybackDecision = PlaybackCandidate | { kind: 'restart' }

export function decideNextPlayback(queue: readonly Song[], playlist: readonly Song[], currentIndex: number): PlaybackCandidate {
  const queuedSong = queue[0]
  if (queuedSong) {
    return {
      kind: 'play',
      playlistIndex: currentIndex,
      song: queuedSong,
      source: 'queue',
    }
  }

  if (!playlist.length) return { kind: 'none' }
  const playlistIndex = currentIndex < 0 || currentIndex >= playlist.length - 1 ? 0 : currentIndex + 1
  return {
    kind: 'play',
    playlistIndex,
    song: playlist[playlistIndex],
    source: 'playlist',
  }
}

export function decidePreviousPlayback(
  playlist: readonly Song[],
  currentIndex: number,
  currentTime: number
): PreviousPlaybackDecision {
  if (currentTime > PREVIOUS_RESTART_THRESHOLD_SECONDS) return { kind: 'restart' }
  if (!playlist.length) return { kind: 'none' }

  const playlistIndex = currentIndex <= 0 || currentIndex >= playlist.length ? playlist.length - 1 : currentIndex - 1
  return {
    kind: 'play',
    playlistIndex,
    song: playlist[playlistIndex],
    source: 'playlist',
  }
}

export function consumePlayedQueueHead(queue: readonly Song[], candidate: PlaybackCandidate): Song[] {
  if (candidate.kind !== 'play' || candidate.source !== 'queue' || queue[0] !== candidate.song) return [...queue]
  return queue.slice(1)
}
