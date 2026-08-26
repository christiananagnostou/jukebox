import Database from '@tauri-apps/plugin-sql'

import type { Song } from '~/App'

export const LIBRARY_DB = 'sqlite:library.db'

const CREATE_SONGS_TABLE = `CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  file TEXT NOT NULL,
  title TEXT NOT NULL,
  album TEXT NOT NULL,
  artist TEXT NOT NULL,
  genre TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  compilation INTEGER NOT NULL,
  date TEXT NOT NULL,
  encoder TEXT NOT NULL,
  trackTotal INTEGER NOT NULL,
  trackNumber INTEGER NOT NULL,
  codec TEXT NOT NULL,
  duration TEXT NOT NULL,
  sampleRate TEXT NOT NULL,
  side INTEGER NOT NULL,
  startTime INTEGER NOT NULL,
  favorRating INTEGER NOT NULL CHECK (favorRating IN (0, 1, 2)),
  dateAdded TEXT NOT NULL,
  visualsPath TEXT NOT NULL
)`

const SONG_COLUMNS = [
  'id',
  'path',
  'file',
  'title',
  'album',
  'artist',
  'genre',
  'bpm',
  'compilation',
  'date',
  'encoder',
  'trackTotal',
  'trackNumber',
  'codec',
  'duration',
  'sampleRate',
  'side',
  'startTime',
  'favorRating',
  'dateAdded',
  'visualsPath',
] as const

const UPSERT_UPDATE = `ON CONFLICT(id) DO UPDATE SET
  path = excluded.path,
  file = excluded.file,
  title = excluded.title,
  album = excluded.album,
  artist = excluded.artist,
  genre = excluded.genre,
  bpm = excluded.bpm,
  compilation = excluded.compilation,
  date = excluded.date,
  encoder = excluded.encoder,
  trackTotal = excluded.trackTotal,
  trackNumber = excluded.trackNumber,
  codec = excluded.codec,
  duration = excluded.duration,
  sampleRate = excluded.sampleRate,
  side = excluded.side,
  startTime = excluded.startTime,
  visualsPath = excluded.visualsPath`

const UPSERT_CHUNK_SIZE = 100

const songValues = (song: Song): unknown[] => [
  song.id,
  song.path,
  song.file,
  song.title,
  song.album,
  song.artist,
  song.genre,
  song.bpm,
  song.compilation,
  song.date,
  song.encoder,
  song.trackTotal,
  song.trackNumber,
  song.codec,
  song.duration,
  song.sampleRate,
  song.side,
  song.startTime,
  song.favorRating,
  song.dateAdded,
  song.visualsPath,
]

export async function loadLibrarySongs(): Promise<Song[]> {
  const db = await Database.load(LIBRARY_DB)

  try {
    await db.execute(CREATE_SONGS_TABLE)
    return await db.select<Song[]>('SELECT * FROM songs')
  } finally {
    await db.close()
  }
}

export async function upsertSongs(songs: Song[]): Promise<void> {
  if (!songs.length) return

  const db = await Database.load(LIBRARY_DB)

  try {
    for (let start = 0; start < songs.length; start += UPSERT_CHUNK_SIZE) {
      const chunk = songs.slice(start, start + UPSERT_CHUNK_SIZE)
      const placeholders = chunk
        .map((_, rowIndex) => {
          const firstParameter = rowIndex * SONG_COLUMNS.length + 1
          const rowParameters = SONG_COLUMNS.map((_, columnIndex) => `$${firstParameter + columnIndex}`)
          return `(${rowParameters.join(', ')})`
        })
        .join(', ')
      const query = `INSERT INTO songs (${SONG_COLUMNS.join(', ')}) VALUES ${placeholders} ${UPSERT_UPDATE}`

      await db.execute(query, chunk.flatMap(songValues))
    }
  } finally {
    await db.close()
  }
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

  const db = await Database.load(LIBRARY_DB)

  try {
    for (let start = 0; start < ids.length; start += 200) {
      const chunk = ids.slice(start, start + 200)
      const placeholders = chunk.map((_, index) => `$${index + 1}`).join(', ')
      await db.execute(`DELETE FROM songs WHERE id IN (${placeholders})`, chunk)
    }
  } finally {
    await db.close()
  }
}

export async function clearLibrarySongs(): Promise<void> {
  const db = await Database.load(LIBRARY_DB)

  try {
    await db.execute(CREATE_SONGS_TABLE)
    await db.execute('DELETE FROM songs')
  } finally {
    await db.close()
  }
}
