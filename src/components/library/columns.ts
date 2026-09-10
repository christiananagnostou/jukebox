import { createContextId } from '@builder.io/qwik'

export const SONG_COLUMNS = [
  { id: 'title', label: 'Title', width: 260, min: 140, visible: true },
  { id: 'artist', label: 'Artist', width: 180, min: 100, visible: true },
  { id: 'album', label: 'Album', width: 220, min: 100, visible: true },
  { id: 'duration', label: 'Duration', width: 88, min: 80, visible: true },
  { id: 'track', label: 'Track', width: 80, min: 64, visible: false },
  { id: 'hertz', label: 'Sample rate', width: 120, min: 100, visible: false },
  { id: 'date', label: 'Year', width: 80, min: 64, visible: false },
  { id: 'date-added', label: 'Date added', width: 120, min: 100, visible: false },
  { id: 'fave', label: 'Favorites', width: 88, min: 80, visible: true },
] as const

export type SongColumnId = (typeof SONG_COLUMNS)[number]['id']
export type ColumnPreferences = Record<SongColumnId, { width: number; visible: boolean }>
export const SongColumnsContext = createContextId<ColumnPreferences>('jukebox.song-columns')
export const COLUMN_STORAGE_KEY = 'jukebox.song-columns.v1'
export const MAX_COLUMN_WIDTH = 800

export function columnWidth(id: SongColumnId, width: number): number {
  const column = SONG_COLUMNS.find((column) => column.id === id)!
  return Number.isFinite(width) ? Math.min(MAX_COLUMN_WIDTH, Math.max(column.min, Math.round(width))) : column.width
}

export function columnPreferences(value?: unknown): ColumnPreferences {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return Object.fromEntries(
    SONG_COLUMNS.map((column) => {
      const item = saved[column.id] as { width?: unknown; visible?: unknown } | undefined
      return [
        column.id,
        {
          width: columnWidth(column.id, typeof item?.width === 'number' ? item.width : column.width),
          visible: column.id === 'title' || (typeof item?.visible === 'boolean' ? item.visible : column.visible),
        },
      ]
    })
  ) as ColumnPreferences
}

export function columnLayout(preferences: ColumnPreferences): Record<string, string> {
  const visible = SONG_COLUMNS.filter((column) => preferences[column.id].visible)
  const widths = visible.map((column) => `var(--song-${column.id}-width)`)
  return {
    ...Object.fromEntries(
      SONG_COLUMNS.map((column) => [`--song-${column.id}-width`, `${preferences[column.id].width}px`])
    ),
    '--song-grid': `24px ${widths.join(' ')} minmax(0, 1fr)`,
    '--song-min-width': `calc(24px + ${widths.join(' + ')} + var(--scrollbar-width))`,
  }
}

export function songDuration(value: string): string {
  return value.replace(/\.\d+$/, '').replace(/^0:/, '') || '-'
}
