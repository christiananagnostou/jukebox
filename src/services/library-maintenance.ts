import type { Song } from '~/App'
import { getErrorMessage } from '~/utils/Errors'

const PATH_CHECK_CONCURRENCY = 32
const MAX_ERROR_MESSAGE_LENGTH = 200

export interface InaccessibleLibraryEntry {
  id: string
  message: string
}

export interface LibraryPathClassification {
  inaccessible: InaccessibleLibraryEntry[]
  missingIds: string[]
}

export interface LibraryCollections {
  allSongs: Song[]
  playlist: Song[]
  queue: Song[]
}

type LibraryPath = Pick<Song, 'id' | 'path'>
type ExistenceChecker = (path: string) => Promise<boolean>
type DeleteSongs = (ids: string[]) => Promise<void>

function boundedCheckError(error: unknown, path: string): string {
  const message = getErrorMessage(error).trim() || 'Path check failed'
  const redacted = path ? message.split(path).join('[path]') : message
  return redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

export async function classifyLibraryPaths(
  songs: readonly LibraryPath[],
  checkExists: ExistenceChecker
): Promise<LibraryPathClassification> {
  const results = new Array<{ inaccessible?: InaccessibleLibraryEntry; missingId?: string }>(songs.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < songs.length) {
      const index = nextIndex++
      const song = songs[index]
      try {
        if ((await checkExists(song.path)) === false) results[index] = { missingId: song.id }
        else results[index] = {}
      } catch (error) {
        results[index] = {
          inaccessible: {
            id: song.id,
            message: boundedCheckError(error, song.path),
          },
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PATH_CHECK_CONCURRENCY, songs.length) }, worker))

  return {
    inaccessible: results.flatMap((result) => (result.inaccessible ? [result.inaccessible] : [])),
    missingIds: results.flatMap((result) => (result.missingId ? [result.missingId] : [])),
  }
}

export async function commitLibraryRemoval(
  collections: LibraryCollections,
  ids: string[],
  persistDeletion: DeleteSongs
): Promise<LibraryCollections> {
  await persistDeletion(ids)
  if (!ids.length) return collections

  const removed = new Set(ids)
  return {
    allSongs: collections.allSongs.filter((song) => !removed.has(song.id)),
    playlist: collections.playlist.filter((song) => !removed.has(song.id)),
    queue: collections.queue.filter((song) => !removed.has(song.id)),
  }
}
