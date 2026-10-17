import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  appendUserPrompt,
  mergeConfigOptions,
  parseAuthMethods,
  parseAgentCapabilities,
  parseAgentInfo,
  parseCommands,
  parseConfigOptions,
  parseEndTurnUsage,
  parseModeState,
  parseSessionListPage,
  reconcileAcpUserMessage,
  reduceAcpMessage,
  resetAcpConversation,
} from "@/modules/acp-agent/acpState";
import {
  getAcpEditorBuffer,
  getAcpEditorBufferSnapshot,
} from "@/modules/acp-agent/bufferRegistry";
import {
  createSerialQueue,
  isPathWithinRoots,
  sameSessionConfig,
  settleWithin,
  withTimeout,
} from "@/modules/acp-agent/lifecycle";
import type { AcpAgentId } from "@/modules/acp-agent/lib/agent";
import {
  terminalAuthCommand,
  terminalAuthHint,
} from "@/modules/acp-agent/terminalAuth";
import { runInDockTerminal } from "@/modules/terminal-dock/lib/dockBridge";
import { invalidateAgentAvailability } from "@/modules/agent-panel/lib/installedAgents";
import {
  INITIAL_ACP_STATE,
  type AcpAttachment,
  type AcpConnectionStatus,
  type AcpPermissionRequest,
  type AcpPermissionSubject,
  type AcpProcessEvent,
  type AcpSessionConfig,
  type AcpSessionInfo,
  type AcpState,
  type AcpToolStatus,
} from "@/modules/acp-agent/types";
import { parseElicitationRequest } from "@/modules/acp-agent/elicitation";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv, type WorkspaceEnv } from "@/modules/workspace";

const ACP_PROTOCOL_VERSION = 2;
const MAX_OUTBOUND_ACP_BYTES = 12 * 1024 * 1024;
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 3_000;
const CLOSE_BUDGET_MS = 750;

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type AcpMention = { rel: string; path: string };

export type AcpPromptInput = {
  text: string;
  mentions?: AcpMention[];
  attachments?: AcpAttachment[];
};

type AcpStore = AcpState & {
  connection: AcpConnectionStatus;
  processError: string | null;
  diagnostic: string | null;
};

const INITIAL_STORE: AcpStore = {
  ...INITIAL_ACP_STATE,
  connection: "idle",
  processError: null,
  diagnostic: null,
};

export const useAcpStore = create<AcpStore>(() => INITIAL_STORE);

let processId: number | null = null;
let requestSequence = 0;
let generation = 0;
let promptRequestId: number | null = null;
let promptLocalMessageId: string | null = null;
let draining = false;
let sessionConfig: AcpSessionConfig | null = null;
let desired: AcpSessionConfig | null = null;
let activeConfig: AcpSessionConfig | null = null;
const transitions = createSerialQueue();
const activeClient: { channel: Channel<AcpProcessEvent> | null } = {
  channel: null,
};
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: unknown) => void }
>();

const MIME_BY_EXT: Record<string, string> = {
  ts: "text/typescript",
  tsx: "text/typescript",
  js: "text/javascript",
  jsx: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  css: "text/css",
  html: "text/html",
  rs: "text/rust",
  py: "text/x-python",
  go: "text/x-go",
  toml: "text/toml",
  yml: "text/yaml",
  yaml: "text/yaml",
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requestId(): number {
  requestSequence += 1;
  return requestSequence;
}

function fileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("/")
    ? `file://${normalized}`
    : `file:///${normalized}`;
}

function mimeForPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MIME_BY_EXT[ext] : undefined;
}

function errorText(error: unknown): string {
  const object = asObject(error);
  if (object) {
    const message = typeof object.message === "string" ? object.message : null;
    const code = typeof object.code === "number" ? object.code : null;
    if (message) {
      const base = code === null ? message : `${message} (code ${code})`;
      if (code === -32000) {
        return `${base}. Authenticate in a terminal (e.g. \`opencode auth login\`).`;
      }
      return base;
    }
  }
  return String(error);
}

function isRunningAcpAgentError(error: unknown): boolean {
  return errorText(error).includes("An ACP agent is already running");
}

function assertOutboundMessageSize(message: Record<string, unknown>): void {
  const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  if (bytes > MAX_OUTBOUND_ACP_BYTES) {
    throw new Error(
      "This request is larger than 12 MiB. Remove some file context or image attachments and try again.",
    );
  }
}

async function send(message: Record<string, unknown>): Promise<void> {
  if (processId === null) throw new Error("The agent is not running");
  assertOutboundMessageSize(message);
  await invoke("acp_send", { sessionId: processId, message });
}

function sendRequest(
  method: string,
  params: Record<string, unknown>,
): { id: number; promise: Promise<unknown> } {
  const id = requestId();
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      void send({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        if (pending.delete(id)) reject(error);
      });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
  return { id, promise };
}

function sendResult(id: number | string, result: unknown): void {
  void send({ jsonrpc: "2.0", id, result }).catch(() => {});
}

function sendError(id: number | string, code: number, message: string): void {
  void send({ jsonrpc: "2.0", id, error: { code, message } }).catch(() => {});
}

function sendNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  void send({ jsonrpc: "2.0", method, params }).catch(() => {});
}

function workspaceEnv(): WorkspaceEnv {
  return sessionConfig?.workspace ?? currentWorkspaceEnv();
}

function sessionCwd(): string | null {
  return sessionConfig?.cwd ?? null;
}

function protocolVersion(): 1 | 2 {
  return useAcpStore.getState().protocolVersion ?? 1;
}

/** ACP v1 makes `mcpServers` a required field on session/new, session/load and
 *  session/resume. Agni ships no MCP configuration, so it is always empty. v2
 *  makes the field optional and it is omitted. */
function withMcpServers(
  params: Record<string, unknown>,
  version: 1 | 2,
): Record<string, unknown> {
  if (version === 1) params.mcpServers = [];
  return params;
}

function sessionAdditionalDirectories(): string[] {
  return usePreferencesStore.getState().acpAdditionalDirectories;
}

function sessionRoots(): string[] {
  const roots: string[] = [];
  if (sessionConfig) roots.push(sessionConfig.cwd);
  return roots.concat(sessionAdditionalDirectories());
}

function isPathInSessionRoots(path: string): boolean {
  return isPathWithinRoots(path, sessionRoots());
}

function sessionSetupDirectories(capabilities: {
  additionalDirectories: boolean;
}): string[] {
  if (!capabilities.additionalDirectories) return [];
  return sessionAdditionalDirectories();
}

function hasActiveSession(params: Record<string, unknown>): boolean {
  const requested =
    typeof params.sessionId === "string" ? params.sessionId : null;
  return requested !== null && requested === useAcpStore.getState().sessionId;
}

function parseEnvEntries(value: unknown): { name: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = asObject(item);
    const name =
      object && typeof object.name === "string" ? object.name.trim() : "";
    const entryValue =
      object && typeof object.value === "string" ? object.value : null;
    return name && entryValue !== null ? [{ name, value: entryValue }] : [];
  });
}

type TerminalExit = { exitCode: number | null; signal: string | null };

type TerminalOutputResult = {
  output: string;
  truncated: boolean;
  exitStatus: TerminalExit | null;
};

async function handleTerminalRequest(
  id: number | string,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (!hasActiveSession(params)) {
    sendError(id, -32602, "The requested session is not active");
    return;
  }
  try {
    if (method === "terminal/create") {
      const command =
        typeof params.command === "string" ? params.command.trim() : "";
      if (!command) {
        sendError(id, -32602, "terminal/create requires a command");
        return;
      }
      const args = Array.isArray(params.args)
        ? params.args.filter((arg): arg is string => typeof arg === "string")
        : [];
      const cwd = typeof params.cwd === "string" ? params.cwd : sessionCwd();
      if (!cwd || !isPathInSessionRoots(cwd)) {
        sendError(
          id,
          -32602,
          "The terminal working directory is outside the active session workspace",
        );
        return;
      }
      const result = await invoke<{ terminalId: string }>(
        "acp_terminal_create",
        {
          command,
          args,
          env: parseEnvEntries(params.env),
          cwd,
          outputByteLimit:
            typeof params.outputByteLimit === "number"
              ? params.outputByteLimit
              : undefined,
        },
      );
      sendResult(id, { terminalId: result.terminalId });
      return;
    }
    const terminalId =
      typeof params.terminalId === "string" ? params.terminalId : "";
    if (!terminalId) {
      sendError(id, -32602, `${method} requires a terminalId`);
      return;
    }
    if (method === "terminal/output") {
      const result = await invoke<TerminalOutputResult>(
        "acp_terminal_output",
        { terminalId },
      );
      sendResult(id, result);
      return;
    }
    if (method === "terminal/wait_for_exit") {
      const result = await invoke<TerminalExit>("acp_terminal_wait_for_exit", {
        terminalId,
      });
      sendResult(id, result);
      return;
    }
    if (method === "terminal/kill") {
      await invoke("acp_terminal_kill", { terminalId });
      sendResult(id, null);
      return;
    }
    if (method === "terminal/release") {
      await refreshAcpTerminal(terminalId);
      await invoke("acp_terminal_release", { terminalId });
      useAcpStore.setState((state) => {
        const existing = state.terminals[terminalId];
        if (!existing) return {};
        return {
          terminals: {
            ...state.terminals,
            [terminalId]: { ...existing, state: "exited" },
          },
        };
      });
      sendResult(id, null);
      return;
    }
    sendError(id, -32601, `Unsupported method: ${method}`);
  } catch (error) {
    sendError(id, -32603, String(error));
  }
}

function sliceLines(content: string, line: unknown, limit: unknown): string {
  if (typeof line !== "number" && typeof limit !== "number") return content;
  const lines = content.split("\n");
  const start = typeof line === "number" ? Math.max(0, line - 1) : 0;
  const end = typeof limit === "number" ? start + limit : lines.length;
  return lines.slice(start, end).join("\n");
}

