import type { FileNode, Song } from '~/App'

interface ContentFileType {
  type: 'audio' | 'video' | 'txt' | 'image' | 'unsupported'
  extension: string
}

export function isAudioFile(filename: string): boolean {
  return filename.match(/\.(mp3|ogg|aac|flac|wav|m4a)$/) !== null
}
export function isVideoFile(filename: string): boolean {
  return filename.match(/\.(mov|mp4|webm|mkv|avi)$/) !== null
}
export function isImageFile(filename: string): boolean {
  return filename.match(/\.(jpg|png|webp)$/) !== null
}
export function isTextFile(filename: string): boolean {
  return filename.match(/\.(txt|rtf|md)$/) !== null
}

export function getContentFileType(filename: string): ContentFileType {
  const extensionMatches = filename.match(/\.[0-9a-z]+$/i)
  const extension = extensionMatches ? extensionMatches[0] : 'unsupported'
  if (isAudioFile(filename)) {
    return {
      type: 'audio',
      extension,
    }
  } else if (isVideoFile(filename)) {
    return {
      type: 'video',
      extension,
    }
  } else if (isImageFile(filename)) {
    return {
      type: 'image',
      extension,
    }
  } else if (isTextFile(filename)) {
    return {
      type: 'txt',
      extension,
    }
  }
  return {
    type: 'unsupported',
    extension,
  }
}

export function organizeFiles(songs: Song[]): FileNode {
  const root: FileNode = { name: '/', children: [], level: 0, isClosed: false, hidden: false }

  for (const song of songs) {
    const pathParts = song.path.split('/')
    let currentNode = root
    let level = 0

    for (const part of pathParts) {
      if (!part) continue
      let childNode = currentNode.children.find((node) => node.name === part)
      level++

      if (!childNode) {
        childNode = { name: part, children: [], level, isClosed: false, hidden: false }
        if (song.file === part) childNode.song = song
        currentNode.children.push(childNode)
      }

      currentNode = childNode
    }
  }
  return root
}
