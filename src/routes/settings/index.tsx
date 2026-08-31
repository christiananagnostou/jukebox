import { component$ } from '@builder.io/qwik'
import { Link, type DocumentHead } from '@builder.io/qwik-city'

import { SettingsShell } from '~/components/settings/SettingsShell'

const destinations = [
  {
    description: 'Window behavior and small application preferences.',
    href: '/settings/general/',
    label: 'General',
    meta: 'Application',
  },
  {
    description: 'Manage watched folders, refresh sources, or reset the local catalog.',
    href: '/settings/library/',
    label: 'Library',
    meta: 'Music on this device',
  },
  {
    description: 'Start the private player and connect securely from a phone or another device.',
    href: '/remote/',
    label: 'Remote listening',
    meta: 'Private access',
  },
  {
    description: 'Control listening history and inspect privacy-safe local diagnostics.',
    href: '/settings/privacy/',
    label: 'Privacy & diagnostics',
    meta: 'Local data',
  },
] as const

export default component$(() => (
  <SettingsShell
    current="overview"
    title="Settings"
    description="A small set of focused controls for Jukebox and the library stored on this device."
  >
    <div class="settings-destination-list">
      {destinations.map((destination) => (
        <Link href={destination.href} key={destination.href}>
          <span class="settings-destination-meta">{destination.meta}</span>
          <span class="settings-destination-title">{destination.label}</span>
          <span class="settings-destination-description">{destination.description}</span>
          <span class="settings-destination-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      ))}
    </div>
  </SettingsShell>
))

export const head: DocumentHead = {
  title: 'Settings · Jukebox',
  meta: [{ name: 'description', content: 'Configure Jukebox.' }],
}
