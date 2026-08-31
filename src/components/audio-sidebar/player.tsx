import { $, component$, useComputed$, useContext, useStore } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'
import { convertFileSrc } from '@tauri-apps/api/core'

import type { Song } from '~/App'
import MetadataLink from '~/components/library/MetadataLink'
import { PLAYBACK_ACCESS_ERROR_MESSAGE } from '~/hooks/useAudioPlayer'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { updateFavoriteRating } from '~/services/library-db'
import { trackMetadataDestinations } from '~/services/library-destination'
import PlaybackLink from './playback-link'
import { MusicNote } from '../svg/MusicNote'
import { NextTrack } from '../svg/NextTrack'
import { Pause } from '../svg/Pause'
import { Play } from '../svg/Play'
import { Repeat, Shuffle, Volume, VolumeMuted } from '../svg/PlaybackModeIcons'
import { PrevTrack } from '../svg/PrevTrack'
import { Star0 } from '../svg/Star0'
import { Star1 } from '../svg/Star1'
import { Star2 } from '../svg/Star2'

const MODE_BUTTON_CLASS =
  'playback-interactive playback-mode-button relative grid h-8 w-8 place-items-center rounded text-lg'
const TRANSPORT_BUTTON_CLASS = 'playback-interactive grid h-10 w-10 place-items-center rounded-full'
const PRIMARY_BUTTON_CLASS = 'playback-primary-button grid h-11 w-11 place-items-center rounded-full'

