import { component$ } from '@builder.io/qwik'
import { Link, type DocumentHead, useLocation } from '@builder.io/qwik-city'

import FocusedCollectionView from '~/components/library/FocusedCollectionView'
import { parseLibraryDestination } from '~/services/library-destination'

export default component$(() => {
  const location = useLocation()
  const destination = parseLibraryDestination(location.url.searchParams, 'album')

  if (!destination) {
    return (
      <section class="focused-collection-invalid">
        <h1>Album not found</h1>
        <p>This album link is incomplete or no longer valid.</p>
        <Link href="/albums/">Browse albums</Link>
      </section>
    )
  }

  return <FocusedCollectionView destination={destination} />
})

export const head: DocumentHead = {
  title: 'Album · Jukebox',
  meta: [{ name: 'description', content: 'Browse and play an album from your local Jukebox library.' }],
}
