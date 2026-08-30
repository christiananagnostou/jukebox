import {
  $,
  component$,
  noSerialize,
  useContext,
  useSignal,
  useStore,
  useVisibleTask$,
  type NoSerialize,
  type QRL,
} from '@builder.io/qwik'

import type { ListItemStyle } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { listLibraryRoots, type LibraryRoot } from '~/services/library-refresh'
import type { PlaylistSummary } from '~/services/playlist-client'
import {
  createSmartPlaylist,
  deleteSmartPlaylist,
  getSmartPlaylist,
  smartPlaylistItemAt,
  type SmartPlaylistCatalogState,
  SmartPlaylistPager,
  smartPlaylistPlaybackAt,
  updateSmartPlaylist,
} from '~/services/smart-playlist-client'
import {
  defaultSmartPlaylistDraft,
  defaultSmartRuleDraft,
  SMART_RULE_FIELDS,
  SMART_SORT_OPTIONS,
  smartPlaylistDefinitionFromDraft,
  smartPlaylistDraftFromDefinition,
  smartRuleNeedsValue,
  smartRuleOperators,
  smartRuleWithField,
  type SmartPlaylistDraft,
  type SmartRuleDraft,
  type SmartRuleField,
} from '~/services/smart-playlist-editor'
import { getErrorMessage } from '~/utils/Errors'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { formatLastPlayed } from './built-in-collections'

const ROW_HEIGHT = 52
const GRID_CLASS = 'grid grid-cols-[48px_minmax(0,1.2fr)_minmax(0,.8fr)_minmax(0,.8fr)_90px_170px]'
const BUTTON_CLASS =
  'border border-gray-600 px-3 py-2 text-sm hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40'
const INPUT_CLASS = 'min-w-0 border border-gray-600 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-yellow-600'

interface SmartPlaylistViewProps {
  onCreated$: QRL<(playlist: PlaylistSummary) => void>
  onDeleted$: QRL<() => void>
  onUpdated$: QRL<(playlist: PlaylistSummary) => void>
  playlistId?: string
}

function catalogState(): SmartPlaylistCatalogState {
  return { error: '', pages: {}, revision: '', status: 'loading', total: 0 }
}

function assignDraft(target: SmartPlaylistDraft, source: SmartPlaylistDraft): void {
  target.direction = source.direction
  target.matchMode = source.matchMode
  target.resultLimit = source.resultLimit
  target.rules = source.rules.map((rule) => ({ ...rule }))
  target.sort = source.sort
}

function validName(value: string): boolean {
  const normalized = value.trim()
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  return Boolean(normalized && [...normalized].length <= 200 && !hasControlCharacter)
}

function numberInputProps(field: SmartRuleField): { max: number; min: number; step: number } {
  if (field === 'duration_ms') return { max: 604_800, min: 0, step: 0.001 }
  if (field === 'favorite') return { max: 2, min: 0, step: 1 }
  if (field === 'year') return { max: 9_999, min: 1, step: 1 }
  if (field === 'sample_rate') return { max: 1_000_000, min: 1, step: 1 }
  return { max: 1_000_000, min: 0, step: 1 }
}

function valueLabel(field: SmartRuleField): string {
  if (field === 'duration_ms') return 'Seconds'
  if (field === 'sample_rate') return 'Hertz'
  if (field === 'root') return 'Library root'
  return 'Value'
}

