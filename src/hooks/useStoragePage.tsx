import type { StorageNode, Store, StoreActions } from '~/App'
import { $ } from '@builder.io/qwik'

import { loadTrackSelection } from '~/services/library-client'

export const StorageStore = {
  storageView: {
    cursorIdx: 0,
    nodes: { error: '', pages: {}, revision: 0, status: 'loading', total: 0 },
    parent: '',
    rootDisplayPath: '',
    rootId: null,
    rootName: '',
  },
} satisfies Pick<Store, 'storageView'>

export function useStoragePlayNode(store: Store, storeActions: StoreActions) {
  return $(async (node?: StorageNode) => {
    if (!node) return
    try {
      const songs = await loadTrackSelection({
        direction: 'asc',
        pathPrefix: node.relativePath || undefined,
        q: store.searchTerm,
        rootId: node.rootId,
        sort: 'default',
      })
      if (!songs.length) return
      store.playlist = songs
      storeActions.playSong(songs[0], 0, { kind: 'folder', label: node.name })
      store.bootstrap.libraryError = ''
    } catch {
      store.bootstrap.libraryError = 'Jukebox could not prepare that storage selection for playback.'
    }
  })
}

export function useStorageOpenNode(store: Store) {
  return $((node?: StorageNode) => {
    if (!node || node.kind === 'track') return
    store.storageView.cursorIdx = 0
    if (node.kind === 'root') {
      store.storageView.rootId = node.rootId
      store.storageView.rootName = node.name
      store.storageView.rootDisplayPath = node.displayPath
      store.storageView.parent = ''
      return
    }
    store.storageView.parent = node.relativePath
  })
}

export function useStorageOpenParent(store: Store) {
  return $(() => {
    store.storageView.cursorIdx = 0
    if (store.storageView.parent) {
      store.storageView.parent = store.storageView.parent.split('/').slice(0, -1).join('/')
      return
    }
    store.storageView.rootId = null
    store.storageView.rootName = ''
    store.storageView.rootDisplayPath = ''
  })
}

export function useStorageHighlightUp(store: Store) {
  return $(() => {
    if (!store.storageView.nodes.total) return
    store.storageView.cursorIdx =
      store.storageView.cursorIdx <= 0 ? store.storageView.nodes.total - 1 : store.storageView.cursorIdx - 1
  })
}

export function useStorageHighlightDown(store: Store) {
  return $(() => {
    if (!store.storageView.nodes.total) return
    store.storageView.cursorIdx =
      store.storageView.cursorIdx >= store.storageView.nodes.total - 1 ? 0 : store.storageView.cursorIdx + 1
  })
}
