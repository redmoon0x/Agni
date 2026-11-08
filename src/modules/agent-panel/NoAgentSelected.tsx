import { Robot01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import type { AgentId } from "@/modules/settings/store";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { AgentAddMenu } from "./AgentAddMenu";

/** Right-panel placeholder when nothing is open. */
export function NoAgentSelected({
  tabs,
  workspace,
  onOpenAgent,
  onBrowseAgents,
}: {
  tabs: readonly AgentTab[];
  workspace: WorkspaceEnv;
  onOpenAgent: (agent: AgentId, profileId?: string | null) => void;
  onBrowseAgents: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-card px-6 text-center">
      <span
        className={cn(
          "grid size-11 place-items-center rounded-xl border border-border/60",
          "bg-gradient-to-b from-foreground/[0.05] to-transparent text-muted-foreground",
        )}
      >
        <HugeiconsIcon icon={Robot01Icon} size={20} strokeWidth={1.6} />
      </span>
      <div className="space-y-1">
        <p className="text-[12px] font-medium text-foreground/90">
          No agent open
        </p>
        <p className="max-w-56 text-[10.5px] leading-relaxed text-muted-foreground">
          Start a harness and it shows up in the Agents list. Keep several open
          to work in parallel.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBrowseAgents}
          className="rounded-md border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-foreground/90 transition-colors hover:bg-foreground/[0.05]"
        >
          Browse agents
        </button>
        <AgentAddMenu
          tabs={tabs}
          workspace={workspace}
          onOpenAgent={onOpenAgent}
          variant="button"
          className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
        />
      </div>
    </div>
  );
}
