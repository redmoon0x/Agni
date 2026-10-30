# Agni Harness: Pi Substrate with Harness 2 Self-Improvement

Status: proposal, not yet started. References: google-research/harness2 (Apache 2.0,
paper arXiv 2610.14224) and earendil-works/pi (MIT, npm @earendil-works/pi-coding-agent).
This plan builds the self-improving harness layer on pi as the coding-agent substrate.

## 1. Decided: Pi is the substrate, composed not forked

Forking pi was the first instinct. It is the wrong route, and the repo itself
says so: Pi is "a minimal, extensible agent harness that you can make your own",
MIT licensed, with an extension, prompt-template, skills, and package system
built exactly for grafting a harness on top. Autonomous forks of an upstream
that ships near-daily (v1.0.0 to v1.4.0 in under three weeks in Oct 2026) turn
into permanent merge debt.

| Fork | Compose (chosen) |
|---|---|
| Own the whole agent: loop, providers, tools, TUI. Full control | Extend pi at supported seams: system-prompt events, tool overrides, lifecycle events, skills, packages |
| Merge cost against ~4k upstream commits per year, repeated breakage (Azure provider rename in 1.0.3, npm-shrinkwrap removal in 1.0.1, --tools modifier changes in 1.1.0) | Pin a version range, keep a conformance spike, upstream updates flow |
| Duplicate pi-ai (OpenAI, Anthropic, Google, Vertex, Mistral, codex OAuth), tool implementations, session persistence | pi-ai and tools come free |
| Harness2 layer still has to be written by us | Harness2 layer still has to be written by us (this plan) |

The escape hatch stays documented: if a needed seam is missing from pi's
extension API rather than merely awkward, we fork for a patch release carried
as a vendored diff, not a full takeover. Phase 0 verifies every seam before
any code lands.

### Why pi specifically (verified facts, Oct 2026)

- Modes: interactive TUI, print/JSON headless (`pi -p`), RPC server
  (`pi --mode rpc`), TypeScript SDK (`createAgentSession` in
  @earendil-works/pi-coding-agent). Agni already drives RPC mode today
  (src-tauri/src/modules/pi.rs spawn + src/modules/pi-agent/ rpcState).
- Extensions: `.js` files auto-discovered in `~/.pi/agent/extensions/`
  (global) and `<project>/.pi/extensions/` (project, loads after project
  trust). Packages can bundle extensions, skills, prompts, themes from npm,
  git, or a local path: `pi install ./packages/agni-harness`.
- `pi.on("before_agent_start", ...)` returns an override for the system
  prompt: our prompt-assembly seam.
- Tool modifiers/overrides: extensions wrap built-in tools (the official
  examples enforce blocked-path policies like .env and SSH keys). Our c8
  middleware seam. `--tools +name/-name` and `--exclude-tools` restrict the
  tool set per process: our probe/improver confinement seam.
- Events: `agent_settled` (with aborted state), error and response events:
  our trajectory and session-end reflection seams.
- Skills: `.pi/skills/` project + global, SKILL.md format: our c6 seam.
- Precedent: pi2.nvim consumes RPC mode from an editor; zosmaai/openzosma
  wraps SDK mode headless with custom system prompt prefix/suffix and an
  extensions dir; pi-subagents is a third-party package adding subagents.
  We are joining an established pattern, not inventing one.

## 2. What we take from Harness 2, and what we leave

Harness 2's core finding: agent capability is a function of the harness, and
the harness can be improved mechanically. Their release is a Python research
framework driving OpenCode or Codex as "substrates". We keep the architecture
ideas, not the Python code.

### Take

