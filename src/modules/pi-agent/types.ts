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

export type PiQueueMode = "all" | "one-at-a-time";

export type PiImageAttachment = {
  type: "image";
  name: string;
  data: string;
  mimeType: string;
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
  /** Monotonic arrival order assigned by the reducer for chronological rendering. */
  sequence?: number;
};

export type PiToolActivity = {
  id: string;
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  output: string;
  /** Monotonic arrival order assigned by the reducer for chronological rendering. */
  sequence?: number;
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

export type PiExtensionNotification = {
  id: string;
  message: string;
  type: "info" | "warning" | "error";
};

export type PiExtensionWidget = {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
};

export type PiForkMessage = {
  entryId: string;
  text: string;
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
  steeringMode: PiQueueMode;
  followUpMode: PiQueueMode;
  pendingMessageCount: number;
  isRetrying: boolean;
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
  extensionNotification: PiExtensionNotification | null;
  extensionStatuses: Record<string, string>;
  extensionWidgets: PiExtensionWidget[];
  extensionTitle: string | null;
  extensionEditorText: { id: string; text: string } | null;
  forkMessages: PiForkMessage[];
  exportedHtmlPath: string | null;
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
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    pendingMessageCount: 0,
    isRetrying: false,
  },
  extensionRequest: null,
  extensionNotification: null,
  extensionStatuses: {},
  extensionWidgets: [],
  extensionTitle: null,
  extensionEditorText: null,
  forkMessages: [],
  exportedHtmlPath: null,
  rpcError: null,
};
