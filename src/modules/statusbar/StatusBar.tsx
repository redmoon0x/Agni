import { ComputerTerminal02Icon } from "@hugeicons/core-free-icons";
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
  onToggleDock: () => void;
  dockOpen: boolean;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onToggleDock,
  dockOpen,
}: Props) {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
      </div>
      <button
        type="button"
        onClick={onToggleDock}
        title="Toggle terminal panel"
        aria-label="Toggle terminal panel"
        aria-pressed={dockOpen}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
          dockOpen && "bg-accent text-foreground",
        )}
      >
        <HugeiconsIcon
          icon={ComputerTerminal02Icon}
          size={13}
          strokeWidth={1.75}
        />
        Terminal
      </button>
    </footer>
  );
}
