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
  const childIndexes = new WeakMap<FileNode, Map<string, FileNode>>()

  for (const song of songs) {
    const pathParts = song.path.split(/[\\/]+/).filter(Boolean)
    let currentNode = root

    for (const [index, part] of pathParts.entries()) {
      let childIndex = childIndexes.get(currentNode)
      if (!childIndex) {
        childIndex = new Map()
        childIndexes.set(currentNode, childIndex)
      }

      let childNode = childIndex.get(part)

      if (!childNode) {
        childNode = {
          name: part,
          children: [],
          level: currentNode.level + 1,
          isClosed: false,
          hidden: false,
        }
        currentNode.children.push(childNode)
        childIndex.set(part, childNode)
      }

      if (index === pathParts.length - 1) childNode.song = song
      currentNode = childNode
    }
  }
  return root
}
