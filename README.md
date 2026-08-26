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

## Development

```sh
git clone https://github.com/christiananagnostou/jukebox.git
cd jukebox
npm install
npm run tauri dev
```

Useful checks:

```sh
npm test -- --run
npm run lint
npm run build.types
npm run build
npm run fmt.check
cd src-tauri && cargo check --locked && cargo fmt --all -- --check
```

Build a desktop bundle with:

```sh
npm run tauri build
```

## Local data

Jukebox stores its SQLite catalog, settings, and cached album art in the platform-specific application data directory. The Settings page controls close-on-X behavior and the default music folder, and provides scan and cleanup actions.

## License

Jukebox is licensed under the [GNU General Public License v3.0](LICENSE).
