<div align="center">

[<img src="https://raw.githubusercontent.com/hydralauncher/hydra/refs/heads/main/resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra Launcher is an open-source gaming platform created to be the single tool that you need in order to manage your gaming library. Hydra is written in Node.js (Electron, React, Typescript) and Rust, with libtorrent providing the torrent engine.</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)

![Hydra Launcher Home Page](./docs/screenshot.png)

</div>

## Features

- Add games that you own to your library
- Have a nice profile that shows what you are playing to your friends
- Save your game progress in the cloud with Hydra Cloud
- Unlock achievements
- Navigate through a rich catalogue with a powerful suggestion algorithm
- Discover new games that you haven't played before

## What this fork adds

This is a fork of [hydralauncher/hydra](https://github.com/hydralauncher/hydra) with a self-hosted backend via [entitybtw/hydra-selfhosted](https://github.com/entitybtw/hydra-selfhosted).

### Self-hosted backend

- **Your own cloud saves** — save backups stored on your server, not Hydra Cloud
- **Your own account** — register with a username and password on your server
- **Public profile** — shareable profile page at your-server/u/username with play time and game library
- **Web dashboard** — manage your profile, banner, avatar, accent color, and custom CSS from a browser
- **No subscription** — everything works without a Hydra Cloud subscription; all cloud save slots are unlimited
- **Session control** — configure session duration and auto sign-out behavior
- **Cloud Saves v1 / v2 switch** — pick between the legacy server backup flow (v1) and the new Hydra Cloud–style sync (v2) in Settings → Integrations → Cloud Saves

### SteamGridDB integration

- **Custom game art** — browse and apply icons, logos, heroes, and covers directly from SteamGridDB in Game Settings → Assets
- Artwork is served through the official Hydra API out of the box — no key required
- **Optional API key** — set your own SteamGridDB API key in Settings → Integrations → SteamGridDB to use the direct SteamGridDB search

## Dependencies

- Node.js + Yarn
- Rust toolchain (for `hydra-native`)
- Git and a C++ toolchain (Visual Studio C++ Build Tools on Windows, GCC/Clang on Linux, Xcode command-line tools on macOS). The native build obtains CMake and CTest automatically through vcpkg.

The native build includes a Rust wrapper around pinned libtorrent. Development and packaged torrenting no longer require Python.

```bash
yarn install
yarn build:linux   # or build:win / build:mac
```

## Contributors

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## License

The project is licensed under the [MIT License](LICENSE).
