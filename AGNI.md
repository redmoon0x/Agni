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
- `fs::replace::fs_replace`: project-wide regex replace. `dryRun` previews matches, apply writes atomically and emits `fs:file-written` so open editors reload.
- `git::commands::*`: full source-control surface. All gated through the workspace authorization registry.
- `github::*`: GitHub via the user's own `gh` CLI login, never a token Agni stores. `github_available` probes install/auth, `github_pr_status` reads the branch's PR and check rollup (`gh pr view --json`), and `github_pr_create` opens a PR. `gh` runs with no shell, bounded output and a 25s timeout; repo roots are authorized first.
- `shell::shell_run_command`: one-shot subshell exec. On Windows via PowerShell, on Unix via `$SHELL -lc`.
- `shell::run_stdin_command`: runs one program directly with a buffer piped to stdin. Used by the opt-in external linter; same authorization and timeout rules.
- `format::format_text`: opt-in format-on-save. Pipes the buffer to a formatter already on PATH (biome, prettier, rustfmt, gofmt, ruff) and returns stdout; no-ops when the tool is absent.
- `workspace::*`: `workspace_authorize` / `workspace_current_dir` plus the WSL bridge.
- `agent::*`: Claude Code hook installer (writes OSC 777 notification hooks into `~/.claude/settings.json`).
- `pick_folder::pick_folder`: native OS folder picker dialog for "Open Folder".
- `open_settings_window`: separate webview window for Settings.

### PTY shell integration

PTY shells are bootstrapped via injected init scripts in `src-tauri/src/modules/pty/scripts/`:

- **Unix** (`zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh`, `bashrc.bash`, `init.fish`) — emit OSC 7 (cwd) and OSC 133 A/B/C/D (prompt boundaries + exit code) so the host can track cwd and detect command boundaries.
- **Windows** (`profile.ps1`) — wraps the user's `prompt` function to emit OSC 7 + OSC 133 A/B/D.

### Agent detection

`pty/agent_detect.rs` scans PTY output for OSC 133;C (command start) and OSC 777 markers from Claude Code hooks. Detects these agents by binary name: `claude`, `codex`, `pi`, `opencode`, `agy`, `gemini`, `hermes`. Emits `agni:agent-signal` events consumed by the frontend notification system. Zero cost when no agent runs.

### Frontend (`src/`)

Single-window React app. Path alias `@/*` → `src/*`. Tabs are a tagged union (`kind`: `terminal` | `editor` | `preview` | `markdown` | `git-diff` | `git-history` | `git-commit-file`) and **not** unmounted on switch — they're hidden via `invisible pointer-events-none`.

