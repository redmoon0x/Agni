export type AcpConnectionStatus =
  | "idle"
  | "starting"
  | "ready"
  | "exited"
  | "stopped"
  | "error";

export type AcpContentBlock = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type AcpMessageRole = "user" | "agent" | "thought";

export type AcpMessage = {
  id: string;
  role: AcpMessageRole;
  text: string;
  /** Monotonic arrival order assigned by the reducer for chronological rendering. */
  sequence: number;
};

export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed";

export type AcpToolContent =
  | { type: "content"; content: AcpContentBlock }
  | { type: "diff"; path: string; oldText: string | null; newText: string }
  | { type: "terminal"; terminalId: string }
  | { type: "unknown"; value: Record<string, unknown> };

export type AcpToolLocation = { path: string; line?: number };

export type AcpToolCall = {
  id: string;
  title: string;
  kind: string;
  status: AcpToolStatus;
  content: AcpToolContent[];
  locations: AcpToolLocation[];
  rawInput: unknown;
  rawOutput: unknown;
  /** Monotonic arrival order assigned by the reducer for chronological rendering. */
  sequence: number;
};

export type AcpPlanEntry = {
  content: string;
  priority: string | null;
  status: string | null;
};

export type AcpPermissionOption = {
  optionId: string;
  name: string;
  kind: string;
};

export type AcpPermissionRequest = {
  /** JSON-RPC id of the pending client request. */
  id: number | string;
  sessionId: string;
  toolCallId: string | null;
  title: string | null;
  options: AcpPermissionOption[];
};

export type AcpUsage = {
  used: number;
  size: number;
  cost: { amount: number; currency: string } | null;
};

export type AcpCommand = {
  name: string;
  description?: string;
  inputHint?: string;
};

export type AcpAgentInfo = {
  name: string | null;
  title: string | null;
  version: string | null;
};

export type AcpCapabilities = {
  loadSession: boolean;
  sessionList: boolean;
  promptImage: boolean;
  promptAudio: boolean;
  promptEmbeddedContext: boolean;
};

export type AcpConfigOptionValue = {
  value: string;
  name: string;
  description?: string;
};

export type AcpConfigOption = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options: AcpConfigOptionValue[];
};

export type AcpMode = {
  id: string;
  name: string;
  description?: string;
};

export type AcpModeState = {
  currentModeId: string;
  availableModes: AcpMode[];
};

export type AcpImageAttachment = {
  type: "image";
  name: string;
  data: string;
  mimeType: string;
};

export type AcpSessionInfo = {
  sessionId: string;
  cwd: string | null;
  title: string | null;
  updatedAt: string | null;
};

export const EMPTY_ACP_CAPABILITIES: AcpCapabilities = {
  loadSession: false,
  sessionList: false,
  promptImage: false,
  promptAudio: false,
  promptEmbeddedContext: false,
};

export type AcpState = {
  messages: AcpMessage[];
  tools: AcpToolCall[];
  plan: AcpPlanEntry[];
  permission: AcpPermissionRequest | null;
  usage: AcpUsage | null;
  commands: AcpCommand[];
  configOptions: AcpConfigOption[];
  modeState: AcpModeState | null;
  currentMode: string | null;
  agentInfo: AcpAgentInfo;
  capabilities: AcpCapabilities;
  sessionId: string | null;
  isStreaming: boolean;
  lastStopReason: string | null;
  rpcError: string | null;
};

export type AcpProcessEvent =
  | { kind: "rpc"; message: unknown }
  | { kind: "stderr"; message: string }
  | { kind: "protocol_error"; message: string }
  | { kind: "exit"; code: number | null };

export const INITIAL_ACP_STATE: AcpState = {
  messages: [],
  tools: [],
  plan: [],
  permission: null,
  usage: null,
  commands: [],
  configOptions: [],
  modeState: null,
  currentMode: null,
  agentInfo: { name: null, title: null, version: null },
  capabilities: EMPTY_ACP_CAPABILITIES,
  sessionId: null,
  isStreaming: false,
  lastStopReason: null,
  rpcError: null,
};
