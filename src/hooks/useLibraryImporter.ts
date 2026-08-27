import { $ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { basename } from '@tauri-apps/api/path'

import type { Metadata, Song, Store } from '~/App'
import { upsertSongs } from '~/services/library-db'
import { getErrorMessage } from '~/utils/Errors'
import { isAudioFile } from '~/utils/Files'
import { addLibraryRoot } from '~/services/library-refresh'

const IMPORT_CONCURRENCY = 4

interface ImportFile {
  name: string
  path: string
}

interface ImportResult {
  error?: string
  song?: Song
}

interface ImportPathPartition {
  directories: string[]
  files: string[]
}

export interface ImportSummary {
  errors: string[]
  folders: number
  imported: number
}

const parseInteger = (value?: string): number => {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

async function collectImportFiles(paths: string[]): Promise<ImportFile[]> {
  const files: ImportFile[] = []

  for (const path of paths) {
    if (isAudioFile(path)) files.push({ name: await basename(path), path })
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
  const importPaths = $(async (paths: string[]): Promise<ImportSummary> => {
    if (!paths.length) return { errors: [], folders: 0, imported: 0 }

    store.sync = {
      ...store.sync,
      status: 'importing',
      processed: 0,
      total: 0,
      message: 'Finding audio files',
    }

    try {
      const { directories, files: filePaths } = await invoke<ImportPathPartition>('classify_import_paths', { paths })
      const rootResults = await Promise.all(
        directories.map(async (path) => {
          try {
            await addLibraryRoot(path)
            return ''
          } catch (error) {
            return `${path}: ${getErrorMessage(error)}`
          }
        })
      )
      const rootErrors = rootResults.filter(Boolean)
      const files = await collectImportFiles(filePaths)
      if (!files.length) {
        store.sync.status = rootErrors.length ? 'error' : directories.length ? 'scanning' : 'idle'
        store.sync.message = rootErrors.length
          ? `${rootErrors.length} folder(s) could not be added`
          : directories.length
            ? 'Native library refresh started'
            : 'No audio files found'
        return { errors: rootErrors, folders: directories.length - rootErrors.length, imported: 0 }
      }
      store.sync.total = files.length
      store.sync.message = files.length ? 'Reading metadata' : 'No audio files found'

      const results = await mapWithConcurrency(
        files,
        IMPORT_CONCURRENCY,
        async (file): Promise<ImportResult> => {
          try {
            const song = await readSong(file)
            return { song }
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
      store.libraryCatalog.refreshKey += 1

      const errors = [...rootErrors, ...results.flatMap((result) => (result.error ? [result.error] : []))]
      store.sync.status = errors.length ? 'error' : 'idle'
      store.sync.message = errors.length ? `${errors.length} file(s) could not be imported` : ''
      store.sync.lastRunAt = new Date().toISOString()
      return { errors, folders: directories.length - rootErrors.length, imported: songs.length }
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
      throw error
    }
  })

  return { importPaths }
}
