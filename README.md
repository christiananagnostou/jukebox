# 🎵 Jukebox 🎵

Jukebox is a music player desktop application capable of managing your precious digital music library. It provides a sleek and intuitive interface for users to manage and play their music collection. Jukebox offers a seamless music playback experience with a host of features to support audiophiles and chill listeners alike.

## Features

- [x] Cross-platform - Windows, MacOS, and Linux.
- [x] Bulk Music Import
- [x] Music playback
- [x] Advanced Search
- [x] Keyboard Shortcuts
- [ ] Playlists
- [ ] Remote Library Connection
- [ ] Audio visualization

## Installation

To install and run Jukebox locally, follow these steps:

1. Clone the repository:
```
git clone https://github.com/ChristianAnagnostou/jukebox.git
```

2. Navigate to the project directory:

```
cd jukebox
```

3. Install the required node dependencies:
```
npm install
```

5. Start the Tauri application for development or production:
```
npm run tauri dev
```
```
npm run tauri build
```

Now you should have Jukebox up and running on your local machine.

## Configuration

Jukebox can be configured using the `~/.jukebox.json` file located your home directory. You can customize settings such as the music library path, theme, and default audio output.

## Contributing

Contributions to Jukebox are welcome! If you want to contribute to the project, please follow these steps:

1. Fork the repository on GitHub.
2. Create a new branch from the `master` branch.
3. Make your changes and commit them with descriptive messages.
4. Push your changes to your forked repository.
5. Submit a pull request to the `master` branch of the original repository.

Please ensure that your contributions align with the project's coding style.

## License

Jukebox is licensed under the [MIT License](LICENSE). Feel free to modify and distribute the application as per the terms of the license.

## Acknowledgments

Jukebox is built using the following open-source libraries and frameworks:

- [Tauri](https://tauri.app/): A framework for creating lightweight and secure desktop applications using web technologies.
- [Qwik](https://qwik.dev/): A fast and efficient framework for building web applications using Typescript and server-side rendering.
