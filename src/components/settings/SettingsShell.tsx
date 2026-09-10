import { component$, Slot } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'
import { PageToolbar } from '~/components/Shared/PageToolbar'

export type SettingsSection = 'general' | 'library' | 'overview' | 'privacy'

const sections: ReadonlyArray<{ href: string; id: SettingsSection; label: string }> = [
  { href: '/settings/', id: 'overview', label: 'Overview' },
  { href: '/settings/general/', id: 'general', label: 'General' },
  { href: '/settings/library/', id: 'library', label: 'Library' },
  { href: '/settings/privacy/', id: 'privacy', label: 'Privacy & diagnostics' },
]

export const SettingsShell = component$(
  (props: { current: SettingsSection; description: string; title: string; hasActions?: boolean }) => (
    <section class="desktop-page" aria-labelledby="settings-heading">
      <PageToolbar title={props.title} id="settings-heading">
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
        {props.hasActions && (
          <details class="page-toolbar-menu">
            <summary>Actions</summary>
            <div class="page-toolbar-menu-options">
              <Slot name="actions" />
            </div>
          </details>
        )}
      </PageToolbar>
      <div class="workspace-page settings-workspace">
        <p class="page-intro">{props.description}</p>
        <div class="settings-section-content">
          <Slot />
        </div>
      </div>
    </section>
  )
)
