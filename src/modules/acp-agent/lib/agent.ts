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
  commandcode: {
    id: "commandcode",
    label: "CommandCode",
    program: "commandcode",
    args: ["acp"],
  },
  claude: {
    // Claude Code has no native ACP mode; Zed's adapter bridges it over npx.
    // Launch truth lives in acp.rs; availability is probed on the `claude` CLI.
    id: "claude",
    label: "Claude Code",
    program: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
  },
} as const;

export type AcpAgentId = keyof typeof ACP_AGENTS;

export const DEFAULT_ACP_AGENT: AcpAgentId = "opencode";

export const ACP_AGENT_LIST = Object.values(ACP_AGENTS);

export function acpAgent(id: AcpAgentId): (typeof ACP_AGENTS)[AcpAgentId] {
  return ACP_AGENTS[id];
}
