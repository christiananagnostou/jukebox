import type { FileNode, PathIndexMap, Song, Store, StoreActions } from '~/App'
import { $ } from '@builder.io/qwik'
import { organizeFiles } from '~/utils/Files'

export const StorageStore = {
  storageView: {
    cursorIdx: 0,
    rootFile: organizeFiles([]),
    pathIndexMap: {},
    nodeCount: 0,
  },
}

export function useStoragePage(store: Store, storeActions: StoreActions) {
  const countAndMapFiles = $((rootFile: FileNode) => {
    let nodeCount = 0
    const pathIndexMap: PathIndexMap = {}

    const mapChildren = (file: FileNode, isParentClosed = false) => {
      if (!isParentClosed) pathIndexMap[nodeCount++] = file
      file.children.forEach((child) => mapChildren(child, file.isClosed || isParentClosed))
    }
    mapChildren(rootFile, rootFile.hidden)
    store.storageView.pathIndexMap = pathIndexMap
    store.storageView.nodeCount = nodeCount
    store.storageView.cursorIdx = Math.min(store.storageView.cursorIdx, Math.max(0, nodeCount - 1))
  })

  const playFile = $((file?: FileNode) => {
    if (!file) return

    const getChildrenSongs = (f: FileNode, songs: Song[] = []): Song[] => {
      if (f.song) songs.push(f.song)
      f.children.forEach((child) => getChildrenSongs(child, songs))
      return songs
    }

    store.playlist = getChildrenSongs(file)

    const songToPlay = file.song || store.playlist[0]
    if (songToPlay) storeActions.playSong(songToPlay, 0)
  })

  const highlightUp = $(() => {
    if (!store.storageView.nodeCount) return
    store.storageView.cursorIdx =
      store.storageView.cursorIdx <= 0 ? store.storageView.nodeCount - 1 : store.storageView.cursorIdx - 1
  })

  const highlightDown = $(() => {
    if (!store.storageView.nodeCount) return
    store.storageView.cursorIdx =
      store.storageView.cursorIdx >= store.storageView.nodeCount - 1 ? 0 : store.storageView.cursorIdx + 1
  })

  return {
    playFile,
    highlightUp,
    highlightDown,
    countAndMapFiles,
  }
}
