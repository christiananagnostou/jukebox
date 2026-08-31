import type { NavigationIconName } from '~/services/app-commands'

const paths: Record<NavigationIconName, string[]> = {
  album: ['M5 4.5h10v11H5z', 'M8 4.5V2.75h9.25V13H15'],
  artist: [
    'M8 8.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z',
    'M2.75 15.25c.4-3.1 2.15-4.65 5.25-4.65s4.85 1.55 5.25 4.65',
  ],
  folder: ['M2.25 4.75h5l1.4 1.5h7.1v8.5H2.25z'],
  import: ['M8 2.5v8', 'm5.25 7.75 2.75 2.75 2.75-2.75', 'M2.5 13.5v2h11v-2'],
  keyboard: ['M2 4.25h12v8.5H2z', 'M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01', 'M4.5 10h7'],
  listen: ['M3 9.25v-1.5a5 5 0 0 1 10 0v1.5', 'M3 9.25h2v4.5H3zM11 9.25h2v4.5h-2z'],
  playlist: ['M3 4h7M3 7.5h7M3 11h5', 'M12 8.5v5.25', 'M12 13.75a1.75 1.75 0 1 1-1.75-1.75H12'],
  remote: ['M3.25 11.75h9.5v2h-9.5z', 'M5 11.75V9a3 3 0 0 1 6 0v2.75', 'M8 5.75V2.5', 'm6.25 4.25 1.75-1.75 1.75 1.75'],
  settings: [
    'M8 5.25A2.75 2.75 0 1 0 8 10.75 2.75 2.75 0 0 0 8 5.25Z',
    'M8 2v1.25M8 12.75V14M2 8h1.25M12.75 8H14M3.75 3.75l.9.9M11.35 11.35l.9.9M12.25 3.75l-.9.9M4.65 11.35l-.9.9',
  ],
  songs: ['M3 3.5h7v9', 'M10 5.5l3-1v7.25', 'M10 12.5a2 2 0 1 1-2-2h2M13 11.75a2 2 0 1 1-2-2h2'],
}

export const NavigationIcon = ({ name }: { name: NavigationIconName }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    viewBox="0 0 16 16"
    width="16"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="1.25"
  >
    {paths[name].map((path) => (
      <path d={path} key={path} />
    ))}
  </svg>
)
