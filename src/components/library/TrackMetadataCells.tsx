import { component$ } from '@builder.io/qwik'

import { trackMetadataDestinations } from '~/services/library-destination'
import MetadataLink from './MetadataLink'

export interface TrackMetadataCellsProps {
  album: string
  artist: string
  class?: string
}

export default component$<TrackMetadataCellsProps>((props) => {
  const destinations = trackMetadataDestinations(props)
  const cellClass = props.class || 'flex min-w-0 items-center border-l border-gray-800 px-3'

  return (
    <>
      <span class={cellClass}>
        {destinations.artist ? (
          <MetadataLink destination={destinations.artist} class="block w-full truncate">
            {props.artist}
          </MetadataLink>
        ) : (
          <span class="truncate">{props.artist || '-'}</span>
        )}
      </span>
      <span class={cellClass}>
        {destinations.album ? (
          <MetadataLink destination={destinations.album} class="block w-full truncate">
            {props.album}
          </MetadataLink>
        ) : (
          <span class="truncate">{props.album || '-'}</span>
        )}
      </span>
    </>
  )
})
