import {
  $,
  component$,
  noSerialize,
  useComputed$,
  useContext,
  useSignal,
  useStore,
  useTask$,
  useVisibleTask$,
  type NoSerialize,
} from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'
import { convertFileSrc } from '@tauri-apps/api/core'

import type { LibraryCatalogState, ListItemStyle, Song } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { SoundBars } from '~/components/Shared/SoundBars'
import { MusicNote } from '~/components/svg/MusicNote'
import {
  focusedCollectionQuery,
  libraryDestinationHref,
  libraryDestinationLabel,
  type LibraryDestination,
} from '~/services/library-destination'
import { LibraryPager, libraryPlaybackAt, librarySongAt } from '~/services/library-client'
import { StoreActionsContext, StoreContext } from '~/routes/layout'

const TRACK_ROW_HEIGHT = 40

function collectionState(): LibraryCatalogState {
  return {
    error: '',
    loadedSongCount: 0,
    pages: {},
    refreshKey: 0,
    revision: 0,
    status: 'loading',
    total: 0,
  }
}

function trackPosition(song: Song): string {
  const track = song.trackNumber || '-'
  return song.side > 1 ? `${song.side}.${track}` : String(track)
}

interface FocusedCollectionViewProps {
  destination: LibraryDestination
}

export default component$<FocusedCollectionViewProps>((props) => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const catalog = useStore(collectionState())
  const pager = useSignal<NoSerialize<LibraryPager>>()
  const observedRefreshKey = useSignal(store.libraryCatalog.refreshKey)
  const actionError = useSignal('')
  const headerSong = useComputed$(() => librarySongAt(catalog, 0))
  const label = libraryDestinationLabel(props.destination)
  const artistHref = libraryDestinationHref({ artist: props.destination.artist, kind: 'artist' })
  const artworkSource =
    props.destination.kind === 'album' && headerSong.value?.visualsPath
      ? convertFileSrc(headerSong.value.visualsPath)
      : ''

  useVisibleTask$(({ cleanup }) => {
    const controller = new LibraryPager(catalog)
    pager.value = noSerialize(controller)
    void controller.resetQuery(focusedCollectionQuery(props.destination))

    cleanup(() => {
      controller.dispose()
      pager.value = undefined
    })
  })

  useTask$(({ track }) => {
    const kind = track(() => props.destination.kind)
    const artist = track(() => props.destination.artist)
    const album = track(() => (props.destination.kind === 'album' ? props.destination.album : ''))
    const destination: LibraryDestination = kind === 'album' ? { album, artist, kind } : { artist, kind }
    actionError.value = ''
    void pager.value?.resetQuery(focusedCollectionQuery(destination))
  })

  useTask$(({ track }) => {
    const refreshKey = track(() => store.libraryCatalog.refreshKey)
    if (refreshKey === observedRefreshKey.value) return
    observedRefreshKey.value = refreshKey
    void pager.value?.reload()
  })

  const playAt = $(async (index: number) => {
    actionError.value = ''
    try {
      await pager.value?.ensureRange(index, index)
      const playback = libraryPlaybackAt(catalog, index)
      if (!playback) {
        actionError.value = 'That track is not available in this collection.'
        return
      }
      await storeActions.playTracks(playback.playlist, playback.playlistIndex, {
        kind: props.destination.kind,
        label,
      })
    } catch {
      actionError.value = `Jukebox could not play this ${props.destination.kind}.`
    }
  })

  return (
    <section class="focused-collection">
      <header class="focused-collection-header">
        {props.destination.kind === 'album' && (
          <div class="focused-collection-art" aria-hidden="true">
            {artworkSource ? (
              <img src={artworkSource} alt="" width={112} height={112} decoding="async" />
            ) : (
              <MusicNote width="34%" height="34%" />
            )}
          </div>
        )}

        <div class="focused-collection-heading">
          <nav class="focused-collection-trail" aria-label="Library location">
            <Link href={props.destination.kind === 'album' ? '/albums/' : '/artists/'}>
              {props.destination.kind === 'album' ? 'Albums' : 'Artists'}
            </Link>
            <span aria-hidden="true">/</span>
            {props.destination.kind === 'album' ? (
              <>
                <Link href={artistHref}>{props.destination.artist}</Link>
                <span aria-hidden="true">/</span>
                <span aria-current="page">{props.destination.album}</span>
              </>
            ) : (
              <span aria-current="page">{props.destination.artist}</span>
            )}
          </nav>

          <h1 title={label}>{label}</h1>
          {props.destination.kind === 'album' && (
            <Link class="focused-collection-artist" href={artistHref}>
              {props.destination.artist}
            </Link>
          )}
          <p class="focused-collection-count" aria-live="polite">
            {catalog.status === 'loading' && !catalog.total
              ? 'Loading tracks…'
              : `${catalog.total.toLocaleString()} ${catalog.total === 1 ? 'track' : 'tracks'}`}
          </p>
        </div>

        <button type="button" class="focused-collection-play" disabled={!catalog.total} onClick$={() => playAt(0)}>
          Play
        </button>
      </header>

      {(catalog.error || actionError.value) && (
        <div class="focused-collection-notice" role="alert">
          <p>{catalog.error || actionError.value}</p>
          <Link href="/settings/library/">Open Library settings</Link>
        </div>
      )}

      <div class="focused-collection-columns" aria-hidden="true">
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        <span>Duration</span>
      </div>

      <div class="focused-collection-tracks">
        {catalog.status === 'ready' && catalog.total === 0 ? (
          <div class="focused-collection-empty">
            <p>No available tracks remain in this {props.destination.kind}.</p>
            <Link href="/settings/library/">Review library folders</Link>
          </div>
        ) : (
          <VirtualList
            numItems={catalog.total}
            itemHeight={TRACK_ROW_HEIGHT}
            onRangeChange={$((startIndex, endIndex) => pager.value?.ensureRange(startIndex, endIndex))}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const song = librarySongAt(catalog, index)
              if (!song) {
                return <div class="focused-track-row focused-track-row-loading" style={{ ...style, height: '40px' }} />
              }
              const isPlaying = store.player.currSong?.id === song.id
              return (
                <div
                  class={`focused-track-row ${isPlaying ? 'focused-track-row-playing' : ''}`}
                  style={{ ...style, height: '40px' }}
                  aria-current={isPlaying ? 'true' : undefined}
                >
                  <span class="focused-track-number">{trackPosition(song)}</span>
                  <button
                    type="button"
                    class="focused-track-play"
                    onClick$={() => playAt(index)}
                    aria-label={`Play ${song.title} by ${song.artist || 'Unknown artist'}`}
                  >
                    <SoundBars show={isPlaying} />
                    <span class="truncate">{song.title || '-'}</span>
                  </button>
                  <span class="focused-track-album" title={song.album}>
                    {song.album || '-'}
                  </span>
                  <span class="focused-track-duration">{song.duration || '-'}</span>
                </div>
              )
            })}
          />
        )}
      </div>
      <p class="sr-only">Tracks load in bounded pages and activate with Enter or Space on their Play button.</p>
    </section>
  )
})
