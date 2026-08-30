import {
  $,
  component$,
  noSerialize,
  useContext,
  useSignal,
  useStore,
  useTask$,
  useVisibleTask$,
  type NoSerialize,
} from '@builder.io/qwik'
import type { DocumentHead } from '@builder.io/qwik-city'

import type { ListItemStyle } from '~/App'
import BuiltInCollectionView from '~/components/playlists/BuiltInCollectionView'
import SmartPlaylistView from '~/components/playlists/SmartPlaylistView'
import { BUILT_IN_COLLECTIONS } from '~/components/playlists/built-in-collections'
import VirtualList from '~/components/Shared/VirtualList'
import { type BuiltInCollectionKind, resolvePlaybackTracks } from '~/services/library-client'
import {
  addPlaylistEntries,
  createPlaylist,
  deletePlaylist,
  duplicatePlaylist,
  isManualPlaylistKind,
  playlistAt,
  type PlaylistCatalogState,
  type PlaylistEntry,
  playlistEntryAt,
  PlaylistEntryPager,
  PLAYLIST_ENTRY_PAGE_SIZE,
  playlistErrorMessage,
  playlistPagePlaybackAt,
  PlaylistPager,
  type PlaylistSummary,
  removePlaylistEntries,
  renamePlaylist,
  movePlaylistEntry,
  type PlaylistMoveDirection,
} from '~/services/playlist-client'
import { StoreActionsContext, StoreContext } from '../layout'

const PLAYLIST_ROW_HEIGHT = 44
const ENTRY_ROW_HEIGHT = 52
const BUTTON_CLASS =
  'border border-gray-600 px-3 py-2 text-sm hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40'
const INPUT_CLASS = 'min-w-0 border border-gray-600 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-yellow-600'

