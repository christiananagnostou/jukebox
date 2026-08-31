import { component$, Slot } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'

import { libraryDestinationHref, type LibraryDestination } from '~/services/library-destination'

export interface MetadataLinkProps {
  ariaLabel?: string
  class?: string
  destination: LibraryDestination
  title?: string
}

export default component$<MetadataLinkProps>((props) => (
  <Link
    href={libraryDestinationHref(props.destination)}
    aria-label={props.ariaLabel}
    class={`metadata-link ${props.class || ''}`}
    title={props.title}
    onClick$={(event) => event.stopPropagation()}
    onDblClick$={(event) => event.stopPropagation()}
    onKeyDown$={(event) => event.stopPropagation()}
  >
    <Slot />
  </Link>
))
