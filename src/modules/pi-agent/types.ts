export type PiConnectionStatus =
  | "idle"
  | "starting"
  | "ready"
  | "exited"
  | "stopped"
  | "error";

export type PiModel = {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
};

export type PiContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
};

export type PiMessage = {
  role: string;
  content: string | PiContentBlock[];
  timestamp?: number;
};

export type PiToolActivity = {
  id: string;
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  output: string;
};

export type PiExtensionRequest = {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
};

export type PiSessionState = {
  model: PiModel | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionId?: string;
  sessionName?: string;
  sessionFile?: string;
  autoCompactionEnabled: boolean;
};

export type PiCommandInfo = {
  name: string;
  description?: string;
};

export type PiSessionStats = {
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  totalMessages?: number;
  cost?: number;
  contextUsage?: unknown;
};

export type PiSessionEntry = {
  path: string;
  name: string | null;
  timestamp: string | null;
};

export type PiRpcState = {
  messages: PiMessage[];
  tools: PiToolActivity[];
  models: PiModel[];
  thinkingLevels: string[];
  commands: PiCommandInfo[];
  stats: PiSessionStats | null;
  session: PiSessionState;
  extensionRequest: PiExtensionRequest | null;
  rpcError: string | null;
};

export type PiProcessEvent =
  | { kind: "rpc"; message: unknown }
  | { kind: "stderr"; message: string }
  | { kind: "protocol_error"; message: string }
  | { kind: "exit"; code: number | null };

export const INITIAL_PI_RPC_STATE: PiRpcState = {
  messages: [],
  tools: [],
  models: [],
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
  commands: [],
  stats: null,
  session: {
    model: null,
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
  },
  extensionRequest: null,
  rpcError: null,
};
