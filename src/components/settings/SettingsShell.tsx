import { component$, Slot } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'

export type SettingsSection = 'general' | 'library' | 'overview' | 'privacy'

const sections: ReadonlyArray<{ href: string; id: SettingsSection; label: string }> = [
  { href: '/settings/', id: 'overview', label: 'Overview' },
  { href: '/settings/general/', id: 'general', label: 'General' },
  { href: '/settings/library/', id: 'library', label: 'Library' },
  { href: '/settings/privacy/', id: 'privacy', label: 'Privacy & diagnostics' },
]

export const SettingsShell = component$((props: { current: SettingsSection; description: string; title: string }) => (
  <section class="workspace-page settings-workspace" aria-labelledby="settings-heading">
    <header class="workspace-header">
      <div>
        <h1 id="settings-heading">{props.title}</h1>
        <p>{props.description}</p>
      </div>
    </header>

    <nav class="settings-section-nav" aria-label="Settings sections">
      {sections.map((section) => (
        <Link
          key={section.id}
          href={section.href}
          data-active={section.id === props.current ? 'true' : 'false'}
          aria-current={section.id === props.current ? 'page' : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>

    <div class="settings-section-content">
      <Slot />
    </div>
  </section>
))
