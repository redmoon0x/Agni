import { invoke } from "@tauri-apps/api/core";

// ── Workspace ──────────────────────────────────────────────────────────────

export async function pickFolder(title?: string, startDir?: string): Promise<string | null> {
  return invoke("pick_folder", { title: title ?? null, startDir: startDir ?? null });
}

export async function workspaceAuthorize(cwd: string): Promise<void> {
  await invoke("workspace_authorize", { cwd });
}

// ── Git types ──────────────────────────────────────────────────────────────

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  status: string;
  staged: boolean;
};

export type GitDiscardEntry = {
  path: string;
  mode: "+" | "-";
  originalPath: string | null;
};

export type GitRepoInfo = {
  repoRoot: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  headDetached: boolean;
};

export type GitStatusSnapshot = {
  changed: GitChangedFile[];
  staged: GitChangedFile[];
  mergeConflicts: string[];
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  graph: string;
  refs: string[];
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
};

export type GitRemoteUrlResult = {
  url: string;
};

export type GitDiffContentResult = {
  originalContent: string;
  changedContent: string;
  diffText: string;
};

export type GitShowCommitResult = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  body: string;
  files: GitCommitFileChange[];
};

// ── Git commands ───────────────────────────────────────────────────────────

export async function gitStatus(repoRoot: string): Promise<GitStatusSnapshot> {
  return invoke("git_status", { repoRoot });
}

export async function gitPanelSnapshot(path: string): Promise<GitStatusSnapshot> {
  return invoke("git_panel_snapshot", { path });
}

export async function gitResolveRepo(path: string): Promise<GitRepoInfo | null> {
  return invoke("git_resolve_repo", { path });
}

export async function gitLog(
  repoRoot: string,
  opts?: { limit?: number; after?: string; before?: string; search?: string },
): Promise<GitLogEntry[]> {
  return invoke("git_log", { repoRoot, ...opts });
}

export async function gitCommitFiles(
  repoRoot: string,
  sha: string,
): Promise<GitCommitFileChange[]> {
  return invoke("git_commit_files", { repoRoot, sha });
}

export async function gitCommit(repoRoot: string, message: string): Promise<string> {
  return invoke("git_commit", { repoRoot, message });
}

export async function gitStage(repoRoot: string, paths: string[]): Promise<void> {
  await invoke("git_stage", { repoRoot, paths });
}

export async function gitUnstage(repoRoot: string, paths: string[]): Promise<void> {
  await invoke("git_unstage", { repoRoot, paths });
}

export async function gitDiscard(
  repoRoot: string,
  entries: GitDiscardEntry[],
): Promise<void> {
  await invoke("git_discard", { repoRoot, entries });
}

export async function gitFetch(repoRoot: string): Promise<void> {
  await invoke("git_fetch", { repoRoot });
}

export async function gitPullFfOnly(repoRoot: string): Promise<void> {
  await invoke("git_pull_ff_only", { repoRoot });
}

export async function gitPush(repoRoot: string): Promise<void> {
  await invoke("git_push", { repoRoot });
}

export async function gitRemoteUrl(repoRoot: string): Promise<GitRemoteUrlResult> {
  return invoke("git_remote_url", { repoRoot });
}

export async function gitDiffContent(
  repoRoot: string,
  path: string,
  staged: boolean,
  originalPath: string | null,
): Promise<GitDiffContentResult> {
  return invoke("git_diff_content", { repoRoot, path, staged, originalPath });
}

export async function gitCommitFileDiff(
  repoRoot: string,
  sha: string,
  path: string,
  originalPath: string | null,
): Promise<GitDiffContentResult> {
  return invoke("git_commit_file_diff", { repoRoot, sha, path, originalPath });
}

export async function gitShowCommit(
  repoRoot: string,
  sha: string,
): Promise<GitShowCommitResult> {
  return invoke("git_show_commit", { repoRoot, sha });
}

export async function gitDiff(
  repoRoot: string,
  path: string | null,
  staged: boolean,
): Promise<{ diffText: string }> {
  return invoke("git_diff", { repoRoot, path, staged });
}

export const native = {
  pickFolder,
  workspaceAuthorize,
  gitStatus,
  gitPanelSnapshot,
  gitResolveRepo,
  gitLog,
  gitCommitFiles,
  gitStage,
  gitUnstage,
  gitDiscard,
  gitFetch,
  gitPullFfOnly,
  gitPush,
};
