import { component$, createContextId, Slot, useContextProvider, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { routeLoader$ } from '@builder.io/qwik-city'

import Nav from '~/components/starter/nav/nav'
import Footer from '~/components/starter/footer/footer'
import type { Store } from '~/App'

export const useServerTimeLoader = routeLoader$(() => {
  return {
    date: new Date().toISOString(),
  }
})

export const PlayerContext = createContextId<Store>('docs.theme-context')

export default component$(() => {
  const store = useStore<Store>(
    {
      allSongs: [],
      audioDir: '',
      pathPrefix: 'asset://localhost/',
      player: {
        currSong: undefined,
        audioElem: undefined,
        nextAudioElem: undefined,
      },
    },
    { deep: true }
  )
  useContextProvider(PlayerContext, store)

  useVisibleTask$(async ({ track }) => {
    // Initialize an audio element
    if (!store.player.audioElem) store.player.audioElem = new Audio()

    // Track changes to currSong
    const currSong = track(() => store.player.currSong)
    if (!currSong) return

    // If currSong changes, change audioElem src to currSong
    const currSongPath = store.pathPrefix + currSong.path
    if (store.player.audioElem?.src !== currSongPath.replace(/ /g, '%20')) {
      store.player.audioElem.src = currSongPath
      store.player.audioElem.load()
      store.player.audioElem.play()

      // console.log((store.player.audioElem.duration))
      // console.log((store.player.audioElem.currentTime = 100))
    }
  })

  return (
    <>
      <Nav />

      <main class="h-screen max-h-screen w-full flex flex-col realtive ml-48">
        <Slot />
        <Footer />
      </main>
    </>
  )
})
