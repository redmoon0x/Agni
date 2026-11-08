import type { AgniRuntimeMode } from "@/modules/acp-agent/lib/runtimeModes";
import type { AcpPermissionRequest } from "@/modules/acp-agent/types";

/**
 * Per-agent quirks, declared as data rather than branches in orchestration.
 * Mirrors T3's `AcpAdapterV2Flavor`: orchestration stays generic and each
 * harness opts into the handful of behaviors it actually needs.
 */
export type AcpAgentFlavor = {
  /** Override the advertised capability when a harness lies about it. */
  supportsImagePrompts?: boolean;
  supportsAudioPrompts?: boolean;
  /** Map Agni's four policies onto the harness's own mode ids. */
  sessionModeForPolicy?: Partial<Record<AgniRuntimeMode, string | null>>;
  /** Extra copy for the permission card when the harness sends none. */
  extractPermissionQuestion?: (request: AcpPermissionRequest) => string | null;
  /** Cancel means "stop the turn" here, so the prompt must be resumed later. */
  interruptPromptOnCancel?: boolean;
  /** The harness needs a runtime restart after an interrupt before it accepts a prompt. */
  restartRuntimeAfterInterrupt?: boolean;
};

export type AcpAgentDescriptor = {
  id: string;
  label: string;
  program: string;
  args: string[];
  /** Program probed for availability; can differ from `program` (Claude). */
  probeProgram: string;
  flavor: AcpAgentFlavor;
};

/**
 * Static catalog: launch truth lives in `acp.rs`; this mirror keeps the UI
 * working before the first IPC round-trip. `agentCatalog.ts` verifies the two
 * agree in development.
 */
export const ACP_AGENTS = {
  opencode: {
    id: "opencode",
    label: "OpenCode",
    program: "opencode",
    args: ["acp"],
    probeProgram: "opencode",
    flavor: {},
  },
  kilo: {
    id: "kilo",
    label: "Kilo Code",
    program: "kilo",
    args: ["acp"],
    probeProgram: "kilo",
    flavor: {},
  },
  commandcode: {
    id: "commandcode",
    label: "CommandCode",
    program: "commandcode",
    args: ["acp"],
    probeProgram: "commandcode",
    flavor: {},
  },
  claude: {
    // Claude Code has no native ACP mode; Zed's adapter bridges it over npx.
    // Availability is probed on the `claude` CLI, not on npx.
    id: "claude",
    label: "Claude Code",
    program: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
    probeProgram: "claude",
    flavor: {},
  },
  hermes: {
    // Hermes ships its own ACP server, so it launches the CLI directly.
    id: "hermes",
    label: "Hermes",
    program: "hermes",
    args: ["acp"],
    probeProgram: "hermes",
    flavor: {},
  },
  omp: {
    id: "omp",
    label: "OMP",
    program: "omp",
    args: ["acp"],
    probeProgram: "omp",
    flavor: {},
  },
} as const satisfies Record<string, AcpAgentDescriptor>;

export type AcpAgentId = keyof typeof ACP_AGENTS;

export const DEFAULT_ACP_AGENT: AcpAgentId = "opencode";

export const ACP_AGENT_LIST: (typeof ACP_AGENTS)[AcpAgentId][] =
  Object.values(ACP_AGENTS);

export function acpAgent(id: AcpAgentId): (typeof ACP_AGENTS)[AcpAgentId] {
  return ACP_AGENTS[id];
}

export function isAcpAgentId(value: unknown): value is AcpAgentId {
  return typeof value === "string" && Object.keys(ACP_AGENTS).includes(value);
}
