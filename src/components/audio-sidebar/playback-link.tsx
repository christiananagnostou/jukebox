import { component$, Slot, useContext } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'

import { StoreContext } from '~/routes/layout'

interface PlaybackLinkProps {
  ariaLabel?: string
  class?: string
  href: string
  searchTerm?: string
  title?: string
}

export default component$<PlaybackLinkProps>((props) => {
  const store = useContext(StoreContext)

  return (
    <Link
      href={props.href}
      aria-label={props.ariaLabel}
      class={`playback-link ${props.class || ''}`}
      title={props.title}
      onClick$={() => {
        if (props.searchTerm !== undefined) store.searchTerm = props.searchTerm
      }}
      onDblClick$={(event) => event.stopPropagation()}
    >
      <Slot />
    </Link>
  )
})
