# T3 Code borrow list for Agni (code-audited)

Companion to `docs/t3code-analysis.md` (2026-10-30, source-level deep dive on the T3 UI and provider layer). Every "Agni today" claim below was re-verified against Agni's actual code on 2026-10-31, not taken from `README.md` or `AGNI.md`, because both are stale (see section 7). Earlier versions of this file undercounted shipped work; the corrections are listed first so the borrow decisions can be trusted.

- Source of truth: https://github.com/pingdotgg/t3code (MIT, ~33k stars), read at the `docs/**` and `apps/server/src/orchestration-v2/**` level on 2026-10-31.
- Agni reference points: `src/modules/**`, `src-tauri/src/modules/**`, `src/settings/**` (code), `README.md` + `AGNI.md` (stale, treated as history only).

---

## 0. Corrections from the previous version

The prior list trusted docs that describe an older Agni. What the code actually says:

| Stale claim | What the code actually has | Evidence |
|---|---|---|
| "One ACP process at a time" | Multiple concurrent ACP processes. Rust keeps a session table keyed by `session_id`; the frontend keeps a client map keyed by agent + profile + cwd + workspace scope, with a 10 minute idle TTL and dispose lifecycle. Sessions persist across app restarts. | `acp.rs` `SessionTable = Arc<Mutex<HashMap<u64, Arc<AcpSession>>>>`; `acp-agent/session/registry.ts` (`getOrCreateAcpSession`, `ACP_IDLE_TTL_MS`); `agent-panel/lib/agentSessions.ts` |
| "No fanout" | Fanout send exists end to end. Composer offers multi-model sends; sessions open per model with a prompt attached. | `app/App.tsx` `handleAgentFanout`; `acp-agent/AcpPanel.tsx` `onFanout`, `fanoutOpen`, `fanoutSelection`; `acp-agent/session/client.ts` |
| "No permission modes / P1" | The full four-mode system exists with alias mapping per agent and a fallback chain that resolves each policy onto the closest mode the agent actually advertises. | `acp-agent/lib/runtimeModes.ts` (`AGNI_RUNTIME_MODES`, `MODE_ALIASES`, `FALLBACK_ORDER`) |
| "Provider instances missing / P1" | Profiles already cover custom config dirs, home dirs, and env vars, with admission control on credential-bearing dirs (T3's `withAccess` analogue) and read-only account probes for known harnesses. | `settings/sections/ProfilesSection.tsx` (`configDir`, `homeDirectory`, `env`); `profile_lock.rs` (`profile_acquire` / `profile_release` / `profile_locks`); `profile_probe.rs` fixed allowlist for claude / opencode / kilo / commandcode / hermes |
| "ACP Registry onboarding missing / P1" | Registry-driven install exists: download specs with sha256 verification, or install specs (npx / uvx style), manifest handling, size and timeout caps, install / uninstall / installed queries. Settings exposes it. | `acp_registry.rs` (`acp_registry_install`, `acp_registry_uninstall`, `acp_registry_installed`); `settings/sections/AcpDiscoverySection.tsx` |
| "Usage feature missing / P0" | A Rust usage engine plus a settings dashboard exist. It scans Claude Code JSONL (streaming snapshots deduped), CommandCode JSONL, OpenCode sqlite, and Hermes, with period and grain bucketing. | `usage.rs` (`UsageEvent`, `UsageReport`, provider labels, `scan_dir` over `~/.claude/projects` and `~/.commandcode/projects`); `settings/sections/UsageSection.tsx` + `usageData.ts` |
| "Harness list: Pi + OpenCode + Kilo" | Managed catalog is five agents: OpenCode, Kilo Code, CommandCode, Claude Code (npx), Hermes; plus arbitrary custom ACP commands. Cargo has more support modules than AGNI.md documents: encrypted secrets, HTTP client, JSONL parsing, pets. | `acp.rs` `ACP_AGENTS`; `modules/secrets.rs`, `http.rs`, `jsonl.rs`, `pets.rs` |

Agent surface known to the Rust side today: `opencode`, `kilo`, `commandcode`, `claude`, `hermes` (managed), plus user-added custom ACP commands. T3 also ships Codex, Cursor, Grok, Antigravity, Pi, Muse drivers; Codex-style JSONL is the one usage source worth adding first.

---

## 1. What T3 Code is, in one screen

T3 Code is an **agent harness control surface**, not a code editor. It has no embedded editor at all. A server process owns the provider processes, terminals, git, and filesystem; web, desktop, and mobile clients are renderers over a scoped RPC contract. It drives Claude Code, Codex, Cursor, Grok Build, OpenCode, Antigravity, Pi, Muse, and any agent from the ACP Registry.

Its edge over Agni today is not process concurrency (we have that) but three things: **state that survives restarts with event-sourced replay**, **limits awareness** (quota windows, auto-resume after a limit, snooze until reset), and **history plumbing** (checkpoints with rewind, worktrees per thread, thread-as-context chips). Almost every remaining borrow idea serves one of those three.

---

## 2. Full comparison by domain

Legend: `done` = ships today, `keep` = Agni advantage, `P0/P1/P2` = borrow priority, `skip` = do not borrow.

| Domain | Agni today (verified) | T3 Code | Verdict |
|---|---|---|---|
| Harness catalog | Five managed agents + custom ACP commands, installed via registry with sha256 or package spec; account probes per agent | 10 drivers + any ACP Registry agent, auto-install, post-install auth probe | done (core); borrow: probe parity for new harnesses P2 |
| Concurrency | Multiple concurrent ACP processes keyed agent+profile+cwd+scope, idle TTL, sessions persist across restarts; single global Pi session | Same, server-side, per-instance full scoping | done (mostly); P1: allow multiple sessions per same-agent key |
| Permission modes | Four modes with per-agent alias mapping and fallback chain | Same four modes + per-thread and project defaults | done (core); P1: project-level mode default |
| Queue / steer | Editable queued runs, steer mid-run, Pi queue modes, queue persists | Queue as server objects, scheduled sends, follow-up default | done |
| Prompt recall / stash | ArrowUp recall + prompt history | Recall + Ctrl+S stash (draft with attachments survives thread switch) | P0: stash |
| Large-paste guardrail | Secret redaction done; composer is a plain textarea, no size handling | Paste over 32 KiB becomes a file attachment; 120k chars with compact-and-send | P0 |
| Usage dashboard | Rust engine over Claude Code / CommandCode / OpenCode / Hermes; settings page with periods, grains, buckets | Same sources + Codex + Cursor API; cost estimates; model breakdowns | P0: cost model + Codex source; P1: model breakdown |
| Limits / quotas | None | Pooled 5h and weekly windows, reset times, /usage-limits inline, auto-resume after limit, snooze until reset | P0: windows + reset presentation; P1: auto-resume + snooze via queue |
| Context meter | Usage parsed per message but no meter chip in composer | Token / percent chip per thread, compaction hint | P0 (cheap, data already exists) |
| Compaction UX | Compaction advertised in v1 capability | Auto-compact-after setting, Compact chip after prompt-cache expiry, compact idle threads before cache expires | P1 |
| Checkpoints / rewind | None | Hidden git refs snapshot per message, rewind dialog with "Revert files too" | P1 (needs Rust git-refs work) |
| Worktrees | None (git ops only reference worktrees internally) | New worktree per thread, branch picker, base compare | P1 |
| Scratch threads | Must open a folder | Scratch threads in a home cache dir, "Turn into project" later | P1 |
| Thread-as-context chip | None | Drag a thread into composer; transcript read on demand | P1 |
| Terminal excerpt chip | None (terminal has agent detection already) | Select terminal output, insert as context chip | P1 |
| Text gen services | None | Titles, commit messages, PR descriptions, review guides via a provider instance | P0: commit message generation first |
| Source control | Local git complete: status, branches, stage, commit, push, history | Plus 7 forges, PR create / review / watch / stacks | P2: GitHub via gh CLI first |
| Session lifecycle UI | Tab status dots, rename / fork / clone / export | Pin / settle / snooze, auto-settle rules, Working section, message search | P2 |
| Side chats | None | /side threads with "Bring back" summary | P2 |
| Handoff on switch | Fork exists (capability-gated) | Explicit context handoff artifacts when switching harnesses mid-thread | P1 |
| Native session import | Only sessions this app started | Import Claude / OpenCode native sessions | P1 |
| MCP | `mcpServers` transmitted as empty (v1 requirement) | Per-session MCP config, MCP Apps cards, Agni-as-MCP-server, `t3 thread` CLI | P1: config UI; P2: server + CLI |
| Multi-question elicitation | One-shot form modal per request | Stacked multi-question panel with pending queue | P1 |
| HTML visual replies | Markdown + separate html-preview tab | In-thread themed sandboxed HTML pages | P2 (reuse html-preview) |
| File viewer in chat | Attach images | In-chat code / MD / CSV / PDF / ZIP viewer | P2 |
| Remote access | None (local desktop only) | Cloudflared pairing, LAN QR, Tailscale, SSH, web + mobile | P2 strategic |
| Accessibility | Not purposed | Complete VoiceOver / NVDA pass, Live Region | P0 (batch with other P0s) |
| Testing infra | Unit tests + manual protocol probing | Replay fixtures per provider for free UI dev | P1 |
| A11y / paste / elicitation extras | n/a | Attached-question options (single-select plan today; richer options) | P1 |
| Editor | CodeMirror 6 + vim, split, format saved | none | keep (differentiator) |
| Terminal | xterm.js + OSC 7/133 detection, WSL | Ghostty WASM core | keep (already better fit) |
| Secrets / auth | Encrypted secret store, redaction patterns, env-var secrets, admission control on profile dirs | Secret store, per-route scoped tokens, token precedence chain | done (core); P2: precedence chain |
| Pets / HTTP client / updater | Shipped | none | keep (personality) |

---

## 3. P0 borrow list (next sprint)

Small, high-visibility deltas. All are frontend-most or a single Rust helper:

1. **Context usage chip in the composer** (`agent-ui/Composer`): show token / percent per thread from the usage you already parse (`agent-panel/lib/usage.ts`, terminal OSC 777 ACP messages). One line of state, one chip.
2. **Cost estimates in UsageSection** (P0-only): small price table keyed by provider + model parsed from existing events; show cost next to tokens in `usageData.ts` aggregation.
3. **Codex sessions in usage.rs**: parse Codex JSONL history the same way as Claude; folds directly into existing emitters.
4. **Limits windows**: present 5h / weekly quota windows with reset times in `UsageSection.tsx`. The ACP status and usage feeds that pile into `usage.ts` already carry status information; add a small parser for provider status payloads and keep this presentation-only in settings first.
5. **/usage-limits inline**: same windows data surfaced inline in the panel header chip. Same plumbing as 4; both are presentation.
6. **Prompt stash (Ctrl+S)**: stash current draft (text only for v1) when leaving a thread; restore on return; store alongside prompt history (`agent-ui/lib/promptHistory.ts`).
7. **Large-paste guardrail**: in `AgentComposerTextarea`, when a paste exceeds a threshold (32 KiB), offer "attach as file" by writing a workspace-bound temp path in the workspace and sending as an attachment instead.
8. **Commit message generation**: reuse the Pi agent (the codebase already has `pi.rs` and it runs headless with a `pi` program) to draft a message from staged changes inside `SourceControlPanel`; one button.
9. **A11y pass**: labels for every icon button, aria-live region for streaming messages, focus management for the elicitation modal.

## 4. P1 borrow list (next cycle)

1. **Project-level mode default**: persist selected `AgniRuntimeMode` per workspace and apply on new sessions before any start; per-session chip already exists. Files: `acp-agent/lib/runtimeModes.ts`, `agent-panel`.
2. **Compaction UX**: surface a Compact chip when prompts near context budget (long threads) and an optional auto trigger after N tokens. Requires the chip from 3.1 and session mode events you already receive.
3. **Checkpoints + rewind ("Edit from here")**: Rust helper in `git` module: per assistant turn head, write a hidden ref (for example `refs/agni/lunch/<session>/<turn>`) for staged + committed state; on rewind, restore files for that turn (or restore into a scratch branch). Needs the session message map you already have (`agentSessions.ts`).
4. **Worktrees**: "Open a worktree" from the session panel: `git worktree add` in the Rust layer, scoped to sessions; sessions keyed by cwd get their own pattern (you already key by cwd).
5. **Scratch threads**: drop the workspace requirement: sessions with a home cache dir as cwd and a "Turn into project" action that moves the thread to a chosen path.
6. **Thread-as-context chip**: attach another session as a context chip; read transcript on mention (transport only reads sessions this app owns: everything in `agentSessions.ts` is already estimable).
7. **Terminal excerpt chip**: select text in the terminal preview; a small "add to composer" affordance turns the selection into a chip with the command and output prefix.
8. **Handoff on harness switch**: when switching threads across agents, fork the thread with an explicit handoff prompt placed in the new session; aligns with the existing fork capability. T3's V2 service does this with dedicated artifacts; our v1 is prompt simple.
9. **Native session import**: load Claude / OpenCode native sessions by parsing their stores in Rust (reuse `jsonl.rs` patterns); surface in the same session list.
10. **MCP config UI**: settings section that writes provider-specific MCP definitions (`mcpServers` entries) into profile env; stop sending `[]` where the target supports real lists.
11. **Multi-question elicitation**: queue requests per session instead of one modal at a time; show a pending stack in the panel so the model's follow-up questions never block silently.
12. **Replay fixtures**: record one conversation per managed agent into fixtures under the test tree; a dev script replays them against the UI for free testing without live agent costs.

## 5. P2 borrow list (later)

- Session lifecycle polish: pin / settle / snooze, auto-settle (idle time, PR merged), Working section grouping, message search.
- Side chats (/side) with "Bring back" summary.
- GitHub integration via `gh` CLI: PR create / link / review / watch; PR chips in the composer.
- MCP apps cards and Agni-as-MCP-server + `agni thread` CLI.
- HTML visual replies in-thread (currently a separate tab; the tab is fine for now, an in-panel iframe can reuse `html-preview`).
- File viewer in chat (PDF, ZIP, CSV).
- Remote access: T3 Connect style pairing (cloudflared / Tailscale) behind a feature flag; large surface, do only with a specific user request.
- Token precedence chain for GitHub auth (PAT vs gh CLI credential vs stored secret).

## 6. Do NOT borrow

- **T3's architecture wholesale**: Agni is a desktop editor with its own process model. Do not copy orchestration-v2 or the server/client split; our Tauri app is already the persisted server (sessions survive restarts, secrets sync weirdness avoided). Borrow features, not architecture.
- **Their provider driver forks**: we have a clean ACP client; do not fork Claude/Codex/whatever source to add features we can resolve from capabilities.
- **Rebuilding usage parsing in the UI**: the Rust engine is the right home; do not duplicate file scanning inside the browser process.
- **Virtualized filesystem ideas**: our editor and sessions are rooted in the real filesystem passed through `workspaceScopeKey` and `fs::tree`; a virtual FS would fight CodeMirror, the file watcher, and user mental models.

---

## 7. Follow-ups outside this file

Stale documentation found during the audit (they say "one process at a time" and enumerate fewer modules than exists):

- `README.md`: features list. Rewrite concurrency claims and inventory.
- `AGNI.md`: architecture map. Mentions `acp-agent/store.ts` (gone); omits `usage.rs`, `acp_registry.rs`, `profile_lock.rs`, `profile_probe.rs`, `profile_storage.rs`, `secrets.rs`, `http.rs`, `acp_terminal.rs`, `pets.rs`.
- `docs/t3code-analysis.md`: contains the same stale claim plus a diffs list now invalidated by shipped work.

---

## 8. Roadmap snapshot

| Phase | Contents |
|---|---|
| P0 sprint | Items 3.1 to 3.9 (context chip, usage cost + Codex source, limits windows, usage-limits chip, stash, paste guard, commit gen, a11y) |
| P1 cycle | Items 4.1 to 4.12 (mode default, compaction, checkpoints, worktrees, scratch threads, thread chip, terminal chip, handoff, native import, MCP config, multi-question, replay fixtures) |
| Later | Section 5 |

Suggested P0 order by dependency: 3.1 (chip, one day) -> 3.7 (paste guard, independent) -> 3.6 (stash, independent) -> 3.3 (Codex source) -> 3.2 (cost) -> 3.4 + 3.5 (limits need 3.3 data path validated) -> 3.8 (commit gen) -> 3.9 (a11y batch).

---

## Appendix A: T3 Code doc map (primary sources read)

- `docs/user/faq.md` (capability inventory)
- `docs/orchestration-v2/README.md` (event-sourcing core)
- `docs/user/permission-modes.md` (mode matrix + defaults)
- Checkpointing chapter (CheckpointStore.ts, Diffs.ts, CheckpointDiffQuery.ts; hidden refs; revert with restore dialogs)
- `docs/user/composer.md` (120k limit, 32 KiB paste attachment rule, prompt stash)
- Threads chapter (worktrees, scratch threads, lifecycle states, drag-to-attach, fanout)
- `docs/user/source-control.md` (forge matrix, per-turn changed files, stacks)
- Side chats chapter (/side, Bring back)
- `docs/user/context-handoffs.md` (ContextHandoffServiceV2 artifacts, provider switch within a thread)
- `docs/user/providers-acp.md` (registry agents, custom ACP, probes)
- `docs/user/providers-claude.md` (per-account CLAUDE_CONFIG_DIR runtime isolation; matching our profile system's design)
- `docs/user/usage.md` (usage + Limits: JSONL sources, Codex history, OpenCode sqlite path, Cursor dashboard API, pooled windows, auto-resume)
- `docs/user/outside-agents.md` (MCP on /mcp with OAuth scopes; `t3 thread` CLI)
- `docs/user/remote-access.md` (T3 Connect via cloudflared, LAN QR, Tailscale HTTPS, pairing tokens)
- `docs/user/html-renders.md` (in-thread HTML pages)
- `docs/user/question-attachments.md` (asked question options)

## Appendix B: verification commands used in this audit

```
rg -n "SessionTable|AcpSession|session_id" src-tauri/src/modules/acp.rs
rg -n "fanout" src/app/App.tsx src/modules/acp-agent
rg -n "MODE_ALIASES|FALLBACK_ORDER" src/modules/acp-agent/lib/runtimeModes.ts
rg -n "claude|opencode|kilo|commandcode|hermes" src-tauri/src/modules/usage.rs
rg -n "worktree|checkpoint" src-tauri/src/modules/git
Get-ChildItem src/settings/sections
rg -n "install|manifest.json|sha256" src-tauri/src/modules/acp_registry.rs
```
