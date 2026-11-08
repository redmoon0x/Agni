import { cn } from "@/lib/utils";
import type { AgentId, AgentPanelMode } from "@/modules/settings/store";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { AgentPanel } from "./AgentPanel";
import { NoAgentSelected } from "./NoAgentSelected";

type Props = {
  tabs: AgentTab[];
  activeId: number | null;
  /** The panel is expanded; a collapsed panel must still notify. */
  visible: boolean;
  workspace: WorkspaceEnv;
  /** Tabs restored from the last launch; their harness session resumes once. */
  resumeTabIds?: ReadonlySet<number>;
  /** Full-workspace surface (focus) or the compact right dock. */
  layoutMode: AgentPanelMode;
  onToggleLayout: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onOpenDiff: (path: string) => void;
  onSwitchProfile: (tab: AgentTab, profileId: string) => void;
  onFanout: (spec: {
    agent: string;
    cwd: string | null;
    workspace: WorkspaceEnv;
    models: { model: string; prompt: string }[];
  }) => void;
  onOpenAgent: (agent: AgentId, profileId?: string | null) => void;
  onBrowseAgents: () => void;
};

/**
 * Hosts every open agent conversation. Switching lives in the Agents sidebar,
 * so the dock has no tab strip or duplicate list of its own.
 */
export function AgentDock({
  tabs,
  activeId,
  visible,
  workspace,
  resumeTabIds,
  layoutMode,
  onToggleLayout,
  onOpenFile,
  onOpenDiff,
  onSwitchProfile,
  onFanout,
  onOpenAgent,
  onBrowseAgents,
}: Props) {
  if (tabs.length === 0) {
    return (
      <NoAgentSelected
        tabs={tabs}
        workspace={workspace}
        onOpenAgent={onOpenAgent}
        onBrowseAgents={onBrowseAgents}
      />
    );
  }

  return (
    <div className="relative h-full min-h-0 bg-card">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "absolute inset-0",
            activeId !== tab.id && "invisible pointer-events-none",
          )}
          aria-hidden={activeId !== tab.id}
        >
          <AgentPanel
            agent={tab.agent}
            cwd={tab.cwd}
            workspace={tab.workspace}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
            tabId={tab.id}
            tabActive={visible && activeId === tab.id}
            profileId={tab.profileId}
            onSwitchProfile={(profileId) => onSwitchProfile(tab, profileId)}
            initialModel={tab.initialModel}
            initialPrompt={tab.initialPrompt}
            resumeLatest={resumeTabIds?.has(tab.id) ?? false}
            layoutMode={layoutMode}
            onToggleLayout={onToggleLayout}
            onFanout={(models) =>
              onFanout({
                agent: tab.agent,
                cwd: tab.cwd,
                workspace: tab.workspace,
                models,
              })
            }
          />
        </div>
      ))}
    </div>
  );
}
