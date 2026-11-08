import { Add01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import { buildAddableRows } from "@/modules/agent-panel/lib/addable";
import { useAvailableAgents } from "@/modules/agent-panel/lib/installedAgents";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentId } from "@/modules/settings/store";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  tabs: readonly AgentTab[];
  workspace: WorkspaceEnv;
  onOpenAgent: (agent: AgentId, profileId?: string | null) => void;
  align?: "start" | "end";
  variant?: "icon" | "button";
  className?: string;
};

/**
 * One add/focus menu for every agent surface. Open rows stay listed so
 * selecting them focuses the session instead of silently doing nothing.
 */
export function AgentAddMenu({
  tabs,
  workspace,
  onOpenAgent,
  align = "end",
  variant = "icon",
  className,
}: Props) {
  const available = useAvailableAgents(workspace);
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  const rows = buildAddableRows(available, profiles, tabs);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "icon" ? (
          <button
            type="button"
            aria-label="Add agent"
            title="Add agent"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground",
              className,
            )}
          >
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-foreground/90 transition-colors hover:bg-foreground/[0.05]",
              className,
            )}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
            Add agent
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align={align} className="w-64">
        <DropdownMenuLabel className="text-[10px]">Agents</DropdownMenuLabel>
        {rows.length === 0 ? (
          <DropdownMenuItem disabled>No agent found on PATH</DropdownMenuItem>
        ) : (
          rows.map((row) => (
            <DropdownMenuItem
              key={row.key}
              onSelect={() => onOpenAgent(row.agent, row.profileId)}
              className="gap-2"
            >
              <AgentIcon agent={row.agent} size={14} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[11.5px]">{row.label}</span>
                <span className="truncate text-[9.5px] text-muted-foreground">
                  {row.profileLabel ?? row.transport}
                </span>
              </span>
              {row.open ? (
                <span className="flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-wide text-primary">
                  <HugeiconsIcon icon={Tick02Icon} size={11} />
                  Open
                </span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void openSettingsWindow("providers")}>
          Manage providers…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
