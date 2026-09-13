export const ACP_AGENTS = {
  opencode: {
    id: "opencode",
    label: "OpenCode",
    program: "opencode",
    args: ["acp"],
  },
  kilo: {
    id: "kilo",
    label: "Kilo Code",
    program: "kilo",
    args: ["acp"],
  },
} as const;

export type AcpAgentId = keyof typeof ACP_AGENTS;

export const DEFAULT_ACP_AGENT: AcpAgentId = "opencode";

export const ACP_AGENT_LIST = Object.values(ACP_AGENTS);

export function acpAgent(id: AcpAgentId): (typeof ACP_AGENTS)[AcpAgentId] {
  return ACP_AGENTS[id];
}