function handleResponse(
  id: number | string,
  message: Record<string, unknown>,
): void {
  const numericId = typeof id === "number" ? id : null;
  const entry = numericId === null ? undefined : pending.get(numericId);
  const error = message.error;
  if (id === promptRequestId) {
    promptRequestId = null;
    const result = message.result as
      | { stopReason?: string; usage?: unknown }
      | null
      | undefined;
    if (result && "usage" in result && !error) {
      useAcpStore.setState((state) => ({
        usage: parseEndTurnUsage(result.usage, state.usage),
      }));
    }
    if (useAcpStore.getState().notice?.kind === "retry") {
      useAcpStore.setState({ notice: null });
    }
    if (protocolVersion() === 1) {
      // v1 reports the outcome on the prompt response itself.
      useAcpStore.setState({
        isStreaming: false,
        sessionState: "idle",
        lastStopReason: error ? "error" : (result?.stopReason ?? null),
        lastStopError: error ? errorText(error) : null,
      });
    } else {
      const messageId =
        result &&
        typeof (result as { messageId?: unknown }).messageId === "string"
          ? (result as { messageId: string }).messageId
          : null;
      if (messageId && promptLocalMessageId) {
        const localId = promptLocalMessageId;
        useAcpStore.setState((state) =>
          reconcileAcpUserMessage(state, localId, messageId),
        );
      }
      if (error) {
        // In v2 an error response means the message was never inserted; the
        // turn never started, so there is no stop reason to report.
        useAcpStore.setState({ isStreaming: false, sessionState: "idle" });
      }
    }
    promptLocalMessageId = null;
  }
  if (!entry || numericId === null) return;
  pending.delete(numericId);
  if (error) entry.reject(new Error(errorText(error)));
  else entry.resolve(message.result ?? null);
}

/** v1 nests permission copy and tool state in `toolCall`; v2 makes `title`
 *  required, adds `description`, and moves the tool call into `subject`. */
function parsePermissionRequest(
  id: number | string,
  params: Record<string, unknown>,
): AcpPermissionRequest {
  const rawOptions = Array.isArray(params.options) ? params.options : [];
  const options = rawOptions.flatMap((option) => {
    const object = asObject(option);
    const optionId =
      object && typeof object.optionId === "string" ? object.optionId : null;
    const name =
      object && typeof object.name === "string" ? object.name : null;
    if (!optionId || !name) return [];
    const kind =
      object && typeof object.kind === "string" ? object.kind : "allow_once";
    return [{ optionId, name, kind }];
  });

  const subject = asObject(params.subject);
  const subjectType =
    subject && typeof subject.type === "string" ? subject.type : null;
  // v1 puts the tool call directly in `toolCall`; v2 nests it in `subject`.
  let toolCall: Record<string, unknown> | null = asObject(params.toolCall);
  let parsedSubject: AcpPermissionSubject | null = null;
  if (subjectType === "tool_call") {
    const nested = asObject(subject?.toolCall);
    if (nested) {
      toolCall = nested;
      parsedSubject = {
        type: "tool_call",
        toolCall: {
          id: typeof nested.toolCallId === "string" ? nested.toolCallId : "",
          title: typeof nested.title === "string" ? nested.title : "",
          name: typeof nested.name === "string" ? nested.name : null,
          kind: typeof nested.kind === "string" ? nested.kind : "other",
          status: normalizePermissionStatus(nested.status),
          content: [],
          locations: [],
          rawInput: nested.rawInput ?? null,
          rawOutput: nested.rawOutput ?? null,
          sequence: 0,
        },
      };
    }
  } else if (subjectType === "command") {
    const command =
      typeof subject?.command === "string" ? subject.command : "";
    const cwd = typeof subject?.cwd === "string" ? subject.cwd : "";
    if (command && cwd) {
      parsedSubject = {
        type: "command",
        command,
        cwd,
        toolCallId:
          typeof subject?.toolCallId === "string" ? subject.toolCallId : null,
        terminalId:
          typeof subject?.terminalId === "string" ? subject.terminalId : null,
      };
    }
  } else if (subject) {
    // Unknown subject types must survive for proxying; render them generically
    // or decline by policy rather than treating them as a tool call.
    parsedSubject = { type: "unknown", value: subject };
  }

  return {
    id,
    sessionId: typeof params.sessionId === "string" ? params.sessionId : "",
    toolCallId:
      typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : null,
    title:
      typeof params.title === "string"
        ? params.title
        : toolCall && typeof toolCall.title === "string"
          ? toolCall.title
          : null,
    description:
      typeof params.description === "string" ? params.description : null,
    subject: parsedSubject,
    options,
  };
}

