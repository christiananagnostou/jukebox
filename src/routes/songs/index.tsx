import { component$ } from '@builder.io/qwik'
import { type DocumentHead } from '@builder.io/qwik-city'

import Library from '~/components/library'

export default component$(() => <Library />)

export const head: DocumentHead = {
  title: 'Songs · Jukebox',
  meta: [{ name: 'description', content: 'Browse, search, sort, and play songs in your local Jukebox library.' }],
}