| Harness 2 concept | Our use |
|---|---|
| 8-component file tree (c1..c8): system prompt, guardrails, memory, tool guidance, subagents, skills, scripts, middleware plugin | `.agni/harness/` file tree mounted by the agni-harness extension at session start, assembled into the system prompt and tool policies |
| Edit contract "omitted-is-inherited": a proposal emits only files it changes | Improver emits partial trees; unlisted files inherit. Diff, review, adopt |
| `SurfaceSpec` data object (paths, caps, frontmatter rules, validators) parametrizing shared read/validate/write/diff logic | `surface.ts` in the harness package. One validator, per-file rules as data |
| `Substrate` protocol: surface(), materialise(), execute(), read_trajectory(), preflight() | Substrate is pi: panel RPC sessions are interactive execute, `pi -p` headless is probe execute. The extension owns "surface" and "materialise" |
| `RunView` separates `delivered` from `score`. Deliverable existence is cheap and always knowable; a score needs a judge | Contrastive refinement keys on deliverable existence plus behavioral contrasts, never a silent judge score |
| Trajectory grammar: `[ACTION]` / `[OBSERVATION]` / `[ERROR]` rendered from agent streams | The extension writes its own transcript in this grammar under `.agni/runs/<runId>/` |
| `obs_trunc >= 10_000`: aggressive observation truncation fabricates defects in probes | Trajectory renderer enforces a 10k char floor per observation; whole-trajectory budget applies after |
| Propose-Probe-Compose without ground truth: propose edits, re-run the same task under matched conditions, compose from behavioral contrasts | Phase 4 improver. k-run budget, matched execution conditions, contrast evidence |
| Per-domain lesson library, tasks within a domain ordered, read-only earlier entries | `.agni/harness/library/<domain>/lessons.jsonl`, append-only, read-only during runs |
| Improver is a separate model/agent from the executor | Improver runs as its own headless pi process with a restricted tool set (`--tools read,...`), never the task executor |
| Harness fingerprint before each run; results keyed by (harness fingerprint, run id) | Adoption and run records carry `harnessFingerprint` so contrast and regression checks are reproducible |
| Harness-level recursion: reflection updates the improver's own guidance with retained lessons | Reflection output is appended to `.agni/harness/improver-guidance.md`, cap enforced |

### Leave (with reasons)

| Skipped | Reason |
|---|---|
| Python, uv, Linux-only tooling | Pi + TypeScript, cross-platform from day one (Windows first) |
| OpenCode/Codex substrate adapters | Our substrate is pi, already integrated with the panel over RPC |
| Benchmark installers, judges, report CLIs | Out of scope; a repo test suite is the optional verifier in Phase 5 |
| Parallel recursion (k general + k domain candidates, k compositions) | Expensive; sequential k=1 is the default, parallel is a flag later |
| Full PPC on every task | Wrong default for a desktop tool. Improvement is explicit and user-initiated |
| Forking pi core | See Section 1 |

## 3. What Agni already has (build on, do not rebuild)

- **Pi over RPC**: `src-tauri/src/modules/pi.rs` spawns pi with workspace
  authorization; `src/modules/pi-agent/` owns the rpcState reducer
  (`agent_end`, `new_session`, `set_model`, `fork`, `clone`, `compact`),
  extension request handling (`PiExtensionRequest`), and model squatting
  already. The harness panel rides this store; no new wire protocol.
- **ACP clients**: Pi/OpenCode/Kilo panel switching stays untouched.
- **Agent memory**: `AGNI.md` from workspace root becomes harness component
  c3, combined with `AGENTS.md` / `CLAUDE.md` when present.
- **Workspace authorization registry** (`src-tauri/src/modules/workspace.rs`):
  spawn cwd authorization, symlink escape blocking, reused by the runner.
- **Settings store** (`src/modules/settings/`): provider keys passed to pi
  spawn env, never logged.
- **Editor, diff review, git-diff tab, markdown renderer**: harness diff
  review and transcript viewing reuse these.

## 4. Architecture overview

```
+---------------------------------------------------------------+
| Agni (Tauri)                                                  |
|                                                               |
|  agent panel -- pi RPC (existing) --------------------------- |
|  harness panel: tree view, runs, lessons, Improve button      |
|      |              | adopt/reject diff review                |
+---------------------------------------------------------------+
        | spawns / reads
        v
  pi processes (user's global pi, version >= pinned floor)
    + agni-harness  (pi package authored by us, installed per workspace)
        |  extension: assemble c1..c8 into system prompt (before_agent_start)
        |  extension: middleware via tool overrides + allow/deny policy
        |  extension: trajectory writer -> .agni/runs/<runId>/ (ACTION/OBS/ERROR)
        |  extension: reflection at agent_settled -> library/<domain>/lessons.jsonl
        v
  .agni/harness/          c1..c8 files, library/, improver-guidance.md
  .agni/harness/.proposals/   improver partial trees, never auto-applied
  .agni/runs/             run.json + transcripts
```

Two layers, one substrate. The app owns UI, provisioning, and approval; pi
owns the agent loop, providers, and tools; the agni-harness package owns
prompt assembly, trajectory, reflection, and the improver loop.

