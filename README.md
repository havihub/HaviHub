<p align="center">
  <img src="build/icon.png" alt="" width="112">
</p>

<h1 align="center">Havi Hub</h1>

<p align="center">
  A free and open-source launcher for Minecraft Java Edition, for Windows and Linux.<br>
  <a href="README.es.md">Leer en español</a>
</p>

Havi Hub is a desktop launcher built on top of [Prism Launcher](https://prismlauncher.org), which it uses as its game engine. It keeps your profiles, accounts and settings in one place, and lets you find and install mods and modpacks from CurseForge and Modrinth without leaving the app. The interface is available in Spanish and English.

<p align="center">
  <img src="docs/screenshots/curseforge/en/home.webp" alt="The home page of Havi Hub, in the CurseForge-style layout" width="900">
</p>

## Features

- Two interface layouts to choose from, one similar to the CurseForge app and one similar to the Modrinth app. Both offer the same features.
- Browsing and installing of mods, modpacks, resource packs, shaders, data packs and worlds from CurseForge and Modrinth, with dependencies and updates handled by the launcher.
- Import of profiles from CurseForge, Modrinth and Prism Launcher. Profiles can also be kept in sync with Prism Launcher and with the CurseForge and Modrinth apps, from one window.
- Sign-in with a Microsoft account. Offline accounts, meant for LAN and offline-mode servers, can only be added after signing in with an account that owns the game.
- Settings for each profile (Java, memory, environment variables, launch commands), plus default game options and key bindings that new profiles start with.
- A 3D skin viewer with the game's default skins, a server browser with the best-known servers and Modrinth's list, a screenshot gallery covering every profile, and several themes, seasonal ones included.
- No ads and no telemetry. Havi Hub has no servers of its own: accounts, profiles and settings stay on your computer. The services it connects to are listed in the [privacy policy](https://havihub.github.io/privacy/); the Home page shows the author's social media channels, which load only after the first-start welcome asks about them, and can be set to load only when opened (in the welcome or in Settings → Privacy).

## Screenshots

### CurseForge style

| | |
|---|---|
| ![Creating an instance](docs/screenshots/curseforge/en/new-instance.webp) | ![Browse](docs/screenshots/curseforge/en/browse.webp) |
| Creating an instance: Minecraft version and mod loader. | Mods and modpacks, filtered by game version, loader and category. |
| ![Servers](docs/screenshots/curseforge/en/servers.webp) | ![Screenshots](docs/screenshots/curseforge/en/gallery.webp) |
| The best-known servers and Modrinth's list in one browser. | The screenshots from every profile, with filters. |
| ![3D skins](docs/screenshots/curseforge/en/skins.webp) | ![Importing profiles](docs/screenshots/curseforge/en/import.webp) |
| Your skin in a Minecraft world, with the game's own animations. | Importing profiles from CurseForge, Modrinth and Prism Launcher. |

### Modrinth style

| | |
|---|---|
| ![Creating an instance](docs/screenshots/modrinth/en/new-instance.webp) | ![Browse](docs/screenshots/modrinth/en/browse.webp) |
| Creating an instance: Minecraft version and mod loader. | Mods and modpacks, filtered by game version, loader and category. |
| ![Servers](docs/screenshots/modrinth/en/servers.webp) | ![Screenshots](docs/screenshots/modrinth/en/gallery.webp) |
| The best-known servers and Modrinth's list in one browser. | The screenshots from every profile, with filters. |
| ![3D skins](docs/screenshots/modrinth/en/skins.webp) | ![Importing profiles](docs/screenshots/modrinth/en/import.webp) |
| Your skin in a Minecraft world, with the game's own animations. | Importing profiles from CurseForge, Modrinth and Prism Launcher. |

### Seasonal themes

They turn on by themselves on their dates, in both layouts.

| | CurseForge style | Modrinth style |
|---|---|---|
| **Halloween**<br>October 25 to November 1 | ![Halloween, CurseForge style](docs/screenshots/curseforge/en/season-halloween.webp) | ![Halloween, Modrinth style](docs/screenshots/modrinth/en/season-halloween.webp) |
| **Christmas**<br>December 19 to 26 | ![Christmas, CurseForge style](docs/screenshots/curseforge/en/season-christmas.webp) | ![Christmas, Modrinth style](docs/screenshots/modrinth/en/season-christmas.webp) |
| **New Year**<br>December 27 to January 2 | ![New Year, CurseForge style](docs/screenshots/curseforge/en/season-newyear.webp) | ![New Year, Modrinth style](docs/screenshots/modrinth/en/season-newyear.webp) |

## Download

Installers are published on the [Releases](https://github.com/havihub/HaviHub/releases) page.

| System | File |
|---|---|
| Windows 10 and 11 (64-bit) | `HaviHub-<version>-Setup.exe` (installer) or `HaviHub-<version>-portable.exe` |
| Linux (x86-64), any distribution | `HaviHub-<version>-linux-x86_64.AppImage` |
| Debian, Ubuntu and derivatives | `HaviHub-<version>-linux-amd64.deb` |

The Windows builds are not code-signed yet, so SmartScreen may warn about them the first time they run ("More info", then "Run anyway"). Every release lists the SHA-256 checksum of each file. How the files are built and will be signed is described in the [Code signing policy](https://havihub.github.io/code-signing-policy/).

To play you need a Microsoft account that owns Minecraft Java Edition. On its first start Havi Hub downloads its game engine, which takes about 45 MB.

## How it works

Prism Launcher is not included in the installers. On its first start, Havi Hub downloads the official portable build from the [Prism Launcher releases](https://github.com/PrismLauncher/PrismLauncher/releases), checks it against the SHA-256 checksum published by GitHub, and keeps it up to date from then on, up to the newest release Havi Hub has been tested with (`TESTED_VERSION` in [`src/main/engine.js`](src/main/engine.js)): a newer Prism Launcher is installed once a Havi Hub update says it works. Before using it, Havi Hub replaces the name, logo and sign-in confirmation page that the engine shows, so that its windows match the rest of the app. That change is entirely contained in [`src/main/engine-brand.js`](src/main/engine-brand.js).

Pictures and sounds from the game (the Minecraft logo, blocks, items, skins) are read from the Minecraft files on your computer. If the game has not been downloaded yet, Havi Hub fetches its client file once from Mojang's servers. None of Mojang's images or sounds are included in this repository or in the installers.

Your data is stored in:

- Windows: `%APPDATA%\havihub` (profiles, accounts and settings) and `%LOCALAPPDATA%\havihub` (the engine).
- Linux: `~/.config/havihub`.

On Windows, uninstalling Havi Hub removes the app and its engine but keeps your profiles, worlds and settings.

## Building from source

You need Node.js 22 or newer. Building the Windows installer also needs [Zig](https://ziglang.org) to compile a small helper program (`pip install ziglang` is the simplest way to get it).

```sh
git clone https://github.com/havihub/HaviHub.git
cd HaviHub
npm ci
npm start            # build and run
npm test             # unit tests
npm run dist:win     # Windows installer, portable build and zip, in release/
npm run dist:linux   # AppImage and .deb, in release/ (on Linux)
```

Official releases include Havi Hub's own CurseForge API key, which is kept out of the source code. To build with a key of your own, set the `HAVIHUB_CF_KEY` environment variable before building. Builds without a key work with Modrinth, and users can enter their own CurseForge key under Settings → Addons.

## Contributing

Bug reports, suggestions and pull requests are welcome, in Spanish or English. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security problems should be reported privately, as described in [SECURITY.md](SECURITY.md).

## License

Havi Hub is free software, released under the [GNU General Public License v3.0](LICENSE).
Copyright © 2026 Havikun.

The third-party components included in the app, with their licenses, are listed in the app under Settings → Licences.

## Disclaimer

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Havi Hub is not affiliated with or endorsed by the Prism Launcher project, CurseForge (Overwolf) or Modrinth. Their names and logos are used only to show where content comes from. Minecraft is a trademark of Mojang AB.
