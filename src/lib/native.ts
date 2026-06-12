import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace";

export async function pickFolder(
  title?: string,
  startDir?: string,
): Promise<string | null> {
  return invoke("pick_folder", {
    title: title ?? null,
    startDir: startDir ?? null,
  });
}

export async function workspaceAuthorize(cwd: string): Promise<void> {
  await invoke("workspace_authorize", { path: cwd });
}

export async function workspaceCurrentDir(): Promise<string> {
  return invoke("workspace_current_dir");
}

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  statusLabel: string;
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export type GitRepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
};

export type GitStatusSnapshot = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  truncated: boolean;
  changedFiles: GitChangedFile[];
};

export type GitPanelSnapshot = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
};

export type GitBranch = {
  name: string;
  fullName: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  lastCommit: string | null;
};

export type GitDeleteMergedBranchesResult = {
  deleted: string[];
  skipped: string[];
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
  statusLabel: string;
  added: number;
  removed: number;
  isBinary: boolean;
};

export type GitDiffResult = {
  diffText: string;
  truncated: boolean;
};

export type GitDiffContentResult = {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  truncated: boolean;
};

export type GitCommitResult = {
  commitSha: string;
  summary: string;
};

export type GitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

export async function gitStatus(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<GitStatusSnapshot> {
  return invoke("git_status", { repoRoot, workspace: workspace ?? null });
}

export async function gitBranches(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<GitBranch[]> {
  return invoke("git_branches", { repoRoot, workspace: workspace ?? null });
}

export async function gitCheckoutBranch(
  repoRoot: string,
  name: string,
  remote: boolean,
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_checkout_branch", {
    repoRoot,
    name,
    remote,
    workspace: workspace ?? null,
  });
}

export async function gitCreateBranch(
  repoRoot: string,
  name: string,
  checkout: boolean,
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_create_branch", {
    repoRoot,
    name,
    checkout,
    workspace: workspace ?? null,
  });
}

export async function gitDeleteMergedBranches(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<GitDeleteMergedBranchesResult> {
  return invoke("git_delete_merged_branches", {
    repoRoot,
    workspace: workspace ?? null,
  });
}

export async function gitPanelSnapshot(
  cwd: string,
  workspace?: WorkspaceEnv,
): Promise<GitPanelSnapshot> {
  return invoke("git_panel_snapshot", { cwd, workspace: workspace ?? null });
}

export async function gitResolveRepo(
  cwd: string,
  workspace?: WorkspaceEnv,
): Promise<GitRepoInfo | null> {
  return invoke("git_resolve_repo", { cwd, workspace: workspace ?? null });
}

export async function gitLog(
  repoRoot: string,
  opts?: { limit?: number; beforeSha?: string },
  workspace?: WorkspaceEnv,
): Promise<GitLogEntry[]> {
  return invoke("git_log", {
    repoRoot,
    limit: opts?.limit ?? null,
    beforeSha: opts?.beforeSha ?? null,
    workspace: workspace ?? null,
  });
}

export async function gitCommitFiles(
  repoRoot: string,
  sha: string,
  workspace?: WorkspaceEnv,
): Promise<GitCommitFileChange[]> {
  return invoke("git_commit_files", {
    repoRoot,
    sha,
    workspace: workspace ?? null,
  });
}

export async function gitCommit(
  repoRoot: string,
  message: string,
  workspace?: WorkspaceEnv,
): Promise<GitCommitResult> {
  return invoke("git_commit", {
    repoRoot,
    message,
    workspace: workspace ?? null,
  });
}

export async function gitStage(
  repoRoot: string,
  paths: string[],
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_stage", { repoRoot, paths, workspace: workspace ?? null });
}

export async function gitUnstage(
  repoRoot: string,
  paths: string[],
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_unstage", {
    repoRoot,
    paths,
    workspace: workspace ?? null,
  });
}

export async function gitDiscard(
  repoRoot: string,
  entries: GitDiscardEntry[],
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_discard", {
    repoRoot,
    entries,
    workspace: workspace ?? null,
  });
}

export async function gitFetch(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_fetch", { repoRoot, workspace: workspace ?? null });
}

export async function gitPullFfOnly(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<void> {
  await invoke("git_pull_ff_only", { repoRoot, workspace: workspace ?? null });
}

export async function gitPush(
  repoRoot: string,
  workspace?: WorkspaceEnv,
): Promise<GitPushResult> {
  return invoke("git_push", { repoRoot, workspace: workspace ?? null });
}

export async function gitRemoteUrl(
  repoRoot: string,
  name?: string,
  workspace?: WorkspaceEnv,
): Promise<string | null> {
  return invoke("git_remote_url", {
    repoRoot,
    name: name ?? null,
    workspace: workspace ?? null,
  });
}

export async function gitDiffContent(
  repoRoot: string,
  path: string,
  staged: boolean,
  originalPath: string | null,
  workspace?: WorkspaceEnv,
): Promise<GitDiffContentResult> {
  return invoke("git_diff_content", {
    repoRoot,
    path,
    staged,
    originalPath,
    workspace: workspace ?? null,
  });
}

export async function gitCommitFileDiff(
  repoRoot: string,
  sha: string,
  path: string,
  originalPath: string | null,
  workspace?: WorkspaceEnv,
): Promise<GitDiffContentResult> {
  return invoke("git_commit_file_diff", {
    repoRoot,
    sha,
    path,
    originalPath,
    workspace: workspace ?? null,
  });
}

export async function gitShowCommit(
  repoRoot: string,
  sha: string,
  workspace?: WorkspaceEnv,
): Promise<GitDiffResult> {
  return invoke("git_show_commit", {
    repoRoot,
    sha,
    workspace: workspace ?? null,
  });
}

export async function gitDiff(
  repoRoot: string,
  path: string | null,
  staged: boolean,
  workspace?: WorkspaceEnv,
): Promise<GitDiffResult> {
  return invoke("git_diff", {
    repoRoot,
    path,
    staged,
    workspace: workspace ?? null,
  });
}

export const native = {
  pickFolder,
  workspaceAuthorize,
  workspaceCurrentDir,
  gitStatus,
  gitBranches,
  gitCheckoutBranch,
  gitCreateBranch,
  gitDeleteMergedBranches,
  gitPanelSnapshot,
  gitResolveRepo,
  gitLog,
  gitCommitFiles,
  gitCommit,
  gitStage,
  gitUnstage,
  gitDiscard,
  gitFetch,
  gitPullFfOnly,
  gitPush,
  gitRemoteUrl,
  gitDiffContent,
  gitCommitFileDiff,
  gitShowCommit,
  gitDiff,
};
