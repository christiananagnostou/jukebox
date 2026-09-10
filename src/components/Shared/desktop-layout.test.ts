import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
import { describe, expect, it } from 'vitest'

const css = parse(readFileSync('src/global.css', 'utf8'))
function declaration(selector: string, property: string) {
  let value: string | undefined
  css.walkRules(selector, (rule) => {
    rule.walkDecls(property, (declaration) => {
      value = declaration.value
    })
  })
  return value
}

describe('desktop panel layout contracts', () => {
  it('keeps horizontal and vertical scrollbars equally thin', () => {
    expect(declaration('*::-webkit-scrollbar', 'height')).toBe('var(--scrollbar-width)')
    expect(declaration('*::-webkit-scrollbar', 'width')).toBe('var(--scrollbar-width)')
    expect(declaration(':root', '--scrollbar-width')).toBe('8px')
  })
  it('disables both overscroll axes on every desktop scroll container', () => {
    let contained = false
    css.walkRules((rule) => {
      if (rule.selectors.includes('.app-shell *')) {
        rule.walkDecls('overscroll-behavior', (decl) => {
          contained = decl.value === 'none'
        })
      }
    })
    expect(contained).toBe(true)
  })
  it('aligns page and side-panel strips using one height token', () => {
    expect(declaration(':root', '--panel-toolbar-height')).toBe('30px')
    expect(declaration('.page-toolbar', 'height')).toBe('var(--panel-toolbar-height)')
    expect(declaration('.nav-index-header', 'margin-top')).toBe('calc(var(--panel-toolbar-height) - 1px)')
    expect(declaration('.panel-top-spacer', 'margin-top')).toBe('calc(var(--panel-toolbar-height) - 1px)')
  })
})
