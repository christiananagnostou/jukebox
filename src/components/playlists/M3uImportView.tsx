import {
  $,
  component$,
  noSerialize,
  useComputed$,
  useContext,
  useSignal,
  useStore,
  useVisibleTask$,
  type NoSerialize,
  type QRL,
} from '@builder.io/qwik'

import type { ListItemStyle } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import {
  applyM3uImport,
  m3uIssueAt,
  type M3uImportPreview,
  type M3uImportResult,
  M3uImportLease,
  type M3uIssueCatalogState,
  M3uIssuePager,
} from '~/services/m3u-client'
import {
  canApplyM3uImport,
  m3uIssueLabel,
  m3uPreviewStats,
  m3uReviewIssueCount,
  skippedM3uEntries,
} from '~/services/m3u-workflow'
import { getErrorMessage } from '~/utils/Errors'
import { StoreContext } from '~/routes/layout'
import { PLAYLIST_BUTTON_CLASS as BUTTON_CLASS, PLAYLIST_FORM_CONTROL_CLASS as INPUT_CLASS } from './styles'

const ISSUE_ROW_HEIGHT = 44
interface M3uImportViewProps {
  onApplied$: QRL<(result: M3uImportResult) => void>
  onBusyChange$: QRL<(busy: boolean) => void>
  onDiscarded$: QRL<() => void>
  preview: M3uImportPreview
}

function catalogState(): M3uIssueCatalogState {
  return { error: '', pages: {}, status: 'loading', total: 0 }
}

