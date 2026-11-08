import type { AgentProfile } from "@/modules/agent-panel/lib/profile";
import type { AgentId } from "@/modules/settings/store";

export type AddableRow = {
  key: string;
  agent: AgentId;
  /** Harness name. */
  label: string;
  profileId: string | null;
  /** Account label when the row is a profile. */
  profileLabel: string | null;
  transport: string;
  /** This harness + profile already has an open session tab. */
  open: boolean;
};

type Available = { id: AgentId; label: string };
type OpenAgent = { agent: AgentId; profileId?: string | null };

/**
 * One row per harness, or one row per profile when profiles exist. Open rows
 * stay in the list so the menu can focus them instead of hiding them.
 */
export function buildAddableRows(
  available: readonly Available[],
  profiles: readonly AgentProfile[],
  open: readonly OpenAgent[],
): AddableRow[] {
  const openKeys = new Set(
    open.map((tab) => `${tab.agent}:${tab.profileId ?? ""}`),
  );

  return available.flatMap((agent): AddableRow[] => {
    const transport = agent.id === "pi" ? "Local RPC" : "ACP · stdio";
    if (agent.id === "pi") {
      return [
        {
          key: "pi",
          agent: "pi",
          label: agent.label,
          profileId: null,
          profileLabel: null,
          transport,
          open: openKeys.has("pi:"),
        },
      ];
    }

    const agentProfiles = profiles.filter(
      (profile) => profile.enabled && profile.agent === agent.id,
    );
    if (agentProfiles.length === 0) {
      return [
        {
          key: agent.id,
          agent: agent.id,
          label: agent.label,
          profileId: null,
          profileLabel: null,
          transport,
          open: openKeys.has(`${agent.id}:`),
        },
      ];
    }
    return agentProfiles.map((profile) => ({
      key: `${agent.id}:${profile.id}`,
      agent: agent.id,
      label: agent.label,
      profileId: profile.id,
      profileLabel: profile.label,
      transport,
      open: openKeys.has(`${agent.id}:${profile.id}`),
    }));
  });
}
