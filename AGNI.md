# AGNI.md

Agni loads `AGNI.md` from the workspace root as agent memory (similar to AGENTS.md / CLAUDE.md). This file is also the project's living architecture doc — read it before making changes.

## Project

**Agni** — fast, lightweight terminal emulator. Tauri 2 + Rust (`portable-pty`) backend, React 19 + TypeScript + xterm.js (webgl) client.

- Bundle id: `app.crynta.agni`
- Package manager: **pnpm**
- Platforms: macOS, Linux, Windows
- Frontend checks: `pnpm lint`, `pnpm check-types`, `pnpm test`
- Rust checks: `cd src-tauri && cargo clippy && cargo test --locked`

## Quality bar

- **Correctness**: edge cases, failure modes, concurrent access.
- **Performance**: ultra-lightweight. Unused features consume zero resources.
- **Security**: validate at every boundary (IPC, fs, network).
- **UI/UX**: polished, professional. Every state and detail considered.
- **Architecture**: new or changed logic lives in pure, dependency-light functions; tauri commands and React components stay thin.

Verify before claiming done: `pnpm lint`, `pnpm check-types`, `pnpm test`, `cargo clippy`, `cargo test --locked`.

## Conventions

- **Comments**: default to none, the code should explain itself. If needed, 1-2 lines on *why*, never *what*.
- **No em-dash** anywhere: code, comments, commits, docs.
- **No emojis** anywhere.
- **Imports**: always `@/...` on the frontend, never relative across modules.
- **pnpm only**, never npm/npx/yarn.

## Architecture

### Two-process model

**Rust (`src-tauri/`)** owns all OS access. The webview never touches the FS, processes, or shells directly — everything goes through `invoke()` calls to commands registered in `src-tauri/src/lib.rs`:

- `pty::pty_*` — long-lived interactive PTY sessions (xterm ↔ portable-pty), managed by `PtyState` (`RwLock<HashMap<id, Session>>`). Output streams via a Tauri `Channel<PtyEvent>`.
- `fs::tree::*`, `fs::file::*`, `fs::mutate::*`: file explorer + editor IO.
- `fs::search::*`, `fs::grep::*`: fuzzy file finder + content search (powered by `ignore` + `grep-*` crates).
- `git::commands::*`: full source-control surface. All gated through the workspace authorization registry.
- `shell::shell_run_command`: one-shot subshell exec. On Windows via PowerShell, on Unix via `$SHELL -lc`.
- `workspace::*`: `workspace_authorize` / `workspace_current_dir` plus the WSL bridge.
- `agent::*`: Claude Code hook installer (writes OSC 777 notification hooks into `~/.claude/settings.json`).
- `pick_folder::pick_folder`: native OS folder picker dialog for "Open Folder".
- `open_settings_window`: separate webview window for Settings.

### PTY shell integration

PTY shells are bootstrapped via injected init scripts in `src-tauri/src/modules/pty/scripts/`:

- **Unix** (`zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh`, `bashrc.bash`, `init.fish`) — emit OSC 7 (cwd) and OSC 133 A/B/C/D (prompt boundaries + exit code) so the host can track cwd and detect command boundaries.
- **Windows** (`profile.ps1`) — wraps the user's `prompt` function to emit OSC 7 + OSC 133 A/B/D.

### Agent detection

`pty/agent_detect.rs` scans PTY output for OSC 133;C (command start) and OSC 777 markers from Claude Code hooks. Detects these agents by binary name: `claude`, `codex`, `pi`, `opencode`, `agy`, `gemini`. Emits `agni:agent-signal` events consumed by the frontend notification system. Zero cost when no agent runs.

### Frontend (`src/`)

Single-window React app. Path alias `@/*` → `src/*`. Tabs are a tagged union (`kind`: `terminal` | `editor` | `preview` | `markdown` | `git-diff` | `git-history` | `git-commit-file`) and **not** unmounted on switch — they're hidden via `invisible pointer-events-none`.

### Module layout

- **terminal/** — `TerminalStack` with xterm.js WebGL renderer. `osc-handlers.ts` parses OSC 7 + OSC 133. The xterm color palette is driven by the central theme engine.
- **editor/** — CodeMirror 6. Supports vim mode and prebuilt themes.
- **explorer/** — file tree with Catppuccin icons, fuzzy search, keyboard nav.
- **preview/** — auto-detected dev-server preview tab.
- **tabs/** — `useTabs` is source of truth for tab list + active id.
- **header/** — top bar + inline search. `NotificationBell` for agent alerts.
- **statusbar/** — bottom bar, `CwdBreadcrumb`, workspace env selector.
- **shortcuts/** — keymap registry + `useGlobalShortcuts`.
- **settings/** — settings store, preferences hook, settings window.
- **sidebar/** — activity bar + collapsible side panels (explorer, source control).
- **source-control/** — git status / stage / commit panel and diff workflow.
- **git-history/** — commit graph rail, refs, per-commit file diffs.
- **markdown/** — markdown preview renderer with Lezer syntax highlighting.
- **workspace/** — workspace environment switching (Local + WSL distros).
- **theme/** — custom theme engine. `ThemeProvider` + `applyTheme` write CSS variables; built-in presets (`agni-default`, nord, tide, catppuccin, tokyo-night, caffeine, gruvbox, sage, rose-pine), user themes via `customThemes.ts`.
- **updater/** — auto-updater UI.
- **agents/** — terminal agent notifications. `agentStore.ts` tracks sessions, `route.ts` routes notifications (OS-notify when unfocused, toast when focused-but-hidden), `NotificationBell` in header. Terminal detection is Rust-side (`pty/agent_detect.rs`).
- **command-palette/** — `Cmd+Shift+P` command palette.

### UI conventions

- **shadcn/ui** configured (`components.json`, base `mist`, icon lib **hugeicons**).
- **Tailwind v4** — config in `src/App.css` via `@theme`.
- Animation: `motion` (Framer Motion successor). Resizable layout: `react-resizable-panels`.
- Path imports: always `@/…`, never relative across modules.
- Cross-platform paths: canonical form is forward-slash.

### Window styling

- macOS: `titleBarStyle: Overlay` + `hiddenTitle: true`.
- Linux/Windows: `decorations: false` + `transparent: true`, custom `WindowControls`.

### Cross-platform conventions

- HOME / cache dirs: use the `dirs` crate.
- Shell init scripts: gate Unix-only logic behind `#[cfg(unix)]`.
- Terminal input: send `\r` (CR) for Enter, not `\n` (LF).

### Bundle config

- `bundle.targets: "all"` with per-platform sections in `tauri.conf.json`.
- Auto-updater configured with a public minisign key at release artifacts URL.
