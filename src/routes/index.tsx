import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { Link, type DocumentHead } from '@builder.io/qwik-city'

import type { BuiltInCollectionItem, BuiltInCollectionKind } from '~/services/library-client'
import { queryBuiltInCollection } from '~/services/library-client'
import { StoreActionsContext, StoreContext } from './layout'

interface CollectionPreview {
  error: string
  items: BuiltInCollectionItem[]
  status: 'loading' | 'ready' | 'error'
  total: number
}

const COLLECTIONS: ReadonlyArray<{
  emptyMessage: string
  kind: BuiltInCollectionKind
  label: string
}> = [
  {
    emptyMessage: 'Play a track to begin building your listening history.',
    kind: 'recently_played',
    label: 'Recently played',
  },
  {
    emptyMessage: 'Completed plays will surface your most-played tracks.',
    kind: 'most_played',
    label: 'Most played',
  },
  {
    emptyMessage: 'Every available track has been played.',
    kind: 'never_played',
    label: 'Unplayed',
  },
] as const

const emptyPreview = (): CollectionPreview => ({ error: '', items: [], status: 'loading', total: 0 })

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const state = useStore({
    action: '',
    error: '',
    collections: {
      recently_played: emptyPreview(),
      most_played: emptyPreview(),
      never_played: emptyPreview(),
    } satisfies Record<BuiltInCollectionKind, CollectionPreview>,
  })

  useVisibleTask$(async ({ cleanup, track }) => {
    track(() => store.libraryCatalog.refreshKey)
    let active = true
    cleanup(() => {
      active = false
    })

    await Promise.all(
      COLLECTIONS.map(async ({ kind }) => {
        const preview = state.collections[kind]
        preview.error = ''
        preview.status = 'loading'
        try {
          const page = await queryBuiltInCollection({ kind, limit: 5, offset: 0 })
          if (!active) return
          preview.items = page.items
          preview.total = page.total
          preview.status = 'ready'
        } catch {
          if (!active) return
          preview.error = 'This collection is temporarily unavailable.'
          preview.status = 'error'
        }
      })
    )
  })

  const playPreview = $(async (kind: BuiltInCollectionKind, index: number) => {
    if (state.action) return
    const definition = COLLECTIONS.find((collection) => collection.kind === kind)
    const items = state.collections[kind].items
    const item = items[index]
    if (!definition || !item) return

    state.action = `${kind}:${index}`
    state.error = ''
    try {
      const playlist = items.map(({ track }) => track)
      store.playlist = playlist
      await storeActions.playSong(item.track, index, { kind: 'collection', label: definition.label })
    } catch {
      state.error = 'Jukebox could not play that track.'
    } finally {
      state.action = ''
    }
  })

  const toggleCurrent = $(() => {
    if (store.player.isPaused) return storeActions.resumeSong()
    return storeActions.pauseSong()
  })

  return (
    <section class="workspace-page" aria-labelledby="listen-heading">
      <header class="workspace-header">
        <div>
          <p class="workspace-eyebrow">Local listening</p>
          <h1 id="listen-heading">Listen</h1>
          <p>Resume a track or choose from useful views of the music already on this device.</p>
        </div>
        <Link class="workspace-link" href="/songs/">
          Browse all songs
        </Link>
      </header>

      {store.player.currSong && (
        <section class="workspace-current" aria-label="Continue listening">
          <div class="min-w-0">
            <p class="workspace-eyebrow">Continue listening</p>
            <h2 class="truncate" title={store.player.currSong.title}>
              {store.player.currSong.title}
            </h2>
            <p class="truncate">
              {[store.player.currSong.artist, store.player.currSong.album].filter(Boolean).join(' · ') ||
                'Unknown track'}
            </p>
          </div>
          <button class="workspace-primary-action" type="button" onClick$={toggleCurrent}>
            {store.player.isPaused ? 'Resume' : 'Pause'}
          </button>
        </section>
      )}

      {state.error && (
        <p class="workspace-error" role="alert">
          {state.error}
        </p>
      )}

      <div class="workspace-collection-grid">
        {COLLECTIONS.map((definition) => {
          const preview = state.collections[definition.kind]
          return (
            <section class="workspace-collection" key={definition.kind} aria-labelledby={`${definition.kind}-heading`}>
              <header>
                <div>
                  <h2 id={`${definition.kind}-heading`}>{definition.label}</h2>
                  <p>{preview.total ? `${preview.total.toLocaleString()} tracks` : 'Local collection'}</p>
                </div>
              </header>

              {preview.status === 'loading' ? (
                <p class="workspace-collection-empty">Loading…</p>
              ) : preview.error ? (
                <p class="workspace-collection-empty" role="alert">
                  {preview.error}
                </p>
              ) : preview.items.length ? (
                <ol>
                  {preview.items.map((item, index) => (
                    <li key={`${definition.kind}:${item.track.id}`}>
                      <button
                        type="button"
                        onClick$={() => playPreview(definition.kind, index)}
                        disabled={Boolean(state.action)}
                        title={`Play ${item.track.title}`}
                      >
                        <span class="workspace-row-number">{index + 1}</span>
                        <span class="min-w-0 flex-1 text-left">
                          <strong class="block truncate">{item.track.title}</strong>
                          <span class="mt-1 block truncate">{item.track.artist || 'Unknown artist'}</span>
                        </span>
                        {definition.kind === 'most_played' && (
                          <span class="workspace-row-meta">{item.playCount} plays</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p class="workspace-collection-empty">{definition.emptyMessage}</p>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
})

export const head: DocumentHead = {
  title: 'Listen · Jukebox',
  meta: [{ name: 'description', content: 'Resume playback and browse useful views of your local music.' }],
}
