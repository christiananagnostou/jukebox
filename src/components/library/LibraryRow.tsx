import { $, component$, useComputed$, useContext } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'

import type { Song } from '~/App'
import { libraryPlaybackAt } from '~/services/library-client'
import { updateFavoriteRating } from '~/services/library-db'
import { trackMetadataDestinations } from '~/services/library-destination'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import MetadataLink from './MetadataLink'
import { SONG_COLUMNS, SongColumnsContext, songDuration } from './columns'
import { SoundBars } from '../Shared/SoundBars'
import { Star0 } from '../svg/Star0'
import { Star1 } from '../svg/Star1'
import { Star2 } from '../svg/Star2'

function formatDateAdded(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return `${date.getMonth() + 1}-${date.getDate()}-${String(date.getFullYear()).slice(-2)}`
}

export interface LibraryRowProps {
  index: number
  song: Song
  style: Record<string, string | number | undefined>
  classes: string
}

export const LibraryRow = component$<LibraryRowProps>(({ index, song, style, classes }) => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const preferences = useContext(SongColumnsContext)
  const columns = useComputed$(() =>
    SONG_COLUMNS.filter((column) => preferences[column.id].visible).map((column) => column.id)
  )

  const isPlaying = useComputed$(() => store.playback.current?.id === song.id)
  const nextRating = useComputed$(() => ((song.favorRating + 1) % 3) as Song['favorRating'])
  const destinations = useComputed$(() => trackMetadataDestinations(song))

  const playTrack = $(async () => {
    void invoke('record_playback_client_event', { event: 'activation_requested' }).catch(() => undefined)
    try {
      store.libraryView.cursorIdx = index
      const playback = libraryPlaybackAt(store.libraryCatalog, index) || {
        playlist: [song],
        playlistIndex: 0,
        song,
      }
      const playlist = playback.playlist.map((track) => ({ ...track }))
      await storeActions.playTracks(playlist, playback.playlistIndex, { kind: 'library', label: 'Library' })
    } catch {
      void invoke('record_playback_client_event', { event: 'activation_failed' }).catch(() => undefined)
      // Playback state exposes the generic, path-free failure to the player UI.
    }
  })

  const handleFavorClick = $(async (rating: Song['favorRating']) => {
    try {
      await updateFavoriteRating(song.id, rating)
      song.favorRating = rating
      store.libraryCatalog.refreshKey += 1
      store.bootstrap.libraryError = ''
    } catch {
      store.bootstrap.libraryError = 'Jukebox could not update that favorite rating.'
    }
  })

  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      data-selected={store.libraryView.cursorIdx === index ? 'true' : undefined}
      data-playing={isPlaying.value ? 'true' : undefined}
      style={style}
      class={classes}
    >
      <span role="cell">
        <SoundBars show={isPlaying.value} />
      </span>
      {columns.value.map((column) => (
        <span key={column} role="cell" class="songs-cell" data-column={column}>
          {column === 'title' && (
            <button
              type="button"
              class="songs-title"
              title={song.title}
              aria-label={`Play ${song.title} by ${song.artist || 'Unknown artist'}`}
              onClick$={playTrack}
            >
              {song.title}
            </button>
          )}

          {column === 'artist' &&
            (destinations.value.artist ? (
              <MetadataLink destination={destinations.value.artist} class="truncate" title={`Open ${song.artist}`}>
                {song.artist}
              </MetadataLink>
            ) : (
              <span class="truncate">{song.artist || '-'}</span>
            ))}

          {column === 'album' &&
            (destinations.value.album ? (
              <MetadataLink destination={destinations.value.album} class="truncate" title={`Open ${song.album}`}>
                {song.album}
              </MetadataLink>
            ) : (
              <span class="truncate">{song.album || '-'}</span>
            ))}
          {column === 'duration' && songDuration(song.duration)}
          {column === 'track' && (song.trackNumber || '-')}
          {column === 'hertz' && (song.sampleRate || '-')}
          {column === 'date' && (song.date || '-')}
          {column === 'date-added' && formatDateAdded(song.dateAdded)}
          {column === 'fave' && (
            <button
              type="button"
              class="songs-favorite"
              aria-label={`Set favorite rating to ${nextRating.value}`}
              title={`Favorite rating: ${song.favorRating}`}
              onClick$={(event) => {
                event.stopPropagation()
                handleFavorClick(nextRating.value)
              }}
            >
              {song.favorRating === 0 && <Star0 />}
              {song.favorRating === 1 && <Star1 />}
              {song.favorRating === 2 && <Star2 />}
            </button>
          )}
        </span>
      ))}
    </div>
  )
})
