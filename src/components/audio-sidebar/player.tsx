import { $, useComputed$, component$, useContext, useStore } from '@builder.io/qwik'
import { StoreContext, StoreActionsContext } from '~/routes/layout'
import { NextTrack } from '../svg/NextTrack'
import { Pause } from '../svg/Pause'
import { Play } from '../svg/Play'
import { PrevTrack } from '../svg/PrevTrack'
import { convertFileSrc } from '@tauri-apps/api/core'
import { MusicNote } from '../svg/MusicNote'

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const progressBarWidth = (store.player.currentTime / store.player.duration) * 250 + 'px'

  const state = useStore({
    isEditing: false,
    isHovered: false,
    cursorXPos: 0,
  })

  const formatSeconds = $((time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    const secondsWithZero = String(seconds).padStart(2, '0')
    return `${minutes}:${secondsWithZero}`
  })

  const albumArt = useComputed$(async () => {
    if (!store.player.currSong?.visualsPath) return ''
    return convertFileSrc(store.player.currSong.visualsPath)
  })

  return (
    <div class="text-center text-sm group/nav-player">
      <div class="max-w-[250px] m-auto">
        {/* Album Art */}
        <div class="w-full">
          {albumArt.value ? (
            <img src={albumArt.value} alt={store.player.currSong?.title} width={250} height={250} />
          ) : (
            <div class="h-auto w-full aspect-square grid place-items-center bg-gray-800 text-gray-700">
              <MusicNote height="20%" width="20%" />
            </div>
          )}
        </div>

        {/* Range Slider */}
        <div
          class="w-full relative overflow-hidden h-8 -mb-4 song-control__range cursor-pointer"
          onMouseMove$={(e) => {
            // @ts-ignore
            state.cursorXPos = e.offsetX
            state.isHovered = true
          }}
          onMouseLeave$={() => (state.isHovered = false)}
          onClick$={() => {
            if (store.player.audioElem?.currentTime)
              store.player.audioElem.currentTime = (state.cursorXPos / 250) * store.player.duration
          }}
        >
          {store.player.audioElem && (
            <>
              {/* Time Elapsed */}
              <div class="bg-slate-500 w-full h-2 absolute left-0 top-0 pointer-events-none" />

              {/* Time Remaining */}
              <div
                class="bg-slate-700 w-full h-2 absolute left-0 top-0 pointer-events-none"
                style={{
                  transform: `translateX(${progressBarWidth})`,
                }}
              />

              {/* Cursor */}
              <span
                class="absolute left-0 top-0 w-[2px] h-2 bg-slate-400 pointer-events-none"
                style={{
                  transform: `translateX(${state.isHovered ? state.cursorXPos + 'px' : progressBarWidth})`,
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Time */}
      <div class="flex justify-between w-full opacity-0 text-xs text-slate-400 group-hover/nav-player:opacity-100 transition-opacity duration-300 pointer-events-none">
        <p class="px-1">{formatSeconds(store.player.currentTime)}</p>
        <p class={`px-1 transition-opacity duration-300 ${state.isHovered ? 'opacity-1' : 'opacity-0'}`}>
          {formatSeconds((state.cursorXPos / 250) * store.player.duration)}
        </p>
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

      <div class="text-left flex flex-col gap-3 p-2 mt-4 border-b border-slate-700 relative">
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
            onChange$={(e: any) => {
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
              onChange$={(e: any) => {
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
              onChange$={(e: any) => {
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
              onChange$={(e: any) => {
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
              onChange$={(e: any) => {
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
              onChange$={(e: any) => {
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
              onChange$={(e: any) => {
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
              onChange$={(e: any) => {
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
