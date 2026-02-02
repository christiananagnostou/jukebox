import { $ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import type { DirEntry } from '@tauri-apps/plugin-fs'
import { readDir } from '@tauri-apps/plugin-fs'
import md5 from 'md5'

import type { Metadata, Song, Store, StoreActions } from '~/App'
import { LIBRARY_DB } from '~/routes/layout'
import { isAudioFile } from '~/utils/Files'
import Database from '@tauri-apps/plugin-sql'

export type ScanMode = 'scan' | 'import'

export function useLibraryScanner(store: Store, storeActions: StoreActions) {
  const startSync = $((mode: ScanMode) => {
    store.sync.status = mode === 'import' ? 'importing' : 'scanning'
    store.sync.processed = 0
    store.sync.total = 0
    store.sync.message = ''
  })

  const finishSync = $(() => {
    store.sync.status = 'idle'
    store.sync.lastRunAt = new Date().toISOString()
    store.sync.message = ''
  })

  const failSync = $((message: string) => {
    store.sync.status = 'error'
    store.sync.message = message
  })

  const addSong = $(async (filePath: string, fileName: string, db: Database) => {
    if (!isAudioFile(filePath)) return

    store.sync.total += 1
    const data = await invoke<string>('get_metadata', { filePath })
    if (!data) return

    let metadata: Metadata
    try {
      metadata = JSON.parse(data) as Metadata
    } catch {
      return
    }

    const { meta_tags } = metadata

    const song: Song = {
      id: md5(filePath),
      path: filePath,
      file: fileName,
      title: meta_tags.TrackTitle || '',
      trackNumber: parseInt(meta_tags.TrackNumber) || 0,
      side: parseInt(meta_tags.Side),
      album: meta_tags.Album || '',
      artist: meta_tags.Artist || '',
      genre: meta_tags.Genre || '',
      bpm: parseInt(meta_tags.Bpm) || 0,
      compilation: parseInt(meta_tags.Compilation) || 0,
      date: meta_tags.Date || '',
      encoder: meta_tags.Encoder || '',
      trackTotal: parseInt(meta_tags.TrackTotal) || 0,
      codec: metadata.codec,
      duration: metadata.duration,
      sampleRate: metadata.sample_rate,
      startTime: 0,
      favorRating: 0,
      dateAdded: new Date().toISOString(),
      visualsPath: metadata.visual_info.image_path,
    }

    const existingIndex = store.allSongs.findIndex((existing) => existing.id === song.id)
    if (existingIndex >= 0) {
      song.dateAdded = store.allSongs[existingIndex].dateAdded
      store.allSongs[existingIndex] = song
    } else {
      storeActions.addSongInOrder(song)
    }

    const columns = Object.keys(song).join(', ')
    const values = Object.values(song)
    const placeholders = Array.from({ length: values.length }, (_, i) => `$${i + 1}`).join(', ')
    const updates = Object.keys(song)
      .filter((key) => key !== 'dateAdded')
      .map((key) => `${key}=excluded.${key}`)
      .concat('dateAdded=songs.dateAdded')
      .join(', ')

    const query = `INSERT INTO songs (${columns}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`
    await db.execute(query, values)

    store.sync.processed += 1
  })

  const processEntries = $(async (basePath: string, entries: DirEntry[], db: Database) => {
    const process = async (parentPath: string, ent: DirEntry[]) => {
      for (const entry of ent.values()) {
        if (entry.name.startsWith('.')) continue
        const entryPath = await join(parentPath, entry.name)

        if (entry.isDirectory) {
          const nested = await readDir(entryPath)
          await process(entryPath, nested)
        } else if (entry.isFile) {
          await addSong(entryPath, entry.name, db)
        }
      }
    }

    await process(basePath, entries)
  })

  const scanDirectories = $(async (paths: string[], mode: ScanMode = 'scan') => {
    if (!paths.length) return
    startSync(mode)

    let failed = false
    const db = await Database.load(LIBRARY_DB)

    await db.execute(`CREATE TABLE IF NOT EXISTS songs (
         id TEXT PRIMARY KEY,
         path TEXT,
         file TEXT,
         title TEXT,
         album TEXT,
         artist TEXT,
         genre TEXT,
         bpm INTEGER,
         compilation INTEGER,
         date TEXT,
         encoder TEXT,
         trackTotal INTEGER,
         trackNumber INTEGER,
         codec TEXT,
         duration TEXT,
         sampleRate TEXT,
         side INTEGER,
         startTime INTEGER,
         favorRating INTEGER CHECK (favorRating IN (0, 1, 2)),
         dateAdded TEXT,
         visualsPath TEXT
     )`)

    try {
      for (const path of paths) {
        const entries = await readDir(path)
        await processEntries(path, entries, db)
      }
    } catch {
      failed = true
      failSync('Scan failed')
    } finally {
      await db.close()
      if (!failed) finishSync()
    }
  })

  const scanDirectory = $(async (path: string, mode: ScanMode = 'scan') => {
    await scanDirectories([path], mode)
  })

  return {
    scanDirectory,
    scanDirectories,
  }
}
