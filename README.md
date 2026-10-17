<div align="center">

<img src="src-tauri/icons/icon.png" alt="Amethyst Launcher" width="120" />

# Amethyst Launcher

**A fast, modern, open-source Minecraft launcher built with Rust, Tauri and React.**

[![Latest release](https://img.shields.io/github/v/release/3aiya/amethyst-launcher?style=flat-square&color=9b5de5)](https://github.com/3aiya/amethyst-launcher/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/3aiya/amethyst-launcher/total?style=flat-square&color=9b5de5)](https://github.com/3aiya/amethyst-launcher/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-9b5de5?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-9b5de5?style=flat-square)](#-download)

[Download](#-download) · [Features](#-features) · [Building](#%EF%B8%8F-building-from-source) · [Contributing](CONTRIBUTING.md)

</div>

---

Amethyst Launcher is a lightweight desktop launcher for Minecraft: Java Edition.
Play Vanilla, Fabric or Forge in clean, isolated instances, discover mods from
Modrinth and CurseForge, manage your skins in 3D, and bring your existing
instances over from other launchers — all from one dark, minimal interface.

## ✨ Features

- 🎮 **One-click play** — Vanilla, Fabric and Forge, each in its own isolated instance.
- 📚 **Instance library** — rename, configure, and relaunch instantly. Manage mods,
  worlds, screenshots and files per instance.
- 🔍 **Content browser** — search and install mods, modpacks, resource packs, data
  packs and shaders from **Modrinth** and **CurseForge**. `.mrpack` import supported.
- 📦 **Import from other launchers** — Prism Launcher, the Modrinth App, ATLauncher,
  and anything using the official `.minecraft` layout.
- 🔑 **Microsoft sign-in** and offline accounts, with multiple accounts on one PC.
- 🧍 **Skins & capes** — a 3D skin viewer, wardrobe, and cape switching.
- ☕ **Automatic Java** — the right Java runtime is downloaded for each version.
- 🌐 **Servers** — live server status and one-click join.
- 💬 **Discord Rich Presence** and ⬆️ **automatic updates**.

## 📥 Download

Grab the latest installer from the
[**Releases**](https://github.com/3aiya/amethyst-launcher/releases/latest) page and
run it. After that, the launcher updates itself automatically.

> Currently Windows (x64) only. The codebase is cross-platform and macOS / Linux
> builds are welcome contributions.

## 🛠️ Building from source

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) (stable)
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
  (on Windows: Microsoft C++ Build Tools and WebView2)

### Run it

```bash
git clone https://github.com/3aiya/amethyst-launcher.git
cd amethyst-launcher
npm install
npm run dev        # start the launcher in development mode
npm run build      # produce a release build in src-tauri/target/release
```

### Optional configuration

| What | Where | Notes |
| --- | --- | --- |
| CurseForge API key | `CURSEFORGE_API_KEY` env var at build time | Get one at [console.curseforge.com](https://console.curseforge.com). Without it, the public `api.curse.tools` mirror is used. |
| Microsoft client ID | [`src-tauri/src/services/auth.rs`](src-tauri/src/services/auth.rs) | Forks should register their own Azure app — see the comment at the top of the file. |
| Discord app, news, admin API | [`src-tauri/src/services/config.rs`](src-tauri/src/services/config.rs) | Leave the placeholders to disable these features. |
| Auto-updater | [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) | Forks must use their own signing key and endpoint, or set `active: false`. |

## 🗂️ Project structure

```
src/                    React + TypeScript frontend
  components/           pages, modals and UI pieces
  lib/tauri-bridge.ts   typed bridge to the Rust commands
shared/ipc-types.ts     types shared between frontend and backend
src-tauri/
  src/main.rs           app entry point and command registration
  src/commands.rs       Tauri command handlers
  src/db.rs             SQLite storage
  src/services/         launching, auth, installers, Modrinth, CurseForge, ...
build-release.ps1       local release script (build, sign, publish)
```

## 🤝 Contributing

Bug reports, ideas and pull requests are all welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR, and report security
issues privately as described in [SECURITY.md](SECURITY.md).

## 📄 License

Released under the [MIT License](LICENSE).

Amethyst Launcher is not an official Minecraft product and is not approved by or
associated with Mojang or Microsoft.

<div align="center">

Made with 💜 by [3aiya](https://github.com/3aiya) and the Amethyst Community

</div>
