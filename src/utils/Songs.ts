import type { Song } from '~/App'

export function getUpcomingSongs(songs: Song[], currentIndex: number, limit = 5): Song[] {
  if (songs.length < 2 || limit <= 0) return []

  const normalizedIndex = ((currentIndex % songs.length) + songs.length) % songs.length
  const start = (normalizedIndex + 1) % songs.length
  const count = Math.min(limit, songs.length - 1)
  return Array.from({ length: count }, (_, offset) => songs[(start + offset) % songs.length])
}
