import { component$, useContext } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'
import { PlayerContext } from '~/routes/layout'

const Links = [
  { title: 'Library', url: '/' },
  { title: 'Flower', url: '/demo/flower' },
]
export default component$(() => {
  const player = useContext(PlayerContext)

  return (
    <nav class="w-48 border-r border-gray-700 fixed top-0 h-screen flex flex-col">
      <ul class="flex-1">
        {Links.map((link) => (
          <li key={link.title} class="p-1">
            <Link
              href={link.url}
              title={link.title}
              class="block py-1 px-2 border border-transparent hover:border-gray-700 rounded"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>

      <div class="border-t border-gray-800 text-center text-sm">
        <p class="h-5">{player.currSong?.title || 'No Song Playing'}</p>
        <div class="w-full px-2 aspect-square bg-gray-800">{/* <img src="" alt="" /> */}</div>
        <p class="h-5">{player.currSong?.artist}</p>
      </div>
    </nav>
  )
})