### Probe and improver execution model

All long-lived behavior happens inside one pi process per session, in RPC
mode (panel) or print/JSON mode (headless runner). The P-P-C improver is
orchestrated by Agni as sequential headless `pi -p` spawns:

1. Propose: headless pi run with `--tools read,grep,find,-bash,-edit,-write`
   plus a confined `write_proposal` tool registered by the extension.
   Input: target run transcript, current tree, surface spec,
   improver-guidance.md. Output: partial tree under `.agni/harness/.proposals/<id>/`.
2. Probe: fresh headless pi run with the candidate harness mounted (same task
   prompt, same model rules, wall budget capped). Extension records a RunView
   pair and a behavior contrast table against the base run.
3. Compose: one more headless pi run that sees base vs probe transcripts and
   decides keeps/drops/merges; emits a partial tree.
4. Adoption in the panel is manual diff review. Nothing applies without the
   user pressing adopt.

## 5. The harness surface (c1..c8) mapped onto pi seams

Workspace-relative tree at `.agni/harness/`:

```
.agni/harness/
  system-prompt.md            c1 skeleton and instructions
  guardrails.md               c2 security, secrets, destructive action gates
  memory.md                   c3 proxy rules: read AGNI.md, AGENTS.md, CLAUDE.md
                              (actual content stays in workspace root files)
  tool-guidance.md            c4 per-tool guidance: when, recovery
  subagents/                  c5 role files (v2; default off, see .pi-skills note)
  skills/                     c6 SKILL.md files
  scripts/                    c7 deterministic helpers (.mjs, .ps1, .sh)
  middleware.md               c8 tool-call policy: deny/rewrite, path allowlists,
                              command denylist regexes
  library/                    output of harnessing-level recursion
    <domain>/lessons.jsonl
  improver-guidance.md        running guidance the reflector appends
  prompts.json                provenance ledger for adopted changes
```

| Component | pi seam | Notes |
|---|---|---|
| c1 system prompt | `before_agent_start` returns assembled systemPrompt | Assembly order stable: c1 body, then c2, c3, c4, lessons, tool guidance |
| c2 guardrails | assembled prompt + extension tool overrides | Tool overrides block regardless of prompt reach; defense in depth |
| c3 memory | assembled prompt reads root files, newest wins | Content never copied into `.agni/harness/` |
| c4 tool guidance | assembled prompt section | |
| c5 subagents | deferred to v2 | pi skips subagents by default; pi-subagents package exists. Do not design the skill system around it in v1 |
| c6 skills | `.pi/skills/` loader; our package declares a skills dir | Skills load on title match only, matched by content rules |
| c7 scripts | extension `registerTool` wrappers | Scripts run only through registered tools with Pi's permission prompt |
| c8 middleware | extension tool wrap (read/bash/edit/write) driven by `middleware.md` | Path allowlist, command denylist regexes enforced at interception, log-only mode first |

Rules mirroring Harness 2:

- Every component is a plain text file with optional YAML frontmatter: `cap`
  (max chars), `enabled`, `when`. Validators enforce caps and shape; data
  lives on `surface.ts` (the SurfaceSpec port).
- Loading is read-only; nothing in the tree executes at load.
- New harness creation seeds from built-in templates shipped in the package.
- `provenance` in prompts.json records where each adopted change came from
  (manual, reflector, improver run id).

## 6. Module layout

One pi package, one app module, near-zero Rust additions. Follow AGNI.md
conventions throughout: pure logic in dependency-light modules, thin glue,
`@/` imports in app code, no comments unless the code cannot explain itself,
no emojis, no em-dashes, pnpm only.

