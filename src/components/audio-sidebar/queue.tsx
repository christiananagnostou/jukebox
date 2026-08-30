import { $, component$, useComputed$, useContext, useStore } from '@builder.io/qwik'

import type { Song } from '~/App'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { playbackSourceCopy } from '~/utils/PlaybackSource'
import { getUpcomingSongSelections } from '~/utils/Songs'
import PlaybackLink from './playback-link'

const QUEUE_ERROR_MESSAGE = 'Jukebox could not update the queue.'
const VISIBLE_QUEUE_LIMIT = 100
const ACTION_CLASS = 'playback-interactive rounded px-2 py-1 text-[11px]'
const PLAYBACK_ERROR_MESSAGE = 'Jukebox could not play that track.'

function formatDuration(song: Song): string {
  const parts = song.duration.split(':').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return ''
  const totalSeconds = Math.max(0, Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const state = useStore({ action: '', error: '' })
  const upcomingSelections = getUpcomingSongSelections(store.playlist, store.player.currSongIndex)
  const sourceCopy = useComputed$(() => playbackSourceCopy(store.playbackSource, store.playlist))
  const hasExplicitQueue = store.queue.length > 0
  const visibleQueue = store.queue.slice(0, VISIBLE_QUEUE_LIMIT)
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

  const playUpcoming = $(async (song: Song, contextIndex: number) => {
    if (state.action) return
    state.action = `play:${contextIndex}`
    state.error = ''
    try {
      await storeActions.playSong(song, contextIndex, store.playbackSource)
    } catch {
      state.error = PLAYBACK_ERROR_MESSAGE
    } finally {
      state.action = ''
    }
  })

  return (
    <section class="p-3" aria-label={hasExplicitQueue ? 'Queued tracks' : 'Upcoming tracks'}>
      <div class="flex min-h-8 items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div class="min-w-0">
          <h2
            class="truncate text-xs font-semibold text-slate-200"
            title={hasExplicitQueue ? 'Up next' : `Browse ${sourceCopy.value.heading}`}
          >
            {hasExplicitQueue ? (
              'Up next'
            ) : (
              <PlaybackLink href={sourceCopy.value.href} searchTerm={sourceCopy.value.searchTerm}>
                {sourceCopy.value.heading}
              </PlaybackLink>
            )}
          </h2>
          <p class="mt-0.5 text-[10px] text-slate-500">
            {hasExplicitQueue
              ? `${store.queue.length} manually queued ${store.queue.length === 1 ? 'track' : 'tracks'}`
              : sourceCopy.value.description}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          {store.player.canUndoQueueEdit && (
            <button class={`${ACTION_CLASS} playback-accent-text`} onClick$={undoQueueEdit} disabled={busy}>
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
        <p role="alert" class="my-2 border-l-2 border-red-500 bg-red-950/60 px-2 py-1.5 text-xs text-red-100">
          {state.error}
        </p>
      )}

      {hasExplicitQueue ? (
        <ol class="divide-y divide-slate-800/80">
          {visibleQueue.map((entry, index) => (
            <li class="group py-2.5" key={entry.entryId}>
              <div class="flex min-w-0 items-start gap-2">
                <span
                  aria-hidden="true"
                  class="playback-queue-marker mt-1.5 h-7 w-0.5 shrink-0 rounded-full"
                  title="Manually queued"
                />
                <div class="min-w-0 flex-1">
                  <span class="block truncate text-xs font-medium leading-5 text-slate-200" title={entry.song.title}>
                    {entry.song.title}
                  </span>
                  {entry.song.artist ? (
                    <PlaybackLink
                      href="/artists/"
                      class="block truncate text-[11px] leading-4 text-slate-500"
                      title={`Browse ${entry.song.artist}`}
                      searchTerm={entry.song.artist}
                    >
                      {entry.song.artist}
                    </PlaybackLink>
                  ) : (
                    <span class="block truncate text-[11px] leading-4 text-slate-500">Unknown artist</span>
                  )}
                </div>
                <span class="mt-1 shrink-0 font-mono text-[10px] tabular-nums text-slate-600">
                  {formatDuration(entry.song)}
                </span>
                <details class="relative shrink-0">
                  <summary
                    class="playback-interactive grid h-7 w-7 cursor-pointer list-none place-items-center rounded text-xs tracking-widest"
                    aria-label={`Actions for ${entry.song.title}`}
                    title="Queue actions"
                  >
                    ...
                  </summary>
                  <div class="mt-1 flex justify-end gap-1" aria-label={`Queue actions for ${entry.song.title}`}>
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
                </details>
              </div>
            </li>
          ))}
        </ol>
      ) : upcomingSelections.length ? (
        <ol class="divide-y divide-slate-800/70">
          {upcomingSelections.map(({ contextIndex, song }, index) => (
            <li
              class="playback-upcoming-row flex min-w-0 items-center gap-2 px-1 py-2.5"
              key={`upcoming-song-${contextIndex}`}
              tabIndex={0}
              title={`Double-click to play ${song.title}`}
              onDblClick$={() => playUpcoming(song, contextIndex)}
              onKeyDown$={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void playUpcoming(song, contextIndex)
                }
              }}
            >
              <span class="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-slate-600">
                {index + 1}
              </span>
              <div class="min-w-0 flex-1">
                <span class="block truncate text-xs leading-5 text-slate-300" title={song.title}>
                  {song.title}
                </span>
                {song.artist ? (
                  <PlaybackLink
                    href="/artists/"
                    class="block truncate text-[11px] leading-4 text-slate-500"
                    title={`Browse ${song.artist}`}
                    searchTerm={song.artist}
                  >
                    {song.artist}
                  </PlaybackLink>
                ) : (
                  <span class="block truncate text-[11px] leading-4 text-slate-500">Unknown artist</span>
                )}
              </div>
              <span class="shrink-0 font-mono text-[10px] tabular-nums text-slate-600">{formatDuration(song)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p class="py-5 text-center text-xs leading-5 text-slate-500">Choose a track to build an upcoming list.</p>
      )}

      {store.queue.length > VISIBLE_QUEUE_LIMIT && (
        <p class="border-t border-slate-800 py-2 text-center text-[10px] text-slate-500">
          Showing the first {VISIBLE_QUEUE_LIMIT} of {store.queue.length} queued tracks.
        </p>
      )}
    </section>
  )
})
