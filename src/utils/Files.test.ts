import { describe, expect, it } from 'vitest'

import { getContentFileType, isAudioFile } from './Files'

describe('file types', () => {
  it('recognizes every supported audio extension case-insensitively', () => {
    for (const extension of ['mp3', 'ogg', 'aac', 'flac', 'wav', 'm4a']) {
      expect(isAudioFile(`track.${extension}`)).toBe(true)
      expect(isAudioFile(`track.${extension.toUpperCase()}`)).toBe(true)
    }
  })

  it('classifies known non-audio content without accepting unsupported files', () => {
    expect(getContentFileType('cover.jpg')).toEqual({ type: 'image', extension: '.jpg' })
    expect(getContentFileType('notes.md')).toEqual({ type: 'txt', extension: '.md' })
    expect(getContentFileType('archive.zip')).toEqual({ type: 'unsupported', extension: '.zip' })
  })
})
