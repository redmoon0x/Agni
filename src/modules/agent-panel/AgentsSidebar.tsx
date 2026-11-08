import { ChartHistogramIcon, Robot01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { AgentAddMenu } from "@/modules/agent-panel/AgentAddMenu";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import { AgentSessionRow } from "@/modules/agent-panel/AgentSessionRow";
import { buildAddableRows } from "@/modules/agent-panel/lib/addable";
import { useAvailableAgents } from "@/modules/agent-panel/lib/installedAgents";
import { handleAgentRowNavigation } from "@/modules/agent-panel/lib/rovingFocus";
import { baseName } from "@/modules/agent-ui/lib/path";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentId } from "@/modules/settings/store";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  cwd: string | null;
  workspace: WorkspaceEnv;
  agentTabs: AgentTab[];
  activeTabId: number | null;
  onActivateTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onOpenAgent: (agent: AgentId, profileId?: string | null) => void;
};

/**
 * T3-style agent switcher: every open session first, then harnesses/profiles
 * that can be opened. Selecting a row focuses the right panel; it never opens
 * a duplicate session for the same agent + account.
 */
export function AgentsSidebar({
  cwd,
  workspace,
  agentTabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onOpenAgent,
}: Props) {
  const available = useAvailableAgents(workspace);
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  const rows = buildAddableRows(available, profiles, agentTabs);
  const availableRows = rows.filter((row) => !row.open);
  const workspaceName = cwd ? baseName(cwd) : "No folder";

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-2.5">
        <span className="grid size-6 place-items-center rounded-md border border-border/50 bg-background/60 text-foreground/80">
          <HugeiconsIcon icon={Robot01Icon} size={13} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground/90">Agents</p>
          <p className="text-[11px] text-muted-foreground">
            {agentTabs.length} open · {availableRows.length} available
          </p>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Token usage"
          title="Token usage"
          onClick={() => void openSettingsWindow("usage")}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <HugeiconsIcon icon={ChartHistogramIcon} size={13} strokeWidth={1.8} />
        </button>
        <AgentAddMenu
          tabs={agentTabs}
          workspace={workspace}
          onOpenAgent={onOpenAgent}
          align="end"
        />
        <button
          type="button"
          aria-label="Manage providers"
          title="Manage providers"
          onClick={() => void openSettingsWindow("providers")}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.8} />
        </button>
      </div>

      <div
        data-agent-list
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5"
      >
        <SectionLabel label="Open" count={agentTabs.length} />
        {agentTabs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-gradient-to-b from-foreground/[0.035] to-transparent px-4 py-5 text-center">
            <span className="mx-auto mb-2 grid size-9 place-items-center rounded-xl border border-border/50 bg-background/60 text-muted-foreground">
              <HugeiconsIcon icon={Robot01Icon} size={16} strokeWidth={1.6} />
            </span>
            <p className="text-[13px] font-medium text-foreground/90">
              No agent open yet
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Pick a harness below, or use + to start one in this workspace.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {agentTabs.map((tab) => (
              <AgentSessionRow
                key={tab.id}
                tab={tab}
                active={tab.id === activeTabId}
                onActivate={() => onActivateTab(tab.id)}
                onClose={() => onCloseTab(tab.id)}
              />
            ))}
          </div>
        )}

        <SectionLabel
          label="Available"
          count={availableRows.length}
          className="mt-4"
        />
        {availableRows.length === 0 ? (
          <p className="rounded-lg border border-border/40 bg-foreground/[0.02] px-2.5 py-2 text-[11px] text-muted-foreground">
            Every installed harness is open.
          </p>
        ) : (
          <div className="space-y-1">
            {availableRows.map((row) => (
              <button
                key={row.key}
                type="button"
                data-agent-row
                onClick={() => onOpenAgent(row.agent, row.profileId)}
                onKeyDown={handleAgentRowNavigation}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left outline-none transition-colors hover:border-border/50 hover:bg-foreground/[0.035] focus-visible:border-primary/40 focus-visible:bg-foreground/[0.04]"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/50 bg-background/60 text-foreground/85 shadow-sm">
                  <AgentIcon agent={row.agent} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-foreground/90">
                      {row.label}
                    </span>
                    {row.profileLabel ? (
                      <span className="shrink-0 rounded border border-border/60 bg-foreground/[0.04] px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {row.profileLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {row.transport}
                    {row.profileLabel
                      ? " · isolated account"
                      : " · default configuration"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 px-1 pb-1 text-[11px] text-muted-foreground">
          Working in {workspaceName}
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {agentTabs.length} open · {availableRows.length} available
        </span>
        <button
          type="button"
          onClick={() => void openSettingsWindow("providers")}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon icon={Settings01Icon} size={10} strokeWidth={1.8} />
          Profiles
        </button>
      </div>
    </div>
  );
}

function SectionLabel({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className?: string;
}) {
  return (
    <div className={cn("mb-1.5 flex items-center gap-1.5 px-1", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="rounded-full bg-foreground/[0.06] px-1.5 text-[10px] tabular-nums text-muted-foreground">
        {count}
      </span>
      <span className="h-px flex-1 bg-border/50" />
    </div>
  );
}
