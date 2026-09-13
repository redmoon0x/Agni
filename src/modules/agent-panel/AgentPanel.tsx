import { useEffect } from "react";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import { AcpPanel } from "@/modules/acp-agent";
import { ACP_AGENT_LIST } from "@/modules/acp-agent/lib/agent";
import { suspendAcp } from "@/modules/acp-agent/store";
import { cn } from "@/lib/utils";
import { PiPanel } from "@/modules/pi-agent";
import { suspendPi } from "@/modules/pi-agent/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type AgentId,
  setAgentPanelAgent,
} from "@/modules/settings/store";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  cwd: string | null;
  workspace: WorkspaceEnv;
};

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "pi", label: "Pi" },
  ...ACP_AGENT_LIST.map((agent) => ({ id: agent.id, label: agent.label })),
];

export function AgentPanel({ cwd, workspace }: Props) {
  const active = usePreferencesStore((state) => state.agentPanelAgent);

  useEffect(() => {
    const mine = active;
    return () => {
      if (mine === "pi") void suspendPi();
      else void suspendAcp();
    };
  }, [active]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {AGENTS.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => void setAgentPanelAgent(agent.id)}
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
