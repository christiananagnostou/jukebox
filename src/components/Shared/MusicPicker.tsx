import { $, component$, useContext, useOnWindow, useVisibleTask$ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import type { Event } from '@tauri-apps/api/event'
import { listen } from '@tauri-apps/api/event'
import { audioDir, basename, join } from '@tauri-apps/api/path'
import { message, open } from '@tauri-apps/plugin-dialog'
import type { DirEntry } from '@tauri-apps/plugin-fs'
import { readDir, stat } from '@tauri-apps/plugin-fs'

import type { Metadata, Song } from '~/App'
import { upsertSongs } from '~/services/library-db'
import { isAudioFile } from '~/utils/Files'
import { mergeSongs } from '~/utils/Songs'
import { StoreContext } from '~/routes/layout'

const IMPORT_CONCURRENCY = 4

interface ImportFile {
  name: string
  path: string
}

interface ImportResult {
  error?: string
  song?: Song
}

const parseInteger = (value?: string): number => {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
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

export default component$(({ styles }: { styles: { button: string; icon: string } }) => {
  const store = useContext(StoreContext)

  const importPaths = $(async (paths: string[]) => {
    const files = await collectImportFiles(paths)
    const existingById = new Map(store.allSongs.map((song) => [song.id, song]))

    const results = await mapWithConcurrency(files, IMPORT_CONCURRENCY, async (file): Promise<ImportResult> => {
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
        return { error: `${file.path}: ${errorMessage(error)}` }
      }
    })

    const songs = results.flatMap((result) => (result.song ? [result.song] : []))
    await upsertSongs(songs)
    store.allSongs = mergeSongs(store.allSongs, songs)

    const errors = results.flatMap((result) => (result.error ? [result.error] : []))
    if (errors.length) {
      await message(`Imported ${songs.length} file(s); ${errors.length} failed.\n\n${errors.slice(0, 5).join('\n')}`, {
        kind: 'warning',
        title: 'Jukebox import',
      })
    }
  })

  const openDirectoryPicker = $(async () => {
    const selected = await open({
      directory: true,
      multiple: true,
      defaultPath: store.audioDir,
    })

    if (!selected) return

    try {
      await importPaths(Array.isArray(selected) ? selected : [selected])
    } catch (error) {
      await message(errorMessage(error), {
        kind: 'error',
        title: 'Jukebox import failed',
      })
    }
  })

  useVisibleTask$(async () => {
    store.audioDir = await audioDir().catch(() => '')

    const unlistenFileDrop = await listen<string[]>('tauri://file-drop', async (event: Event<string[]>) => {
      if (event.payload?.length) {
        try {
          await importPaths(event.payload)
        } catch (error) {
          await message(errorMessage(error), {
            kind: 'error',
            title: 'Jukebox import failed',
          })
        }
      }
    })

    return unlistenFileDrop
  })

  useOnWindow(
    'keydown',
    $((event: globalThis.Event) => {
      const keyboardEvent = event as KeyboardEvent
      if (keyboardEvent.shiftKey && keyboardEvent.key.toLowerCase() === 'i') {
        keyboardEvent.preventDefault()
        openDirectoryPicker()
      }
    })
  )

  return (
    <button onClick$={openDirectoryPicker} class={styles.button}>
      Import Music
      <span class={styles.icon}>I</span>
    </button>
  )
})
