import { $ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { basename, join } from '@tauri-apps/api/path'
import type { DirEntry } from '@tauri-apps/plugin-fs'
import { readDir, stat } from '@tauri-apps/plugin-fs'

import type { Metadata, Song, Store } from '~/App'
import { upsertSongs } from '~/services/library-db'
import { getErrorMessage } from '~/utils/Errors'
import { isAudioFile } from '~/utils/Files'
import { mergeSongs } from '~/utils/Songs'
import { ensureLegacyCatalog } from '~/services/library-client'

const IMPORT_CONCURRENCY = 4

interface ImportFile {
  name: string
  path: string
}

interface ImportResult {
  error?: string
  song?: Song
}

export interface ImportSummary {
  errors: string[]
  imported: number
}

export type ImportMode = 'scan' | 'import'

const parseInteger = (value?: string): number => {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

async function collectDirectoryFiles(directoryPath: string, entries: DirEntry[], files: ImportFile[]): Promise<void> {
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const entryPath = await join(directoryPath, entry.name)
    if (entry.isDirectory) {
      await collectDirectoryFiles(entryPath, await readDir(entryPath), files)
    } else if (entry.isFile && isAudioFile(entryPath)) {
      files.push({ name: entry.name, path: entryPath })
    }
  }
}

async function collectImportFiles(paths: string[]): Promise<ImportFile[]> {
  const files: ImportFile[] = []

  for (const path of paths) {
    const pathInfo = await stat(path)
    if (pathInfo.isDirectory) {
      await collectDirectoryFiles(path, await readDir(path), files)
    } else if (pathInfo.isFile && isAudioFile(path)) {
      files.push({ name: await basename(path), path })
    }
  }

  return files
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
  onProcessed: (processed: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let processed = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
      onProcessed(++processed)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

async function readSong(file: ImportFile): Promise<Song> {
  const metadata = await invoke<Metadata>('get_metadata', { filePath: file.path })
  const tags = metadata.meta_tags

  return {
    id: metadata.id,
    path: file.path,
    file: file.name,
    title: tags.TrackTitle || file.name,
    trackNumber: parseInteger(tags.TrackNumber),
    side: parseInteger(tags.DiscNumber || tags.Side),
    album: tags.Album || '',
    artist: tags.Artist || '',
    genre: tags.Genre || '',
    bpm: parseInteger(tags.Bpm),
    compilation: parseInteger(tags.Compilation),
    date: tags.Date || '',
    encoder: tags.Encoder || '',
    trackTotal: parseInteger(tags.TrackTotal),
    codec: metadata.codec,
    duration: metadata.duration,
    sampleRate: String(metadata.sample_rate),
    startTime: 0,
    favorRating: 0,
    dateAdded: new Date().toISOString(),
    visualsPath: metadata.visual_info.image_path,
  }
}

export function useLibraryImporter(store: Store) {
  const importPaths = $(async (paths: string[], mode: ImportMode = 'import'): Promise<ImportSummary> => {
    if (!paths.length) return { errors: [], imported: 0 }

    store.sync = {
      ...store.sync,
      status: mode === 'scan' ? 'scanning' : 'importing',
      processed: 0,
      total: 0,
      message: 'Finding audio files',
    }

    try {
      const files = await collectImportFiles(paths)
      const legacyCatalog = await ensureLegacyCatalog(store)
      const existingById = new Map(legacyCatalog.map((song) => [song.id, song]))
      store.sync.total = files.length
      store.sync.message = files.length ? 'Reading metadata' : 'No audio files found'

      const results = await mapWithConcurrency(
        files,
        IMPORT_CONCURRENCY,
        async (file): Promise<ImportResult> => {
          try {
            const song = await readSong(file)
            const existingSong = existingById.get(song.id)
            return {
              song: existingSong
                ? {
                    ...song,
                    startTime: existingSong.startTime,
                    favorRating: existingSong.favorRating,
                    dateAdded: existingSong.dateAdded,
                  }
                : song,
            }
          } catch (error) {
            return { error: `${file.path}: ${getErrorMessage(error)}` }
          }
        },
        (processed) => {
          if (processed === files.length || processed % 10 === 0) store.sync.processed = processed
        }
      )

      const songs = results.flatMap((result) => (result.song ? [result.song] : []))
      await upsertSongs(songs)
      store.legacyCatalog = mergeSongs(store.legacyCatalog, songs)
      store.libraryCatalog.refreshKey += 1

      const errors = results.flatMap((result) => (result.error ? [result.error] : []))
      store.sync.status = errors.length ? 'error' : 'idle'
      store.sync.message = errors.length ? `${errors.length} file(s) could not be imported` : ''
      store.sync.lastRunAt = new Date().toISOString()
      return { errors, imported: songs.length }
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
      throw error
    }
  })

  return { importPaths }
}
