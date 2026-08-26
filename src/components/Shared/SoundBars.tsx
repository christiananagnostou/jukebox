import { component$ } from '@builder.io/qwik'

export interface SoundBarsProps {
  show: boolean
}

export const SoundBars = component$<SoundBarsProps>(({ show }) => {
  return (
    <div class="sound-wave pl-2">
      {show && (
        <div aria-hidden="true" class="flex">
          <i class="bar" />
          <i class="bar" />
          <i class="bar" />
          <i class="bar" />
        </div>
      )}
    </div>
  )
})
