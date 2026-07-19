<div align="center">

# 💎 Amethyst Launcher

**A modern, all-in-one Minecraft launcher — play instantly, discover mods,
and stay connected with the community.**

*Powered by Amethyst Community · Developed by 3aiya*

</div>

---

Amethyst Launcher is a sleek, dark-themed Minecraft launcher built for
speed and simplicity. Play Vanilla, Fabric, Forge, or our own curated
Amethyst modpack, browse and install content straight from Modrinth, and
jump into the Amethyst Community server — all from one clean interface.

## ✨ Highlights

- 🎮 **One-click play** — Vanilla, Fabric, Forge, and the custom Amethyst
  modpack, each in its own clean, isolated instance.
- 🔍 **Built-in content browser** — search and install mods, modpacks,
  resource packs, data packs, and shaders directly from Modrinth.
- 📚 **Instance library** — every version you play is saved, renameable,
  and ready to relaunch instantly — no reinstalling, no redownloading.
- 🌐 **Amethyst Community server**, front and center, with live status and
  one-click join.
- 🔑 **Sign in with Microsoft** — no extra setup, just click and log in.
- 🎨 **Skins, Discord Rich Presence, and auto-updates** built right in.

## 📥 Download

Grab the latest installer from the
[**Releases**](../../releases/latest) page and run it — that's it. The
launcher checks for and installs updates automatically after that, so
you'll always be on the newest version.

## 🖼️ Screenshots

*(add a few screenshots here once you have some!)*

## 🙌 Credits

**Amethyst Launcher** is powered by the **Amethyst Community** and
developed by **3aiya**.

---

<br>

# Development

The rest of this document covers the technical side — building from
source, configuration, and how everything fits together.

## Stack

| Layer          | Tech                                              |
| -------------- | -------------------------------------------------- |
| Frontend       | Electron + React + TypeScript                      |
| Backend        | Node.js (Electron main process)                    |
| Minecraft core | `minecraft-launcher-core` (MCLC) + `msmc` for auth  |
| Database       | SQLite (`better-sqlite3`) for local settings        |
| Auto update    | `electron-updater`                                  |
| Installer      | `electron-builder`                                  |
| UI             | Tailwind CSS v4 + Framer Motion + lucide-react      |

## Features

- **Version manager** — release/snapshot/old-version listing straight from
  Mojang's manifest, with installed versions marked.
- **Both login modes** — offline profiles, and real Microsoft login through
  `msmc`'s built-in Electron popup flow (uses Mojang's own public client ID,
  so **no Azure app registration needed** — unlike a lot of DIY launchers).
- **Java auto-detect / auto-download** — downloads Mojang's own per-version
  Java runtime automatically; falls back to system Java.
- **Mod loaders** — Fabric installs via a version-json merge (MCLC has no
  native Fabric support, so this recreates what the official launcher does
  internally); Forge installs via MCLC's built-in ForgeWrapper integration.
