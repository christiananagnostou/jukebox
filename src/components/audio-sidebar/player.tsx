import type { QwikChangeEvent } from '@builder.io/qwik'
import { $, component$, useContext } from '@builder.io/qwik'
import { StoreContext, StoreActionsContext } from '~/routes/layout'
import { NextTrack } from '../svg/NextTrack'
import { Pause } from '../svg/Pause'
import { Play } from '../svg/Play'
import { PrevTrack } from '../svg/PrevTrack'

interface IndexProps {}

export default component$<IndexProps>(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const dragHandler = $((e: QwikChangeEvent<HTMLInputElement>) => {
    if (!store.player.audioElem) return
    const currentDraggedTime = parseInt(e.target.value)
    store.player.audioElem.currentTime = currentDraggedTime
  })

  const formatSeconds = $((time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    const secondsWithZero = String(seconds).padStart(2, '0')
    return `${minutes}:${secondsWithZero}`
  })

  return (
    <div class="text-center text-sm group/nav-player">
      <div class="max-w-[250px] m-auto">
        {/* Album Art */}
        <div class="w-full aspect-square bg-slate-800">{/* <img src="" alt="" /> */}</div>

        {/* Range Slider */}
        <div>
          <div class="w-full relative overflow-hidden h-2">
            <input
              class="appearance-none w-full block"
              type="range"
              min={0}
              max={store.player.duration}
              value={store.player.currentTime}
              onChange$={dragHandler}

              // TODO: get color from album art
              // style={{
              //   background: `linear-gradient(to right, ${store.player.currSong.color[0]}, ${store.player.currentSong.color[1]})`,
              // }}
            />
            {store.player.audioElem && (
              <div
                class="bg-slate-500 w-full h-full absolute left-0 top-0 pointer-events-none"
                style={{
                  transform: `translateX(${(store.player.currentTime / store.player.duration) * 100}%)`,
                }}
              ></div>
            )}
          </div>

          <div class="flex justify-between w-full opacity-0 text-xs text-slate-400 group-hover/nav-player:opacity-100 transition-opacity duration-300">
            <p class="px-1">{formatSeconds(store.player.currentTime)}</p>
            <p class="px-1">{formatSeconds(store.player.duration)}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div class="flex justify-evenly text-slate-500 mt-1">
        <button onClick$={storeActions.prevSong}>
          <PrevTrack />
        </button>
        {store.player.isPaused ? (
          <button onClick$={storeActions.resumeSong}>
            <Play />
          </button>
        ) : (
          <button onClick$={storeActions.pauseSong}>
            <Pause />
          </button>
        )}
        <button onClick$={storeActions.nextSong}>
          <NextTrack />
        </button>
      </div>

      <div class="text-left flex flex-col gap-3 p-2 my-2 border-b border-slate-700">
        <p class="truncate text-lg">{store.player.currSong?.title}</p>

        <p class="truncate">
          <span class="text-xs block text-gray-400">Album</span>
          {store.player.currSong?.album}
        </p>

        <p class="truncate">
          <span class="text-xs block text-gray-400">Artist</span>
          {store.player.currSong?.artist}
        </p>

        <p class="truncate">
          <span class="text-xs block text-gray-400">Genre</span>
          {store.player.currSong?.genre || '-'}
        </p>
        <p class="truncate">
          <span class="text-xs block text-gray-400">Date</span>
          {store.player.currSong?.date || '-'}
        </p>
        <p class="truncate">
          <span class="text-xs block text-gray-400">Track</span>
          {store.player.currSong?.trackNumber || '-'}
          {store.player.currSong?.trackTotal ? ' of ' + store.player.currSong.trackTotal : ''}
        </p>

        <p class="truncate">
          <span class="text-xs block text-gray-400">Codec</span>
          {store.player.currSong?.codec || '-'}
        </p>

        <p class="truncate">
          <span class="text-xs block text-gray-400">Sample Rate</span>
          {store.player.currSong?.sampleRate || '-'}
        </p>
      </div>
    </div>
  )
})