```
packages/agni-harness/        pi package (our authored harness, MIT-attributed fork of nothing)
  package.json                name @agni/pi-harness, "pi" manifest key, peerDeps:
                              @earendil-works/pi-ai, pi-agent-core, pi-coding-agent (host-supplied)
  extension/
    index.js                  entry discovered by pi loader
    mount.ts                  read + validate .agni/harness tree, fingerprint
    assemble.ts               prompt assembly (pure, deterministic, testable)
    middleware.ts             tool overrides from middleware.md (pure matcher)
    trajectory.ts             event -> [ACTION]/[OBSERVATION]/[ERROR] writer,
                              observation floor 10k, run.json RunView record
    reflect.ts                agent_settled hook: one bounded model call,
                              structured lesson candidates with evidence
    library.ts                lessons.jsonl append/read API, caps, dedupe
    improve.ts                write_proposal tool + probe bookkeeping
  seeds/
    agentic-coding/           built-in template tree (all c files)
    repo-review/              second seed
  surface.ts                  SurfaceSpec: paths, caps, frontmatter rules, validators
  tree.ts                     read, validate, write, diff, omitted-is-inherited apply
  fingerprint.ts              stable tree hash, CRLF-normalized
  runner.ts                   headless spawn helper: propose / probe / compose steps,
                              matched conditions, wall + cost caps
  test/                       vitest: assembly snapshots, tree apply, middleware matcher,
                              trajectory grammar, library caps

src/modules/harness/          app side (webview)
  harnessStore.ts             tree + runs + proposals state via existing fs commands
  treeDiff.ts                 presenting diffs (pure, reuses editor diff types)
  HarnessPanel.tsx            tree view, run history, lessons list, Improve button
  AdoptDialog.tsx             per-file diff review, adopt/reject, provenance display
  index.ts

src-tauri (minimal)
  modules/pi.rs               unchanged spawn; add provider env assembly if pi auth
                              uses vars not present; version floor check (pi --version
                              >= pinned minimum) with a clear upgrade message
  no new fs commands: tree IO reuses fs::file, fs::mutate, fs::tree
```

Deployment of the package (P0 spike decides the winner):

- Candidate A: `pi install ./packages/agni-harness` run once per workspace by
  Agni on first "Enable Agni harness" click; uses pi's own package + trust
  machinery.
- Candidate B: Agni writes a tiny bootstrap loader into the workspace
  `.pi/extensions/` that registers the package path by config. No global
  mutation.
- Candidate C: if pi exposes an extensions-dir CLI flag, pass it at spawn
  (cleanest; verify existence in P0).

Whichever route wins, the extension must not load unless the user opted in.

## 7. Phases

Each phase ends with all gates green: `pnpm lint`, `pnpm check-types`,
`pnpm test`, and (where Rust changed) `cargo clippy` + `cargo test --locked`.

### Phase 0: Seam verification spike (1 week, throwaway code)

Goal: prove every seam we depend on exists and behaves as documented on the
pinned pi version, on Windows first.

1. Pin pi and record the floor version in the plan and package.json.
2. Spike script (repo scripts/, gitignored output) verifies:
   - `before_agent_start` system prompt override works in RPC mode and in
     `pi -p` from an extension loaded by each deployment candidate (A, B, C).
   - Project trust: does headless `pi -p` block project extensions/skills
     until trusted? Record the non-interactive acceptance route.
   - Tool override interception: wrap `read` and `bash`, assert blocked paths.
   - `--tools` / `--exclude-tools` confinement behaves for probes.
   - Event coverage for trajectory: which events give us full tool args,
     results, errors, timing, text deltas; record gaps.
   - `agent_settled` fires reliably at session end in RPC mode.
   - Error and retry behavior of pi-ai streaming from the extension host.
3. Decide DAG: deployment route (A/B/C), version pin policy, extension holes.

Acceptance: A written seam report in docs/ with each result, plus the
decision list. No product code this phase.

### Phase 1: Harness surface v1 (agents behave exactly from files)

1. Build package skeleton per Section 6: surface.ts, tree.ts, fingerprint.ts,
   mount.ts, assemble.ts, middleware.ts with unit tests.
2. Implement c1..c4 + c6..c8 mounting (c5 deferred): assembly covers system
   prompt, guardrails, memory proxy, tool guidance, skills on match, scripts
   listed as tools, middleware policy enforced at interception in log-only
   mode.
3. Seed flow: panel button mints `.agni/harness/` from agentic-coding seed.
   Empty tree must produce the internal fallback prompt (pi default behavior).
4. HarnessPanel v1: read-only tree view, per-file preview in the editor pane,
   validation errors surfaced, seed button.
5. Tests: assembly snapshots, middleware matcher, fingerprint stability
   (CRLF-normalized), validators.

Acceptance: editing system-prompt.md changes behavior deterministically in a
fixture; invalid file loads safe with inline error; middleware log-only mode
records would-denies without changing behavior.

### Phase 2: Trajectory and runs

