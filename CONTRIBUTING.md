# Contributing to Amethyst Launcher

Thanks for taking the time to contribute! Bug reports, feature ideas, docs fixes
and code are all welcome.

## Reporting bugs and requesting features

- Search [existing issues](https://github.com/3aiya/amethyst-launcher/issues) first.
- Use the issue templates - they ask for the details needed to reproduce a problem
  (launcher version, Minecraft version, mod loader, and logs).
- For security problems, **do not open a public issue** - see [SECURITY.md](SECURITY.md).

## Development setup

1. Install [Node.js](https://nodejs.org/) 22+, [Rust](https://rustup.rs/) and the
   [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
2. Fork and clone the repository.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

## Making changes

1. Create a branch from `main`: `git checkout -b fix/short-description`.
2. Keep pull requests focused - one fix or feature per PR.
3. Make sure everything still builds:

   ```bash
   npm run typecheck
   cd src-tauri && cargo clippy
   ```

4. Test your change in the running launcher. If it touches launching, try at least
   one Vanilla, one Fabric and one Forge instance.
5. If you change a command's types, update both `shared/ipc-types.ts` and
   `src-tauri/src/types.rs` so they stay in sync.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add NeoForge support
fix(launch): handle missing natives on 1.8.9
docs: clarify build steps
```

## Code style

- **Rust:** match the surrounding code; prefer `anyhow::Result` in services and return
  `Result<_, String>` from Tauri commands.
- **TypeScript/React:** function components and hooks, Tailwind for styling,
  and call the backend only through `src/lib/tauri-bridge.ts`.
- Never commit API keys, signing keys or other secrets.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
