import { $, component$, useContext } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'

import type { Song } from '~/App'
import { libraryPlaybackAt } from '~/services/library-client'
import { updateFavoriteRating } from '~/services/library-db'
import { trackMetadataDestinations } from '~/services/library-destination'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import MetadataLink from './MetadataLink'
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

  const isPlaying = store.player.currSong?.id === song.id
  const destinations = trackMetadataDestinations(song)

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

  const nextRating = ((song.favorRating + 1) % 3) as Song['favorRating']

  return (
    <div
      key={song.title}
      style={style}
      class={
        classes +
        ` hover:bg-[rgba(0,0,0,.15)]
        ${isPlaying && '!bg-gray-700'}`
      }
    >
      <SoundBars show={isPlaying} />

      <button
        type="button"
        class="relative truncate pl-1 text-left hover:text-white focus-visible:text-white"
        aria-label={`Play ${song.title} by ${song.artist || 'Unknown artist'}`}
        onClick$={playTrack}
      >
        {song.title}
      </button>

      {destinations.artist ? (
        <MetadataLink destination={destinations.artist} class="truncate pl-2" title={`Open ${song.artist}`}>
          {song.artist}
        </MetadataLink>
      ) : (
        <span class="truncate pl-2">{song.artist}</span>
      )}

      {destinations.album ? (
        <MetadataLink destination={destinations.album} class="truncate pl-2" title={`Open ${song.album}`}>
          {song.album}
        </MetadataLink>
      ) : (
        <span class="truncate pl-2">{song.album}</span>
      )}

      <span class="truncate pl-2">{song.trackNumber}</span>

      <span class="truncate pl-2">{song.sampleRate}</span>

      <span class="truncate pl-2">{song.date}</span>

      <span class="truncate pl-2">{formatDateAdded(song.dateAdded)}</span>

      <span class="truncate pl-2 flex align-center">
        <button
          aria-label={`Set favorite rating to ${nextRating}`}
          title={`Favorite rating: ${song.favorRating}`}
          onClick$={(event) => {
            event.stopPropagation()
            handleFavorClick(nextRating)
          }}
        >
          {song.favorRating === 0 && <Star0 />}
          {song.favorRating === 1 && <Star1 />}
          {song.favorRating === 2 && <Star2 />}
        </button>
      </span>
    </div>
  )
})
