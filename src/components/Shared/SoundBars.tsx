import { component$ } from '@builder.io/qwik'

export interface SoundBarsProps {
  show: boolean
}

export const SoundBars = component$<SoundBarsProps>(({ show }) => {
  return (
    <div class="sound-wave pl-2">
      {show && (
        <>
          <i class="bar"></i>
          <i class="bar"></i>
          <i class="bar"></i>
          <i class="bar"></i>
        </>
      )}
    </div>
  )
})