function formatSeconds(time: number): string {
  if (!Number.isFinite(time) || time < 0) return '0:00'

  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function nextRepeatMode(mode: 'off' | 'one' | 'all'): 'off' | 'one' | 'all' {
  if (mode === 'off') return 'all'
  return mode === 'all' ? 'one' : 'off'
}

function repeatLabel(mode: 'off' | 'one' | 'all'): string {
  if (mode === 'one') return 'Repeat current track'
  if (mode === 'all') return 'Repeat playback context'
  return 'Repeat off'
}

const PlayerArtwork = component$<{ src: string }>(({ src }) =>
  src ? (
    <img src={src} alt="" width={240} height={240} decoding="async" class="aspect-square w-full object-contain" />
  ) : (
    <span class="aspect-square w-full grid place-items-center bg-slate-800 text-slate-600">
      <MusicNote height="18%" width="18%" />
    </span>
  )
)

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const favoriteState = useStore({ busy: false, error: '' })

  const albumArt = useComputed$(() => {
    const visualsPath = store.player.currSong?.visualsPath
    return visualsPath ? convertFileSrc(visualsPath) : ''
  })

  const setFavorite = $(async (rating: Song['favorRating']) => {
    const current = store.player.currSong
    if (!current || favoriteState.busy) return

    favoriteState.busy = true
    favoriteState.error = ''
    try {
      await updateFavoriteRating(current.id, rating)
      current.favorRating = rating
      for (const song of store.playlist) {
        if (song.id === current.id) song.favorRating = rating
      }
      for (const entry of store.queue) {
        if (entry.song.id === current.id) entry.song.favorRating = rating
      }
      store.libraryCatalog.refreshKey += 1
    } catch {
      favoriteState.error = 'Favorite rating could not be updated.'
    } finally {
      favoriteState.busy = false
    }
  })

  const current = store.player.currSong
  const destinations = current ? trackMetadataDestinations(current) : {}
  const nextFavorite = current ? (((current.favorRating + 1) % 3) as Song['favorRating']) : 0
  return (
    <section aria-label="Now playing" class="border-b border-slate-700/80">
      <div class="flex items-center justify-end px-4 pb-2 pt-3">
        <button
          type="button"
          class="playback-interactive grid h-8 w-8 place-items-center rounded text-lg"
          disabled={!current || favoriteState.busy}
          aria-label={current ? `Set favorite rating to ${nextFavorite}` : 'No track selected'}
          title={current ? `Favorite rating: ${current.favorRating}` : 'No track selected'}
          onClick$={() => setFavorite(nextFavorite)}
        >
          {current?.favorRating === 1 ? <Star1 /> : current?.favorRating === 2 ? <Star2 /> : <Star0 />}
        </button>
      </div>

      <div class="px-4">
        {current ? (
          destinations.album ? (
            <MetadataLink
              destination={destinations.album}
              ariaLabel={`Open album ${current.album}`}
              title={`Open ${current.album}`}
              class="playback-artwork-link mx-auto block max-w-[240px] overflow-hidden rounded-sm bg-slate-900 shadow-[0_14px_32px_rgba(0,0,0,0.22)]"
            >
              <PlayerArtwork src={albumArt.value} />
            </MetadataLink>
          ) : (
            <PlaybackLink
              href="/songs/"
              ariaLabel={`Find ${current.title} in the library`}
              title="Find in library"
              class="playback-artwork-link mx-auto block max-w-[240px] overflow-hidden rounded-sm bg-slate-900 shadow-[0_14px_32px_rgba(0,0,0,0.22)]"
            >
              <PlayerArtwork src={albumArt.value} />
            </PlaybackLink>
          )
        ) : (
          <div class="mx-auto max-w-[240px] overflow-hidden rounded-sm bg-slate-900 shadow-[0_14px_32px_rgba(0,0,0,0.22)]">
            <div class="aspect-square w-full grid place-items-center bg-slate-800 text-slate-600">
              <MusicNote height="18%" width="18%" />
            </div>
          </div>
        )}

        <div class="min-w-0 pb-1 pt-4 text-center">
          {current ? (
            <h2 class="truncate text-base font-semibold leading-6 text-slate-100" title={current.title}>
              <PlaybackLink href="/songs/">{current.title}</PlaybackLink>
            </h2>
          ) : (
            <h2 class="truncate text-base font-semibold leading-6 text-slate-100">Nothing playing</h2>
          )}
          {current?.artist ? (
            <p class="truncate text-xs leading-5 text-slate-400" title={current.artist}>
              {destinations.artist ? (
                <MetadataLink destination={destinations.artist}>{current.artist}</MetadataLink>
              ) : (
                current.artist
              )}
            </p>
          ) : (
            <p class="truncate text-xs leading-5 text-slate-400">Choose a track from your library</p>
          )}
          {current?.album && (
            <p class="truncate text-[11px] leading-4 text-slate-500" title={current.album}>
              {destinations.album ? (
                <MetadataLink destination={destinations.album}>{current.album}</MetadataLink>
              ) : (
                current.album
              )}
            </p>
          )}
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(store.player.duration, 0)}
          step={0.1}
          value={Math.min(store.player.currentTime, store.player.duration || 0)}
          disabled={!current}
          aria-label="Playback position"
          class="playback-range mt-2 w-full"
          style={`--range-progress: ${store.player.duration > 0 ? Math.min(100, (store.player.currentTime / store.player.duration) * 100) : 0}%`}
          onInput$={(_, element) => {
            void storeActions.seekSong(Number(element.value))
          }}
        />

        <div class="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-slate-500">
          <span>{formatSeconds(store.player.currentTime)}</span>
          <span>{formatSeconds(store.player.duration)}</span>
        </div>

        <div class="mt-1 grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-1" aria-label="Playback controls">
          <button
            type="button"
            class={`${MODE_BUTTON_CLASS} justify-self-start`}
            data-active={store.player.shuffleEnabled ? 'true' : 'false'}
            aria-label={store.player.shuffleEnabled ? 'Turn shuffle off' : 'Turn shuffle on'}
            aria-pressed={store.player.shuffleEnabled}
            title={store.player.shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
            onClick$={() => storeActions.setShuffleEnabled(!store.player.shuffleEnabled)}
          >
            <Shuffle />
          </button>
          <button
            class={TRANSPORT_BUTTON_CLASS}
            onClick$={storeActions.prevSong}
            aria-label="Previous track"
            title="Previous track"
          >
            <PrevTrack />
          </button>
          {!current ? (
            <button
              class={PRIMARY_BUTTON_CLASS}
              onClick$={storeActions.nextSong}
              aria-label="Play queued track"
              title="Play queued track"
            >
              <Play />
            </button>
          ) : store.player.isPaused ? (
            <button class={PRIMARY_BUTTON_CLASS} onClick$={storeActions.resumeSong} aria-label="Play" title="Play">
              <Play />
            </button>
          ) : (
            <button class={PRIMARY_BUTTON_CLASS} onClick$={storeActions.pauseSong} aria-label="Pause" title="Pause">
              <Pause />
            </button>
          )}
          <button
            class={TRANSPORT_BUTTON_CLASS}
            onClick$={storeActions.nextSong}
            aria-label="Next track"
            title="Next track"
          >
            <NextTrack />
          </button>
          <button
            type="button"
            class={`${MODE_BUTTON_CLASS} justify-self-end`}
            data-active={store.player.repeatMode !== 'off' ? 'true' : 'false'}
            aria-label={`${repeatLabel(store.player.repeatMode)}. Change mode.`}
            title={repeatLabel(store.player.repeatMode)}
            onClick$={() => storeActions.setRepeatMode(nextRepeatMode(store.player.repeatMode))}
          >
            <Repeat />
            {store.player.repeatMode === 'one' && (
              <span aria-hidden="true" class="absolute bottom-0.5 right-0.5 text-[8px] font-bold">
                1
              </span>
            )}
          </button>
        </div>

        <div class="mb-3 mt-2 flex items-center gap-2">
          <button
            type="button"
            class="playback-interactive grid h-8 w-8 shrink-0 place-items-center rounded text-base"
            aria-label={store.player.muted ? 'Unmute' : 'Mute'}
            aria-pressed={store.player.muted}
            title={store.player.muted ? 'Unmute' : 'Mute'}
            onClick$={() => storeActions.setMuted(!store.player.muted)}
          >
            {store.player.muted || store.player.volumePercent === 0 ? <VolumeMuted /> : <Volume />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={store.player.volumePercent}
            aria-label="Volume"
            aria-valuetext={`${store.player.volumePercent} percent${store.player.muted ? ', muted' : ''}`}
            class="playback-range w-full"
            data-muted={store.player.muted ? 'true' : 'false'}
            style={`--range-progress: ${store.player.volumePercent}%`}
            onChange$={(_, element) => storeActions.setVolumePercent(Number(element.value))}
          />
          <span class="w-7 text-right font-mono text-[10px] tabular-nums text-slate-500">
            {store.player.volumePercent}
          </span>
        </div>
      </div>

      {(store.player.error || favoriteState.error) && (
        <div role="alert" class="mx-3 mb-3 border-l-2 border-red-500 bg-red-950/60 px-3 py-2 text-xs text-red-100">
          <p>{favoriteState.error || store.player.error}</p>
          {store.player.error === PLAYBACK_ACCESS_ERROR_MESSAGE ? (
            <Link
              class="mt-2 inline-block font-semibold text-red-200 underline decoration-red-500/60 underline-offset-2 hover:text-white"
              href="/settings/library/"
            >
              Reconnect a music folder
            </Link>
          ) : (
            store.player.error &&
            current && (
              <button
                type="button"
                class="mt-2 font-semibold text-red-200 underline decoration-red-500/60 underline-offset-2 hover:text-white"
                onClick$={storeActions.resumeSong}
              >
                Try again
              </button>
            )
          )}
        </div>
      )}

      {current && (
        <details class="group border-t border-slate-800 text-xs">
          <summary class="playback-details-summary playback-interactive flex cursor-pointer list-none items-center justify-between px-4 py-3">
            <span>
              <span class="group-open:hidden">Show track details</span>
              <span class="hidden group-open:inline">Hide track details</span>
            </span>
            <span class="playback-details-chevron" aria-hidden="true">
              ›
            </span>
          </summary>
          <dl class="grid grid-cols-2 gap-x-3 gap-y-2 px-4 pb-4 pt-1">
            <div>
              <dt class="text-[10px] uppercase tracking-wide text-slate-600">Track</dt>
              <dd class="mt-1 truncate text-slate-300">
                {current.trackNumber || '-'}
                {current.trackTotal ? ` of ${current.trackTotal}` : ''}
              </dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wide text-slate-600">Year</dt>
              <dd class="mt-1 truncate text-slate-300">{current.date || '-'}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wide text-slate-600">Codec</dt>
              <dd class="mt-1 truncate text-slate-300">{current.codec || '-'}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wide text-slate-600">Sample rate</dt>
              <dd class="mt-1 truncate text-slate-300">{current.sampleRate || '-'}</dd>
            </div>
          </dl>
        </details>
      )}
    </section>
  )
})
