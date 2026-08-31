import type { Song } from '~/App'

export interface UpcomingSongSelection {
  contextIndex: number
  song: Song
}

export function getUpcomingSongSelections(
  songs: Song[],
  currentIndex: number | null,
  limit = 5
): UpcomingSongSelection[] {
  if (!songs.length || limit <= 0) return []

  const normalizedIndex = currentIndex === null ? null : ((currentIndex % songs.length) + songs.length) % songs.length
  const start = normalizedIndex === null ? 0 : (normalizedIndex + 1) % songs.length
  const count = Math.min(limit, normalizedIndex === null ? songs.length : songs.length - 1)
  return Array.from({ length: count }, (_, offset) => {
    const contextIndex = (start + offset) % songs.length
    return { contextIndex, song: songs[contextIndex] }
  })
}