Every pane sits under a `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) and uncaught errors funnel through `reportError` (`src/lib/errors.ts`), which logs to console + the native log and raises a throttled toast.

### Module layout

- **terminal/** — `TerminalStack` with xterm.js WebGL renderer. `osc-handlers.ts` parses OSC 7 + OSC 133. The xterm color palette is driven by the central theme engine.
- **editor/** — CodeMirror 6. Supports vim mode, prebuilt themes, an optional two-pane split (`editor.split`, Mod+\\), opt-in format-on-save, and opt-in inline diagnostics from an external linter (`lib/externalDiagnostics.ts`). Both opt-ins are preferences that default off.
- **explorer/** — file tree with Catppuccin icons, fuzzy search, keyboard nav.
- **search/** — workspace content search (`fs_grep`) with a toggleable replace row backed by `fs_replace` (preview then apply).
- **preview/** — auto-detected dev-server preview tab.
- **tabs/** — `useTabs` is source of truth for tab list + active id, plus `secondaryId` for the editor split.
- **header/** — top bar + inline search. `NotificationBell` for agent alerts.
- **statusbar/** — bottom bar, `CwdBreadcrumb`, workspace env selector.
- **shortcuts/** — keymap registry + `useGlobalShortcuts`.
- **settings/** — settings store, preferences hook, settings window.
- **sidebar/** — activity bar + collapsible side panels (threads, explorer, search, source control).
- **source-control/** — git status / stage / commit panel and diff workflow. `useSourceControl` revalidates on window focus, on `fs:file-written` / `fs:changed` events, and by a 3s poll while a git view is on screen, so the change list does not go stale while the app stays focused. A refresh requested during an in-flight read is queued and re-run instead of dropped, and `reusableRoot` compares paths across git's forward slashes and native spellings. `git_status` merges `git diff --numstat -z HEAD` into each changed file (`additions`/`deletions`), shown as `+N -N` on rows and used by the per-turn changed-files card; the status bar shows the current branch and warns when the terminal cwd is outside the tracked repo.
- **git-history/** — commit graph rail, refs, per-commit file diffs.
- **markdown/** — markdown preview renderer with Lezer syntax highlighting.
- **workspace/** — workspace environment switching (Local + WSL distros).
- **theme/** — custom theme engine. `ThemeProvider` + `applyTheme` write CSS variables; built-in presets (`agni-default`, nord, tide, catppuccin, tokyo-night, caffeine, gruvbox, sage, rose-pine), user themes via `customThemes.ts`.
- **updater/** — auto-updater UI.
- **agent-panel/** — the T3-style agent surface. `AgentDock` hosts every open conversation; `ThreadsSidebar` is the left rail list of open threads grouped by workspace with live harness titles; `AgentPicker` (harness + model, with a disposable-session probe) starts sessions. Harness, account and model are chosen inside the panel, not the sidebar. Thread UI state (pins, renames, last-visited timestamps, MRU order, collapsed folders) is persisted to localStorage under `agni:thread-ui:v1` by `lib/threadUiStore.ts`, keyed by the stable tab key rather than the per-launch numeric tab id. Session identity itself (agent, cwd, profile, model) stays in the settings store (`agentSessions`). The composer's "Spin up" picker hands the current prompt to another harness as a fresh thread (`onSpawnAgent`), so one harness can delegate a task to a different one.
- **agents/** — terminal agent notifications. `agentStore.ts` tracks sessions, `route.ts` routes notifications (OS-notify when unfocused, toast when focused-but-hidden), `NotificationBell` in header. Terminal detection is Rust-side (`pty/agent_detect.rs`).
- **acp-agent/** — ACP client (Agent Client Protocol) speaking v1 and v2 over stdio. `store.ts` owns the JSON-RPC lifecycle (batch frames, version negotiation, session list/load/resume/fork/delete), `acpState.ts` is the pure `session/update` reducer, `elicitation.ts` parses the JSON-Schema form surface, `terminalAuth.ts` renders the shell line for `type: "terminal"` auth methods. Agent-owned terminal display is polled through the Rust `acp_terminal_*` commands.
- **command-palette/** — `Cmd+Shift+P` command palette.

### ACP client notes

- Negotiates `protocolVersion` 1 or 2 per connection and shapes payloads to the negotiated version.
- v2 specifics: `session/prompt` acknowledges insertion (completion arrives as an idle `state_update`), tool calls are upserts with omit/`null`/value patch semantics, `plan_update` nests entries under a `planId`, agent terminals stream base64 `terminal_output_chunk` frames and `terminal_update` snapshots, diffs carry `changes[]` plus an optional git `patch`, permissions use a required `title` plus a `tool_call` or `command` `subject`.
- v1 specifics: `clientCapabilities.session.notices` and `clientCapabilities.session.compaction` must be advertised or agents must not send `notice`, `compaction_update` or `compaction_summary_chunk`.
- Model selection has two shapes: a `model` config option (`session/set_config_option`) or an ACP `SessionModelState` catalog (`session/set_model`). The config option wins when an agent sends both, and `session/set_model` is only sent to agents that advertised a catalog.
- `session/fork` is a draft RFD, gated on the agent advertising `session: { fork: {} }`.
- OMP ACP sessions forward existing user and project `~/.omp/agent/mcp.json` / `<workspace>/.omp/mcp.json` configurations as ACP `mcpServers` on new, load, resume and fork. OMP disables its on-disk MCP discovery in ACP mode. Other agents still receive an empty array for ACP v1 (required), and omit the field for v2. WSL OMP MCP forwarding is not yet supported.
- `_meta` is read but never sent: ACP makes it optional and implementations must not assume its contents, so no extension payload is advertised.
- Unknown enum and union values are preserved rather than dropped (`rawMode`, `{ type: "unknown" }` subjects) so a future ACP variant can still be replayed or proxied.

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
