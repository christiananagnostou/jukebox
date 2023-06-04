import type { Store, StoreActions, FileNode, Song } from '~/App'
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

    const mapChildren = (file: FileNode, isParentClosed: boolean = false) => {
      // remove index for files whos parent(s) are hidden
      if (!isParentClosed) store.storageView.pathIndexMap[nodeCount++] = file
      file.children.forEach((child) => mapChildren(child, file.isClosed || isParentClosed))
    }
    mapChildren(rootFile, rootFile.hidden)
    store.storageView.nodeCount = nodeCount
  })

  // Recurse through children to get songs
  const playFile = $((file: FileNode) => {
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
    store.storageView.cursorIdx =
      store.storageView.cursorIdx <= 0 ? store.storageView.nodeCount - 1 : store.storageView.cursorIdx - 1
  })

  const highlightDown = $(() => {
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
