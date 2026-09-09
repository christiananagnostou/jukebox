import { describe, expect, it } from 'vitest'
import { columnLayout, columnPreferences, columnWidth, SONG_COLUMNS, songDuration } from './columns'

describe('song column preferences', () => {
  it('defaults to essential listening metadata', () => {
    const preferences = columnPreferences()
    expect(SONG_COLUMNS.filter((column) => preferences[column.id].visible).map((column) => column.id)).toEqual([
      'title',
      'artist',
      'album',
      'duration',
      'fave',
    ])
  })
  it('round-trips widths and visibility without sharing mutable defaults', () => {
    const preferences = columnPreferences()
    preferences.album.visible = false
    preferences.title.width = 480
    expect(columnPreferences(JSON.parse(JSON.stringify(preferences)))).toEqual(preferences)
    expect(columnPreferences().title.width).toBe(260)
    expect(columnPreferences().album.visible).toBe(true)
  })
  it('validates corrupt and obsolete preferences while always retaining Title', () => {
    const preferences = columnPreferences({
      title: { visible: false, width: -50 },
      artist: { width: 99999 },
      album: null,
      duration: { width: 'wide' },
      unknown: true,
    })
    expect(preferences.title).toEqual({ visible: true, width: 140 })
    expect(preferences.artist.width).toBe(800)
    expect(preferences.album.width).toBe(220)
    expect(preferences.duration.width).toBe(88)
    expect(columnPreferences(null)).toEqual(columnPreferences())
    expect(columnWidth('title', NaN)).toBe(260)
    expect(columnWidth('title', 301.2)).toBe(301)
  })
  it('shares one CSS grid between the header and virtual rows, omitting hidden columns', () => {
    const preferences = columnPreferences()
    preferences.artist.visible = false
    const layout = columnLayout(preferences)
    expect(layout['--song-grid']).not.toContain('--song-artist-width')
    expect(layout['--song-grid']).toContain('--song-title-width')
    expect(layout['--song-min-width']).toContain('--scrollbar-width')
  })
  it('formats duration without fractional seconds, preserving long tracks', () => {
    expect(songDuration('0:03:24.000')).toBe('03:24')
    expect(songDuration('1:05:24.200')).toBe('1:05:24')
    expect(songDuration('3:24')).toBe('3:24')
    expect(songDuration('')).toBe('-')
  })
})