function normalizePermissionStatus(value: unknown): AcpToolStatus {
  if (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "pending";
}

async function handleClientRequest(
  id: number | string,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (method === "session/request_permission") {
    useAcpStore.setState({ permission: parsePermissionRequest(id, params) });
    return;
  }

  if (method === "elicitation/create") {
    const elicitation = parseElicitationRequest(id, params);
    if (!elicitation) {
      sendError(id, -32602, "Unsupported elicitation request");
      return;
    }
    if (useAcpStore.getState().elicitation) {
      sendError(id, -32000, "Another elicitation is already awaiting input");
      return;
    }
    useAcpStore.setState({ elicitation });
    return;
  }

  if (method.startsWith("terminal/")) {
    await handleTerminalRequest(id, method, params);
    return;
  }

  if (method === "fs/read_text_file") {
    const path = typeof params.path === "string" ? params.path : "";
    if (!hasActiveSession(params) || !isPathInSessionRoots(path)) {
      sendError(
        id,
        -32602,
        "The requested file is outside the active session workspace",
      );
      return;
    }
    const buffer = getAcpEditorBuffer(path, workspaceEnv());
    if (buffer !== null) {
      sendResult(id, {
        content: sliceLines(buffer, params.line, params.limit),
      });
      return;
    }
    let result: ReadResult | null = null;
    try {
      result = await invoke<ReadResult>("fs_read_file", {
        path,
        workspace: workspaceEnv(),
      });
    } catch (error) {
      sendError(id, -32603, String(error));
      return;
    }
    if (result.kind !== "text") {
      sendError(id, -32603, `Cannot read text file: ${path}`);
      return;
    }
    sendResult(id, {
      content: sliceLines(result.content, params.line, params.limit),
    });
    return;
  }

  if (method === "fs/write_text_file") {
    const path = typeof params.path === "string" ? params.path : "";
    const content = typeof params.content === "string" ? params.content : "";
    if (!hasActiveSession(params) || !isPathInSessionRoots(path)) {
      sendError(
        id,
        -32602,
        "The requested file is outside the active session workspace",
      );
      return;
    }
    if (getAcpEditorBufferSnapshot(path, workspaceEnv())?.dirty) {
      sendError(
        id,
        -32000,
        "The file has unsaved editor changes. Save or resolve the file before the agent writes it.",
      );
      return;
    }
    try {
      await invoke("fs_write_file", {
        path,
        content,
        workspace: workspaceEnv(),
        source: "acp",
      });
      sendResult(id, null);
    } catch (error) {
      sendError(id, -32603, String(error));
    }
    return;
  }

  sendError(id, -32601, `Unsupported method: ${method}`);
}

/** Routes one inbound JSON-RPC frame (single message or batch entry). */
function handleRpcMessage(value: unknown): void {
  const message = asObject(value);
  if (!message) return;
  const method = typeof message.method === "string" ? message.method : null;
  const id =
    typeof message.id === "number" || typeof message.id === "string"
      ? message.id
      : null;

  if (draining) {
    // Only outstanding responses matter while shutting down.
    if (id !== null && method === null) handleResponse(id, message);
    return;
  }

  if (method === "$/cancel_request") {
    const params = asObject(message.params) ?? {};
    const cancelled = params.requestId;
    if (typeof cancelled === "number") {
      const entry = pending.get(cancelled);
      pending.delete(cancelled);
      entry?.reject(new Error("The agent cancelled the request"));
    } else if (typeof cancelled === "string") {
      for (const [key, entry] of pending) {
        if (String(key) === cancelled) {
          entry.reject(new Error("The agent cancelled the request"));
          pending.delete(key);
        }
      }
    }
    if (id !== null) sendResult(id, null);
    return;
  }
  if (method === "elicitation/complete") {
    const params = asObject(message.params) ?? {};
    const elicitationId =
      typeof params.elicitationId === "string" ? params.elicitationId : null;
    const current = useAcpStore.getState().elicitation;
    if (
      elicitationId &&
      current?.mode === "url" &&
      current.elicitationId === elicitationId
    ) {
      useAcpStore.setState({ elicitation: null });
    }
    if (id !== null) sendResult(id, null);
    return;
  }
  if (method && id !== null) {
    void handleClientRequest(id, method, asObject(message.params) ?? {});
    return;
  }
  if (method) {
    useAcpStore.setState((state) => reduceAcpMessage(state, message));
    return;
  }
  if (id !== null) handleResponse(id, message);
}

function handleProcessEvent(
  event: AcpProcessEvent,
  eventGeneration: number,
): void {
  if (eventGeneration !== generation) return;
  if (event.kind === "rpc") {
    // JSON-RPC 2.0 batch: one newline-delimited frame may be an array.
    if (Array.isArray(event.message)) {
      for (const entry of event.message) handleRpcMessage(entry);
      return;
    }
    handleRpcMessage(event.message);
    return;
  }
  if (event.kind === "stderr") {
    useAcpStore.setState({ diagnostic: event.message });
    return;
  }
  if (event.kind === "protocol_error") {
    promptRequestId = null;
    promptLocalMessageId = null;
    for (const entry of pending.values())
      entry.reject(new Error(event.message));
    pending.clear();
    useAcpStore.setState({
      rpcError: event.message,
      isStreaming: false,
      permission: null,
      elicitation: null,
    });
    return;
  }
  processId = null;
  activeConfig = null;
  activeClient.channel = null;
  promptRequestId = null;
  promptLocalMessageId = null;
  for (const entry of pending.values())
    entry.reject(new Error("The agent exited"));
  pending.clear();
  const diagnostic = useAcpStore.getState().diagnostic;
  useAcpStore.setState({
    connection: "exited",
    sessionId: null,
    isStreaming: false,
    permission: null,
    elicitation: null,
    processError:
      diagnostic ??
      (event.code === 0 || event.code === null
        ? null
        : `The agent exited with code ${event.code}`),
  });
}

async function stopProcess(
  closeSessionId: string | null,
  canClose: boolean,
): Promise<void> {
  const id = processId;
  draining = true;
  try {
    if (id !== null && closeSessionId && canClose) {
      await settleWithin(
        sendRequest("session/close", { sessionId: closeSessionId }).promise.catch(
          () => undefined,
        ),
        CLOSE_BUDGET_MS,
      );
    }
  } finally {
    generation += 1;
    promptRequestId = null;
    promptLocalMessageId = null;
    activeClient.channel = null;
    draining = false;
  }
  processId = null;
  activeConfig = null;
  for (const entry of pending.values())
    entry.reject(new Error("The agent session ended"));
  pending.clear();
  if (id !== null) {
    await withTimeout(
      invoke("acp_stop", { sessionId: id }),
      STOP_TIMEOUT_MS,
      "Timed out stopping the agent",
    ).catch(() => {});
  }
  await invoke("acp_terminal_close_all").catch(() => {});
}

async function spawnSession(
  config: AcpSessionConfig,
  eventGeneration: number,
): Promise<void> {
  const start = async (): Promise<{ sessionId: number }> => {
    try {
      return await invoke<{ sessionId: number }>("acp_start", {
        agent: config.agent,
        cwd: config.cwd,
        workspace: config.workspace,
        onEvent: activeClient.channel,
      });
    } catch (error) {
      if (!isRunningAcpAgentError(error)) throw error;
      await invoke("acp_close_all");
      return invoke<{ sessionId: number }>("acp_start", {
        agent: config.agent,
        cwd: config.cwd,
        workspace: config.workspace,
        onEvent: activeClient.channel,
      });
    }
  };

  const result = await start();
  if (eventGeneration !== generation || !sameSessionConfig(sessionConfig, config)) {
    await invoke("acp_stop", { sessionId: result.sessionId }).catch(() => {});
    return;
  }
  processId = result.sessionId;
  activeConfig = config;
  const clientVersion = await getVersion().catch(() => "0.0.0");
  if (eventGeneration !== generation) return;
  const initialized = (await sendRequest("initialize", {
    protocolVersion: ACP_PROTOCOL_VERSION,
    info: { name: "agni", title: "Agni", version: clientVersion },
    capabilities: {},
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
      elicitation: { form: {}, url: {} },
      auth: { terminal: true },
      session: {
        configOptions: { boolean: {} },
        // v1 gates these behind client capabilities: agents must not send
        // `notice`, `compaction_update` or `compaction_summary_chunk` to a
        // client that omits them.
        notices: {},
        compaction: {},
      },
    },
    clientInfo: { name: "agni", title: "Agni", version: clientVersion },
  }).promise) as {
    protocolVersion?: number;
    agentCapabilities?: unknown;
    agentInfo?: unknown;
    capabilities?: unknown;
    info?: unknown;
    authMethods?: unknown;
  } | null;
  if (
    initialized?.protocolVersion !== 1 &&
    initialized?.protocolVersion !== 2
  ) {
    throw new Error(
      `The agent selected an unsupported ACP version: ${initialized?.protocolVersion ?? "unknown"}`,
    );
  }
  const selectedVersion = initialized.protocolVersion;
  const selectedCapabilities = parseAgentCapabilities(
    initialized.capabilities ?? initialized.agentCapabilities,
  );
  const sessionParams: Record<string, unknown> = withMcpServers(
    { cwd: config.cwd },
    selectedVersion,
  );
  const additionalDirectories = sessionSetupDirectories(selectedCapabilities);
  if (additionalDirectories.length > 0) {
    sessionParams.additionalDirectories = additionalDirectories;
  }
  const created = (await sendRequest("session/new", sessionParams)
    .promise) as {
    sessionId?: string;
    configOptions?: unknown;
    modes?: unknown;
    availableCommands?: unknown;
  } | null;
  if (!created?.sessionId) {
    throw new Error("The agent did not return a session id");
  }
  if (eventGeneration !== generation) return;
  const modeState = parseModeState(created.modes);
  useAcpStore.setState({
    connection: "ready",
    processError: null,
    sessionId: created.sessionId,
    configOptions: parseConfigOptions(created.configOptions),
    commands: parseCommands(created.availableCommands),
    modeState,
    currentMode: modeState?.currentModeId ?? null,
    protocolVersion: initialized.protocolVersion,
    agentInfo: parseAgentInfo(initialized.info ?? initialized.agentInfo),
    capabilities: selectedCapabilities,
    authMethods: parseAuthMethods(initialized.authMethods),
    sessionConfig,
  });
}

