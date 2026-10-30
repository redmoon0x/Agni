import { type ReactNode, useEffect } from "react";
import {
  MoreHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import {
  invalidateAgentAvailability,
  PANEL_AGENTS,
  useInstalledAgents,
} from "@/modules/agent-panel/lib/installedAgents";
import { AcpPanel } from "@/modules/acp-agent";
import { PiPanel } from "@/modules/pi-agent";
import { suspendPi } from "@/modules/pi-agent/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { type AgentId, setAgentPanelAgent } from "@/modules/settings/store";
import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";

type Props = {
  cwd: string | null;
  workspace: WorkspaceEnv;
  onOpenFile?: (path: string, line?: number) => void;
};

export function AgentPanel({ cwd, workspace, onOpenFile }: Props) {
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
    };
  }, [active]);

  if (noneInstalled) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-card">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-[11px] text-muted-foreground">
            No agent found on PATH
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Install an ACP agent or Pi and reopen this panel.
          </p>
        </div>
      </div>
    );
  }

  const selectAgent = (id: AgentId) => {
    void setAgentPanelAgent(id);
    invalidateAgentAvailability();
  };

  const agentPicker = (
    <AgentPicker agents={agents} active={active} onSelect={selectAgent} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="min-h-0 flex-1">
        {active === "pi" ? (
          <PiPanel
            cwd={cwd}
            workspace={workspace}
            agentPicker={agentPicker}
            onOpenFile={onOpenFile}
          />
        ) : (
          <AcpPanel
            key={`${active}:${cwd ?? ""}:${workspaceScopeKey(workspace)}`}
            agent={active}
            cwd={cwd}
            workspace={workspace}
            agentPicker={agentPicker}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </div>
  );
}

function AgentPicker({
  agents,
  active,
  onSelect,
}: {
  agents: { id: AgentId; label: string }[];
  active: AgentId;
  onSelect: (agent: AgentId) => void;
}): ReactNode {
  const activeAgent = agents.find((agent) => agent.id === active);
  if (!activeAgent) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Change agent, currently ${activeAgent.label}`}
          className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-semibold tracking-wide text-foreground uppercase transition-colors hover:bg-foreground/[0.06]"
        >
          <AgentIcon agent={activeAgent.id} size={15} />
          {activeAgent.label}
          <HugeiconsIcon icon={MoreHorizontalIcon} size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-[10px]">Agent</DropdownMenuLabel>
        {agents.map((agent) => (
          <DropdownMenuItem key={agent.id} onSelect={() => onSelect(agent.id)}>
            <AgentIcon agent={agent.id} size={14} />
            <span className="flex-1">{agent.label}</span>
            {agent.id === active ? <HugeiconsIcon icon={Tick02Icon} size={14} /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
