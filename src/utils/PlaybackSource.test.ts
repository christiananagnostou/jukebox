import { describe, expect, it } from 'vitest'

import type { Song } from '~/App'
import { playbackSourceCopy } from './PlaybackSource'

function song(id: string, album = 'Kind of Blue', artist = 'Miles Davis'): Song {
  return {
    id,
    album,
    artist,
    bpm: 0,
    codec: 'flac',
    compilation: 0,
    date: '1959',
    dateAdded: '',
    duration: '00:05:37',
    encoder: '',
    favorRating: 0,
    file: `${id}.flac`,
    genre: 'Jazz',
    path: `/music/${id}.flac`,
    sampleRate: '44100',
    side: 0,
    startTime: 0,
    title: id,
    trackNumber: 1,
    trackTotal: 1,
    visualsPath: '',
  }
}

describe('playbackSourceCopy', () => {
  it.each([
    [{ kind: 'album', label: 'Kind of Blue' }, 'From Kind of Blue', 'Continuing this album'],
    [{ kind: 'artist', label: 'Miles Davis' }, 'More from Miles Davis', 'Continuing this artist selection'],
    [{ kind: 'playlist', label: 'Late Night' }, 'From Late Night', 'Continuing this playlist'],
    [{ kind: 'collection', label: 'Recently played' }, 'From Recently played', 'Continuing this collection'],
    [{ kind: 'folder', label: 'Jazz' }, 'From Jazz', 'Continuing this folder'],
    [{ kind: 'library', label: 'Library' }, 'From your library', 'Continuing your current library order'],
  ] as const)('describes an explicit %s source', (source, heading, description) => {
    expect(playbackSourceCopy(source, [song('one')])).toMatchObject({ heading, description })
  })

  it('recovers an album label when restored playback has no source metadata', () => {
    expect(playbackSourceCopy(undefined, [song('one'), song('two')])).toMatchObject({
      heading: 'From Kind of Blue',
      description: 'Continuing this album',
    })
  })

  it('falls back to the library for a mixed restored selection', () => {
    expect(playbackSourceCopy(undefined, [song('one'), song('two', 'Blue Train', 'John Coltrane')])).toMatchObject({
      heading: 'From your library',
      description: 'Continuing your current library order',
    })
  })
})
