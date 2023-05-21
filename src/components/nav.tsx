import { $, type QwikChangeEvent, component$, useContext } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'
import { NextTrack } from '~/components/svg/NextTrack'
import { Pause } from '~/components/svg/Pause'
import { Play } from '~/components/svg/Play'
import { PrevTrack } from '~/components/svg/PrevTrack'
import { StoreActionsContext, StoreContext } from '~/routes/layout'

const Links = [
  { title: 'Library', url: '/' },
  { title: 'Albums', url: '/' },
  { title: 'Playlists', url: '/' },
  { title: 'Import', url: '/' },
  {},
]

export default component$(() => {
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
    <nav class="border-r border-gray-700 fixed top-0 h-screen flex flex-col" style={{ width: 'var(--navbar-width' }}>
      <ul class="flex-1 mt-[29px] border-y border-gray-700">
        {Links.map((link) => (
          <li key={link.title} class="p-1">
            <Link
              href={link.url}
              title={link.title}
              class="block py-1 px-2 border border-transparent hover:border-gray-700 rounded"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>

      <div class="text-center text-sm group/nav-player">
        {/* Album Art */}
        {/* <div class="w-full px-2 aspect-square bg-gray-800"><img src="" alt="" /></div> */}
        {/* Tile */}
        <p class="h-5 truncate">{store.player.currSong?.title}</p>
        {/* Artist */}
        <p class="h-5 truncate">{store.player.currSong?.artist}</p>

        {/* Controls */}
        <div class="flex justify-evenly text-slate-500 mt-4">
          <button onClick$={storeActions.prevSong}>
            <PrevTrack />
          </button>
          {store.player.isPaused ? (
            <button
              onClick$={() => {
                store.player.audioElem?.play()
                store.player.isPaused = false
              }}
            >
              <Play />
            </button>
          ) : (
            <button
              onClick$={() => {
                store.player.audioElem?.pause()
                store.player.isPaused = true
              }}
            >
              <Pause />
            </button>
          )}
          <button onClick$={storeActions.nextSong}>
            <NextTrack />
          </button>
        </div>

        {/* Range Slider */}
        <div class="">
          <div class="flex justify-between w-full opacity-0 text-xs text-slate-400 group-hover/nav-player:opacity-100 transition-opacity duration-300">
            <p class="px-1">{formatSeconds(store.player.currentTime)}</p>
            <p class="px-1">{formatSeconds(store.player.duration)}</p>
          </div>

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
        </div>
      </div>
    </nav>
  )
})
