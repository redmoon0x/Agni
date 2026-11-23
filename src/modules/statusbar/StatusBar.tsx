import { Alert02Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import type { WorkspaceEnv } from "@/modules/workspace";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  /** Current branch of the tracked repo, if any. */
  branch?: string | null;
  isDetached?: boolean;
  /** Root of the tracked repo, to detect when the cwd is outside it. */
  repoRoot?: string | null;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isWithin(root: string, path: string): boolean {
  const candidate = normalizePath(path);
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  branch = null,
  isDetached = false,
  repoRoot = null,
}: Props) {
  const branchLabel = isDetached ? "detached" : branch;
  const mismatch =
    !!repoRoot && !!cwd && !isWithin(normalizePath(repoRoot), cwd);

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
      </div>
      {branchLabel ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {mismatch ? (
            <span
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-amber-500"
              title={`The current folder is outside ${repoRoot}; the branch shown belongs to that repository.`}
            >
              <HugeiconsIcon icon={Alert02Icon} size={10} strokeWidth={2} />
              outside repo
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex max-w-40 items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              isDetached
                ? "text-amber-500"
                : "text-muted-foreground",
            )}
            title={
              isDetached
                ? "HEAD is detached"
                : branch
                  ? `On branch ${branch}`
                  : "Current branch"
            }
          >
            <HugeiconsIcon icon={GitBranchIcon} size={10} strokeWidth={1.9} />
            <span className="truncate">{branchLabel}</span>
          </span>
        </div>
      ) : null}
    </footer>
  );
}
