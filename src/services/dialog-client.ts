import { invoke } from '@tauri-apps/api/core'

interface MusicFolderPickerOptions {
  defaultPath?: string
  multiple: boolean
}

export function pickMusicFolders(options: MusicFolderPickerOptions): Promise<string[]> {
  return invoke('pick_import_directories', {
    defaultPath: options.defaultPath,
    multiple: options.multiple,
  })
}
