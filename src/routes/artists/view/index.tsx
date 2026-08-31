import { component$ } from '@builder.io/qwik'
import { Link, type DocumentHead, useLocation } from '@builder.io/qwik-city'

import FocusedCollectionView from '~/components/library/FocusedCollectionView'
import { parseLibraryDestination } from '~/services/library-destination'

export default component$(() => {
  const location = useLocation()
  const destination = parseLibraryDestination(location.url.searchParams, 'artist')

  if (!destination) {
    return (
      <section class="focused-collection-invalid">
        <h1>Artist not found</h1>
        <p>This artist link is incomplete or no longer valid.</p>
        <Link href="/artists/">Browse artists</Link>
      </section>
    )
  }

  return <FocusedCollectionView destination={destination} />
})

export const head: DocumentHead = {
  title: 'Artist · Jukebox',
  meta: [{ name: 'description', content: 'Browse and play an artist from your local Jukebox library.' }],
}
