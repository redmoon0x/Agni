import { useEffect } from "react";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import {
  PANEL_AGENTS,
  useInstalledAgents,
} from "@/modules/agent-panel/lib/installedAgents";
import { AcpPanel } from "@/modules/acp-agent";
import { suspendAcp } from "@/modules/acp-agent/store";
import { cn } from "@/lib/utils";
import { PiPanel } from "@/modules/pi-agent";
import { suspendPi } from "@/modules/pi-agent/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { type AgentId, setAgentPanelAgent } from "@/modules/settings/store";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  cwd: string | null;
  workspace: WorkspaceEnv;
};

export function AgentPanel({ cwd, workspace }: Props) {
  const preferred = usePreferencesStore((state) => state.agentPanelAgent);
  const installed = useInstalledAgents(workspace);
  const agents = installed
    ? PANEL_AGENTS.filter((agent) => installed.includes(agent.id))
    : PANEL_AGENTS;
  const active = agents.some((agent) => agent.id === preferred)
    ? preferred
    : (agents[0]?.id ?? preferred);
  const noneInstalled = agents.length === 0;

  useEffect(() => {
    if (active !== preferred) void setAgentPanelAgent(active);
  }, [active, preferred]);

  useEffect(() => {
    const mine = active;
    return () => {
      if (mine === "pi") void suspendPi();
      else void suspendAcp();
    };
  }, [active]);

  if (noneInstalled) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-card">
        <AgentTabs
          agents={agents}
          active={active}
          onSelect={setAgentPanelAgent}
        />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-[11px] text-muted-foreground">
            No agent found on PATH
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Install Pi, Kilo Code, or OpenCode and reopen this panel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <AgentTabs
        agents={agents}
        active={active}
        onSelect={setAgentPanelAgent}
      />
      <div className="min-h-0 flex-1">
        {active === "pi" ? (
          <PiPanel cwd={cwd} workspace={workspace} />
        ) : (
          <AcpPanel agent={active} cwd={cwd} workspace={workspace} />
        )}
      </div>
    </div>
  );
}

function AgentTabs({
  agents,
  active,
  onSelect,
}: {
  agents: { id: AgentId; label: string }[];
  active: AgentId;
  onSelect: (agent: AgentId) => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onSelect(agent.id)}
          aria-pressed={active === agent.id}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors",
            active === agent.id
              ? "bg-foreground/[0.08] font-medium text-foreground"
              : "text-muted-foreground hover:bg-foreground/[0.05]",
          )}
        >
          <AgentIcon agent={agent.id} size={12} />
          {agent.label}
        </button>
      ))}
    </div>
  );
}
