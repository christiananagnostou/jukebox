import { component$, useContext } from '@builder.io/qwik'
import type { Signal } from '@builder.io/qwik'
import { MobileContext } from '../context'
import { detail, formatTime, trackArtwork } from '../model'
import { Artwork, Icon, TransportButton } from './primitives'
import type { IconName } from './primitives'

export const MiniPlayer = component$(() => {
  const { player, library, runtime } = useContext(MobileContext)
  return (
    <footer class="bottom-dock">
      <section id="mini-player" aria-label="Player">
        <button
          id="open-player"
          type="button"
          aria-label="Open Now Playing"
          aria-haspopup="dialog"
          disabled={!player.ready}
          onClick$={() => runtime.value?.sheet.open()}
        >
          <Artwork id="mini-art" url={trackArtwork(player.active)} eager />
          <span class="playing-copy">
            <strong id="mini-title">
              {player.active ? player.active.title || player.active.file : 'Nothing playing'}
            </strong>
            <span id="mini-detail">
              {player.feedback.actions.length
                ? player.feedback.message || player.feedback.heading
                : player.active?.artist || 'Choose a song to begin'}
            </span>
          </span>
        </button>
        <TransportButton action="toggle" />
        <TransportButton action="next" />
        <progress
          id="mini-progress"
          value={player.duration ? (player.position / player.duration) * 100 : 0}
          max={100}
          aria-label="Track progress"
        />
      </section>
      <nav aria-label="Library views">
        {(['tracks', 'albums', 'artists'] as const).map((view, index) => (
          <button
            key={view}
            type="button"
            data-view={view}
            aria-pressed={library.view === view}
            onClick$={() => runtime.value?.navigate(view)}
          >
            <Icon name={(['music', 'album', 'artist'] as IconName[])[index]} />
            {['Songs', 'Albums', 'Artists'][index]}
          </button>
        ))}
      </nav>
    </footer>
  )
})

export const Queue = component$<{ queueRef: Signal<HTMLDetailsElement | undefined> }>(({ queueRef }) => {
  const { player, runtime } = useContext(MobileContext)
  const start = player.queue.currentIndex ?? 0
  return (
    <details id="queue-panel" ref={queueRef}>
      <summary>
        <span>Up next</span>
        <span id="queue-count">
          {player.queue.queue.length ? `${player.queue.queue.length} tracks` : 'Queue empty'}
        </span>
      </summary>
      <div id="queue-content">
        <div id="queue-items" aria-label="Playback queue">
          {!player.queue.queue.length && <p class="queue-empty">Play a track to build this device queue.</p>}
          {player.queue.queue.slice(start, start + 21).map((track, offset) => {
            const index = start + offset
            const current = player.queue.currentIndex === index
            return (
              <div key={`${track.id}:${index}`} class={`queue-row ${current ? 'is-current' : ''}`}>
                <button
                  type="button"
                  class="queue-track"
                  aria-current={current ? 'true' : 'false'}
                  data-player-action="queue"
                  data-index={index}
                  disabled={!player.ready}
                >
                  <strong>{track.title || track.file}</strong>
                  <span>{detail([track.artist, current ? 'Current' : 'Upcoming'])}</span>
                </button>
                <button
                  type="button"
                  class="queue-remove"
                  aria-label={`Remove ${track.title || track.file} from queue`}
                  onClick$={() => runtime.value?.player.remove(index)}
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
        <button
          id="clear-queue"
          class="quiet-action danger-action"
          type="button"
          hidden={!player.queue.queue.length}
          onClick$={() => runtime.value?.player.clear()}
        >
          Clear queue
        </button>
      </div>
    </details>
  )
})

export const NowPlaying = component$<{
  panel: Signal<HTMLDialogElement | undefined>
  handle: Signal<HTMLElement | undefined>
  seek: Signal<HTMLInputElement | undefined>
  queue: Signal<HTMLDetailsElement | undefined>
}>((refs) => {
  const { player, runtime } = useContext(MobileContext)
  const position = player.scrubbing ? (player.preview / 100) * player.duration : player.position
  return (
    <dialog id="now-playing-panel" aria-labelledby="player-heading" ref={refs.panel}>
      <div class="player-screen">
        <div id="sheet-handle" aria-hidden="true" ref={refs.handle}>
          <span />
        </div>
        <div class="player-heading">
          <button
            id="close-player"
            class="icon-button"
            type="button"
            aria-label="Close Now Playing"
            onClick$={() => runtime.value?.sheet.close()}
          >
            <Icon name="down" />
          </button>
          <h2 id="player-heading" aria-live="polite" aria-atomic="true">
            {player.feedback.heading}
          </h2>
          <button
            id="show-queue"
            class="icon-button"
            type="button"
            aria-label="Show queue"
            onClick$={() => runtime.value?.showQueue()}
          >
            <Icon name="queue" />
          </button>
        </div>
        <div class="playback-feedback" hidden={!player.feedback.message && !player.feedback.actions.length}>
          <p id="playback-message" role="status" aria-atomic="true" hidden={!player.feedback.message}>
            {player.feedback.message}
          </p>
          <div id="playback-actions">
            {player.feedback.actions.map((action) => (
              <button
                key={action}
                type="button"
                class={`quiet-action ${action === 'remove' ? 'danger-action' : ''}`}
                data-player-action="recover"
                data-recovery={action}
              >
                {action === 'retry' ? 'Retry' : action === 'skip' ? 'Skip' : 'Remove'}
              </button>
            ))}
          </div>
        </div>
        <Artwork id="now-art" class="large-art" url={trackArtwork(player.active)} eager />
        <div class="playing-copy full-copy" aria-live="polite">
          <strong id="now-playing">
            {player.active ? player.active.title || player.active.file : 'Nothing playing'}
          </strong>
          <button
            id="now-artist"
            class="text-link"
            type="button"
            disabled={!player.active?.artist}
            onClick$={() => {
              if (player.active) return runtime.value?.navigate('albums', player.active.artist)
            }}
          >
            {player.active?.artist || ''}
          </button>
          <button
            id="now-playing-detail"
            class="text-link"
            type="button"
            disabled={!player.active?.album}
            onClick$={() => {
              if (player.active) return runtime.value?.navigate('tracks', '', player.active.album)
            }}
          >
            {player.active?.album || (player.active ? 'Unknown album' : 'Choose a song to begin')}
          </button>
        </div>
        <div class="seek-control">
          <input
            id="seek"
            ref={refs.seek}
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={player.scrubbing ? player.preview : player.duration ? (player.position / player.duration) * 100 : 0}
            aria-label="Playback position"
            disabled={!player.ready || !player.active || !player.duration}
          />
          <div class="time-labels">
            <span id="elapsed">{formatTime(position)}</span>
            <span id="duration">{formatTime(player.duration)}</span>
          </div>
        </div>
        <div class="transport" aria-label="Playback controls">
          <TransportButton action="previous" />
          <TransportButton action="toggle" primary />
          <TransportButton action="next" />
        </div>
        <button
          id="save-offline"
          class="quiet-action"
          type="button"
          disabled={!player.active || player.offline === 'saving' || player.offline === 'unavailable'}
          onClick$={() => runtime.value?.player.toggleOffline()}
        >
          {player.offline === 'saved'
            ? 'Remove offline copy'
            : player.offline === 'saving'
              ? 'Saving…'
              : player.offline === 'unavailable'
                ? 'Offline storage unavailable'
                : 'Save offline'}
        </button>
        <Queue queueRef={refs.queue} />
      </div>
    </dialog>
  )
})