- **Browse** — search and install mods, modpacks, resource packs, data
  packs, and shaders straight from Modrinth, into whichever instance you
  pick. Installing a modpack (`.mrpack`) creates a brand new, fully
  self-contained instance automatically. See
  [Browse / Modrinth integration](#browse--modrinth-integration) below.
- **News panel** — a small feed + social links panel on the Browse page,
  pointed at a JSON feed you host. See
  [News feed setup](#news-feed-setup) below.
- **Skins** — upload/reset via the official Minecraft Services API
  (Microsoft accounts only).
- **Discord Rich Presence** — shows "Amethyst Launcher" / "Playing
  &lt;version&gt;" on your Discord profile while the game runs, idle
  otherwise. See [Discord Rich Presence setup](#discord-rich-presence-setup)
  below.
- **Servers panel** — a featured card for your primary (Amethyst Community)
  server plus a grid of other servers, each live-pinged for status/player
  count. Hitting Play quick-plays straight into that server via MCLC's
  native `quickPlay` (Minecraft 1.20+; needs the server's IP). The primary
  card always runs whatever Amethyst version is currently selected on the
  Play tab, rather than a fixed version.
- **Amethyst Loader** — a 4th loader option for our own curated modpack,
  hosted on Google Drive. See [Amethyst Loader setup](#amethyst-loader-setup)
  below.
- **Profiles / instances** — every (loader, version) you actually play gets
  its own fully isolated profile: own versions/libraries/mods/config/saves/
  servers.dat, so Vanilla 1.21.1, Fabric 1.21.1, and Amethyst 26.2 never mix
  state. Once a profile is installed, launching it again skips straight to
  play — no redundant re-downloading or re-extracting. Manage them (rename,
  delete) from the **Library** tab.
- **Local settings in SQLite**, no cloud sync, no telemetry.

## Requirements

- Node.js 20+
- A legally owned copy of Minecraft (for Microsoft login / online play)

## Setup

```bash
npm install
npm run dev
```

`npm install` also runs `electron-rebuild` (via `postinstall`) to recompile
`better-sqlite3`'s native binary for Electron's Node ABI — this needs
internet access the first time (it downloads Electron's headers).

`npm run dev` starts the Vite dev server and Electron together with hot
reload for the renderer.

## Building a release

```bash
npm run dist
```

This runs the Vite + TypeScript builds and then `electron-builder`, producing
an installer under `release/` (NSIS on Windows, DMG on macOS, AppImage on
Linux — see the `build` block in `package.json`). This is for testing a
build locally — it does **not** publish anything or notify existing users.

## Publishing updates

The app already has `electron-updater` wired in (`electron/main.ts` calls
`autoUpdater.checkForUpdatesAndNotify()` on startup for packaged builds), but
it needs somewhere to actually check *for* updates. This section is that
missing piece, explained from scratch.

### How it works, conceptually

1. You bump the version number and run one command that builds installers
   **and** uploads them somewhere public, along with a small metadata file
   (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`).
2. Every time someone's copy of the launcher starts, `electron-updater`
   fetches that metadata file, compares the version inside it to the
   currently-running version, and if it's newer, downloads the new
   installer in the background and prompts to restart and install.
3. You don't touch anything on the user's machine — it's all pulled by
   the app itself.

The "somewhere public" is a **publish provider**. The simplest option, and
the one already configured here, is **GitHub Releases** — free, no server to
run, and both `electron-builder` and `electron-updater` support it natively.

### One-time setup

1. Push this project to a GitHub repo (public, or private if you're using a
   token with access — public is simpler since no auth is needed to check
   for updates).
2. Edit the `publish` block in `package.json`:
   ```json
   "publish": {
     "provider": "github",
     "owner": "your-github-username",
     "repo": "your-repo-name"
   }
   ```
3. Create a GitHub **Personal Access Token** (Settings → Developer settings
   → Personal access tokens → generate one with `repo` scope) and set it as
   an environment variable before publishing:
   ```bash
   export GH_TOKEN="ghp_yourtokenhere"   # Windows: set GH_TOKEN=ghp_yourtokenhere
   ```
   `electron-builder` uses this token to create the GitHub Release and
   upload the installers to it — it's only needed on your machine when
   publishing, never shipped in the app.

### Shipping an update

Every time you want to push an update:

1. Bump the version in `package.json` (e.g. `1.0.0` → `1.0.1`). This is the
   number `electron-updater` compares — nothing updates if it doesn't
   increase.
2. Run:
   ```bash
   npm run release
   ```
   This builds the app and runs `electron-builder --publish always`, which
   creates a new GitHub Release tagged with the version, uploads the
   installer(s) plus the `latest*.yml` metadata files, and marks the release
   as published (not a draft).
3. That's it. Anyone with an earlier version running the app will pick up
   the update automatically the next time they open it.

**What the user actually sees**: nothing, until a download finishes — the
check and download both happen silently in the background. Once it's ready,
a small banner appears at the top of the launcher ("Update vX.X.X ready to
install") with a **Restart & update** button; clicking it quits and relaunches
the app with the new version already applied. If they just keep using the
app without clicking it, the update installs automatically the next time
they close and reopen the launcher anyway (`autoInstallOnAppQuit` is on) —
so no one gets stuck on an old version even if they ignore the banner.

If you'd rather review a release before it goes out, use
`--publish onTagOrDraft` instead and manually publish the draft on GitHub
when ready — see [electron-builder's publish docs](https://www.electron.build/configuration/publish)
for the other options (`onTag`, `never`, generic HTTP servers, S3, etc., if
GitHub doesn't fit your setup).

### Code signing (important caveat)

Auto-update works without code signing, but:
- **Windows**: unsigned installers show a SmartScreen warning on first
  install ("Windows protected your PC"). Auto-updates after that still work
  fine — this only affects the first-ever install, not the update flow.
- **macOS**: unsigned/unnotarized apps can hit Gatekeeper issues, and
  `autoUpdater` on macOS specifically requires the app to be signed for
  silent updates to work at all (unsigned Mac builds mostly need to be
  reinstalled manually). Windows and Linux don't have this restriction.

If macOS support matters, you'll eventually want an Apple Developer account
for signing + notarization — not required to get started on Windows/Linux
though.

## Browse / Modrinth integration

The **Browse** tab searches Modrinth's public API directly (no API key
needed for search/browse) across five tabs: Modpacks, Mods, Resource Packs,
Data Packs, Shaders.

- Search results are paginated (20 per page, with Back/Next controls showing
  "X-Y of Z") since Modrinth caps how many results come back in one request.
- **Mods / Resource Packs / Data Packs / Shaders**: hit **Install** on a
  result and a small dialog walks you through it — pick which version, then
  pick which instance to install into (or **Create new instance**, which
  lets you choose the loader/game version from what that version supports).
  It downloads straight into the right folder (`mods/`, `resourcepacks/`,
  `shaderpacks/`). Data packs are placed inside the instance's single world
  automatically if there's exactly one; with zero or multiple worlds it
  stages the file at the instance root instead so you can move it into the
  right save manually.
- **Modpacks**: picking a version installs it immediately as a **brand new
  instance** (matching how every other launcher handles modpacks), named
  after the pack — no instance picker step, since a modpack always gets its
  own instance. It downloads the `.mrpack`, installs the matching
  Fabric/Forge base, downloads every mod the pack lists, and copies the
  pack's `overrides/` (configs, resource packs, etc.) into the new instance
  — all before it shows up ready-to-play in the Library tab.
- Only Fabric- and Forge-based modpacks are supported (Quilt packs install
  using the Fabric base, since Quilt is Fabric-API-compatible for most
  packs; NeoForge isn't supported yet).

If you want the User-Agent Modrinth sees identified as your own project,
edit the `USER_AGENT` constant at the top of
`electron/services/modrinth.ts` — Modrinth asks for a descriptive one but
doesn't require anything beyond that for these endpoints.

## News feed setup

The News panel (right side of the Browse page) reads a JSON feed from
wherever you point it — a GitHub Gist raw URL, a file on your own site,
anywhere reachable over HTTPS. Configure it in
**`electron/services/newsConfig.ts`**:

```ts
export const NEWS_FEED_URL = "https://your-site.example.com/news.json";

export const SOCIAL_LINKS = {
  modrinth: "",
  discord: "https://discord.gg/your-invite",
  twitter: "",
  youtube: "",
  reddit: "",
};
```

The feed itself is just an array:

```json
[
  { "title": "1.2.0 released", "body": "Short summary...", "date": "2026-07-01", "url": "https://..." },
  { "title": "Server maintenance", "body": "...", "date": "2026-06-20" }
]
```

`url` is optional — if present, clicking the item opens it in the browser.
Leave `NEWS_FEED_URL` as the placeholder and the panel just shows "No news
configured yet" instead of erroring. Leave any `SOCIAL_LINKS` entry as `""`
to hide that icon.

## Profiles / instances

Every version you play - Vanilla, Fabric, Forge, or an Amethyst pack - gets
its own profile, stored at:

```
<gameDirectory>/profiles/<loader>-<version>/
```

e.g. `profiles/vanilla-1.21.1/`, `profiles/fabric-1.21.1/`,
`profiles/amethyst-26.2/`. Each one is a fully independent Minecraft
directory (its own `versions/`, `libraries/`, `mods/`, `config/`, `saves/`,
`servers.dat`) — nothing is shared between them except the downloaded Java
runtime cache (kept at the top-level `gameDirectory` since the same JRE
build is reused across profiles).

**First launch** of a given (loader, version) does the full install (Fabric/
Forge/Amethyst pack download+extract+sync, vanilla files, etc.) and then
writes a small `.installed` marker plus a `.profile-meta.json` cache into
that profile's folder. **Every launch after that** reads the cached meta and
jumps straight to "check Java -> launch" — no re-downloading, no
re-extracting, no re-syncing.

The **Library** tab lists every profile that's been created, with when it
was last played, its loader/version, and a Play button. Click the pencil
icon next to a name to rename it, or the trash icon to delete it (this also
deletes that profile's folder on disk, freeing the space).

## How Microsoft sign-in works

Unlike launchers built around `minecraft-launcher-lib` (Python) or similar,
`msmc` ships with Mojang's own official client ID baked in, plus a built-in
Electron popup (`Auth.launch("electron")`) that handles the whole
Microsoft → Xbox → Minecraft token chain for you. No Azure app registration,
no manual redirect-URL copy-pasting — click "Sign in with Microsoft," log in
in the popup, done.

## Amethyst Loader setup

The "Amethyst Loader" isn't a public mod loader - it's our own curated
modpack, hosted as versioned zip files in a **shared Google Drive folder**
(no server, no local folder to keep in sync). Each version is just a zip
named after the Minecraft version it targets, e.g. `1.20.6.zip`,
`1.21.11.zip` — drop in a new one and it shows up as a new entry in the
Version dropdown the next time the list refreshes.

**One-time setup** — edit **`electron/services/amethystRemoteConfig.ts`**:

```ts
export const GOOGLE_DRIVE_FOLDER_ID = "PUT_YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE";
export const GOOGLE_DRIVE_API_KEY = "PUT_YOUR_GOOGLE_DRIVE_API_KEY_HERE";
```

1. Create (or reuse) a Google Cloud project, enable the **Google Drive API**,
   and create an **API key** (APIs & Services -> Credentials -> Create
   Credentials -> API key). Paste it into `GOOGLE_DRIVE_API_KEY`.
2. Share your Drive folder as **"Anyone with the link -> Viewer"**.
3. Copy the folder ID out of its URL
   (`https://drive.google.com/drive/folders/<THIS_PART>`) into
   `GOOGLE_DRIVE_FOLDER_ID`.

That's the only place either value lives.

**Each zip's structure** (all at the zip's root):

```
1.20.6.zip
├── mods/
│   ├── some-mod.jar
│   └── another-mod.jar
├── config/
│   └── some-mod.cfg
└── servers.dat
```

- `mods/` — synced into the instance's mods folder. Whatever the pack put
  there on the *previous* sync gets cleanly removed first if it's no longer
  in the new version — anything you added yourself is left alone.
- `config/` — copied into the instance's config folder (overwrites
  same-named files, same as any modpack installer).
- `servers.dat` — copied in as-is, so the pack's server list shows up in
  Minecraft's own multiplayer screen too.
- The Minecraft version is taken from the zip's filename itself, so name
  each zip exactly after the version it targets. Fabric (latest stable
  loader build) is installed automatically underneath it.

**Multiple versions, different mods** — this is the whole point: select
`1.21.1` in the Version dropdown and you get whatever `1.21.1.zip` contains;
switch to `1.21.8` and you get that zip's mods instead. Nothing is hardcoded
per-version in the app itself — the launcher just lists whatever zips it
finds in the Drive folder, sorted newest-first, and downloads/installs
whichever one you pick.

**Isolated profiles** — each version launches from its own folder under
`<game directory>/profiles/amethyst-<version>/`, with its own mods, config,
saves, and `versions/` — completely separate from every other Amethyst
version (and from Vanilla/Fabric/Forge, which still share the main game
directory). Switching versions can never mix up two packs' mods.

**Auto-update**: the Drive folder is re-listed fresh every time the Version
dropdown refreshes (loader switched to Amethyst, or hitting Refresh) — so
uploading a new `<version>.zip` is all it takes for it to show up, no
restart needed.

Selecting **Amethyst** as the loader works exactly like Vanilla/Fabric/Forge
— pick a version, hit Play, it downloads + installs + launches.


## Discord Rich Presence setup

Rich Presence works out of the box in "off" mode - it silently does nothing
until configured, so nothing breaks if you skip this. To turn it on, edit
**`electron/services/discordConfig.ts`** (the only file you need to touch):

```ts
export const DISCORD_CLIENT_ID = "PUT_YOUR_DISCORD_APPLICATION_ID_HERE";
export const DISCORD_LARGE_IMAGE_KEY = "amethyst_logo_placeholder";
```

1. Create an application at <https://discord.com/developers/applications>
   and copy its **Application ID** into `DISCORD_CLIENT_ID`.
2. Under that application's **Rich Presence -> Art Assets**, upload your
   `image.png` and give it an asset key (e.g. `amethyst_logo`). Copy that
   same key into `DISCORD_LARGE_IMAGE_KEY`.

That's the only place either value lives, so swapping in your final image
later is a one-line change.

Behavior:
- Connects automatically on launcher start; shows "Amethyst Launcher / In
  the launcher" once connected.
- Switches to "Amethyst Launcher / Playing &lt;version&gt;" (or
  "Playing Fabric 1.21.1" / "Playing Forge 1.20.1" for modded) right after
  the game launches, and back to idle when it closes.
- If Discord isn't running (or isn't installed), it fails silently and
  retries every 15 seconds in the background - so it picks up automatically
  if you open Discord after the launcher.
- Cleanly disconnects and clears the activity on quit.

## Project structure

```
amethyst-launcher/
├── electron/                   # Main process (compiled to dist-electron/)
│   ├── main.ts                  # Window creation, auto-update, bootstrap
│   ├── preload.ts                # contextBridge -> window.amethyst API
│   ├── ipc.ts                    # All ipcMain.handle channels
│   ├── db.ts                     # SQLite-backed settings store
│   └── services/
│       ├── auth.ts                # Offline + Microsoft (msmc) login
│       ├── versions.ts            # Mojang manifest + installed versions
│       ├── javaManager.ts         # Java detect/auto-download
│       ├── fabricInstaller.ts     # Fabric version-json merge installer
│       ├── forgeInstaller.ts      # Forge installer jar download (+ MCLC's ForgeWrapper)
│       ├── modsManager.ts         # mods/ folder management
│       ├── skinManager.ts         # Minecraft Services skin API
│       ├── discordConfig.ts       # Discord app id + asset key (edit here)
│       ├── discordRpc.ts          # Discord Rich Presence lifecycle
│       ├── serverPing.ts          # Raw Server List Ping protocol (status/players)
│       ├── amethystRemoteConfig.ts # Google Drive folder id + API key (edit here)
│       ├── amethystPack.ts        # Amethyst modpack: list/download/sync per-version profiles
│       ├── profiles.ts            # Unified profile/instance system (all loaders)
│       ├── modrinth.ts            # Modrinth API: search + get versions
│       ├── contentInstaller.ts    # Installs mods/packs/shaders into a profile, .mrpack modpacks
│       ├── newsConfig.ts          # News feed URL + social links (edit here)
│       ├── news.ts                # Fetches the configured news feed
│       └── launcher.ts            # Orchestrates install + MCLC launch
├── src/                         # Renderer (React + Tailwind + Framer Motion)
│   ├── App.tsx
│   ├── components/
│   │   ├── TitleBar.tsx            # Custom frameless window titlebar
│   │   ├── Sidebar.tsx              # Nav with animated active indicator
│   │   ├── PlayPage.tsx
│   │   ├── LibraryPage.tsx          # Profile/instance list - rename, delete, play
│   │   ├── AmethystLogo.tsx         # Animated SVG crystal logo
│   │   ├── ServersSection.tsx       # Featured server + servers grid
│   │   ├── BrowsePage.tsx           # Modrinth search/install + News panel
│   │   ├── SkinsPage.tsx
│   │   ├── SettingsPage.tsx
│   │   └── LoginModal.tsx
│   └── types/global.d.ts          # window.amethyst typings
└── shared/ipc-types.ts          # Types shared by main + renderer
```

## Notes

- Game files install to `<userData>/minecraft` by default (changeable in
  Settings) — on Linux that's `~/.config/amethyst-launcher/minecraft`.
- Offline mode only works with game files you already legally own, exactly
  like the official launcher's LAN/offline play — this launcher provides no
  way to play without owning the game.
