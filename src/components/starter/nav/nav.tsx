import { $, type QwikChangeEvent, component$, useContext } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'
import { PlayerContext } from '~/routes/layout'

const Links = [
  { title: 'Library', url: '/' },
  { title: 'Flower', url: '/demo/flower' },
]
export default component$(() => {
  const store = useContext(PlayerContext)

  const dragHandler = $((e: QwikChangeEvent<HTMLInputElement>) => {
    if (!store.player.audioElem) return
    const currentDraggedTime = parseInt(e.target.value)
    store.player.audioElem.currentTime = currentDraggedTime
  })

  return (
    <nav class="w-48 border-r border-gray-700 fixed top-0 h-screen flex flex-col">
      <ul class="flex-1">
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

      <div class="border-t border-gray-800 text-center text-sm">
        <p class="h-5">{store.player.currSong?.title || 'No Song Playing'}</p>
        <div class="w-full px-2 aspect-square bg-gray-800">{/* <img src="" alt="" /> */}</div>
        <p class="h-5">{store.player.currSong?.artist}</p>

        {/* Controls */}
        <div class="flex justify-evenly text-slate-700">
          {/* Prev */}
          <svg
            stroke="currentColor"
            fill="none"
            stroke-width="2"
            viewBox="0 0 24 24"
            stroke-linecap="round"
            stroke-linejoin="round"
            height="2rem"
            width="2rem"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
            <path d="M21 5v14l-8 -7z"></path>
            <path d="M10 5v14l-8 -7z"></path>
          </svg>
          {/* Play */}
          <svg
            stroke="currentColor"
            fill="none"
            stroke-width="2"
            viewBox="0 0 24 24"
            stroke-linecap="round"
            stroke-linejoin="round"
            height="2rem"
            width="2rem"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
            <path d="M7 4v16l13 -8z"></path>
          </svg>
          {/* Next */}
          <svg
            stroke="currentColor"
            fill="none"
            stroke-width="2"
            viewBox="0 0 24 24"
            stroke-linecap="round"
            stroke-linejoin="round"
            height="2rem"
            width="2rem"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
            <path d="M3 5v14l8 -7z"></path>
            <path d="M14 5v14l8 -7z"></path>
          </svg>
        </div>

        {/* Range Slider */}
        <div class="flex items-center justify-center mb-3">
          <p class="py-4 px-2">{store.player.audioElem?.currentTime}</p>

          <div class="flex w-full relative overflow-hidden h-2">
            <input
              class="appearance-none"
              type="range"
              min={0}
              max={store.player.audioElem?.duration || 1000}
              value={store.player.audioElem?.currentTime}
              onChange$={dragHandler}

              // TODO: get color from album art
              // style={{
              //   background: `linear-gradient(to right, ${store.player.currSong.color[0]}, ${store.player.currentSong.color[1]})`,
              // }}
            />
            {store.player.audioElem && (
              <div
                class="bg-white w-full h-full absolute left-0 top-0 pointer-events-none"
                style={{
                  transform: `translateX(${
                    (store.player.audioElem?.currentTime / store.player.audioElem?.duration) * 100
                  }%)`,
                }}
              ></div>
            )}
          </div>

          <p class="py-4 px-2">{store.player.audioElem?.duration || 0}</p>
        </div>
      </div>
    </nav>
  )
})