1. trajectory.ts: per-event rendering with `[ACTION]` (args capped 2000),
   `[OBSERVATION]` (10k floor), `[ERROR]`; whole-transcript budget applied
   after floors; env redaction asserted by tests.
2. run.json RunView: ok, delivered (>= 1 file write or edit, or a bash run
   with stdout, definition recorded in run.json), costUsd, wallMs,
   harnessFingerprint, summary, error. Fork/clone sessions link parent ids.
3. HarnessPanel run history: list runs, open transcript as markdown tab,
   filter by delivered and fingerprint.

Acceptance: crashed sessions still produce valid transcripts; zero-write
sessions record not delivered; transcripts contain no provider secrets.

### Phase 3: Reflection and lesson library

1. reflect.ts on agent_settled (RPC sessions) or run completion (headless):
   one bounded model call, structured candidates (lesson text, domain guess,
   evidence: run ids, fingerprint, contrast note). No score language.
2. library.ts: dedupe against recent entries, confidence floor, append to
   `library/<domain>/lessons.jsonl`; read API returns k most recent for the
   domain (k=10), read-only.
3. improver-guidance.md gets a compressed dated note, rotate oldest at cap.
4. Lessons injected into the next run's assembled prompt under a marked
   section; guardrails state lessons never override user messages or
   guardrails.
5. HarnessPanel: lessons list with evidence links, domain filter, delete.

Acceptance: second task in the same domain receives a lesson derived from the
first; injection affects prompt only, never tool inputs (asserted); empty
library sessions behave identically to Phase 1 behavior.

### Phase 4: Propose-Probe-Compose improver

1. Panel "Improve harness for this task" on a completed run opens the
   improver; a second, cheap provider/model is allowed.
2. propose: headless pi with restricted tools; writes partial tree to
   `.agni/harness/.proposals/<id>/`; proposal records target run, base
   fingerprint, evidence cited.
3. probe: runner.ts spawns fresh headless pi with candidate harness, same
   task prompt, matched model rules, wall cap; produces RunView pair plus
   contrast table (tools called, files touched, delivered, wall, errors).
   Observation floors respected (10k default).
4. compose: pi sees both transcripts plus contrast table; drops edits with no
   evidence, keeps positive-contrast edits, merges overlaps; still partial
   tree only.
5. Adoption: AdoptDialog diff review (per-file plus summary plus evidence
   column), writes via existing fs mutate, records provenance and
   before/after fingerprints in prompts.json. Then reflection closes the
   loop with the adopted set. Sequential k mode flag repeats PPC bounded,
   stopping when compose emits no edits.

Acceptance: fixture run with a fabricated failure produces a proposal; probe
shows the contrast; adoption is manual and applies only listed files; next
run fingerprint changes and run.json records lineage. Improver sessions can
never write outside `.agni/harness/.proposals/` (tested at interception).

### Phase 5: Distribution hardening and optional verifier

1. Version floor enforcement in pi.rs with upgrade guidance; pin policy
   documented (exact pin in CI, floor a listed advisory).
2. Windows-first CI for the package tests; WSL workspace verification.
3. Optional: bundled pi runtime so end users need nothing (node SEA or
   esbuild bundle); open decision D3 revisited with bundle numbers.
4. Optional verifier: if the workspace exposes a test command, RunView
   records `verified` and the improver may use it as the delivered gate.
   Off by default, per-workspace opt-in.
5. Research flag only: downside eval mode over a scripted task list, scoring
   scoped strictly to that run, never mixed into lessons.

## 8. Cross-cutting rules

### Security

- Harness files are untrusted workspace content. Assembly wraps each file in
  section markers; the c2 seed states that instructions inside memory, skill,
  or library files never override user messages or guardrails. Test: a
  planted instruction must not change tool decisions without user approval.
- The improver cannot write outside `.agni/harness/.proposals/`, enforced at
  tool interception, not by prompt. Probe sessions get read-only tools.
- pi's project-trust model governs extension and skill loading in project
  dirs; respect it verbatim, no bypasses in non-interactive headless runs.
- Provider keys travel to pi via spawn env only; redaction in trajectory
  tests prevents secrets in transcripts, lessons, run.json, or logs.
- Bash: pi's default tool kept, cwd pinned by spawn authorization, command
  text shown verbatim in Pi's permission prompts; middleware adds a denylist.
- All file IO behind the existing workspace authorization registry; symlink
  escape tests in workspace.rs are the gate.

