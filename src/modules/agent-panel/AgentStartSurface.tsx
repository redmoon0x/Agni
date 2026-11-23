import { Robot01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { AgentPickerPanel } from "@/modules/agent-panel/AgentPicker";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import type { AgentId } from "@/modules/settings/store";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";

/** Empty right panel: the picker itself is the start surface. */
export function AgentStartSurface({
  workspace,
  cwd,
  tabs,
  onOpenAgent,
  onActivateTab,
}: {
  workspace: WorkspaceEnv;
  cwd: string | null;
  tabs: readonly AgentTab[];
  onOpenAgent: (
    agent: AgentId,
    profileId: string | null,
    modelId?: string | null,
  ) => void;
  onActivateTab: (id: number) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-y-auto bg-card px-4 py-6">
      <span
        className={cn(
          "grid size-11 place-items-center rounded-xl border border-border/60",
          "bg-gradient-to-b from-foreground/[0.05] to-transparent text-muted-foreground",
        )}
      >
        <HugeiconsIcon icon={Robot01Icon} size={20} strokeWidth={1.6} />
      </span>
      <div className="space-y-1 text-center">
        <p className="text-[13px] font-medium text-foreground/90">
          Start an agent session
        </p>
        <p className="mx-auto max-w-72 text-[11px] leading-relaxed text-muted-foreground">
          Pick a harness on the left, then a model on the right. Sessions for
          the same harness share one tab.
        </p>
      </div>
      <div className="w-full max-w-[34rem] overflow-hidden rounded-xl border border-border/70 bg-background/60 shadow-sm">
        <AgentPickerPanel
          workspace={workspace}
          cwd={cwd}
          tabs={tabs}
          onOpenAgent={onOpenAgent}
          onActivateTab={onActivateTab}
          className="h-[17rem]"
        />
      </div>
      <button
        type="button"
        onClick={() => void openSettingsWindow("providers")}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <HugeiconsIcon icon={Settings01Icon} size={11} strokeWidth={1.8} />
        Manage providers
      </button>
    </div>
  );
}