async function transitionTo(
  config: AcpSessionConfig | null,
  force = false,
): Promise<void> {
  await transitions.enqueue(async () => {
    if (!force) {
      if (config !== null && !sameSessionConfig(desired, config)) return;
      if (config === null && desired !== null) return;
      if (
        config !== null &&
        processId !== null &&
        sameSessionConfig(activeConfig, config)
      ) {
        return;
      }
    }

    const prior = useAcpStore.getState();
    const closeSessionId = prior.sessionId;
    const canClose = prior.capabilities.sessionClose;
    useAcpStore.setState({
      ...INITIAL_STORE,
      connection: config === null ? "stopped" : "starting",
      sessionConfig,
    });

    await stopProcess(closeSessionId, canClose);

    if (config === null) return;
    if (!sameSessionConfig(desired, config)) return;

    generation += 1;
    const eventGeneration = generation;
    const channel = new Channel<AcpProcessEvent>();
    channel.onmessage = (event) => handleProcessEvent(event, eventGeneration);
    activeClient.channel = channel;

    try {
      await withTimeout(
        spawnSession(config, eventGeneration),
        START_TIMEOUT_MS,
        "The agent did not start in time",
      );
    } catch (error) {
      generation += 1;
      const id = processId;
      processId = null;
      activeConfig = null;
      activeClient.channel = null;
      promptRequestId = null;
      promptLocalMessageId = null;
      for (const entry of pending.values())
        entry.reject(new Error("The agent failed to start"));
      pending.clear();
      if (id !== null) {
        await invoke("acp_stop", { sessionId: id }).catch(() => {});
      }
      const message = errorText(error);
      if (message.includes("is on PATH")) invalidateAgentAvailability();
      useAcpStore.setState({
        connection: "error",
        processError: message,
        sessionConfig,
      });
      throw error instanceof Error ? error : new Error(message);
    }
  });
}

