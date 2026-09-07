import { createContextId } from '@builder.io/qwik'
import type { NoSerialize, Signal } from '@builder.io/qwik'
import type { LibraryModel, PlayerModel } from './model'
import type { MobileRuntime } from './runtime'

export const MobileContext = createContextId<{
  library: LibraryModel
  player: PlayerModel
  runtime: Signal<NoSerialize<MobileRuntime> | undefined>
}>('jukebox.mobile')
