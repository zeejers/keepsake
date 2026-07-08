# Keepsake

A fast, keyboard-first password manager for KeePass `.kdbx` files. Cross-platform desktop app built with Tauri v2 + Vue 3.

- **Three-pane layout** (Buttercup-style): groups on the left, entries in the middle, details on the right
- **Multiple vaults** open at once in tabs (`⌘1…⌘9` to switch, `⌘O` to add)
- **Create new databases** (kdbx4 / Argon2id) or open existing ones — kdbx 3 & 4 via [kdbxweb](https://github.com/keeweb/kdbxweb)
- **Keyboard-first**: `⌘K` fuzzy search across titles, usernames, URLs, and notes; `⌘N` new entry in the current group; `⌘C`/`⌘B` copy password/username; `?` for the full cheat sheet
- **Click-to-copy** any field; notes stay blurred until revealed, and selecting a range of notes copies just that part
- **File attachments**: view, add, save, and remove entry binaries (kdbx4 binary pool, deduplicated)
- **Multi-select** with `⌘`-click / `⇧`-click / `⌘A`, plus a right-click context menu (edit, copy, open URL, delete)
- **Auto-save**: every change is written to disk moments after you make it — no explicit save step
- **Dropbox vaults**: connect once, browse your `.kdbx` files, open and auto-save over the Dropbox API — works the same on desktop and Android. Conflict-safe: if the remote file changed underneath you, your version is saved as a Dropbox conflict copy instead of clobbering it
- Clipboard auto-clears 30s after copying a secret
- A `.bak` of the database is written next to local files on every save (Google Drive sync is planned)

## Development

```bash
make install   # npm install
make dev       # run the app (tauri dev)
make check     # typecheck TS + cargo check
make build     # production bundles (dmg/app/msi/deb)
```

Requires Node 20+ and a Rust toolchain (for Tauri).

### Try it

Generate a demo vault, then unlock it with password `demo`:

```bash
node scripts/make-demo.mjs   # writes demo.kdbx
make dev
```

`node scripts/smoke-kdbx.mjs` runs a headless round-trip test of the crypto layer (create → save → reload, wrong-password rejection).

## Shortcuts

| Keys | Action |
| --- | --- |
| `⌘K` / `⌘F` | Search entries and groups (fuzzy; includes usernames, notes, URLs) |
| `⌘N` | New entry (in the selected group) |
| `⌘⇧N` | New group |
| `⌘E` / `Enter` | Edit selected entry |
| `⌘↵` | Save entry (while editing) |
| `⌘C` / `⌘B` / `⌘U` | Copy password / copy username / open URL |
| `↑` `↓` / `⇧↑` `⇧↓` | Move between entries / extend selection |
| `⌘Click` / `⇧Click` / `⌘A` | Toggle / range / select all |
| `⌘1…⌘9` | Switch vault tab |
| `⌘O` | Open another vault |
| `⌘⌫` | Move selection to trash |
| `⌘S` | Save database to disk (manual — auto-save is on) |
| `⌘L` | Close current vault |
| `?` | Shortcut cheat sheet |

On Windows/Linux, use `Ctrl` instead of `⌘`.

## Releasing

`.github/workflows/release.yml` builds macOS (arm64 + x86_64), Windows, and Linux bundles via `tauri-action` and attaches them to a draft GitHub release whenever a `v*` tag is pushed. macOS signing/notarization activates when the `APPLE_*` secrets are configured (see the commented env block in the workflow).

## Architecture

```
src/
  lib/kdbx.ts        kdbxweb + argon2 (hash-wasm) glue, multi-vault handles,
                     file I/O via tauri-plugin-fs
  stores/vault.ts    Pinia store; vault sessions (tabs) with per-vault UI state.
                     kdbxweb objects live outside Vue reactivity — the store
                     derives plain view-models keyed on a revision counter
  components/        UnlockScreen (open/create), Sidebar/GroupTreeNode, EntryList,
                     EntryDetail, SearchPalette, HelpOverlay, PromptModal, Toast
src-tauri/           Tauri v2 shell (dialog, fs, clipboard-manager, opener plugins)
```

The Rust side is a plain Tauri shell — all kdbx parsing happens in the webview via kdbxweb, so the same code path can later back a browser or mobile build.

## Dropbox setup

Keepsake talks to Dropbox as an OAuth PKCE public client, so you need a (free) app key:

1. Create an app at [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) — "Scoped access", "Full Dropbox" (or "App folder" to sandbox it), any name.
2. On the app's Permissions tab enable `files.metadata.read`, `files.content.read`, and `files.content.write`.
3. In Keepsake's Dropbox tab, paste the App key, authorize in the browser, and paste back the code Dropbox shows you.

The refresh token is stored locally; no server is involved. To ship builds with your key baked in, set `DEFAULT_APP_KEY` in `src/lib/dropbox.ts`.

## Security notes

- Crypto is delegated to [kdbxweb](https://github.com/keeweb/kdbxweb) (the library behind KeeWeb) with Argon2 via [hash-wasm](https://github.com/Daninet/hash-wasm); key derivation runs in a Web Worker.
- Touch ID stores the master password in the macOS login Keychain (scoped to this app) behind a LocalAuthentication prompt.
- Clipboard contents are cleared 30 seconds after copying a secret.
- This project has **not** been independently security-audited. Use at your own risk.

## License

[MIT](LICENSE)
