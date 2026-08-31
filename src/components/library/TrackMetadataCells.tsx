import { component$, useComputed$ } from '@builder.io/qwik'

import { trackMetadataDestinations } from '~/services/library-destination'
import MetadataLink from './MetadataLink'

export interface TrackMetadataCellsProps {
  album: string
  artist: string
  class?: string
}

export default component$<TrackMetadataCellsProps>((props) => {
  const destinations = useComputed$(() => trackMetadataDestinations(props))
  const cellClass = useComputed$(() => props.class || 'flex min-w-0 items-center border-l border-gray-800 px-3')

  return (
    <>
      <span class={cellClass.value}>
        {destinations.value.artist ? (
          <MetadataLink destination={destinations.value.artist} class="block w-full truncate">
            {props.artist}
          </MetadataLink>
        ) : (
          <span class="truncate">{props.artist || '-'}</span>
        )}
      </span>
      <span class={cellClass.value}>
        {destinations.value.album ? (
          <MetadataLink destination={destinations.value.album} class="block w-full truncate">
            {props.album}
          </MetadataLink>
        ) : (
          <span class="truncate">{props.album || '-'}</span>
        )}
      </span>
    </>
  )
})
