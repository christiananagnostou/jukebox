import { component$, useContext } from '@builder.io/qwik'
import { MobileContext } from '../context'
import { albumArtwork, detail, libraryStatus, libraryTitle, trackArtwork } from '../model'
import { Artwork, Icon } from './primitives'

export const Library = component$(() => {
  const { library: state, player, runtime } = useContext(MobileContext)
  return (
    <main id="library">
      <header class="library-header">
        <div class="heading-row">
          <h1>Jukebox</h1>
          <span class="library-caption">Your music, everywhere.</span>
        </div>
        <form id="search-form" role="search" preventdefault:submit onSubmit$={() => runtime.value?.search()}>
          <Icon name="search" />
          <input
            id="search"
            type="search"
            placeholder={`Search ${state.view}`}
            aria-label="Search library"
            value={state.search}
            onInput$={(_, input) => {
              state.search = input.value
            }}
          />
          <button class="icon-button" type="submit" aria-label="Search">
            <Icon name="arrow" />
          </button>
        </form>
        <div id="context" hidden={!state.artist && !state.album}>
          <button id="back" class="icon-button" type="button" aria-label="Back" onClick$={() => runtime.value?.back()}>
            <Icon name="back" />
          </button>
          <strong id="context-label">{detail([state.album, state.artist])}</strong>
        </div>
        <div class="section-heading">
          <h2 id="view-title">{libraryTitle(state)}</h2>
          <div class="status-row">
            <p id="status" role="status">
              {libraryStatus(state)}
            </p>
            <button
              id="refresh-library"
              class="icon-button"
              type="button"
              aria-label="Refresh library"
              onClick$={() => runtime.value?.library.load(false, true)}
            >
              <Icon name="refresh" />
            </button>
            <button
              id="library-retry"
              class="quiet-action"
              type="button"
              hidden={!state.error}
              onClick$={() => runtime.value?.library.load(false, true)}
            >
              Retry
            </button>
          </div>
        </div>
      </header>
      <section id="items" aria-label={libraryTitle(state)} data-layout={state.view} aria-busy={state.loading}>
        {state.view === 'albums' &&
          state.albums.map((album, index) => (
            <button
              key={`${album.value}:${album.artistValue}:${index}`}
              class="item album-item"
              type="button"
              onClick$={() => runtime.value?.navigate('tracks', album.artistValue, album.value)}
            >
              <Artwork url={albumArtwork(album)} />
              <span class="item-copy">
                <strong>{album.name}</strong>
                <span>{detail([album.artist, album.date], 'Unknown artist')}</span>
              </span>
            </button>
          ))}
        {state.view === 'artists' &&
          state.artists.map((artist, index) => (
            <button
              key={`${artist.value}:${index}`}
              class="item artist-item"
              type="button"
              onClick$={() => runtime.value?.navigate('albums', artist.value)}
            >
              <Artwork class="artist-art" />
              <span class="item-copy">
                <strong>{artist.name}</strong>
                <span>
                  {artist.albumCount} album{artist.albumCount === 1 ? '' : 's'} · {artist.trackCount} track
                  {artist.trackCount === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          ))}
        {state.view === 'tracks' &&
          state.tracks.map((track, index) => (
            <button
              key={`${track.id}:${index}`}
              class={`item ${player.active?.id === track.id ? 'is-current' : ''}`}
              data-track-id={track.id}
              data-player-action="track"
              data-index={index}
              type="button"
              disabled={!player.ready}
            >
              <Artwork url={trackArtwork(track)} />
              <span class="item-copy">
                <strong>{track.title || track.file}</strong>
                <span>{detail([track.artist, track.album], 'Unknown artist')}</span>
              </span>
              <span class="item-duration">{track.duration}</span>
            </button>
          ))}
      </section>
      <button
        id="load-more"
        type="button"
        hidden={!state.more}
        disabled={state.loading}
        onClick$={() => runtime.value?.library.load(true)}
      >
        Load more
      </button>
    </main>
  )
})
