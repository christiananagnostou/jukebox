import { component$, createContextId, Slot, useContextProvider, useStore } from '@builder.io/qwik'
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
      addedSongs: [],
      audioDir: '',
      currSong: undefined,
      currAudioElem: undefined,
      nextAudioElem: undefined,
    },
    { deep: true }
  )
  useContextProvider(PlayerContext, store)

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
