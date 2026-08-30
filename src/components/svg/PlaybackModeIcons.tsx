import { component$ } from '@builder.io/qwik'

const ICON_PROPS = {
  fill: 'none',
  height: '1em',
  stroke: 'currentColor',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'stroke-width': '1.6',
  viewBox: '0 0 24 24',
  width: '1em',
  xmlns: 'http://www.w3.org/2000/svg',
} as const

export const Repeat = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a3 3 0 0 1 3-3h15" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a3 3 0 0 1-3 3H3" />
  </svg>
))

export const Shuffle = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M18 4l3 3-3 3" />
    <path d="M3 7h3c5 0 5 10 10 10h5" />
    <path d="M18 14l3 3-3 3" />
    <path d="M3 17h3c2.2 0 3.4-1.9 4.5-4" />
    <path d="M13.5 8.5C14.2 7.6 15 7 16 7h5" />
  </svg>
))

export const Volume = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M5 9H2v6h3l5 4V5L5 9z" />
    <path d="M14 9.5a4 4 0 0 1 0 5" />
    <path d="M17 6.5a8 8 0 0 1 0 11" />
  </svg>
))

export const VolumeMuted = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M5 9H2v6h3l5 4V5L5 9z" />
    <path d="M15 10l5 5" />
    <path d="M20 10l-5 5" />
  </svg>
))
