import { $, component$, useContext, useStore } from '@builder.io/qwik'

import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { getUpcomingSongs } from '~/utils/Songs'

const QUEUE_ERROR_MESSAGE = 'Jukebox could not update the queue.'
const ACTION_CLASS =
  'px-1 py-1 text-[11px] text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30'

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const state = useStore({ action: '', error: '' })
  const upcomingSongs = getUpcomingSongs(store.playlist, store.player.currSongIndex)
  const hasExplicitQueue = store.queue.length > 0
  const busy = Boolean(state.action)

  const clearQueue = $(async () => {
    if (state.action) return
    state.action = 'clear'
    state.error = ''
    try {
      await storeActions.clearUpcoming()
    } catch {
      state.error = QUEUE_ERROR_MESSAGE
    } finally {
      state.action = ''
    }
  })

  const undoQueueEdit = $(async () => {
    if (state.action) return
    state.action = 'undo'
    state.error = ''
    try {
      await storeActions.undoQueueEdit()
    } catch {
      state.error = QUEUE_ERROR_MESSAGE
    } finally {
      state.action = ''
    }
  })

  const removeEntry = $(async (entryId: string) => {
    if (state.action) return
    state.action = `remove:${entryId}`
    state.error = ''
    try {
      await storeActions.removeQueuedSong(entryId)
    } catch {
      state.error = QUEUE_ERROR_MESSAGE
    } finally {
      state.action = ''
    }
  })

  const moveEntry = $(async (entryId: string, beforeEntryId?: string | null) => {
    if (state.action) return
    state.action = `move:${entryId}`
    state.error = ''
    try {
      await storeActions.moveQueuedSong(entryId, beforeEntryId)
    } catch {
      state.error = QUEUE_ERROR_MESSAGE
    } finally {
      state.action = ''
    }
  })

  return (
    <section class="border-t border-gray-700 p-2" aria-label={hasExplicitQueue ? 'Queued tracks' : 'Upcoming tracks'}>
      <div class="flex min-h-7 items-center justify-between gap-2">
        <span class="text-xs text-gray-400">{hasExplicitQueue ? 'Queue' : 'Up next'}</span>
        <div class="flex items-center gap-2">
          {store.player.canUndoQueueEdit && (
            <button class={ACTION_CLASS} onClick$={undoQueueEdit} disabled={busy}>
              Undo
            </button>
          )}
          {hasExplicitQueue && (
            <button class={ACTION_CLASS} onClick$={clearQueue} disabled={busy}>
              Clear
            </button>
          )}
        </div>
      </div>

      {state.error && (
        <p role="alert" class="mb-2 border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-200">
          {state.error}
        </p>
      )}

      {hasExplicitQueue ? (
        <ol>
          {store.queue.map((entry, index) => (
            <li class="border-b border-gray-800 py-2 last:border-b-0" key={entry.entryId}>
              <div class="flex min-w-0 items-start justify-between gap-2">
                <div class="min-w-0">
                  <span class="block truncate">{entry.song.title}</span>
                  <span class="block truncate text-xs text-gray-400">{entry.song.artist}</span>
                </div>
                <span class="text-[10px] tabular-nums text-slate-600">{index + 1}</span>
              </div>
              <div class="mt-1 flex justify-end gap-2">
                <button
                  class={ACTION_CLASS}
                  disabled={busy || index === 0}
                  onClick$={() => moveEntry(entry.entryId, store.queue[index - 1]?.entryId)}
                  aria-label={`Move ${entry.song.title} up`}
                >
                  Up
                </button>
                <button
                  class={ACTION_CLASS}
                  disabled={busy || index === store.queue.length - 1}
                  onClick$={() => moveEntry(entry.entryId, store.queue[index + 2]?.entryId || null)}
                  aria-label={`Move ${entry.song.title} down`}
                >
                  Down
                </button>
                <button
                  class={`${ACTION_CLASS} hover:text-red-300`}
                  disabled={busy}
                  onClick$={() => removeEntry(entry.entryId)}
                  aria-label={`Remove ${entry.song.title} from the queue`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ol>
          {upcomingSongs.map((song, index) => (
            <li class="py-2" key={`upcoming-song-${song.id}-${index}`}>
              <span class="block truncate">{song.title}</span>
              <span class="block truncate text-xs text-gray-400">{song.artist}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
})