export default component$((props: M3uImportViewProps) => {
  const store = useContext(StoreContext)
  const catalog = useStore(catalogState())
  const lease = useSignal<NoSerialize<M3uImportLease>>()
  const pager = useSignal<NoSerialize<M3uIssuePager>>()
  const state = useStore({
    action: '',
    error: '',
    name: props.preview.suggestedName,
  })
  const issueCount = useComputed$(() => m3uReviewIssueCount(props.preview))

  useVisibleTask$(({ cleanup, track }) => {
    const token = track(() => props.preview.token)
    const controller = new M3uIssuePager(catalog)
    const tokenLease = new M3uImportLease(token)
    state.action = ''
    state.error = ''
    state.name = props.preview.suggestedName
    lease.value = noSerialize(tokenLease)
    pager.value = noSerialize(controller)
    if (m3uReviewIssueCount(props.preview)) {
      void controller.reset(token)
    } else {
      controller.clear()
      catalog.status = 'ready'
    }
    cleanup(() => {
      store.isTyping = false
      controller.dispose()
      lease.value = undefined
      pager.value = undefined
      void tokenLease.release().catch(() => undefined)
    })
  })

  const applyImport = $(async () => {
    if (state.action || !canApplyM3uImport(props.preview, state.name)) return
    state.action = 'apply'
    state.error = ''
    await props.onBusyChange$(true)
    try {
      const result = await applyM3uImport(props.preview.token, state.name.trim())
      lease.value?.consume()
      await props.onApplied$(result)
    } catch (error) {
      state.error = getErrorMessage(error)
    } finally {
      state.action = ''
      await props.onBusyChange$(false)
    }
  })

  const discardImport = $(async () => {
    if (state.action) return
    state.action = 'discard'
    state.error = ''
    await props.onBusyChange$(true)
    try {
      await lease.value?.release()
      await props.onDiscarded$()
    } catch (error) {
      state.error = getErrorMessage(error)
    } finally {
      state.action = ''
      await props.onBusyChange$(false)
    }
  })

  const busy = useComputed$(() => Boolean(state.action))
  const error = useComputed$(() => state.error || catalog.error)
  const skipped = useComputed$(() => skippedM3uEntries(props.preview))

  return (
    <section class="flex min-h-0 flex-1 flex-col" aria-label="Review playlist import">
      <header class="border-b border-gray-700 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl">Review playlist import</h2>
            <p class="mt-1 text-xs text-slate-400">Nothing is created until you apply this reviewed import.</p>
          </div>
          <span class="text-xs text-slate-500">M3U / M3U8</span>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {m3uPreviewStats(props.preview).map((stat) => (
            <div key={stat.label} class="border border-gray-700 bg-gray-900 px-3 py-2">
              <div class={`text-lg tabular-nums ${stat.tone === 'warning' ? 'text-amber-300' : 'text-slate-200'}`}>
                {stat.value}
              </div>
              <div class="text-xs text-slate-500">{stat.label}</div>
            </div>
          ))}
        </div>

        <form preventdefault:submit onSubmit$={applyImport} class="mt-4 flex max-w-2xl flex-wrap items-end gap-2">
          <label class="grid min-w-[240px] flex-1 gap-1 text-xs text-slate-400">
            New playlist name
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
          <button
            class={`${BUTTON_CLASS} playlist-primary-action`}
            type="submit"
            disabled={!canApplyM3uImport(props.preview, state.name) || busy.value}
          >
            {state.action === 'apply' ? 'Importing…' : `Import ${props.preview.matchedEntries} tracks`}
          </button>
          <button class={BUTTON_CLASS} type="button" onClick$={discardImport} disabled={busy.value}>
            Discard
          </button>
        </form>

        <div class="mt-3 min-h-4 text-xs" aria-live="polite">
          {error.value ? (
            <span role="alert" class="text-red-300">
              {error.value}
            </span>
          ) : skipped.value ? (
            <span class="text-amber-300">
              {skipped.value} {skipped.value === 1 ? 'entry will' : 'entries will'} be skipped. Review the redacted
              issues below.
            </span>
          ) : (
            <span class="text-slate-400">Every entry is ready to import.</span>
          )}
        </div>
      </header>

      {issueCount.value ? (
        <>
          <div
            class="grid min-h-[30px] grid-cols-[80px_140px_minmax(0,1fr)] border-b border-gray-700 text-xs text-slate-400"
            style={{ paddingRight: 'var(--scrollbar-width)' }}
          >
            <span class="flex items-center px-3">Line</span>
            <span class="flex items-center border-l border-gray-700 px-3">Issue</span>
            <span class="flex items-center border-l border-gray-700 px-3">Track</span>
          </div>
          <div class="relative min-h-0 flex-1">
            {catalog.status === 'loading' && catalog.total === 0 && (
              <div class="grid h-full place-items-center p-8 text-sm text-slate-400">Loading import review…</div>
            )}
            <VirtualList
              numItems={catalog.total || issueCount.value}
              itemHeight={ISSUE_ROW_HEIGHT}
              onRangeChange={$((startIndex, endIndex) => pager.value?.ensureRange(startIndex, endIndex))}
              renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
                const issue = m3uIssueAt(catalog, index)
                if (!issue) return <div class="bg-gray-900" style={{ ...style, height: `${ISSUE_ROW_HEIGHT}px` }} />
                return (
                  <div
                    key={`${issue.line}:${issue.kind}:${issue.name}`}
                    class="grid grid-cols-[80px_140px_minmax(0,1fr)] border-b border-gray-800 text-sm"
                    style={{ ...style, height: `${ISSUE_ROW_HEIGHT}px` }}
                  >
                    <span class="flex items-center px-3 tabular-nums text-slate-500">{issue.line}</span>
                    <span class="flex items-center border-l border-gray-800 px-3 text-amber-300">
                      {m3uIssueLabel(issue.kind)}
                    </span>
                    <span class="flex min-w-0 items-center border-l border-gray-800 px-3">
                      <span class="truncate" title={issue.name}>
                        {issue.name}
                      </span>
                    </span>
                  </div>
                )
              })}
            />
          </div>
          <p class="sr-only">
            Import issues load in bounded pages and include only source line, issue type, and filename.
          </p>
        </>
      ) : (
        <div class="grid flex-1 place-items-center p-8 text-center text-sm text-slate-400">
          <div>
            <p class="text-slate-300">All entries matched your library.</p>
            <p class="mt-2">Apply the import to create a new manual playlist.</p>
          </div>
        </div>
      )}
    </section>
  )
})
