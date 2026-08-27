import { component$, useComputed$, useContext } from '@builder.io/qwik'
import { convertFileSrc } from '@tauri-apps/api/core'

import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { MusicNote } from '../svg/MusicNote'
import { NextTrack } from '../svg/NextTrack'
import { Pause } from '../svg/Pause'
import { Play } from '../svg/Play'
import { PrevTrack } from '../svg/PrevTrack'

function formatSeconds(time: number): string {
  if (!Number.isFinite(time) || time < 0) return '0:00'

  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const albumArt = useComputed$(() => {
    const visualsPath = store.player.currSong?.visualsPath
    return visualsPath ? convertFileSrc(visualsPath) : ''
  })

  return (
    <div class="text-sm">
      <div class="max-w-[250px] m-auto">
        {albumArt.value ? (
          <img
            src={albumArt.value}
            alt=""
            width={250}
            height={250}
            decoding="async"
            class="aspect-square object-contain"
          />
        ) : (
          <div class="aspect-square w-full grid place-items-center bg-gray-800 text-gray-700">
            <MusicNote height="20%" width="20%" />
          </div>
        )}

        <input
          type="range"
          min={0}
          max={Math.max(store.player.duration, 0)}
          step={0.1}
          value={Math.min(store.player.currentTime, store.player.duration || 0)}
          aria-label="Playback position"
          class="mt-3 w-full accent-yellow-500"
          onInput$={(_, element) => {
            void storeActions.seekSong(Number(element.value))
          }}
        />

        <div class="flex justify-between text-xs text-slate-400">
          <span>{formatSeconds(store.player.currentTime)}</span>
          <span>{formatSeconds(store.player.duration)}</span>
        </div>
      </div>

      <div class="mt-2 flex justify-evenly text-slate-500">
        <button onClick$={storeActions.prevSong} aria-label="Previous track" title="Previous track">
          <PrevTrack />
        </button>
        {store.player.isPaused ? (
          <button onClick$={storeActions.resumeSong} aria-label="Play" title="Play">
            <Play />
          </button>
        ) : (
          <button onClick$={storeActions.pauseSong} aria-label="Pause" title="Pause">
            <Pause />
          </button>
        )}
        <button onClick$={storeActions.nextSong} aria-label="Next track" title="Next track">
          <NextTrack />
        </button>
      </div>

      {store.player.error && (
        <p role="alert" class="mt-3 border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-200">
          {store.player.error}
        </p>
      )}

      <dl class="mt-4 grid gap-3 border-b border-slate-700 p-2">
        <div>
          <dt class="text-xs text-gray-400">Title</dt>
          <dd class="truncate text-lg">{store.player.currSong?.title || '-'}</dd>
        </div>
        <div>
          <dt class="text-xs text-gray-400">Artist</dt>
          <dd class="truncate">{store.player.currSong?.artist || '-'}</dd>
        </div>
        <div>
          <dt class="text-xs text-gray-400">Album</dt>
          <dd class="truncate">{store.player.currSong?.album || '-'}</dd>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <dt class="text-xs text-gray-400">Track</dt>
            <dd class="truncate">
              {store.player.currSong?.trackNumber || '-'}
              {store.player.currSong?.trackTotal ? ` of ${store.player.currSong.trackTotal}` : ''}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-400">Year</dt>
            <dd class="truncate">{store.player.currSong?.date || '-'}</dd>
          </div>
          <div>
            <dt class="text-xs text-gray-400">Codec</dt>
            <dd class="truncate">{store.player.currSong?.codec || '-'}</dd>
          </div>
          <div>
            <dt class="text-xs text-gray-400">Sample rate</dt>
            <dd class="truncate">{store.player.currSong?.sampleRate || '-'}</dd>
          </div>
        </div>
      </dl>
    </div>
  )
})
