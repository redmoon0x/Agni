<div align="center">
  <img src="public/logo.png" width="144" height="144" alt="Agni" />
  <h1>Agni</h1>
  <p><strong>Fast, lightweight terminal emulator.</strong></p>
  <p>
    <a href="https://github.com/deviprasadshetty-dev/Agni">
      <img src="https://img.shields.io/badge/github-devi--agni-blue" alt="github" />
    </a>
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="platform" />
  </p>
</div>

---

**Agni** is a de-bloated fork of [Terax](https://github.com/crynta/terax-ai), a Tauri 2 + Rust terminal emulator. We stripped out all built-in AI (API keys, cloud providers, chat panel, auto-complete, agents) and kept the core: native PTY, WebGL terminal, code editor, file explorer, git, and preview. About 3-4 MB on disk. It detects CLI coding agents (Claude Code, pi, Codex, etc.) running inside the terminal and notifies you when they need attention. Native PTY backend with a WebGL renderer, plus a code editor, file explorer, source control with git graph, and web preview. Detects CLI coding agents (Claude Code, pi, Codex, etc.) running in your terminal — shows a notification bell and tab indicators when they need attention.

## Features

### Terminal
- xterm.js with WebGL renderer, multi-tab with background streaming
- Native PTY backend via `portable-pty` (zsh, bash, pwsh, fish, cmd)
- Split panels (horizontal and vertical)
- Inline search, link detection, true-color
- WSL workspace environments on Windows

### Code editor
- CodeMirror 6 (TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, Markdown, etc.)
- Vim mode
- Ten built-in themes: Atom One, Aura, Copilot, GitHub, Gruvbox, Nord, Tokyo Night, Xcode

### Source control
- Stage / unstage hunks, commit, push with upstream awareness
- Git history pane with commit graph
- Commit search and filter

### File explorer
- Catppuccin icon theme
- Fuzzy search, keyboard navigation, inline rename, context actions

### Web preview
- Auto-detects local dev servers and opens them in a preview tab

### CLI agent awareness
- Detects Claude Code, pi, Codex, OpenCode, Agy, Gemini running in the terminal
- Green tab indicator dot when agent is active
- Auto-renames tab to show agent name
- OS notification when agent needs attention or finishes

### Themes
- Built-in presets + custom theme engine
- Background images with adjustable opacity and blur
- Independent editor theme

## Build from source

**Prerequisites**
- Rust (stable), https://rustup.rs
- Node 22+ and [pnpm](https://pnpm.io)
- Tauri prerequisites for your platform, https://tauri.app/start/prerequisites/

```bash
pnpm install
pnpm tauri dev          # development
pnpm tauri build        # production bundle
```

## Tech stack

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Tailwind v4, shadcn/ui, Zustand.

## License

Apache-2.0
