import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { Link, type DocumentHead } from '@builder.io/qwik-city'

import MetadataLink from '~/components/library/MetadataLink'
import { PageToolbar } from '~/components/Shared/PageToolbar'
import type { BuiltInCollectionItem, BuiltInCollectionKind } from '~/services/library-client'
import { queryBuiltInCollection } from '~/services/library-client'
import { trackMetadataDestinations } from '~/services/library-destination'
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
    const definition = COLLECTIONS.find((collection) => collection.kind === kind)
    const items = state.collections[kind].items
    const item = items[index]
    if (!definition || !item) return

    state.error = ''
    try {
      await storeActions.playTracks(
        items.map(({ track }) => track),
        index,
        { kind: 'collection', label: definition.label }
      )
    } catch {
      state.error = 'Jukebox could not play that track.'
    }
  })

  return (
    <section class="desktop-page" aria-labelledby="listen-heading">
      <PageToolbar title="Listen" id="listen-heading">
        <Link class="workspace-link" href="/songs/">
          Browse all songs
        </Link>
      </PageToolbar>
      <div class="workspace-page">
        {state.error && (
          <p class="workspace-error" role="alert">
            {state.error}
          </p>
        )}

        <div class="workspace-collection-grid">
          {COLLECTIONS.map((definition) => {
            const preview = state.collections[definition.kind]
            return (
              <section
                class="workspace-collection"
                key={definition.kind}
                aria-labelledby={`${definition.kind}-heading`}
              >
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
                    {preview.items.map((item, index) => {
                      const artistDestination = trackMetadataDestinations(item.track).artist
                      return (
                        <li key={`${definition.kind}:${item.track.id}`}>
                          <div class="workspace-track-row">
                            <span class="workspace-row-number">{index + 1}</span>
                            <span class="min-w-0 flex-1 text-left">
                              <button
                                type="button"
                                class="workspace-track-play block w-full truncate text-left"
                                onClick$={() => playPreview(definition.kind, index)}
                                title={`Play ${item.track.title}`}
                              >
                                {item.track.title}
                              </button>
                              {artistDestination ? (
                                <MetadataLink
                                  destination={artistDestination}
                                  class="workspace-track-artist mt-1 block truncate"
                                >
                                  {item.track.artist}
                                </MetadataLink>
                              ) : (
                                <span class="workspace-track-artist mt-1 block truncate">Unknown artist</span>
                              )}
                            </span>
                            {definition.kind === 'most_played' && (
                              <span class="workspace-row-meta">{item.playCount} plays</span>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p class="workspace-collection-empty">{definition.emptyMessage}</p>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
})

export const head: DocumentHead = {
  title: 'Listen · Jukebox',
  meta: [{ name: 'description', content: 'Resume playback and browse useful views of your local music.' }],
}
