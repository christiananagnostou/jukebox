import { describe, expect, it } from 'vitest'

import type { Song } from '~/App'
import { organizeFiles } from './Files'

const song = (path: string, id: string): Song => ({
  id,
  path,
  file: path.split(/[\\/]/).at(-1) || '',
  title: id,
  album: '',
  artist: '',
  genre: '',
  bpm: 0,
  compilation: 0,
  date: '',
  encoder: '',
  trackTotal: 0,
  trackNumber: 0,
  codec: '',
  duration: '',
  sampleRate: '',
  side: 0,
  startTime: 0,
  favorRating: 0,
  dateAdded: '',
  visualsPath: '',
})

describe('organizeFiles', () => {
  it('reuses shared directories and attaches each song to its leaf', () => {
    const root = organizeFiles([
      song('/music/Artist/Album/one.flac', 'one'),
      song('/music/Artist/Album/two.flac', 'two'),
    ])

    const album = root.children[0].children[0].children[0]

    expect(root.children).toHaveLength(1)
    expect(album.children.map((child) => child.song?.id)).toEqual(['one', 'two'])
  })

  it('supports Windows-style paths', () => {
    const root = organizeFiles([song('C:\\Music\\Artist\\track.flac', 'track')])

    expect(root.children[0].name).toBe('C:')
    expect(root.children[0].children[0].children[0].children[0].song?.id).toBe('track')
  })
})
