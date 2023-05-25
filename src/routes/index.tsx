import { component$ } from '@builder.io/qwik'
import { type DocumentHead } from '@builder.io/qwik-city'
import Library from '~/components/library'

export default component$(() => {
  return <Library />
})

export const head: DocumentHead = {
  title: 'Library',
  meta: [
    {
      name: 'description',
      content: 'Qwik site description',
    },
  ],
}
