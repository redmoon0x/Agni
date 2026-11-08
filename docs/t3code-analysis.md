# T3 Code Analysis — UI Decisions & Borrowable Features for Agni

> Source: https://github.com/pingdotgg/t3code.git (cloned, deep-read at component/protocol level)
> Compared against: Agni 0.8.2 (Tauri 2 + React 19, `src-tauri` + `src`)
> Date: 2026-10-30

---

## 1. What T3 Code is (and what it is *not*)

T3 Code (Ping.gg) is an **agentic harness control surface**, not a code editor. Key structural fact:

- **It has no embedded text editor.** Files always open via an `OpenInPicker` (VS Code, Cursor, Zed, JetBrains, Finder…). The app is built around agents doing work while a human reviews.
- Desktop = Electron shell (`apps/desktop`) + pure React SPA (`apps/web`). The SPA is served-and-embedded; state lives in a local **server process** (`apps/server`) owning provider processes, terminals, git, and the filesystem.
- A **`packages/contracts`** package owns every cross-boundary type (RPC, thread, provider, settings). The UI never guesses network JSON shapes.
- Providers (harnesses): Claude Code, Codex (app-server protocol), Cursor (SDK), Grok Build, FX, OpenCode, Pi, Muse, Antigravity + **any agent from the official ACP registry**. That last one is your "any harness you want" plan, already shipped in production.

**Why their AI panel feels better than ours:** it rests on a *typed, event-sourced orchestration core* (`orchestration-v2`: `Orchestrator.ts`, `ProjectionStore`, `ProviderTurnStartService`, etc.) so the panel never owns protocol state; it only renders projections. Our panel (`acp-agent/AcpPanel.tsx` + `store.ts`) mixes protocol state, session lifecycle, and rendering in ~4 modules of 46–74KB each. The panel gap is mostly an *architecture* gap, then a *feature* gap.

---

## 2. Provider architecture for "any harness, any provider" (your plan)

T3's layering (all path refs verified in-repo):

```
UI (apps/web + apps/desktop)
   │ typed RPC (packages/contracts/src/rpc.ts) + client atoms (client-runtime)
   ▼
apps/server orchestration-v2 ── ProviderAdapterRegistryV2 (per-instance adapters)
   ▼
ProviderInstanceRegistry  ← settings.providerInstances (reconcile + health refresh)
   ▼
Provider drivers (packages/provider-*)
   ├─ ACP path: makeAcpAdapterV2 → AcpSessionRuntime → effect-acp (NDJSON JSON-RPC over stdio)
   └─ Native path: Cursor SDK, Codex app-server, OpenCode HTTP, Pi/Muse protocols
```

### The four pieces worth copying

