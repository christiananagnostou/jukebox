import { component$, useSignal, useTask$, useContext } from '@builder.io/qwik'
import { MobileContext } from '../context'

const paths = {
  refresh: 'M20 7V3l-3 3M4 17v4l3-3M20 7a8 8 0 0 0-14-2M4 17a8 8 0 0 0 14 2',
  play: 'M8 5l11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
  next: 'M5 5l11 7-11 7zM19 5v14',
  previous: 'M19 5L8 12l11 7zM5 5v14',
  down: 'm6 9 6 6 6-6',
  back: 'm14 6-6 6 6-6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3h3M20 16a3 3 0 1 1-3-3h3',
  album: 'M3 3h18v18H3zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  artist: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  queue: 'M4 6h16M4 12h16M4 18h10',
}
export type IconName = keyof typeof paths
export const Icon = component$<{ name: IconName }>(({ name }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={paths[name]} />
  </svg>
))
export const Artwork = component$<{ url?: string; class?: string; id?: string; eager?: boolean }>((props) => {
  const failed = useSignal(false)
  useTask$(({ track }) => {
    track(() => props.url)
    failed.value = false
  })
  return (
    <span id={props.id} class={`artwork ${props.class || ''}`}>
      <Icon name={props.class === 'artist-art' ? 'artist' : 'music'} />
      {props.url && !failed.value && (
        <img
          src={props.url}
          alt=""
          loading={props.eager ? 'eager' : 'lazy'}
          onError$={() => {
            failed.value = true
          }}
        />
      )}
    </span>
  )
})
export const TransportButton = component$<{ action: 'toggle' | 'next' | 'previous'; primary?: boolean }>(
  ({ action, primary }) => {
    const { player } = useContext(MobileContext)
    const disabled =
      !player.ready ||
      !player.active ||
      (action === 'next' &&
        player.queue.currentIndex !== null &&
        player.queue.currentIndex >= player.queue.queue.length - 1)
    const label =
      action === 'toggle' ? (player.paused ? 'Play' : 'Pause') : action === 'next' ? 'Next track' : 'Previous track'
    return (
      <button
        class={`icon-button ${primary ? 'primary-play' : ''}`}
        data-player-action={action}
        data-transport={action}
        type="button"
        aria-label={label}
        disabled={disabled}
      >
        <Icon name={action === 'toggle' ? (player.paused ? 'play' : 'pause') : action} />
      </button>
    )
  }
)
