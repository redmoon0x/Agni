import type { AcpAgentId } from "@/modules/acp-agent/lib/agent";
import type { WorkspaceEnv } from "@/modules/workspace";

export type AcpSessionConfig = {
  agent: AcpAgentId;
  cwd: string;
  workspace: WorkspaceEnv;
};

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
  uri?: string;
  mimeType?: string;
  data?: string;
  name?: string;
  resource?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AcpMessageRole = "user" | "agent" | "thought";

export type AcpMessage = {
  id: string;
  role: AcpMessageRole;
  text: string;
  content: AcpContentBlock[];
  /** Monotonic arrival order assigned by the reducer for chronological rendering. */
  sequence: number;
};

export type AcpToolStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type AcpDiffChange = {
  operation: string;
  path: string;
  oldPath: string | null;
  fileType: string | null;
  mimeType: string | null;
};

export type AcpToolContent =
  | { type: "content"; content: AcpContentBlock }
  | {
      type: "diff";
      path: string;
      oldText: string | null;
      newText: string;
      /** v2 `changes[]`. Authoritative over the v1 old/new pair. */
      changes: AcpDiffChange[];
      /** v2 `patch.text`, rendered as a git patch when `patchFormat` is `git_patch`. */
      patch: string | null;
      patchFormat: string | null;
    }
  | { type: "terminal"; terminalId: string }
  | { type: "unknown"; value: Record<string, unknown> };

export type AcpToolLocation = { path: string; line?: number };

export type AcpToolCall = {
  id: string;
  title: string;
  /** Optional programmatic tool name, stable across v1 and v2. */
  name: string | null;
  kind: string;
  status: AcpToolStatus;
  content: AcpToolContent[];
  locations: AcpToolLocation[];
  rawInput: unknown;
  rawOutput: unknown;
  /** Monotonic arrival order assigned by the reducer for chronological rendering. */
  sequence: number;
};

