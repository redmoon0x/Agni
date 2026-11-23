import { cn } from "@/lib/utils";
import type { AgentId, AgentPanelMode } from "@/modules/settings/store";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { AgentPanel } from "./AgentPanel";
import { AgentStartSurface } from "./AgentStartSurface";

type Props = {
  tabs: AgentTab[];
  activeId: number | null;
  /** The panel is expanded; a collapsed panel must still notify. */
  visible: boolean;
  workspace: WorkspaceEnv;
  /** Workspace root for a session that has not started yet. */
  cwd: string | null;
  /** Tabs restored from the last launch; their harness session resumes once. */
  resumeTabIds?: ReadonlySet<number>;
  /** Full-workspace surface (focus) or the compact right dock. */
  layoutMode: AgentPanelMode;
  onToggleLayout: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onOpenDiff: (path: string) => void;
  onSwitchProfile: (tab: AgentTab, profileId: string) => void;
  onFanout: (spec: {
    agent: AgentId;
    cwd: string | null;
    workspace: WorkspaceEnv;
    models: { model: string; prompt: string }[];
  }) => void;
  onOpenAgent: (
    agent: AgentId,
    profileId?: string | null,
    modelId?: string | null,
  ) => void;
  onActivateTab: (id: number) => void;
  /** Start another harness in a fresh thread with a handoff prompt. */
  onSpawnAgent?: (
    agent: AgentId,
    profileId: string | null,
    modelId: string | null,
    prompt: string,
  ) => void;
};

/**
 * Hosts every open agent conversation. Choosing a harness lives in the panel
 * itself (header and composer pickers), so the dock has no list of its own.
 */
export function AgentDock({
  tabs,
  activeId,
  visible,
  workspace,
  cwd,
  resumeTabIds,
  layoutMode,
  onToggleLayout,
  onOpenFile,
  onOpenDiff,
  onSwitchProfile,
  onFanout,
  onOpenAgent,
  onActivateTab,
  onSpawnAgent,
}: Props) {
  if (tabs.length === 0) {
    return (
      <AgentStartSurface
        workspace={workspace}
        cwd={cwd}
        tabs={tabs}
        onOpenAgent={onOpenAgent}
        onActivateTab={onActivateTab}
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
            tabs={tabs}
            onOpenAgent={onOpenAgent}
            onActivateTab={onActivateTab}
            onSpawnAgent={onSpawnAgent}
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