export function ensureAcpStarted(
  agent: AcpAgentId,
  cwd: string | null,
  workspace: WorkspaceEnv,
): Promise<void> {
  if (!cwd) {
    const error = "Open a folder before starting the agent";
    useAcpStore.setState({ connection: "error", processError: error });
    return Promise.reject(new Error(error));
  }
  const config: AcpSessionConfig = { agent, cwd, workspace };
  sessionConfig = config;
  desired = config;
  return transitionTo(config);
}

export function stopAcp(): Promise<void> {
  desired = null;
  return transitionTo(null);
}

export function restartAcp(): Promise<void> {
  const config = sessionConfig;
  if (!config) return Promise.resolve();
  desired = config;
  return transitionTo(config, true);
}

async function createSession(cwd: string): Promise<void> {
  const params = withMcpServers({ cwd }, protocolVersion());
  const additionalDirectories = sessionSetupDirectories(
    useAcpStore.getState().capabilities,
  );
  if (additionalDirectories.length > 0) {
    params.additionalDirectories = additionalDirectories;
  }
  const created = (await sendRequest("session/new", params).promise) as {
    sessionId?: string;
    configOptions?: unknown;
    modes?: unknown;
    availableCommands?: unknown;
  } | null;
  if (!created?.sessionId) {
    throw new Error("The agent did not return a session id");
  }
  const modeState = parseModeState(created.modes);
  useAcpStore.setState({
    sessionId: created.sessionId,
    configOptions: parseConfigOptions(created.configOptions),
    commands: parseCommands(created.availableCommands),
    modeState,
    currentMode: modeState?.currentModeId ?? null,
  });
}

export async function newAcpSession(): Promise<void> {
  const cwd = sessionCwd();
  if (!cwd) return;
  useAcpStore.setState((state) => resetAcpConversation(state));
  await createSession(cwd);
}

export async function listAcpSessions(cursor?: string): Promise<{
  sessions: AcpSessionInfo[];
  nextCursor: string | null;
}> {
  const cwd = sessionCwd();
  if (!cwd) return { sessions: [], nextCursor: null };
  const params: Record<string, unknown> = { cwd };
  if (cursor) params.cursor = cursor;
  const result = (await sendRequest("session/list", params).promise) as {
    sessions?: unknown;
    nextCursor?: unknown;
  } | null;
  return parseSessionListPage(result);
}

export async function loadAcpSession(sessionId: string): Promise<void> {
  const cwd = sessionCwd();
  if (!cwd) return;
  const capabilities = useAcpStore.getState().capabilities;
  const version = protocolVersion();
  const canLoad = version === 1 && capabilities.loadSession;
  if (!canLoad && !capabilities.sessionResume) {
    throw new Error("This agent cannot load previous sessions.");
  }
  useAcpStore.setState((state) => resetAcpConversation(state));
  const method = canLoad ? "session/load" : "session/resume";
  const params = withMcpServers({ sessionId, cwd }, version);
  if (!canLoad) params.replayFrom = { type: "start" };
  const additionalDirectories = sessionSetupDirectories(capabilities);
  if (additionalDirectories.length > 0) {
    params.additionalDirectories = additionalDirectories;
  }
  const result = (await sendRequest(method, params).promise) as {
    configOptions?: unknown;
    modes?: unknown;
    availableCommands?: unknown;
  } | null;
  const modeState = parseModeState(result?.modes);
  useAcpStore.setState({
    sessionId,
    configOptions: parseConfigOptions(result?.configOptions),
    commands: parseCommands(result?.availableCommands),
    modeState,
    currentMode: modeState?.currentModeId ?? null,
    permission: null,
    elicitation: null,
  });
}