export type AcpDisplayTerminal = {
  id: string;
  title: string | null;
  /** v2 `terminal_update.command`. */
  command: string | null;
  /** v2 `terminal_update.cwd`. Absolute when present. */
  cwd: string | null;
  output: string;
  state: string | null;
  exitCode: number | null;
  /** v2 `exitStatus.signal`. */
  signal: string | null;
  source?: "agent" | "client";
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

/** v2 `session/request_permission.subject`. `tool_call` and `command` are the
 *  stable variants; anything else is preserved raw for generic rendering. */
export type AcpPermissionSubject =
  | { type: "tool_call"; toolCall: AcpToolCall }
  | {
      type: "command";
      command: string;
      cwd: string;
      toolCallId: string | null;
      terminalId: string | null;
    }
  | { type: "unknown"; value: Record<string, unknown> };

export type AcpPermissionRequest = {
  /** JSON-RPC id of the pending client request. */
  id: number | string;
  sessionId: string;
  toolCallId: string | null;
  /** Required in v2, optional in v1 (where the copy lived on the tool call). */
  title: string | null;
  /** v2 `description`. Supporting copy for the permission prompt. */
  description: string | null;
  subject: AcpPermissionSubject | null;
  options: AcpPermissionOption[];
};

export type AcpElicitationChoice = {
  id: string;
  value: string | number | boolean;
  name: string;
  description?: string;
};

export type AcpElicitationFieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "select"
  | "multiselect"
  | "json";

export type AcpElicitationField = {
  name: string;
  type: AcpElicitationFieldType;
  title: string;
  description?: string;
  required: boolean;
  choices: AcpElicitationChoice[];
  defaultValue?: string | number | boolean | (string | number | boolean)[];
};

/** Where an elicitation is anchored: a session/tool call, or a bare JSON-RPC
 *  request that predates any session (auth and configuration phases). */
export type AcpElicitationScope =
  | { kind: "session"; sessionId: string; toolCallId: string | null }
  | { kind: "request"; requestId: number | string };

export type AcpElicitationRequest =
  | {
      mode: "form";
      id: number | string;
      scope: AcpElicitationScope | null;
      message: string;
      title: string | null;
      fields: AcpElicitationField[];
    }
  | {
      mode: "url";
      id: number |string;
      scope: AcpElicitationScope | null;
      message: string;
      title: string | null;
      url: string;
      elicitationId: string;
    }
  | {
      /** `_`-prefixed or future mode: preserved raw, never rendered as a
       *  known mode, per the extensibility rules. */
      mode: "other";
      id: number | string;
      scope: AcpElicitationScope | null;
      message: string;
      rawMode: string;
      value: Record<string, unknown>;
    };

export type AcpUsage = {
  used: number;
  size: number;
  cost: { amount: number; currency: string } | null;
};

export type AcpAuthMethod = {
  methodId: string;
  type: "agent" | "terminal" | string;
  name: string;
  description?: string;
  args: string[];
  env: { name: string; value: string }[];
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
  sessionResume: boolean;
  sessionClose: boolean;
  sessionDelete: boolean;
  sessionFork: boolean;
  additionalDirectories: boolean;
  promptImage: boolean;
  promptAudio: boolean;
  promptEmbeddedContext: boolean;
  authLogout: boolean;
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

/** ACP `ModelInfo`: the agent's own model catalog. */
export type AcpModel = {
  modelId: string;
  name: string;
  description: string | null;
};

/** ACP `SessionModelState`: the models a session can switch between. */
export type AcpModelState = {
  currentModelId: string | null;
  availableModels: AcpModel[];
};

export type AcpAttachment = {
  type: "image" | "audio";
  name: string;
  data: string;
  mimeType: string;
};

export type AcpSessionNotice = {
  kind: "retry" | "compaction" | "notice" | "auth";
  text: string;
  /** Standard `notice` severity. Only set for `kind: "notice"`. */
  severity: "info" | "warning" | "error" | "other" | null;
};

export type AcpCompactionStatus = "in_progress" | "completed" | "failed";

export type AcpCompaction = {
  id: string | null;
  status: AcpCompactionStatus | null;
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
  sessionResume: false,
  sessionClose: false,
  sessionDelete: false,
  sessionFork: false,
  additionalDirectories: false,
  promptImage: false,
  promptAudio: false,
  promptEmbeddedContext: false,
  authLogout: false,
};

export type AcpState = {
  messages: AcpMessage[];
  tools: AcpToolCall[];
  terminals: Record<string, AcpDisplayTerminal>;
  plan: AcpPlanEntry[];
  /** v2 `plan_update.planId`. Null when the agent reports an unkeyed v1 plan. */
  planId: string | null;
  permission: AcpPermissionRequest | null;
  elicitation: AcpElicitationRequest | null;
  usage: AcpUsage | null;
  commands: AcpCommand[];
  configOptions: AcpConfigOption[];
  modeState: AcpModeState | null;
  currentMode: string | null;
  modelState: AcpModelState | null;
  agentInfo: AcpAgentInfo;
  capabilities: AcpCapabilities;
  protocolVersion: 1 | 2 | null;
  authMethods: AcpAuthMethod[];
  sessionState: "idle" | "running" | "requires_action" | null;
  sessionId: string | null;
  sessionConfig: AcpSessionConfig | null;
  sessionTitle: string | null;
  notice: AcpSessionNotice | null;
  compaction: AcpCompaction | null;
  isStreaming: boolean;
  lastStopReason: string | null;
  /** v2 idle `state_update.error` payload for `stopReason: "error"`. */
  lastStopError: string | null;
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
  terminals: {},
  plan: [],
  planId: null,
  permission: null,
  elicitation: null,
  usage: null,
  commands: [],
  configOptions: [],
  modeState: null,
  currentMode: null,
  modelState: null,
  agentInfo: { name: null, title: null, version: null },
  capabilities: EMPTY_ACP_CAPABILITIES,
  protocolVersion: null,
  authMethods: [],
  sessionState: null,
  sessionId: null,
  sessionConfig: null,
  sessionTitle: null,
  notice: null,
  compaction: null,
  isStreaming: false,
  lastStopReason: null,
  lastStopError: null,
  rpcError: null,
};
