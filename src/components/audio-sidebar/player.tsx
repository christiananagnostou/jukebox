import type { QwikChangeEvent } from '@builder.io/qwik'
import { $, useComputed$, component$, useContext, useStore } from '@builder.io/qwik'
import { Store as DB } from 'tauri-plugin-store-api'
import { StoreContext, StoreActionsContext, ALBUM_ART_DB } from '~/routes/layout'
import { NextTrack } from '../svg/NextTrack'
import { Pause } from '../svg/Pause'
import { Play } from '../svg/Play'
import { PrevTrack } from '../svg/PrevTrack'
import type { AlbumArt } from '~/App'

interface IndexProps {}

export default component$<IndexProps>(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const state = useStore({
    isEditing: false,
  })

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

  const albumArt = useComputed$(async () => {
    const albumArtDB = new DB(ALBUM_ART_DB)
    if (!store.player.currSong?.id) return ''

    const visualInfo = (await albumArtDB.get(store.player.currSong.id)) as AlbumArt
    if (!visualInfo.mediaData || !visualInfo.mediaType) return ''

    const content = new Uint8Array(visualInfo.mediaData)
    return URL.createObjectURL(new Blob([content.buffer], { type: visualInfo.mediaType }))
  })

  return (
    <div class="text-center text-sm group/nav-player">
      <div class="max-w-[250px] m-auto">
        {/* Album Art */}
        <div class="w-full aspect-square bg-slate-800">
          {albumArt.value && <img src={albumArt.value} alt={store.player.currSong?.title} width={250} height={250} />}
        </div>

        {/* Range Slider */}
        <div class="w-full relative overflow-hidden h-2 song-control__range cursor-pointer">
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
            <>
              <div
                class="bg-slate-500 w-full h-1 absolute left-0 top-0 pointer-events-none"
                style={{
                  transform: `translateX(${(store.player.currentTime / store.player.duration) * 250}px)`,
                }}
              />

              <span
                class="absolute left-0 top-0 w-[2px] h-1 bg-slate-400"
                style={{
                  transform: `translateX(${(store.player.currentTime / store.player.duration) * 250}px)`,
                }}
              >
                {/* {store.player.currentTime} */}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Time */}
      <div class="flex justify-between w-full opacity-0 text-xs text-slate-400 group-hover/nav-player:opacity-100 transition-opacity duration-300">
        <p class="px-1">{formatSeconds(store.player.currentTime)}</p>
        <p class="px-1">{formatSeconds(store.player.duration)}</p>
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

      <div class="text-left flex flex-col gap-3 p-2 my-2 border-b border-slate-700 relative">
        {/* Edit Btn */}
        <button
          onClick$={() => (state.isEditing = !state.isEditing)}
          class="absolute text-xs -top-2 right-2 opacity-0 text-slate-500 group-hover/nav-player:opacity-100 transition-opacity duration-300"
        >
          {state.isEditing ? 'Save' : 'Edit'}
        </button>

        {/* Title */}

        {state.isEditing ? (
          <input
            type="text"
            onChange$={(e) => {
              if (store.player.currSong) store.player.currSong.title = e.target.value
            }}
            value={store.player.currSong?.title}
            class="bg-transparent text-lg px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
          />
        ) : (
          <p class="truncate text-lg">{store.player.currSong?.title || '-'}</p>
        )}

        {/* Album */}
        <p class="truncate">
          <span class="text-xs block text-gray-400">Album</span>

          {state.isEditing ? (
            <input
              type="text"
              onChange$={(e) => {
                if (store.player.currSong) store.player.currSong.album = e.target.value
              }}
              value={store.player.currSong?.album}
              class="bg-transparent px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
            />
          ) : (
            store.player.currSong?.album || '-'
          )}
        </p>

        {/* Artist */}
        <p class="truncate">
          <span class="text-xs block text-gray-400">Artist</span>

          {state.isEditing ? (
            <input
              type="text"
              onChange$={(e) => {
                if (store.player.currSong) store.player.currSong.artist = e.target.value
              }}
              value={store.player.currSong?.artist}
              class="bg-transparent px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
            />
          ) : (
            store.player.currSong?.artist || '-'
          )}
        </p>

        {/* Genre */}
        <p class="truncate">
          <span class="text-xs block text-gray-400">Genre</span>

          {state.isEditing ? (
            <input
              type="text"
              onChange$={(e) => {
                if (store.player.currSong) store.player.currSong.genre = e.target.value
              }}
              value={store.player.currSong?.genre}
              class="bg-transparent px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
            />
          ) : (
            store.player.currSong?.genre || '-'
          )}
        </p>

        {/* Date */}
        <p class="truncate">
          <span class="text-xs block text-gray-400">Date</span>

          {state.isEditing ? (
            <input
              type="text"
              onChange$={(e) => {
                if (store.player.currSong) store.player.currSong.date = e.target.value
              }}
              value={store.player.currSong?.date}
              class="bg-transparent px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
            />
          ) : (
            store.player.currSong?.date || '-'
          )}
        </p>

        {/* Track */}
        <p class="truncate">
          <span class="text-xs block text-gray-400">Track</span>

          {state.isEditing ? (
            <input
              type="text"
              onChange$={(e) => {
                if (store.player.currSong) store.player.currSong.trackNumber = parseInt(e.target.value)
              }}
              value={store.player.currSong?.trackNumber}
              class="bg-transparent px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
            />
          ) : (
            <span>
              {store.player.currSong?.trackNumber || '-'}
              {store.player.currSong?.trackTotal ? ' of ' + store.player.currSong.trackTotal : ''}
            </span>
          )}
        </p>

        {/* Codec */}
        <p class="truncate">
          <span class="text-xs block text-gray-400">Codec</span>

          {state.isEditing ? (
            <input
              type="text"
              onChange$={(e) => {
                if (store.player.currSong) store.player.currSong.codec = e.target.value
              }}
              value={store.player.currSong?.codec}
              class="bg-transparent px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
            />
          ) : (
            store.player.currSong?.codec || '-'
          )}
        </p>

        {/* Sample Rate */}
        <p class="truncate">
          <span class="text-xs block text-gray-400">Sample Rate</span>
          {state.isEditing ? (
            <input
              type="text"
              onChange$={(e) => {
                if (store.player.currSong) store.player.currSong.sampleRate = e.target.value
              }}
              value={store.player.currSong?.sampleRate}
              class="bg-transparent px-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] focus:outline-none w-full"
            />
          ) : (
            store.player.currSong?.sampleRate || '-'
          )}
        </p>
      </div>
    </div>
  )
})
