import type { BuiltInCollectionKind } from '~/services/library-client'

export interface BuiltInCollectionDefinition {
  description: string
  emptyMessage: string
  kind: BuiltInCollectionKind
  label: string
}

export const BUILT_IN_COLLECTIONS: readonly BuiltInCollectionDefinition[] = [
  {
    description: 'Tracks ordered by their latest successful playback start.',
    emptyMessage: 'Play a track to start building local listening history.',
    kind: 'recently_played',
    label: 'Recently Played',
  },
  {
    description: 'Tracks ordered by completed plays, with recent plays breaking ties.',
    emptyMessage: 'Completed plays will appear here.',
    kind: 'most_played',
    label: 'Most Played',
  },
  {
    description: 'Available library tracks with no retained successful playback start.',
    emptyMessage: 'Every available library track has been played.',
    kind: 'never_played',
    label: 'Never Played',
  },
]

export function builtInCollectionDefinition(kind: BuiltInCollectionKind): BuiltInCollectionDefinition {
  return BUILT_IN_COLLECTIONS.find((collection) => collection.kind === kind) || BUILT_IN_COLLECTIONS[0]
}

export function formatLastPlayed(value?: string | null): string {
  if (!value) return '—'
  const timestamp = value.replace('T', ' ').replace('Z', '')
  return `${timestamp.slice(0, 16)} UTC`
}
