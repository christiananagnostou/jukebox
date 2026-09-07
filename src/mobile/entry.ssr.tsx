import { renderToString } from '@builder.io/qwik/server'
import type { RenderToStringOptions } from '@builder.io/qwik/server'
import Root from './root'

export const render = (options: RenderToStringOptions) =>
  renderToString(<Root />, { ...options, containerAttributes: { lang: 'en' }, qwikLoader: { include: 'always' } })
