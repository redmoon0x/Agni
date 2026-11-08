import { useEffect } from "react";
import { AcpPanel } from "@/modules/acp-agent";
import { PiPanel } from "@/modules/pi-agent";
import { suspendPi } from "@/modules/pi-agent/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentId, AgentPanelMode } from "@/modules/settings/store";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  cwd: string | null;
  workspace: WorkspaceEnv;
  /** Pinned to a session tab; omitted only by future non-tab hosts. */
  agent?: AgentId;
  onOpenFile?: (path: string, line?: number) => void;
  /** Open a turn's changed file as a diff tab. */
  onOpenDiff?: (path: string) => void;
  initialModel?: string | null;
  initialPrompt?: string | null;
  onFanout?: (models: { model: string; prompt: string }[]) => void;
  /** Present when hosted by a tab; drives the tab-bar status projection. */
  tabId?: number;
  tabActive?: boolean;
  /** Harness instance (account) to use. */
  profileId?: string | null;
  /** Replace this tab with another account. */
  onSwitchProfile?: (profileId: string) => void;
  /** Restored tab: resume its latest harness session once connected. */
  resumeLatest?: boolean;
  /** Full-workspace surface (focus) or the compact right dock. */
  layoutMode: AgentPanelMode;
  onToggleLayout: () => void;
};

/**
 * Pinned host for one agent session. Identity and account live in the panel
 * header; switching agents happens from the Agents sidebar.
 */
export function AgentPanel({
  cwd,
  workspace,
  agent: pinnedAgent,
  onOpenFile,
  onOpenDiff,
  initialModel,
  initialPrompt,
  onFanout,
  tabId,
  tabActive,
  profileId,
  onSwitchProfile,
  resumeLatest,
  layoutMode,
  onToggleLayout,
}: Props) {
  const preferred = usePreferencesStore((state) => state.agentPanelAgent);
  const active: AgentId = pinnedAgent ?? preferred;

  useEffect(() => {
    if (active !== "pi") return;
    return () => {
      void suspendPi();
    };
  }, [active]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="min-h-0 flex-1">
        {active === "pi" ? (
          <PiPanel
            cwd={cwd}
            workspace={workspace}
            onOpenFile={onOpenFile}
            tabId={tabId}
            active={tabActive}
            profileId={profileId}
            onSwitchProfile={onSwitchProfile}
            layoutMode={layoutMode}
            onToggleLayout={onToggleLayout}
          />
        ) : (
          <AcpPanel
            agent={active}
            cwd={cwd}
            workspace={workspace}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
            initialModel={initialModel}
            initialPrompt={initialPrompt}
            onFanout={onFanout}
            tabId={tabId}
            active={tabActive}
            profileId={profileId}
            onSwitchProfile={onSwitchProfile}
            resumeLatest={resumeLatest}
            layoutMode={layoutMode}
            onToggleLayout={onToggleLayout}
          />
        )}
      </div>
    </div>
  );
}