function catalogState<Item>(): PlaylistCatalogState<Item> {
  return { error: '', pages: {}, status: 'loading', total: 0 }
}

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const playlists = useStore(catalogState<PlaylistSummary>())
  const entries = useStore(catalogState<PlaylistEntry>())
  const playlistPager = useSignal<NoSerialize<PlaylistPager>>()
  const entryPager = useSignal<NoSerialize<PlaylistEntryPager>>()
  const state = useStore({
    action: '',
    confirmDelete: false,
    createName: '',
    duplicateName: '',
    duplicating: false,
    editing: false,
    error: '',
    notice: '',
    renameName: '',
    selectedBuiltIn: '' as '' | BuiltInCollectionKind,
    selectedId: '',
    selectedKind: '' as '' | PlaylistSummary['kind'],
    selectedName: '',
    smartCreating: false,
  })

  useVisibleTask$(({ cleanup }) => {
    const playlistsController = new PlaylistPager(playlists)
    const entriesController = new PlaylistEntryPager(entries)
    playlistPager.value = noSerialize(playlistsController)
    entryPager.value = noSerialize(entriesController)
    void playlistsController.reset()

    cleanup(() => {
      playlistsController.dispose()
      entriesController.dispose()
      playlistPager.value = undefined
      entryPager.value = undefined
    })
  })

  useTask$(({ track }) => {
    const selectedId = track(() => state.selectedId)
    const selectedBuiltIn = track(() => state.selectedBuiltIn)
    const selectedKind = track(() => state.selectedKind)
    const smartCreating = track(() => state.smartCreating)
    state.confirmDelete = false
    state.duplicating = false
    state.editing = false
    if (selectedBuiltIn || smartCreating || selectedKind === 'smart') {
      entryPager.value?.clear()
    } else if (selectedId && isManualPlaylistKind(selectedKind)) {
      void entryPager.value?.reset(selectedId)
    } else {
      entryPager.value?.clear()
    }
  })

  const selectPlaylist = $((playlist: PlaylistSummary) => {
    state.error = ''
    state.notice = ''
    state.selectedBuiltIn = ''
    state.duplicating = false
    state.smartCreating = false
    state.selectedId = playlist.id
    state.selectedKind = playlist.kind
    state.selectedName = playlist.name
    state.renameName = playlist.name
  })

  const selectBuiltIn = $((kind: BuiltInCollectionKind) => {
    state.error = ''
    state.notice = ''
    state.selectedBuiltIn = kind
    state.duplicating = false
    state.smartCreating = false
    state.selectedId = ''
    state.selectedKind = ''
    state.selectedName = ''
  })

  const beginSmartPlaylist = $(() => {
    if (state.action) return
    state.error = ''
    state.notice = ''
    state.selectedBuiltIn = ''
    state.selectedId = ''
    state.selectedKind = ''
    state.selectedName = ''
    state.smartCreating = true
  })

  const smartPlaylistCreated = $(async (playlist: PlaylistSummary) => {
    state.smartCreating = false
    state.selectedBuiltIn = ''
    state.selectedId = playlist.id
    state.selectedKind = 'smart'
    state.selectedName = playlist.name
    state.notice = `Created ${playlist.name}.`
    await playlistPager.value?.reload()
  })

  const smartPlaylistUpdated = $(async (playlist: PlaylistSummary) => {
    state.selectedName = playlist.name
    state.notice = `Updated ${playlist.name}.`
    await playlistPager.value?.reload()
  })

  const smartPlaylistDeleted = $(async () => {
    const deletedName = state.selectedName
    state.selectedId = ''
    state.selectedKind = ''
    state.selectedName = ''
    state.notice = `Deleted ${deletedName}.`
    await playlistPager.value?.reload()
  })

  const createPlaylistRecord = $(async () => {
    const name = state.createName.trim()
    if (!name || state.action) return
    state.action = 'create'
    state.error = ''
    state.notice = ''
    try {
      const created = await createPlaylist(name)
      state.createName = ''
      state.selectedBuiltIn = ''
      state.smartCreating = false
      state.selectedId = created.id
      state.selectedKind = 'manual'
      state.selectedName = created.name
      state.renameName = created.name
      state.notice = `Created ${created.name}.`
      await playlistPager.value?.reload()
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not create that playlist.')
    } finally {
      state.action = ''
    }
  })

  const renamePlaylistRecord = $(async () => {
    const name = state.renameName.trim()
    if (!state.selectedId || !isManualPlaylistKind(state.selectedKind) || !name || state.action) return
    state.action = 'rename'
    state.error = ''
    state.notice = ''
    try {
      const renamed = await renamePlaylist(state.selectedId, name)
      state.selectedName = renamed.name
      state.renameName = renamed.name
      state.editing = false
      state.notice = `Renamed playlist to ${renamed.name}.`
      await playlistPager.value?.reload()
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not rename that playlist.')
    } finally {
      state.action = ''
    }
  })

  const deletePlaylistRecord = $(async () => {
    if (!state.selectedId || !isManualPlaylistKind(state.selectedKind) || state.action !== '') return
    state.action = 'delete'
    state.error = ''
    state.notice = ''
    try {
      const deletedName = state.selectedName
      await deletePlaylist(state.selectedId)
      state.selectedId = ''
      state.selectedKind = ''
      state.selectedName = ''
      state.renameName = ''
      state.confirmDelete = false
      state.notice = `Deleted ${deletedName}.`
      await playlistPager.value?.reload()
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not delete that playlist.')
    } finally {
      state.action = ''
    }
  })

  const duplicatePlaylistRecord = $(async () => {
    const name = state.duplicateName.trim()
    if (!state.selectedId || !isManualPlaylistKind(state.selectedKind) || !name || state.action) return
    state.action = 'duplicate'
    state.error = ''
    state.notice = ''
    try {
      const duplicated = await duplicatePlaylist(state.selectedId, name)
      state.duplicateName = ''
      state.duplicating = false
      state.selectedId = duplicated.id
      state.selectedKind = 'manual'
      state.selectedName = duplicated.name
      state.renameName = duplicated.name
      state.notice = `Created ${duplicated.name}.`
      await playlistPager.value?.reload()
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not duplicate that playlist.')
    } finally {
      state.action = ''
    }
  })

  const addCurrentTrack = $(async () => {
    const song = store.player.currSong
    if (!state.selectedId || !isManualPlaylistKind(state.selectedKind) || !song || state.action) return
    state.action = 'add'
    state.error = ''
    state.notice = ''
    try {
      await addPlaylistEntries(state.selectedId, [song.id])
      state.notice = `Added ${song.title}.`
      await Promise.all([entryPager.value?.reload(), playlistPager.value?.reload()])
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not add that track.')
    } finally {
      state.action = ''
    }
  })

  const removeEntry = $(async (entry: PlaylistEntry) => {
    if (!state.selectedId || !isManualPlaylistKind(state.selectedKind) || state.action) return
    state.action = `remove:${entry.id}`
    state.error = ''
    state.notice = ''
    try {
      await removePlaylistEntries(state.selectedId, [entry.id])
      state.notice = `Removed ${entry.title}.`
      await Promise.all([entryPager.value?.reload(), playlistPager.value?.reload()])
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not remove that playlist entry.')
    } finally {
      state.action = ''
    }
  })

  const moveEntry = $(async (entry: PlaylistEntry, direction: PlaylistMoveDirection) => {
    if (!state.selectedId || !isManualPlaylistKind(state.selectedKind) || state.action) return
    state.action = `move:${entry.id}`
    state.error = ''
    state.notice = ''
    try {
      const mutation = await movePlaylistEntry(state.selectedId, entry.id, direction)
      state.notice = mutation.affected
        ? `Moved ${entry.title} ${direction}.`
        : `${entry.title} is already at the ${direction === 'up' ? 'top' : 'bottom'}.`
      if (mutation.affected) await entryPager.value?.reload()
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not reorder that playlist entry.')
    } finally {
      state.action = ''
    }
  })

  const playEntry = $(async (index: number) => {
    if (!isManualPlaylistKind(state.selectedKind) || state.action) return
    const playback = playlistPagePlaybackAt(entries, index)
    const entry = playlistEntryAt(entries, index)
    if (!playback || !entry) return
    state.action = 'play'
    state.error = ''
    state.notice = ''
    try {
      const songs = await resolvePlaybackTracks(playback.trackIds)
      let playlistIndex = playback.playlistIndex
      if (songs[playlistIndex]?.id !== entry.songId) {
        const targetOccurrence = playback.trackIds
          .slice(0, playback.playlistIndex + 1)
          .filter((trackId) => trackId === entry.songId).length
        let occurrence = 0
        playlistIndex = songs.findIndex((song) => {
          if (song.id !== entry.songId) return false
          occurrence += 1
          return occurrence === targetOccurrence
        })
      }
      const selectedSong = songs[playlistIndex]
      if (!selectedSong) throw new Error('That playlist entry is no longer available.')
      store.playlist = songs
      await storeActions.playSong(selectedSong, playlistIndex)
    } catch (error) {
      state.error = playlistErrorMessage(error, 'Jukebox could not prepare that playlist page for playback.')
    } finally {
      state.action = ''
    }
  })

  const busy = Boolean(state.action)
  const selectedStatus = entries.error || state.error

  return (
    <section class="grid min-h-0 flex-1 grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col border-r border-gray-700" aria-label="Playlists">
        <div class="border-b border-gray-700 p-3">
          <h1 class="mb-3 text-lg">Playlists</h1>
          <form preventdefault:submit onSubmit$={createPlaylistRecord} class="flex gap-2">
            <label class="sr-only" for="new-playlist-name">
              New playlist name
            </label>
            <input
              id="new-playlist-name"
              class={`${INPUT_CLASS} flex-1`}
              value={state.createName}
              maxLength={200}
              placeholder="New playlist"
              onInput$={(_, input) => (state.createName = input.value)}
              onFocus$={() => (store.isTyping = true)}
              onBlur$={() => (store.isTyping = false)}
            />
            <button class={BUTTON_CLASS} type="submit" disabled={!state.createName.trim() || busy}>
              Create
            </button>
          </form>
          <button class={`${BUTTON_CLASS} mt-2 w-full`} type="button" onClick$={beginSmartPlaylist} disabled={busy}>
            New smart playlist
          </button>
          {!state.selectedId && !state.selectedBuiltIn && !state.smartCreating && (
            <div class="mt-2 min-h-4 text-xs" aria-live="polite">
              {state.error ? (
                <span role="alert" class="text-red-300">
                  {state.error}
                </span>
              ) : (
                <span class="text-slate-400">{state.notice}</span>
              )}
            </div>
          )}
        </div>

        <div class="border-b border-gray-700 p-2">
          <h2 class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Built-in</h2>
          <div class="flex flex-col" aria-label="Built-in collections">
            {BUILT_IN_COLLECTIONS.map((collection) => {
              const selected = collection.kind === state.selectedBuiltIn
              return (
                <button
                  key={collection.kind}
                  class={`min-h-10 px-2 text-left text-sm hover:bg-gray-800 ${selected ? 'bg-gray-700' : ''}`}
                  disabled={busy}
                  onClick$={() => selectBuiltIn(collection.kind)}
                  aria-current={selected ? 'page' : undefined}
                >
                  {collection.label}
                </button>
              )
            })}
          </div>
        </div>

        <div class="relative min-h-0 flex-1">
          <h2 class="sr-only">Your playlists</h2>
          {playlists.status === 'ready' && playlists.total === 0 && (
            <p class="p-4 text-sm leading-relaxed text-slate-400">Create a playlist to collect tracks for later.</p>
          )}
          {playlists.error && (
            <p role="alert" class="m-3 border border-red-900 bg-red-950 p-3 text-sm text-red-200">
              {playlists.error}
            </p>
          )}
          <VirtualList
            numItems={playlists.total}
            itemHeight={PLAYLIST_ROW_HEIGHT}
            onRangeChange={$((startIndex, endIndex) => playlistPager.value?.ensureRange(startIndex, endIndex))}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const playlist = playlistAt(playlists, index)
              if (!playlist) return <div class="bg-gray-900" style={{ ...style, height: `${PLAYLIST_ROW_HEIGHT}px` }} />
              const selected = playlist.id === state.selectedId
              return (
                <button
                  key={playlist.id}
                  class={`flex w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-gray-800 ${
                    selected ? 'bg-gray-700' : ''
                  }`}
                  style={{ ...style, height: `${PLAYLIST_ROW_HEIGHT}px` }}
                  onClick$={() => selectPlaylist(playlist)}
                  disabled={busy}
                  aria-current={selected ? 'page' : undefined}
                >
                  <span class="truncate">{playlist.name}</span>
                  <span class="text-xs tabular-nums text-slate-500">
                    {playlist.kind === 'smart' ? 'Smart' : playlist.entryCount}
                  </span>
                </button>
              )
            })}
          />
        </div>
      </aside>

      <div class="flex min-h-0 min-w-0 flex-col">
        {state.selectedBuiltIn ? (
          <BuiltInCollectionView kind={state.selectedBuiltIn} />
        ) : state.smartCreating ? (
          <SmartPlaylistView
            onCreated$={smartPlaylistCreated}
            onUpdated$={smartPlaylistUpdated}
            onDeleted$={smartPlaylistDeleted}
          />
        ) : !state.selectedId ? (
          <div class="grid flex-1 place-items-center p-8 text-center text-sm text-slate-400">
            <div>
              <p class="text-base text-slate-300">Select a playlist</p>
              <p class="mt-2">Choose one from the list or create a new collection.</p>
            </div>
          </div>
        ) : state.selectedKind === 'smart' ? (
          <SmartPlaylistView
            playlistId={state.selectedId}
            onCreated$={smartPlaylistCreated}
            onUpdated$={smartPlaylistUpdated}
            onDeleted$={smartPlaylistDeleted}
          />
        ) : (
          <>
            <header class="border-b border-gray-700 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="truncate text-xl">{state.selectedName}</h2>
                  <p class="mt-1 text-xs text-slate-500">
                    {entries.total} {entries.total === 1 ? 'entry' : 'entries'}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    class={BUTTON_CLASS}
                    onClick$={addCurrentTrack}
                    disabled={!store.player.currSong || busy}
                    title={store.player.currSong ? `Add ${store.player.currSong.title}` : 'Play a track first'}
                  >
                    Add current track
                  </button>
                  <button
                    class={BUTTON_CLASS}
                    onClick$={() => {
                      state.renameName = state.selectedName
                      state.editing = !state.editing
                      state.duplicating = false
                      state.confirmDelete = false
                    }}
                    disabled={busy}
                  >
                    Rename
                  </button>
                  <button
                    class={BUTTON_CLASS}
                    onClick$={() => {
                      state.duplicateName = `${state.selectedName} copy`
                      state.duplicating = !state.duplicating
                      state.editing = false
                      state.confirmDelete = false
                    }}
                    disabled={busy}
                  >
                    Duplicate
                  </button>
                  <button
                    class={`${BUTTON_CLASS} border-red-900 text-red-300`}
                    onClick$={() => {
                      state.confirmDelete = !state.confirmDelete
                      state.editing = false
                      state.duplicating = false
                    }}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {state.editing && (
                <form preventdefault:submit onSubmit$={renamePlaylistRecord} class="mt-3 flex max-w-lg gap-2">
                  <label class="sr-only" for="rename-playlist">
                    Playlist name
                  </label>
                  <input
                    id="rename-playlist"
                    class={`${INPUT_CLASS} flex-1`}
                    value={state.renameName}
                    maxLength={200}
                    onInput$={(_, input) => (state.renameName = input.value)}
                    onFocus$={() => (store.isTyping = true)}
                    onBlur$={() => (store.isTyping = false)}
                  />
                  <button class={BUTTON_CLASS} type="submit" disabled={!state.renameName.trim() || busy}>
                    Save
                  </button>
                  <button class={BUTTON_CLASS} type="button" onClick$={() => (state.editing = false)} disabled={busy}>
                    Cancel
                  </button>
                </form>
              )}

              {state.duplicating && (
                <form preventdefault:submit onSubmit$={duplicatePlaylistRecord} class="mt-3 flex max-w-lg gap-2">
                  <label class="sr-only" for="duplicate-playlist-name">
                    Duplicate playlist name
                  </label>
                  <input
                    id="duplicate-playlist-name"
                    class={`${INPUT_CLASS} flex-1`}
                    value={state.duplicateName}
                    maxLength={200}
                    onInput$={(_, input) => (state.duplicateName = input.value)}
                    onFocus$={() => (store.isTyping = true)}
                    onBlur$={() => (store.isTyping = false)}
                  />
                  <button class={BUTTON_CLASS} type="submit" disabled={!state.duplicateName.trim() || busy}>
                    Create copy
                  </button>
                  <button
                    class={BUTTON_CLASS}
                    type="button"
                    onClick$={() => (state.duplicating = false)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </form>
              )}

              {state.confirmDelete && (
                <div class="mt-3 flex flex-wrap items-center gap-3 border border-red-900 bg-red-950 px-3 py-2 text-sm">
                  <span>Delete this playlist and its entries?</span>
                  <button
                    class={`${BUTTON_CLASS} border-red-600 text-red-200`}
                    onClick$={deletePlaylistRecord}
                    disabled={busy}
                  >
                    Confirm delete
                  </button>
                  <button class={BUTTON_CLASS} onClick$={() => (state.confirmDelete = false)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              )}

              <div class="mt-3 min-h-4 text-xs" aria-live="polite">
                {selectedStatus ? (
                  <span role="alert" class="text-red-300">
                    {selectedStatus}
                  </span>
                ) : (
                  <span class="text-slate-400">{state.notice}</span>
                )}
              </div>
            </header>

            <div
              class="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.8fr)_200px] border-b border-gray-700 text-xs text-slate-400"
              style={{ minHeight: '30px', paddingRight: 'var(--scrollbar-width)' }}
            >
              <span class="flex items-center px-2">#</span>
              <span class="flex items-center border-l border-gray-700 px-3">Title</span>
              <span class="flex items-center border-l border-gray-700 px-3">Artist</span>
              <span class="flex items-center border-l border-gray-700 px-3">Album</span>
              <span class="flex items-center border-l border-gray-700 px-3">Status / actions</span>
            </div>

            <div class="relative min-h-0 flex-1">
              {entries.status === 'ready' && entries.total === 0 && (
                <div class="grid h-full place-items-center p-8 text-center text-sm text-slate-400">
                  <div>
                    <p class="text-slate-300">This playlist is empty.</p>
                    <p class="mt-2">Play a library track, then choose Add current track.</p>
                  </div>
                </div>
              )}
              <VirtualList
                numItems={entries.total}
                itemHeight={ENTRY_ROW_HEIGHT}
                onRangeChange={$((startIndex, endIndex) => entryPager.value?.ensureRange(startIndex, endIndex))}
                renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
                  const entry = playlistEntryAt(entries, index)
                  if (!entry) return <div class="bg-gray-900" style={{ ...style, height: `${ENTRY_ROW_HEIGHT}px` }} />
                  const available = entry.availability === 'available'
                  return (
                    <div
                      key={entry.id}
                      class="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.8fr)_200px] border-b border-gray-800 text-sm"
                      style={{ ...style, height: `${ENTRY_ROW_HEIGHT}px` }}
                    >
                      <span class="flex items-center px-2 tabular-nums text-slate-500">{index + 1}</span>
                      <button
                        class="flex min-w-0 items-center border-l border-gray-800 px-3 text-left hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-slate-500"
                        onClick$={() => playEntry(index)}
                        disabled={!available || busy}
                        aria-label={
                          available
                            ? `Play ${entry.title} by ${entry.artist || 'Unknown artist'}`
                            : `${entry.title} is ${entry.availability}`
                        }
                      >
                        <span class="truncate">{entry.title || '-'}</span>
                      </button>
                      <span class="flex min-w-0 items-center border-l border-gray-800 px-3">
                        <span class="truncate">{entry.artist || '-'}</span>
                      </span>
                      <span class="flex min-w-0 items-center border-l border-gray-800 px-3">
                        <span class="truncate">{entry.album || '-'}</span>
                      </span>
                      <span class="flex items-center justify-between gap-2 border-l border-gray-800 px-2">
                        <span class={available ? 'text-slate-500' : 'text-amber-300'}>
                          {available ? 'Ready' : entry.availability === 'missing' ? 'Missing' : 'Offline'}
                        </span>
                        <span class="flex items-center gap-2">
                          <button
                            class="px-1 py-2 text-xs text-slate-400 hover:text-white disabled:opacity-30"
                            onClick$={() => moveEntry(entry, 'up')}
                            disabled={busy || index === 0}
                            aria-label={`Move ${entry.title} up`}
                          >
                            Up
                          </button>
                          <button
                            class="px-1 py-2 text-xs text-slate-400 hover:text-white disabled:opacity-30"
                            onClick$={() => moveEntry(entry, 'down')}
                            disabled={busy || index === entries.total - 1}
                            aria-label={`Move ${entry.title} down`}
                          >
                            Down
                          </button>
                          <button
                            class="px-1 py-2 text-xs text-slate-400 hover:text-red-300 disabled:opacity-40"
                            onClick$={() => removeEntry(entry)}
                            disabled={busy}
                            aria-label={`Remove ${entry.title} from ${state.selectedName}`}
                            title="Remove entry"
                          >
                            Remove
                          </button>
                        </span>
                      </span>
                    </div>
                  )
                })}
              />
            </div>
            <p class="sr-only">
              Playlist entries load in pages of {PLAYLIST_ENTRY_PAGE_SIZE}; missing tracks remain visible but cannot be
              played.
            </p>
          </>
        )}
      </div>
    </section>
  )
})

export const head: DocumentHead = {
  title: 'Playlists · Jukebox',
  meta: [
    {
      name: 'description',
      content: 'Create and manage local Jukebox playlists.',
    },
  ],
}