**2.1 One giant ACP factory + per-agent "flavor" instead of per-agent code.**
`packages/provider-acp/src/server/adapter.ts` — `makeAcpAdapterV2` is a single ~7000-line factory used by *every* ACP harness. Per-harness quirks live in an `AcpAdapterV2Flavor` config (~45 optional hooks, declared in `AcpAdapterV2Options`, lines 429 & 220-372 of `adapter.ts`): `buildPrompt`, `rewriteUserText`, `supportsImagePrompts` (Grok lies about image support → override), `sessionModeForPolicy` (maps T3's 4 permission modes to the harness's native mode), `extractPermissionQuestion`, `permissionDisposition`, `interruptPromptOnCancel`, `restartRuntimeAfterInterrupt`, `followAgentWorkState`, and more. Orchestration code stays generic; quirks stay declarative.
**For Agni:** our `acp.rs` + `agent.ts` hardcode 5 launch descriptors and treat all ACP agents identically (which is why edge behavior — e.g. Claude Code's per-mode differences via the Zed bridge — comes out flattest). A first-class move is turning `ACP_AGENTS` into *descriptors with a small quirk object* rather than pure launch strings.

**2.2 Registry-driven distribution: install any ACP agent automatically.**
`packages/provider-acp-registry/src/server/AcpRegistrySupport.ts` (77KB): downloads the ACP registry index with **sha256 integrity checks**, resolves each agent to `{kind: "binary" | "npx" | "uvx", args, env, binaryTarget}` (preference `auto → binary → npx → uvx`), manages a local binary cache, and resolves errors into `AcpRegistryOperationError {reason, authMethods?, authAction?}`.
**For Agni:** we already fetch the registry JSON (`acp.rs`, 2MiB cap) and expose it read-only in `settings/sections/AcpDiscoverySection.tsx` — the user has to copy an install command by hand. T3's "Add provider → pick from registry → auto-resolve install (binary/npx/uvx) → onboard" flow removes the entire manual step.

**2.3 The probe pattern: one disposable session tells you everything.**
`probe.ts` (`probeAcpRegistryConfiguration`) launches a throwaway ACP session to enumerate **auth methods** (`agent | env_var | terminal`, with command/envVar/link), **models** (capped 256), session config options, slash commands, skills, and `nativeSessions` ability (`canList/Load/Resume/Delete`). This is why their provider setup pages always show *real* options instead of guesses.
**For Agni:** our availability probe is CLI-presence-based with a 60s TTL cache (`agent-panel/installedAgents.ts`), and model lists come from live sessions only. A post-install disposable-session probe would let the Settings page show auth methods and models before the first chat.

**2.4 Provider instances = a first-class entity, report honest capability flags.**
Their wire `ServerProvider` shape (`packages/contracts/src/server.ts:206-268`) carries `supportedRuntimeModes`, `supportsConversationRollback`, `nativeSessions`, `setup.canAuthenticate/canInstall`, `versionAdvisory`, `usageLimits`, `slashCommands`, `skills`, plus a `ForwardCompatibleArray` envelope so old clients ignore unknown new fields. Instance identity is branded (`acpScopedNativeId("provider-instance:<id>:<nativeId>")`) so tool calls from parallel instances never collide.
**For Agni:** we currently allow **one ACP process at a time** (explicit in README). T3 runs arbitrarily many instances concurrently, each a `Scope`-managed process, with per-thread routing by `instanceId`. Supporting ≥2 concurrent ACP agents (Pi already runs concurrently with one ACP agent today) is the single biggest unlock for "fleet"-style use.

### Other provider-layer patterns to steal (bulk list)

| Pattern | Where in T3 | Agni takeaway |
|---|---|---|
| Dev replay agent | `ProviderInstanceRegistryHydration.ts` seeds a `devReplay` provider that runs `scripts/dev-replay-agent.ts` — a free ACP agent replaying **recorded turn transcripts** | Build an Agni dev-replay ACP agent from our own session exports; UI dev with no tokens and deterministic sessions |
| Recorded transcripts as test suite | `apps/server/src/orchestration-v2/testkit/` real NDJSON fixtures (multi_turn, turn_interrupt_mid_tool, tool_call_denied_write, plan_questions, …) + `DeterministicRuntime` | Our `acp.rs` behaviors are only probed manually; transcript replay would pin protocol behavior to tests |
| Credential-rotation admission control | `ProviderAdapterRegistryV2` wraps `openSession` in peer `auth.withAccess` guards so sign-in flips fail fast | We do terminal-auth sign-in (`terminalAuth.ts`) with no guard against switching/auth while a session holds the credential |
| Settings forms from schema annotations | `makeProviderSettingsSchema` + `providerSettingsForm` annotations — adding a settings field auto-renders the form | Our settings sections are hand-built; a small schema-defaults system would stop duplicating forms per provider |
| Health refresh loop | provider snapshots reconcile on a 5-min interval + PubSub push to clients | Our agent availability probe is on-demand only |
| Windows process-tree kill via `taskkill /T /F` | `AcpSessionRuntime.ts` | We already use Job Objects — T3 validates the same conclusion; keep ours |
| Linux cgroup + OOM-score wrapping for agent spawns | `wrapCommandForLinuxCgroup` | Relevant to our **WSL workspaces** (`workspace.rs`) if we ever spawn agents inside the distro |

---

## 3. UI decisions in T3 Code (the catalog)

### 3.1 Shell & layout

1. **The chat view never unmounts.** `apps/web/src/components/ChatView.tsx` (3,900 lines) is mounted permanently; thread switches feed it a `routeThreadKey`, and Settings routes render **as modals over the chat**, replacing the view. Rationale in code: thread switching must not rebuild expensive message surfaces or clobber composer state. *Agni's AgentPanel is part of the `App.tsx` layout too, but our session switching approach re-keys heavier tree state; the "never remount + thin route wrappers" pattern is worth adopting.*
2. **Four-region workspace:** titlebar (frameless; `hiddenInset` on macOS, `titleBarOverlay` with theme-synced WCO colors on Windows — see `apps/desktop/src/window/DesktopWindow.ts`, `workspaceTitlebar.ts`) / left thread sidebar (`Sidebar.tsx`, 3,500 lines, reorderable with dnd-kit, per-thread status dot + elapsed timer + **drag a thread onto the composer to mention it**) / center chat column with a fixed composer / right panel.
3. **Right panel is a typed state machine, not a pile of booleans:** `RightPanelKind = diff | files | file | preview | device | terminal | pull-request | pull-requests` with inline-vs-hidden presentation at the `max-width: 980px` mobile breakpoint, plus a **maximize-inline mode** that replaces the chat column while a floating mini-composer keeps the thread reachable (`RightPanelTabs.tsx`, `rightPanelLayout.ts`). *Agni's equivalents: `right-docked AgentPanel` + `TerminalDock` bottom, but our git/PR/diff surfaces live as editor tab kinds, not a right rail next to chat.*
4. **Per-thread terminals kept alive across navigation.** `ChatTerminalDrawers.tsx` keeps interleaved threads' terminals mounted up to `MAX_HIDDEN_MOUNTED_TERMINAL_THREADS` so switching back to a thread doesn't re-run a shell. *Our terminal dock has pane persistence (`panes.ts`), but it isn't thread-scoped.*

### 3.2 Composer (their deepest, best surface — `ChatComposer.tsx` + `composer-logic.ts`)

5. **Live markdown as you type.** TipTap 3 editor: typing `**bold**` becomes bold immediately, fenced code blocks render syntax-highlighted live with a language chip + "plain text" fallback (`ComposerPromptEditorTiptap.tsx`, `ComposerCodeBlockNodeView`). Mentions/attachments/citations insert as *chips*, not raw text tokens.
   *Ours: plain autosizing textarea — pasted markdown stays as text. This is the most visible daily-use difference between the panels.*
6. **Caret-positioned command menu with ranked sections.** `/` commands, `@` file/PR mentions, `#` PR refs, and skills (currency-glyph trigger as an "@ for keyboards without @", `composerMentionDrag.ts`), rendered as a custom virtualized menu pinned to the caret in `ComposerCommandMenuLayer`, with `aria-activedescendant` and stable highlight while items stream in (`composerMenuHighlight.ts`).
   *Ours: slash palette + `atToken` mentions exist, but the menu renders as a detached dropdown, not caret-anchored.*
7. **Prompt guardrails:** `ComposerPromptLengthValidation` + auto-convert-to-attachment on oversize (>32KiB paste → text-file attachment; >120k chars prompts get a compact-and-send affordance, `ComposerPrimaryActions.tsx`). **Alt+↑/↓ prompt history recall** with unsent-edit preservation (`composerPromptHistory.ts`).
   *Agni has neither; users hit silent ACP 12MiB/long-prompt failures instead.*
8. **Controls bar with "ownership" states** (`ComposerControlsBar.tsx`, `composerControlsOwnership.ts`): model, effort, permission-mode, workspace, git branch, and host controls adapt — the open popover expands while siblings dim, "no dead gray icons ever". Alt+drag reorders controls; order persists. Keyboard shortcuts documented: Mod+M model, +H host, +E effort, +A permissions, and more.
9. **Permission modes as a first-class control** (`runtimeModeConfig.ts`): `Supervised / Auto-accept edits / Auto / Full access` (icons: Lock/PenLine/Sparkles/ShieldOff) with `resolveCompatibleRuntimeMode` fallback when a provider disallows a mode, and mode explanations in the settings docs (`docs/user/permission-modes.md`). *Ours renders ACP session modes as a raw mode picker with no fallback logic or framing.*
10. **Multi-model fanout send.** Select 2+ models in the picker (`useMultipleModelSend.ts`, `draftFanoutSelectionsAtom`) → one send fans out into sibling threads per model, grouped as a `FanoutThreadGroup` in the sidebar, with a rate-limit warning when instances share a key. This is a T3 original; neither Cursor nor Claude Code has it. *Direct fit for our "any harness" positioning: one plan, five harnesses race it.*
11. **Primary action is a state machine, not a send button** (`ComposerPrimaryActions.tsx`): Send / **Queue** (thread busy) / **Steer** (interrupt + send now; Mod+Shift+Enter swaps queue↔steer) / Interrupt-with-clear-queued / Answer-pending-questions / Compact-and-send. Plus **queued runs as editable objects** (`QueuedRunsControl.tsx`): stacked prompts you can edit inline, first-in-queue upgradeable to a steer, scheduled items with a calendar affordance, persisted across reloads.
    *Ours: Pi queue modes (all / one-at-a-time) exist, but the ACP panel has a simple send/queue.* 
12. **Pending-user-input panel** (`ComposerPendingUserInputPanel.tsx`): when the agent asks multiple questions, they render **stacked with "Question 2 of 3" progress**, per-question chips, keyboard choice navigation, collapsible to a chip row. *Our elicitation dialogs are modal one-shots — multi-question turns feel clunky.*
13. **Secret redaction on send:** server event `composer_secrets_changed` strips detected API keys out of outgoing prompts, with a banner explaining the redaction. Cheap, high-trust feature.

### 3.3 Timeline / message rendering

14. **WorkLog: collapse tool bursts into narrated groups.** `TimelineWorkGroupRows.tsx` + `WorkLog.tsx`: consecutive tool calls become one row ("Working", "Ran files…", "Read 14 files") with failure-state icons, expandable to all steps (expanded group re-virtualized). Single most effective "clean chat" decision. *Our `ToolRow.tsx` collapses per-row; a run of 30 tools still dominates the timeline.*
15. **Incremental streaming markdown** (`apps/web/src/markdown-incremental.ts`): caches everything up to the last completed fence and only reparses the tail per token chunk (with CRLF/BOM safety and full-reparse fallback). Solves the streaming-jank problem we have with `streamdown` re-rendering.
16. **Read mode + scroll pinning.** Streaming auto-scrolls only while the user is pinned to bottom; scrolling up unpins and shows a ScrollToEnd button; entering read mode never pauses the agent. We already have a "Latest" chip (`Conversation.tsx`); the unpin/read-mode layer is a small delta.
17. **Timeline minimap** (`TimelineMinimap.tsx`): right-edge draggable scrubber over the whole thread, hover previews messages, jump markers at checkpoints/questions. Unique to T3; genuinely improves 200+ message threads.
18. **Citations on assistant output.** Select assistant text → floating quote toolbar → "Cite" inserts a chip in the composer anchored to the source range, with the source re-rendering as a quote overlay; reconstruction survives compaction (`citationProcedure.ts`). Cursor-grade feature built client-side.
19. **Fork per message:** every assistant message carries a copy + fork action (branch the thread from this point). *Our Pi panel has fork; our ACP panel has session fork but not message-level fork.*
20. **Wait-state honesty at the end of the timeline:** `ThreadNow.tsx` composes one consistent family of status/announcement/sync lines, with `role="alert"` only when user action is required, and invisible finger-sized hit areas on touch.

### 3.4 Safety, checkpoints, diffs

21. **Checkpoint rewind with a 3-way dialog:** each user message is a checkpoint; rewinding opens a confirm with Cancel / **"Revert files too"** / **"Revert and keep changes"** (`RevertConfirmHost`, ChatView). Backed by server `CheckpointService`/`RollbackService`.
22. **Changed-files-per-turn cards** (`ChangedFilesCard` + `ChangedFilesTree`): each turn shows its file tree with +/- totals, expandable to diffs. *Our diffs live in GitDiffPane; the per-turn association to chat is missing — this is the highest-value "agent changed what?" UI we lack.*
23. **Pierre diff engine** (`@pierre/diffs`, `@pierre/trees`) for file trees + annotatable diffs — commercial inspiration: their diff cards use synthetic headers (icon, +/- counts, path breadcrumbs) so tree and cards read identically in chat and PR panels.
24. **No embedded editor at all** — `OpenInPicker.tsx` covers 15+ external editors with per-product icons and Remote variants. This is the biggest *philosophy* divergence from Agni: they chose review-surface over editing surface. Don't copy it; our CodeMirror editor is our differentiator. **But do copy the affordance:** an "Open in VS Code" anywhere is cheap and wins real users.

### 3.5 Feel, sound, a11y

25. **Ghostty WASM terminal engine:** they vendor Ghostty's actual VT core (`libghostty-vt`) compiled to WASM — the terminal is the same engine as the Ghostty project, with Nerd Font symbols matching the UI icons. *We chose xterm.js + WebGL pool — fine; note the bar.*
26. **Sound + notifications with engineering around them:** separate completion/input sounds coalesced through one AudioContext, unlocked on first gesture; dewindows toast tags are fnv1a-hashed because **Windows silently drops toasts with >73-char tags** (real bug, happily commented). Notification modes: off / sound / both; background threads announce identically via voice notifications.
27. **a11y throughout:** aria-live announcements for background threads, focus-trapped overlays with return focus, `motion-reduce` guards on every custom animation, `pointer-coarse` hit-area expansion.
28. **Theming & fonts:** Inter variable subsets self-hosted (no CDN), Tailwind 4 + shadcn-on-Base-UI, semantic color roles used consistently (usage gauges, status-approved, etc.), light/dark/system + per-surface resolved translucency.

---

## 4. Panel feature comparison (Agni vs T3 AI panel)

| Capability | Agni today | T3 Code | Notes |
|---|---|---|---|
| Multi-harness | Pi + ACP (5 launchers), **1 ACP process at a time** | 10 built-in drivers + any ACP-registry agent, many instances concurrent | Agni's core positioning vs their maturity |
| Streaming markdown | streamdown (full re-render) | TipTap live-markdown + incremental tail-parse | Most visible gap in every session |
| Tool rendering | per-row collapse (`ToolRow.tsx`) | WorkLog narrated groups + failure accents | Biggest "clean chat" gap |
| Thinking | collapsible w/ pulse | toggleable reasoning surface per message | We're actually at parity |
| @-mentions | atToken, path mentions | caret menu w/ ranked sections + thread/PR mentions + drag | Close; menu posture missing |
| Slash commands | `/` palette, agent-provided | same + skills + effort + modes in-menu | Close |
| Images | clipboard paste shared w/ Pi | paste + SnapShot (screen-capture + a11y tree) | SnapShot is desktop-only differentiator |
| Permission/approvals | inline + elicitation modal | 4-mode control w/ fallback + pending-question stack panel | T3's mode control is better |
| Model picker | live-session models | favorited + virtualized + capability chips + letter jumps + fanout | Large gap |
| Queue/steer | Pi: modes; ACP: send | editable queued objects, steer-first-in-queue, scheduled runs | Large gap |
| History | compact indicator, session export HTML | prompt-length guardrail, prompt recall, compaction resume tokens | Medium gap |
| Checkpoints | none | per-message rewind w/ revert-files dialog, per-turn change cards | Large gap |
| Right panel | tab kinds: git-diff, git-history, preview, etc. | typed RightPanelKind (diff/files/terminal/PR) + maximize | Philosophical; ours is tab-first |
| Per-thread terminals | dock panes (global) | thread-scoped, kept-alive across nav | Medium delta |
| Sounds/notifications | agent toasts + Claude hooks | coalesced sounds + a11y announcements + toast-tag fix | Medium |
| Native editor | CodeMirror 6 + vim!! | none (open-in) | **Our advantage; keep** |
| WSL workspaces, TCP inspect, HTTP client, preview-annotate | ours | none | **Our advantage; keep** |

**Verdict:** T3's panel is better mostly because (a) every session is a projection of a typed event stream, not mutated zustand state inside one 74KB component, and (b) ~15 UI features we never built (composer live-markdown, WorkLog, queue-as-objects, mode control, checkpoints). Both are closable.

---

## 5. Recommended borrow list (prioritized for Agni)

### P0 — high impact, achievable without re-architecture
| # | Item | Where in T3 | Where in Agni | Effort |
|---|---|---|---|---|
| 1 | **Live-markdown composer** (TipTap + mention chips, code-block language chip; keep textarea fallback) | `ChatComposer.tsx` | `agent-ui/Composer.tsx` (~2-4 weeks shared across Pi + ACP via agent-ui) | M |
| 2 | **WorkLog grouped tool rows** | `TimelineWorkGroupRows.tsx` | `agent-ui/Messages.tsx` + `ToolRow.tsx` (~1wk to collapse consecutive rows; add failure icons) | S |
| 3 | **Prompt guardrails + recall** (length counter→compact/attach pattern, Alt+↑/↓ history per session) | `ComposerPromptLengthValidation`, `composerPromptHistory` | `agent-ui/Composer.tsx` (~2 days) | S |
| 4 | **Permission-mode control** w/ per-agent compatible fallback (`resolveCompatibleRuntimeMode` pattern) mapping to ACP session modes | `runtimeModeConfig.ts` | `acp-agent/` store mode picker (~1wk) | S-M |
| 5 | **Read mode + scroll pinning** on top of our "Latest" chip | `ChatView.tsx` scroll logic | `agent-ui/Conversation.tsx` (small) | S |
| 6 | **Editable queued runs + steer/queue send** (surface already half-exists in Pi modes) | `QueuedRunsControl.tsx`, `ComposerPrimaryActions.tsx` | unify Pi queue modes + ACP send (~2wk) | M |
| 7 | **Secret redaction banner on send** | `redactComposerSecrets` + server event | `acp-agent/lib` send path (~2 days) | S |
| 8 | **"Open in VS Code/Zed" affordance** | `OpenInPicker.tsx` | explorer + tool-row actions (~2 days, Tauri `opener` plugin) | S |

### P1 — structural, unlocks the rest
| # | Item | Why |
|---|---|---|
| 9 | **Per-agent quirk descriptors** (replace `ACP_AGENTS` launch strings with `{command, args[], flavor}` incl. image-support overrides, session-mode mapping, interrupt behavior) | makes every ACP agent behave like a first-class driver; prerequisite for registry onboarding |
| 10 | **2+ concurrent ACP sessions** (session-scope process registry in `acp.rs`, `acpScopedNativeId`-style tool-id scoping) | fleet use; our README's one-process limit is a real positioning penalty |
| 11 | **Registry onboarding flow**: pick agent from `cdn.agentclientprotocol.com` → auto-resolve install (binary/npx/uvx w/ `uvx` fallback) → probe auth/models → done | upgrades `AcpDiscoverySection.tsx` from copy-strings to one-click |
| 12 | **Per-turn changed-files card** linking chat turns → `GitDiffPane` diffs | highest-value "what did the agent change" UI; we have the diff component already |
| 13 | **Message-level fork in the ACP panel** (fork exists in the store; expose per assistant message, surfaces already in Pi panel) | turns every message into a branch point |
| 14 | **Multi-question pending-input panel** (stacked w/ progress chips) | replaces one-at-a-time elicitation modals |
| 15 | **Checks/ checkpoints & rewind** — only if at least one supported harness (opencode?) exposes rollback | big feature; gate on ACP capability probing |

### P2 — polish copy cats
16. Timeline minimap scrubber · 17. Coalesced completion/input sounds + background voice announcements (reuse Claude hooks notify path; hash Windows toast tags if we add native toasts) · 18. Capability-chip model picker w/ favorites + jump-to-letter · 19. Ownership-state controls bar · 20. Provider health 5-min refresh in `installedAgents.ts` · 21. Dev-replay ACP agent from exported sessions for UI testing · 22. Keyboard: Mod+M model, Mod+Shift+Enter queue↔steer swap.

### Explicitly do NOT borrow
- No-embedded-editor philosophy (we win there with CodeMirror + vim).
- Electron/effect/nx-style structure (Tauri's process model already covers process ownership; keep zustand but *thin* it behind a projection layer).
- `@pierre/diffs` (commercial); our `@codemirror/merge` diff is fine.

---

## 6. The one-paragraph architectural lesson

T3's AI panel wins because **the panel is a renderer for a typed event projection, not the state owner.** Every provider quirk is declarative (`Flavor`), every conversation is an event stream (`orchestration-v2`), every wire shape is forward-compatible (`contracts`), and the UI compositions never remount. Agni's fastest path to a "better panel" is not to copy components — it is to (1) promote protocol/session state out of `acp-agent/store.ts` into a reducer-per-source layer (we already do this pattern in `pi-agent/rpcState.ts` — generalize it), (2) add quirk descriptors, (3) keep the multi-agent tab host, then (4) ship the P0 UI list onto the clean base.

---

### Appendix — T3 file index for deep dives

- Layout/shell: `apps/web/src/components/ChatView.tsx`, `ChatRightPanel.tsx`, `ChatTerminalDrawers.tsx`, `chatCanvasLayout.ts`, `rightPanelLayout.ts`, `PanelLayoutControls.tsx`, `app/desktop/src/window/DesktopWindow.ts`, `apps/web/src/workspaceTitlebar.ts`
- Composer: `apps/web/src/components/chat/ChatComposer.tsx`, `composer-logic.ts`, `ComposerPromptEditorTiptap.tsx`, `ComposerCommandMenu.tsx`, `ComposerControlsBar.tsx`, `ComposerControlsOwnership.ts`, `runtimeModeConfig.ts`, `TraitsPicker.tsx`, `ComposerModelPicker.tsx`, `ComposerPrimaryActions.tsx`, `QueuedRunsControl.tsx`, `ComposerPendingUserInputPanel.tsx`, `useMultipleModelSend.ts`
- Timeline: `MessagesTimeline.tsx`, `MessagesTimeline.logic.ts`, `TimelineWorkGroupRows.tsx`, `WorkLog.tsx`, `TimelineAssistantRows.tsx`, `TimelineMinimap.tsx`, `ThreadNow.tsx`, `ChatMarkdown.tsx`, `markdown-incremental.ts`, `AssistantCitationSource.tsx`
- Provider layer: `packages/provider-core/src/{client.ts,server/driver.ts,server/ProviderHost.ts,server/auth.ts}`, `packages/provider-acp/src/server/{adapter.ts,AcpSessionRuntime.ts}`, `packages/provider-acp-registry/src/server/{AcpRegistrySupport.ts,probe.ts,adapter.ts}`, `packages/effect-acp/src/{client.ts,protocol.ts,_internal/stdio.ts}`, `apps/server/src/provider/{builtInDrivers.ts,ProviderInstanceRegistry.ts}`, `apps/server/src/orchestration-v2/{Orchestrator.ts,ProviderSessionManager.ts,ProviderEventIngestor.ts}`
- Contracts: `packages/contracts/src/{server.ts,orchestrationV2.ts,rpc.ts,settings.ts,acpRegistry.ts}`