export default component$((props: SmartPlaylistViewProps) => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const catalog = useStore(catalogState())
  const baseline = useStore<SmartPlaylistDraft>(defaultSmartPlaylistDraft())
  const draft = useStore<SmartPlaylistDraft>(defaultSmartPlaylistDraft())
  const roots = useStore<{ error: string; items: LibraryRoot[]; loaded: boolean }>({
    error: '',
    items: [],
    loaded: false,
  })
  const pager = useSignal<NoSerialize<SmartPlaylistPager>>()
  const state = useStore({
    action: '',
    confirmDelete: false,
    editorOpen: !props.playlistId,
    error: '',
    loaded: false,
    name: '',
    notice: '',
    savedName: '',
  })

  useVisibleTask$(({ cleanup, track }) => {
    const playlistId = track(() => props.playlistId || '')
    const controller = new SmartPlaylistPager(catalog)
    let active = true
    pager.value = noSerialize(controller)
    state.action = ''
    state.confirmDelete = false
    state.error = ''
    state.loaded = !playlistId
    state.notice = ''

    if (playlistId) {
      state.editorOpen = false
      void Promise.all([getSmartPlaylist(playlistId), controller.reset(playlistId)])
        .then(([playlist]) => {
          if (!active) return
          state.name = playlist.summary.name
          state.savedName = playlist.summary.name
          const loadedDraft = smartPlaylistDraftFromDefinition(playlist.definition)
          assignDraft(baseline, loadedDraft)
          assignDraft(draft, loadedDraft)
          state.loaded = true
        })
        .catch((error) => {
          if (!active) return
          state.error = getErrorMessage(error)
          state.loaded = true
        })
    } else {
      controller.clear()
      state.editorOpen = true
      state.name = ''
      state.savedName = ''
      const newDraft = defaultSmartPlaylistDraft()
      assignDraft(baseline, newDraft)
      assignDraft(draft, newDraft)
    }

    cleanup(() => {
      active = false
      store.isTyping = false
      controller.dispose()
      pager.value = undefined
    })
  })

  useVisibleTask$(({ cleanup, track }) => {
    const editorOpen = track(() => state.editorOpen)
    if (!editorOpen || roots.loaded) return
    let active = true
    roots.loaded = true
    void listLibraryRoots()
      .then((items) => {
        if (!active) return
        roots.items = items
        roots.error = ''
      })
      .catch(() => {
        if (active) roots.error = 'Library roots are unavailable. Existing root rules remain editable by ID.'
      })
    cleanup(() => {
      active = false
    })
  })

  const save = $(async () => {
    if (state.action || !validName(state.name)) return
    state.action = 'save'
    state.error = ''
    state.notice = ''
    try {
      const definition = smartPlaylistDefinitionFromDraft(draft)
      if (props.playlistId) {
        const updated = await updateSmartPlaylist(props.playlistId, state.name.trim(), definition)
        state.name = updated.summary.name
        state.savedName = updated.summary.name
        const savedDraft = smartPlaylistDraftFromDefinition(updated.definition)
        assignDraft(baseline, savedDraft)
        assignDraft(draft, savedDraft)
        state.editorOpen = false
        state.notice = `Updated ${updated.summary.name}.`
        await pager.value?.reload()
        await props.onUpdated$(updated.summary)
      } else {
        const created = await createSmartPlaylist(state.name.trim(), definition)
        state.notice = `Created ${created.summary.name}.`
        await props.onCreated$(created.summary)
      }
    } catch (error) {
      state.error = getErrorMessage(error)
    } finally {
      state.action = ''
    }
  })

  const remove = $(async () => {
    if (!props.playlistId || state.action) return
    state.action = 'delete'
    state.error = ''
    state.notice = ''
    try {
      await deleteSmartPlaylist(props.playlistId)
      await props.onDeleted$()
    } catch (error) {
      state.error = getErrorMessage(error)
    } finally {
      state.action = ''
    }
  })

  const playItem = $(async (index: number) => {
    if (state.action) return
    const playback = smartPlaylistPlaybackAt(catalog, index)
    if (!playback) return
    state.action = 'play'
    state.error = ''
    try {
      store.playlist = playback.playlist
      await storeActions.playSong(playback.song, playback.playlistIndex, { kind: 'playlist', label: state.name })
    } catch (error) {
      state.error = getErrorMessage(error)
    } finally {
      state.action = ''
    }
  })

  const addRule = $(() => {
    if (draft.rules.length < 32) draft.rules.push(defaultSmartRuleDraft('artist'))
  })

  const removeRule = $((index: number) => {
    if (draft.rules.length > 1) draft.rules.splice(index, 1)
  })

  const changeRuleField = $((index: number, field: SmartRuleField) => {
    draft.rules[index] = smartRuleWithField(field)
  })

  const cancelEditor = $(() => {
    state.name = state.savedName
    assignDraft(draft, baseline)
    state.error = ''
    state.editorOpen = false
  })

  const busy = Boolean(state.action)
  const selectedError = state.error || catalog.error

  return (
    <section class="flex min-h-0 flex-1 flex-col" aria-label={props.playlistId ? state.name : 'New smart playlist'}>
      <header class="border-b border-gray-700 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-xl">{props.playlistId ? state.name || 'Smart playlist' : 'New smart playlist'}</h2>
            <p class="mt-1 text-xs text-slate-400">
              {props.playlistId
                ? `${catalog.total} ${catalog.total === 1 ? 'matching track' : 'matching tracks'}`
                : 'Build a live collection from indexed library and listening-history rules.'}
            </p>
          </div>
          {props.playlistId && (
            <div class="flex flex-wrap gap-2">
              <button
                class={BUTTON_CLASS}
                onClick$={() => {
                  state.editorOpen = !state.editorOpen
                  state.confirmDelete = false
                }}
                disabled={busy || !state.loaded}
                aria-expanded={state.editorOpen}
              >
                {state.editorOpen ? 'Close editor' : 'Edit rules'}
              </button>
              <button
                class={`${BUTTON_CLASS} border-red-900 text-red-300`}
                onClick$={() => {
                  state.confirmDelete = !state.confirmDelete
                  state.editorOpen = false
                }}
                disabled={busy || !state.loaded}
                aria-expanded={state.confirmDelete}
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {state.confirmDelete && (
          <div class="mt-3 flex flex-wrap items-center gap-3 border border-red-900 bg-red-950 px-3 py-2 text-sm">
            <span>Delete this smart playlist? Library tracks and history will not be changed.</span>
            <button class={`${BUTTON_CLASS} border-red-600 text-red-200`} onClick$={remove} disabled={busy}>
              Confirm delete
            </button>
            <button class={BUTTON_CLASS} onClick$={() => (state.confirmDelete = false)} disabled={busy}>
              Cancel
            </button>
          </div>
        )}

        <div class="mt-3 min-h-4 text-xs" aria-live="polite">
          {selectedError ? (
            <span role="alert" class="text-red-300">
              {selectedError}
            </span>
          ) : (
            <span class="text-slate-400">{state.notice}</span>
          )}
        </div>
      </header>

      {state.editorOpen && (
        <form
          preventdefault:submit
          onSubmit$={save}
          class="max-h-[48vh] overflow-y-auto border-b border-gray-700 bg-gray-900 p-4"
          aria-label="Smart playlist rules"
        >
          <div class="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_150px_150px_140px_120px]">
            <label class="grid gap-1 text-xs text-slate-400">
              Name
              <input
                class={INPUT_CLASS}
                value={state.name}
                maxLength={200}
                required
                onInput$={(_, input) => (state.name = input.value)}
                onFocus$={() => (store.isTyping = true)}
                onBlur$={() => (store.isTyping = false)}
              />
            </label>
            <label class="grid gap-1 text-xs text-slate-400">
              Match
              <select
                class={INPUT_CLASS}
                value={draft.matchMode}
                onChange$={(_, input) => (draft.matchMode = input.value as SmartPlaylistDraft['matchMode'])}
                onFocus$={() => (store.isTyping = true)}
                onBlur$={() => (store.isTyping = false)}
              >
                <option value="all">All rules</option>
                <option value="any">Any rule</option>
              </select>
            </label>
            <label class="grid gap-1 text-xs text-slate-400">
              Sort by
              <select
                class={INPUT_CLASS}
                value={draft.sort}
                onChange$={(_, input) => (draft.sort = input.value as SmartPlaylistDraft['sort'])}
                onFocus$={() => (store.isTyping = true)}
                onBlur$={() => (store.isTyping = false)}
              >
                {SMART_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label class="grid gap-1 text-xs text-slate-400">
              Direction
              <select
                class={INPUT_CLASS}
                value={draft.direction}
                onChange$={(_, input) => (draft.direction = input.value as SmartPlaylistDraft['direction'])}
                onFocus$={() => (store.isTyping = true)}
                onBlur$={() => (store.isTyping = false)}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <label class="grid gap-1 text-xs text-slate-400">
              Result limit
              <input
                class={INPUT_CLASS}
                type="number"
                min={1}
                max={10_000}
                step={1}
                value={draft.resultLimit}
                onInput$={(_, input) => (draft.resultLimit = input.value)}
                onFocus$={() => (store.isTyping = true)}
                onBlur$={() => (store.isTyping = false)}
              />
            </label>
          </div>

          <fieldset class="mt-4 grid gap-2">
            <legend class="mb-2 text-sm text-slate-300">Rules</legend>
            {draft.rules.map((rule: SmartRuleDraft, index) => {
              const operators = smartRuleOperators(rule.field)
              const numberProps = numberInputProps(rule.field)
              return (
                <div
                  key={`${index}:${rule.field}`}
                  class="grid gap-2 border border-gray-700 p-2 md:grid-cols-[32px_minmax(130px,.8fr)_minmax(150px,.9fr)_minmax(160px,1fr)_80px]"
                >
                  <span class="flex items-center justify-center text-xs tabular-nums text-slate-500">{index + 1}</span>
                  <label class="grid gap-1 text-xs text-slate-400">
                    Field
                    <select
                      class={INPUT_CLASS}
                      value={rule.field}
                      onChange$={(_, input) => changeRuleField(index, input.value as SmartRuleField)}
                      onFocus$={() => (store.isTyping = true)}
                      onBlur$={() => (store.isTyping = false)}
                    >
                      {SMART_RULE_FIELDS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {operators.length ? (
                    <label class="grid gap-1 text-xs text-slate-400">
                      Operator
                      <select
                        class={INPUT_CLASS}
                        value={rule.operator}
                        onChange$={(_, input) => {
                          rule.operator = input.value
                          if (!smartRuleNeedsValue(rule)) rule.value = ''
                        }}
                        onFocus$={() => (store.isTyping = true)}
                        onBlur$={() => (store.isTyping = false)}
                      >
                        {operators.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span class="hidden md:block" />
                  )}

                  {smartRuleNeedsValue(rule) ? (
                    <label class="grid gap-1 text-xs text-slate-400">
                      {valueLabel(rule.field)}
                      {rule.field === 'availability' ? (
                        <select
                          class={INPUT_CLASS}
                          value={rule.value}
                          onChange$={(_, input) => (rule.value = input.value)}
                          onFocus$={() => (store.isTyping = true)}
                          onBlur$={() => (store.isTyping = false)}
                        >
                          <option value="available">Available</option>
                          <option value="unavailable">Unavailable</option>
                        </select>
                      ) : rule.field === 'root' ? (
                        <select
                          class={INPUT_CLASS}
                          value={rule.value}
                          onChange$={(_, input) => (rule.value = input.value)}
                          onFocus$={() => (store.isTyping = true)}
                          onBlur$={() => (store.isTyping = false)}
                        >
                          <option value="0">Imported tracks</option>
                          {rule.value !== '0' && !roots.items.some((root) => String(root.id) === rule.value) && (
                            <option value={rule.value}>{`Library root #${rule.value}`}</option>
                          )}
                          {roots.items.map((root) => (
                            <option key={root.id} value={root.id}>
                              {`${root.path}${root.enabled ? '' : ' (offline)'}`}
                            </option>
                          ))}
                        </select>
                      ) : rule.field === 'date_added' || rule.field === 'last_played' ? (
                        <input
                          class={INPUT_CLASS}
                          type="date"
                          value={rule.value}
                          onInput$={(_, input) => (rule.value = input.value)}
                          onFocus$={() => (store.isTyping = true)}
                          onBlur$={() => (store.isTyping = false)}
                        />
                      ) : rule.field === 'favorite' ? (
                        <select
                          class={INPUT_CLASS}
                          value={rule.value}
                          onChange$={(_, input) => (rule.value = input.value)}
                          onFocus$={() => (store.isTyping = true)}
                          onBlur$={() => (store.isTyping = false)}
                        >
                          <option value="0">Not rated</option>
                          <option value="1">Favorite</option>
                          <option value="2">Loved</option>
                        </select>
                      ) : ['year', 'play_count', 'duration_ms', 'sample_rate'].includes(rule.field) ? (
                        <input
                          class={INPUT_CLASS}
                          type="number"
                          min={numberProps.min}
                          max={numberProps.max}
                          step={numberProps.step}
                          value={rule.value}
                          onInput$={(_, input) => (rule.value = input.value)}
                          onFocus$={() => (store.isTyping = true)}
                          onBlur$={() => (store.isTyping = false)}
                        />
                      ) : (
                        <input
                          class={INPUT_CLASS}
                          value={rule.value}
                          maxLength={1_024}
                          onInput$={(_, input) => (rule.value = input.value)}
                          onFocus$={() => (store.isTyping = true)}
                          onBlur$={() => (store.isTyping = false)}
                        />
                      )}
                    </label>
                  ) : (
                    <span class="flex items-end pb-2 text-xs text-slate-500">No value needed</span>
                  )}

                  <button
                    class="self-end px-2 py-2 text-xs text-slate-400 hover:text-red-300 disabled:opacity-30"
                    type="button"
                    onClick$={() => removeRule(index)}
                    disabled={draft.rules.length === 1 || busy}
                    aria-label={`Remove rule ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </fieldset>

          {roots.error && <p class="mt-2 text-xs text-amber-300">{roots.error}</p>}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button class={BUTTON_CLASS} type="button" onClick$={addRule} disabled={draft.rules.length >= 32 || busy}>
              Add rule
            </button>
            <button class={`${BUTTON_CLASS} border-yellow-700`} type="submit" disabled={!validName(state.name) || busy}>
              {state.action === 'save' ? 'Saving…' : props.playlistId ? 'Save changes' : 'Create smart playlist'}
            </button>
            {props.playlistId && (
              <button class={BUTTON_CLASS} type="button" onClick$={cancelEditor} disabled={busy}>
                Cancel
              </button>
            )}
            <span class="text-xs text-slate-500">{draft.rules.length} of 32 rules</span>
          </div>
        </form>
      )}

      {props.playlistId && (
        <>
          <div
            class={`${GRID_CLASS} min-h-[30px] border-b border-gray-700 text-xs text-slate-400`}
            style={{ paddingRight: 'var(--scrollbar-width)' }}
          >
            <span class="flex items-center px-2">#</span>
            <span class="flex items-center border-l border-gray-700 px-3">Title</span>
            <span class="flex items-center border-l border-gray-700 px-3">Artist</span>
            <span class="flex items-center border-l border-gray-700 px-3">Album</span>
            <span class="flex items-center justify-end border-l border-gray-700 px-3">Plays</span>
            <span class="flex items-center border-l border-gray-700 px-3">Last played</span>
          </div>

          <div class="relative min-h-0 flex-1">
            {catalog.status === 'loading' && catalog.total === 0 && (
              <div class="grid h-full place-items-center p-8 text-sm text-slate-400">Loading smart playlist…</div>
            )}
            {catalog.status === 'ready' && catalog.total === 0 && (
              <div class="grid h-full place-items-center p-8 text-center text-sm text-slate-400">
                <div>
                  <p class="text-slate-300">No tracks match these rules.</p>
                  <p class="mt-2">Open the rule editor to broaden this playlist.</p>
                </div>
              </div>
            )}
            <VirtualList
              numItems={catalog.total}
              itemHeight={ROW_HEIGHT}
              onRangeChange={$((startIndex, endIndex) => pager.value?.ensureRange(startIndex, endIndex))}
              renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
                const item = smartPlaylistItemAt(catalog, index)
                if (!item) return <div class="bg-gray-900" style={{ ...style, height: `${ROW_HEIGHT}px` }} />
                const available = item.availability === 'available'
                return (
                  <div
                    key={`${props.playlistId}:${item.track.id}`}
                    class={`${GRID_CLASS} border-b border-gray-800 text-sm`}
                    style={{ ...style, height: `${ROW_HEIGHT}px` }}
                  >
                    <span class="flex items-center px-2 tabular-nums text-slate-500">{index + 1}</span>
                    <button
                      class="flex min-w-0 items-center border-l border-gray-800 px-3 text-left hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-slate-500"
                      disabled={!available || busy}
                      onClick$={() => playItem(index)}
                      aria-label={
                        available
                          ? `Play ${item.track.title} by ${item.track.artist || 'Unknown artist'}`
                          : `${item.track.title} is unavailable`
                      }
                    >
                      <span class="truncate">{item.track.title || '-'}</span>
                    </button>
                    <span class="flex min-w-0 items-center border-l border-gray-800 px-3">
                      <span class="truncate">{item.track.artist || '-'}</span>
                    </span>
                    <span class="flex min-w-0 items-center border-l border-gray-800 px-3">
                      <span class="truncate">{item.track.album || '-'}</span>
                    </span>
                    <span class="flex items-center justify-end border-l border-gray-800 px-3 tabular-nums text-slate-400">
                      {item.playCount}
                    </span>
                    <span class="flex items-center border-l border-gray-800 px-3 text-xs tabular-nums text-slate-500">
                      {available ? formatLastPlayed(item.lastPlayedAt) : 'Unavailable'}
                    </span>
                  </div>
                )
              })}
            />
          </div>
        </>
      )}
    </section>
  )
})