export async function resumeAcpSession(sessionId: string): Promise<void> {
  const cwd = sessionCwd();
  if (!cwd || !useAcpStore.getState().capabilities.sessionResume) return;
  useAcpStore.setState((state) => resetAcpConversation(state));
  const params = withMcpServers({ sessionId, cwd }, protocolVersion());
  const additionalDirectories = sessionSetupDirectories(
    useAcpStore.getState().capabilities,
  );
  if (additionalDirectories.length > 0) {
    params.additionalDirectories = additionalDirectories;
  }
  const result = (await sendRequest("session/resume", params).promise) as {
    configOptions?: unknown;
    modes?: unknown;
    availableCommands?: unknown;
  } | null;
  useAcpStore.setState((state) => {
    const modeState =
      result?.modes === undefined ? state.modeState : parseModeState(result.modes);
    return {
      sessionId,
      configOptions: mergeConfigOptions(
        state.configOptions,
        result?.configOptions,
      ),
      commands: Array.isArray(result?.availableCommands)
        ? parseCommands(result.availableCommands)
        : state.commands,
      modeState,
      currentMode: modeState?.currentModeId ?? null,
      permission: null,
      elicitation: null,
    };
  });
}

/** `session/fork` is a draft RFD, not part of the v1 or v2 stable schema. The
 *  call is gated on the agent advertising `session: { fork: {} }`, and takes
 *  the same options as `session/load`. Agents that do not implement it never
 *  advertise the capability, so the method is never sent to them. */
export async function forkAcpSession(sessionId: string): Promise<void> {
  const cwd = sessionCwd();
  if (!cwd || !useAcpStore.getState().capabilities.sessionFork) return;
  useAcpStore.setState((state) => resetAcpConversation(state));
  const params = withMcpServers({ sessionId, cwd }, protocolVersion());
  const additionalDirectories = sessionSetupDirectories(
    useAcpStore.getState().capabilities,
  );
  if (additionalDirectories.length > 0) {
    params.additionalDirectories = additionalDirectories;
  }
  const result = (await sendRequest("session/fork", params).promise) as {
    sessionId?: string;
    configOptions?: unknown;
    modes?: unknown;
    availableCommands?: unknown;
  } | null;
  if (!result?.sessionId) {
    throw new Error("The agent did not return a forked session id");
  }
  const modeState = parseModeState(result.modes);
  useAcpStore.setState({
    sessionId: result.sessionId,
    configOptions: parseConfigOptions(result.configOptions),
    commands: parseCommands(result.availableCommands),
    modeState,
    currentMode: modeState?.currentModeId ?? null,
    permission: null,
    elicitation: null,
  });
}

export async function deleteAcpSession(sessionId: string): Promise<void> {
  if (!useAcpStore.getState().capabilities.sessionDelete) return;
  await sendRequest("session/delete", { sessionId }).promise;
  if (useAcpStore.getState().sessionId === sessionId) await newAcpSession();
}

export async function loginAcp(methodId: string): Promise<void> {
  const method = useAcpStore
    .getState()
    .authMethods.find((candidate) => candidate.methodId === methodId);
  if (!method) return;
  if (method.type === "terminal") {
    const agent = sessionConfig?.agent;
    if (!agent) return;
    const command = terminalAuthCommand(agent, method);
    const opened = await runInDockTerminal(command);
    if (!opened) {
      throw new Error(
        "Open a workspace first, then sign in with this command in a Agni terminal.",
      );
    }
    useAcpStore.setState({
      notice: {
        kind: "auth",
        text: terminalAuthHint(command),
        severity: null,
      },
    });
    return;
  }
  await sendRequest(protocolVersion() === 2 ? "auth/login" : "authenticate", {
    methodId,
  }).promise;
}

export async function logoutAcp(): Promise<void> {
  if (
    !useAcpStore.getState().capabilities.authLogout &&
    protocolVersion() === 1
  )
    return;
  await sendRequest(protocolVersion() === 2 ? "auth/logout" : "logout", {})
    .promise;
}

export async function setAcpConfigOption(
  configId: string,
  value: string | boolean,
): Promise<void> {
  const state = useAcpStore.getState();
  const sessionId = state.sessionId;
  if (!sessionId) return;
  const originalValue = state.configOptions.find(
    (option) => option.id === configId,
  )?.currentValue;
  useAcpStore.setState({
    configOptions: state.configOptions.map((option) =>
      option.id === configId ? { ...option, currentValue: value } : option,
    ),
  });
  const params: Record<string, unknown> = { sessionId, configId, value };
  if (typeof value === "boolean") params.type = "boolean";
  else if (protocolVersion() === 2) params.type = "id";
  try {
    const result = (await sendRequest("session/set_config_option", params)
      .promise) as { configOptions?: unknown } | null;
    useAcpStore.setState((current) => {
      if (current.sessionId !== sessionId) return {};
      return {
        configOptions: mergeConfigOptions(
          current.configOptions,
          result?.configOptions,
        ),
      };
    });
  } catch (error) {
    useAcpStore.setState((current) => {
      if (current.sessionId !== sessionId || originalValue === undefined) {
        return {};
      }
      return {
        configOptions: current.configOptions.map((option) =>
          option.id === configId
            ? { ...option, currentValue: originalValue }
            : option,
        ),
      };
    });
    throw error;
  }
}