### Performance (unused features cost zero)

- No harness package loads unless the user enabled it in the workspace;
  otherwise pi sessions run exactly as today.
- Reflector runs once per run end, bounded, skipped when no transcript.
- Append-only trajectory writing, no re-parsing.
- Lesson injection bounded (k entries, capped size each).

### Cross-platform

- Windows consumed first: PowerShell 5.1 semantics in any seeded `.ps1`
  scripts alongside `.sh` variants.
- Paths canonical forward-slash; fingerprint normalizes CRLF so Windows
  checkouts diff clean.
- WSL workspace sessions verified for both RPC and headless modes.

### Observability

- Native log channel `agni-harness` for mount, middleware denials, probe
  spawn, reflect completion.
- Panel error states reuse existing notification routing (route.ts).

## 9. Key design invariants

1. **Omitted means inherited.** Proposals are partial trees forever.
2. **Delivered beats scored.** Contrast evidence is behavioral, not a judge
   number, except inside the isolated Phase 5 eval flag.
3. **The improver never touches workspace project files.** Its writes go to
   `.agni/harness/.proposals/` only, enforced at interception.
4. **Every adoption is human-approved.** No background writes to the mounted
   tree; the reflector may write only to `library/` and the guidance file.
5. **The fingerprint is the contract.** Runs, lessons, proposals all carry
   the tree fingerprint they were executed against.
6. **Observation truncation has a floor.** 10k chars default; lower only with
   an explicit reason recorded in the transcript.
7. **Opt-in only.** Without explicit enablement, pi behaves like stock pi.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| pi upstream churn breaks a seam | Pin + conformance spike in CI against the pinned version; seams wrapped in our own thin adapters so breakage is localized; fork escape hatch for patch releases if a seam vanishes |
| Extension API gaps discovered late | Phase 0 verifies all seams before product code; spike report gates the go decision |
| Headless project-trust friction for probes | Trust acceptance route settled empirically in P0; probes never run untrusted extensions silently |
| Improver makes the harness worse | Probe contrast gates adoption; nothing applies without review; evidence column in the diff UI |
| Cost blowup from PPC probes | k=1 sequential default, wall and cost caps, explicit user initiation, cheap model for improver |
| Prompt injection via memory or library files | Section wrapping, instruction hierarchy in guardrails, tests asserting approval-gated behavior |
| Editing harness files from a running session + fingerprint drift | Mount snapshot at session start; mid-session edits affect future sessions; documented and surfaced in the panel |
| Provider key exposure in transcripts | Env redaction with tests in trajectory renderers |
| Windows spawn quirks (global pi shim resolution) | Reuse pi.rs spawn path that already works for the panel; CI on Windows first |
| Double implementation of prompt assembly (app vs package) | The app never assembles prompts. The app only reads the tree and applies diffs; assembly lives solely in the package |

## 11. Open decisions

- **D1: deployment route for the package** (install via pi, workspace
  bootstrap extension, or CLI flag). Spike decides in Phase 0.
- **D2: version pin policy.** Proposal: exact pin in CI, published floor in
  docs, panel warns on older pi.
- **D3: bundled pi runtime for end users.** Node SEA vs esbuild bundle vs
  requiring the pi installer. Revisit with bundle size numbers in Phase 5.
- **D4: domain classifier for lessons.** v1 heuristic (prompt language +
  touched file paths). v2 option: one cheap classifier call.
- **D5: sharing lessons with OpenCode/Kilo clients.** Harness is
  pi-scoped in v1; cross-client injection deferred.
- **D6: subagent support.** Adopt pi-subagents package vs author minimal
  role runner. Deferred to v2; no v1 coupling.

## 12. Glossary

- **Harness**: file-based scaffolding around a frozen model making it an
  agent, assembled at `before_agent_start` from c1..c8.
- **Substrate**: pi. Interactive sessions run over RPC; probes run headless
  in print/JSON mode.
- **agni-harness**: our pi package: mounting, assembly, middleware,
  trajectory, reflection, improver.
- **PPC / Propose-Probe-Compose**: contrastive refinement step of Harness 2.
- **RunView**: record of one finished rollout (ok, delivered, cost, wall,
  fingerprint). Deliberately carries no score.
- **Lesson**: evidence-backed note in the library produced by reflection,
  consumed read-only during later runs.
- **Fingerprint**: stable hash of the mounted harness tree.
