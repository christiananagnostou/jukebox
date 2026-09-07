import { component$, noSerialize, useContextProvider, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import type { NoSerialize } from '@builder.io/qwik'
import { MobileContext } from './context'
import { initialLibrary, initialPlayer } from './model'
import { MobileRuntime } from './runtime'
import { Library } from './components/library'
import { MiniPlayer, NowPlaying } from './components/player'

export default component$(() => {
  const library = useStore(initialLibrary())
  const player = useStore(initialPlayer())
  const runtime = useSignal<NoSerialize<MobileRuntime>>()
  const root = useSignal<HTMLElement>()
  const audio = useSignal<HTMLAudioElement>()
  const panel = useSignal<HTMLDialogElement>()
  const handle = useSignal<HTMLElement>()
  const seek = useSignal<HTMLInputElement>()
  const queue = useSignal<HTMLDetailsElement>()
  useContextProvider(MobileContext, { library, player, runtime })
  useVisibleTask$(
    ({ cleanup }) => {
      if (!root.value || !audio.value || !panel.value || !handle.value || !seek.value || !queue.value) return
      const controller = new MobileRuntime(
        {
          root: root.value,
          audio: audio.value,
          panel: panel.value,
          handle: handle.value,
          seek: seek.value,
          queue: queue.value,
        },
        player,
        library
      )
      runtime.value = noSerialize(controller)
      cleanup(() => {
        controller.dispose()
        runtime.value = undefined
      })
    },
    { strategy: 'document-ready' }
  )
  return (
    <>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#17171f" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Jukebox" />
        <title>Jukebox</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/icon-512.png" />
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body ref={root} lang="en">
        <Library />
        <MiniPlayer />
        <NowPlaying panel={panel} handle={handle} seek={seek} queue={queue} />
        <audio id="player" ref={audio} preload="metadata" />
      </body>
    </>
  )
})
