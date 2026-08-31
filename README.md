# Jukebox

Jukebox is a compact desktop music player for local libraries. It is built with Tauri v2, Qwik, TypeScript, and Rust.

## Features

- Recursive folder and drag-and-drop import for common audio formats
- Track, artist, album, and folder views
- Search, deterministic sorting, favorites, queueing, and keyboard shortcuts
- Persistent library catalog, album-art cache, and app settings
- Missing-file cleanup and manual library rescans
- System tray playback behavior

## Requirements

- Node.js 22.12 or newer
- Rust 1.93 or newer
- Platform dependencies required by [Tauri v2](https://v2.tauri.app/start/prerequisites/)

## Platform status

Required CI builds and checks Jukebox on Windows x64, macOS, and Ubuntu. Windows CI produces at least one MSI or NSIS installer and scans the raw executable plus bundle files for build-machine paths. Compressed installer payloads are not recursively unpacked, so signed installer launch tests remain part of the release roadmap.

Published installers are not yet signed, notarized, or delivered through an automatic updater.

## Development

```sh
git clone https://github.com/christiananagnostou/jukebox.git
cd jukebox
npm install
npm run tauri dev
```

Useful checks:

```sh
npm run pre-push
```

Build a desktop bundle with:

```sh
npm run tauri build
```

## Local data

Jukebox stores its SQLite catalog, settings, and cached album art in the platform-specific application data directory. The Settings page controls close-on-X behavior and the default music folder, and provides scan and cleanup actions.

## License

Jukebox is licensed under the [GNU General Public License v3.0](LICENSE).
