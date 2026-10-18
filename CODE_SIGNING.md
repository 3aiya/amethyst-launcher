# Code signing policy

Amethyst Launcher's Windows installers are digitally signed so that Windows can
show who published them and confirm the file has not been altered since it was
built.

> **Status:** code signing through the SignPath Foundation is being set up.
> Until it is live, installers are **not** signed. Every release's notes say
> whether its installer is signed.

This policy is also published on the project website at
<https://launcher.amethystcommunity.net/#code-signing>, with the privacy policy
at <https://launcher.amethystcommunity.net/privacy>.

> Free code signing provided by [SignPath.io](https://about.signpath.io),
> certificate by [SignPath Foundation](https://signpath.org)

Because the certificate is issued by the SignPath Foundation, Windows shows
**SignPath Foundation** as the verified publisher of the installer. The software
itself is developed and maintained by the Amethyst Launcher project.

## Team roles

| Role | Who | What they do |
| --- | --- | --- |
| **Author / committer** | [3aiya](https://github.com/3aiya) | Writes and commits the source code. |
| **Reviewer** | [3aiya](https://github.com/3aiya) | Reviews every pull request from anyone who is not a committer before it is merged. |
| **Approver** | [3aiya](https://github.com/3aiya) | Approves each individual signing request in SignPath. |

All members with access to the source repository and to SignPath use
multi-factor authentication.

## How releases are built and signed

Every published release is produced entirely by the
[release workflow](.github/workflows/release.yml) on GitHub-hosted runners —
nothing is built, signed or uploaded from a maintainer's own machine:

1. A maintainer pushes a `v*` tag. The workflow builds the frontend and the Rust
   backend from that exact commit and packs the MSI installer.
2. The unsigned installer is uploaded as a GitHub workflow artifact.
3. The workflow submits that artifact to SignPath, where a maintainer approves
   the signing request by hand. SignPath verifies that the artifact really came
   from this repository's workflow before it signs anything.
4. The signed installer comes back, gets the updater signature generated over
   it, and is published to the
   [Releases](https://github.com/3aiya/amethyst-launcher/releases) page together
   with `latest.json`.

## Verifying a download

Right-click the downloaded `.msi` → **Properties** → **Digital Signatures**. The
signature must name **SignPath Foundation**. Or, in PowerShell:

```powershell
Get-AuthenticodeSignature ".\Amethyst.Launcher_1.1.1_x64_en-US.msi" |
    Format-List Status, SignerCertificate
```

`Status` must be `Valid`. If Windows reports an invalid or missing signature,
the file did not come from us — delete it and download again from the
[Releases](https://github.com/3aiya/amethyst-launcher/releases) page.

Automatic updates are verified twice: Windows checks the Authenticode
signature above, and the launcher checks a separate
[minisign](https://jedisct1.github.io/minisign/) signature against the public
key compiled into the app, so an update that was tampered with in transit is
rejected before it runs.

## Privacy

Amethyst Launcher is a Minecraft launcher, so it has to talk to a number of
networked systems to do its job. It transfers the following information, and
nothing else:

| Where | What is sent | Why |
| --- | --- | --- |
| `login.microsoftonline.com`, `*.xboxlive.com`, `api.minecraftservices.com`, `api.mojang.com`, `sessionserver.mojang.com` | Your Microsoft sign-in, and the tokens it returns | Signing in to your own Minecraft account. Only when you choose Microsoft sign-in. |
| `piston-meta.mojang.com`, `libraries.minecraft.net`, `resources.download.minecraft.net` | Which Minecraft version you are installing | Downloading the game itself. |
| `meta.fabricmc.net`, `maven.minecraftforge.net`, `files.minecraftforge.net` | Which loader version you are installing | Downloading Fabric / Forge. |
| `api.modrinth.com`, `api.curseforge.com` or `api.curse.tools`, `edge.forgecdn.net` | Your search terms and the content you install | The Browse tab. Only while you use it. |
| `textures.minecraft.net`, `crafatar.com` | The account UUID whose skin is being shown | Rendering skins and capes. |
| Minecraft servers you add | A standard server status ping | The server list's online/player count. |
| `github.com` | Your launcher version | The update check, and downloading updates. |
| `amethyst-launcher-admin.vercel.app` | News and config requests, plus an anonymous usage ping — a random per-install id, the launcher version, your OS, and for a game launch the Minecraft version and loader | News, announcements and rough install/launch counts. **Opt out** under Settings → Privacy; nothing is sent once it is off. |

The usage ping contains no account name, UUID, email address, IP-derived
location, file path or anything else that identifies you, and the random
install id is generated locally and never linked to an account.

Your Minecraft account tokens, skins, instances and game files are stored only
on your own computer, under your user profile. Nothing on that list is uploaded
anywhere.

Discord Rich Presence talks to the Discord desktop app on your own machine over
local IPC; the launcher makes no network request for it. It can be turned off
under Settings → Discord Rich Presence.

Amethyst Launcher does not scan for or exploit vulnerabilities, does not try to
bypass any security measures of the operating system, and does not bundle
advertising, bundled offers or any other unwanted software. It is installed
with a standard MSI package and can be removed at any time from
**Settings → Apps → Installed apps** in Windows.

### Third-party privacy policies

The services above are operated by other organisations and have their own
privacy policies:

- [Microsoft / Minecraft](https://privacy.microsoft.com/privacystatement)
- [Modrinth](https://modrinth.com/legal/privacy)
- [CurseForge (Overwolf)](https://www.overwolf.com/legal/privacy)
- [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
- [Vercel](https://vercel.com/legal/privacy-policy) — hosts our news/config API
- [Discord](https://discord.com/privacy)
- [Crafatar](https://crafatar.com)

## Reporting a problem

Report anything that looks like a misuse of the certificate, or any security
issue, privately as described in [SECURITY.md](SECURITY.md).