export async function setAcpMode(modeId: string): Promise<void> {
  const sessionId = useAcpStore.getState().sessionId;
  if (!sessionId) return;
  await sendRequest("session/set_mode", { sessionId, modeId }).promise;
  useAcpStore.setState({ currentMode: modeId });
}

/** Above this size a mention is sent as a `resource_link` instead of inlining
 *  the whole file, which keeps large files off the wire and under the 12 MiB
 *  outbound cap. Agents must support both, and `resource_link` lets the agent
 *  read only the lines it needs. */
const MAX_INLINE_MENTION_BYTES = 256 * 1024;

export async function promptAcp(input: AcpPromptInput): Promise<void> {
  const sessionId = useAcpStore.getState().sessionId;
  if (!sessionId) throw new Error("The agent session is not ready");
  const blocks: Record<string, unknown>[] = [];
  const text = input.text.trim();
  if (text) blocks.push({ type: "text", text });
  for (const mention of input.mentions ?? []) {
    const uri = fileUri(mention.path);
    const mimeType = mimeForPath(mention.path);
    let result: ReadResult | null = null;
    try {
      result = await invoke<ReadResult>("fs_read_file", {
        path: mention.path,
        workspace: workspaceEnv(),
      });
    } catch {
      // Unreadable files still reach the agent as a link.
    }
    if (result?.kind === "text" && result.size <= MAX_INLINE_MENTION_BYTES) {
      blocks.push({
        type: "resource",
        resource: {
          uri,
          ...(mimeType ? { mimeType } : {}),
          text: result.content,
        },
      });
      continue;
    }
    blocks.push({
      type: "resource_link",
      uri,
      name: mention.rel,
      ...(mimeType ? { mimeType } : {}),
    });
  }
  for (const attachment of input.attachments ?? []) {
    blocks.push({
      type: attachment.type,
      mimeType: attachment.mimeType,
      data: attachment.data,
    });
  }
  if (blocks.length === 0) return;
  const params = { sessionId, prompt: blocks };
  assertOutboundMessageSize({
    jsonrpc: "2.0",
    id: requestSequence + 1,
    method: "session/prompt",
    params,
  });
  const display =
    text ||
    (input.attachments?.length ? "Sent an attachment" : "Sent file context");
  useAcpStore.setState((state) => {
    const next = appendUserPrompt(state, display);
    promptLocalMessageId = next.messages[next.messages.length - 1]?.id ?? null;
    return next;
  });
  const { id, promise } = sendRequest("session/prompt", params);
  promptRequestId = id;
  useAcpStore.setState({
    isStreaming: true,
    sessionState: "running",
    lastStopReason: null,
    lastStopError: null,
    rpcError: null,
  });
  promise.catch((error) => {
    useAcpStore.setState((state) =>
      state.sessionId === sessionId
        ? {
            rpcError: errorText(error),
            isStreaming: false,
            sessionState: "idle",
          }
        : { rpcError: errorText(error) },
    );
  });
}

export function cancelAcp(): void {
  const sessionId = useAcpStore.getState().sessionId;
  if (sessionId) sendNotification("session/cancel", { sessionId });
  if (useAcpStore.getState().permission) respondToPermission("cancelled");
  if (useAcpStore.getState().elicitation) respondToElicitation("cancel");
}

export async function refreshAcpTerminal(terminalId: string): Promise<void> {
  try {
    const result = await invoke<TerminalOutputResult>("acp_terminal_output", {
      terminalId,
    });
    useAcpStore.setState((state) => {
      const existing = state.terminals[terminalId];
      return {
        terminals: {
          ...state.terminals,
          [terminalId]: {
            id: terminalId,
            title: existing?.title ?? null,
            command: existing?.command ?? null,
            cwd: existing?.cwd ?? null,
            output: result.output,
            state: result.exitStatus ? "exited" : "running",
            exitCode: result.exitStatus?.exitCode ?? null,
            signal: result.exitStatus?.signal ?? null,
            source: "client",
          },
        },
      };
    });
  } catch {
    // A released or agent-managed terminal keeps its last displayed output.
  }
}

export function respondToPermission(optionId: string | "cancelled"): void {
  const permission = useAcpStore.getState().permission;
  if (!permission) return;
  const outcome =
    optionId === "cancelled"
      ? { outcome: "cancelled" }
      : { outcome: "selected", optionId };
  sendResult(permission.id, { outcome });
  useAcpStore.setState({ permission: null });
}

export function respondToElicitation(
  action: "accept" | "cancel" | "decline",
  content?: Record<string, unknown>,
): void {
  const elicitation = useAcpStore.getState().elicitation;
  if (!elicitation) return;
  sendResult(elicitation.id, {
    action,
    ...(action === "accept" ? { content: content ?? {} } : {}),
  });
  useAcpStore.setState({ elicitation: null });
}
