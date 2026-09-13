import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  appendUserPrompt,
  parseAgentCapabilities,
  parseAgentInfo,
  parseConfigOptions,
  parseModeState,
  parseSessionList,
  reduceAcpMessage,
  resetAcpConversation,
} from "@/modules/acp-agent/acpState";
import type { AcpAgentId } from "@/modules/acp-agent/lib/agent";
import {
  INITIAL_ACP_STATE,
  type AcpConnectionStatus,
  type AcpImageAttachment,
  type AcpProcessEvent,
  type AcpSessionInfo,
  type AcpState,
} from "@/modules/acp-agent/types";
import { currentWorkspaceEnv, type WorkspaceEnv } from "@/modules/workspace";

const ACP_PROTOCOL_VERSION = 1;

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type AcpMention = { rel: string; path: string };

export type AcpPromptInput = {
  text: string;
  mentions?: AcpMention[];
  images?: AcpImageAttachment[];
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
let startPromise: Promise<void> | null = null;
let requestSequence = 0;
let generation = 0;
let promptRequestId: number | null = null;
let lastStart: {
  agent: AcpAgentId;
  cwd: string | null;
  workspace: WorkspaceEnv;
} | null = null;
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

async function send(message: Record<string, unknown>): Promise<void> {
  if (processId === null) throw new Error("The agent is not running");
  await invoke("acp_send", { sessionId: processId, message });
}

function sendRequest(
  method: string,
  params: Record<string, unknown>,
): { id: number; promise: Promise<unknown> } {
  const id = requestId();
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params }).catch((error) => {
      if (pending.delete(id)) reject(error);
    });
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
  return lastStart?.workspace ?? currentWorkspaceEnv();
}

function sliceLines(content: string, line: unknown, limit: unknown): string {
  if (typeof line !== "number" && typeof limit !== "number") return content;
  const lines = content.split("\n");
  const start = typeof line === "number" ? Math.max(0, line - 1) : 0;
  const end = typeof limit === "number" ? start + limit : lines.length;
  return lines.slice(start, end).join("\n");
}

function handleResponse(id: number | string, message: Record<string, unknown>): void {
  const numericId = typeof id === "number" ? id : null;
  const entry = numericId === null ? undefined : pending.get(numericId);
  const error = message.error;
  if (id === promptRequestId) {
    promptRequestId = null;
    const result = message.result as { stopReason?: string } | null | undefined;
    useAcpStore.setState({
      isStreaming: false,
      lastStopReason: error ? "error" : (result?.stopReason ?? null),
    });
  }
  if (!entry || numericId === null) return;
  pending.delete(numericId);
  if (error) entry.reject(new Error(errorText(error)));
  else entry.resolve(message.result ?? null);
}

async function handleClientRequest(
  id: number | string,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (method === "session/request_permission") {
    const toolCall = asObject(params.toolCall);
    const rawOptions = Array.isArray(params.options) ? params.options : [];
    const options = rawOptions.flatMap((option) => {
      const object = asObject(option);
      const optionId =
        object && typeof object.optionId === "string" ? object.optionId : null;
      const name = object && typeof object.name === "string" ? object.name : null;
      if (!optionId || !name) return [];
      const kind =
        object && typeof object.kind === "string" ? object.kind : "allow_once";
      return [{ optionId, name, kind }];
    });
    useAcpStore.setState({
      permission: {
        id,
        sessionId:
          typeof params.sessionId === "string" ? params.sessionId : "",
        toolCallId:
          toolCall && typeof toolCall.toolCallId === "string"
            ? toolCall.toolCallId
            : null,
        title:
          toolCall && typeof toolCall.title === "string"
            ? toolCall.title
            : null,
        options,
      },
    });
    return;
  }

  if (method === "fs/read_text_file") {
    const path = typeof params.path === "string" ? params.path : "";
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

function handleProcessEvent(event: AcpProcessEvent, eventGeneration: number): void {
  if (eventGeneration !== generation) return;
  if (event.kind === "rpc") {
    const message = asObject(event.message);
    if (!message) return;
    const method = typeof message.method === "string" ? message.method : null;
    const id =
      typeof message.id === "number" || typeof message.id === "string"
        ? message.id
        : null;
    if (method && id !== null) {
      void handleClientRequest(id, method, asObject(message.params) ?? {});
      return;
    }
    if (method) {
      useAcpStore.setState((state) => reduceAcpMessage(state, message));
      return;
    }
    if (id !== null) handleResponse(id, message);
    return;
  }
  if (event.kind === "stderr") {
    useAcpStore.setState({ diagnostic: event.message });
    return;
  }
  if (event.kind === "protocol_error") {
    useAcpStore.setState({ rpcError: event.message });
    return;
  }
  processId = null;
  startPromise = null;
  activeClient.channel = null;
  promptRequestId = null;
  for (const entry of pending.values()) entry.reject(new Error("The agent exited"));
  pending.clear();
  const diagnostic = useAcpStore.getState().diagnostic;
  useAcpStore.setState({
    connection: "exited",
    isStreaming: false,
    permission: null,
    processError:
      diagnostic ??
      (event.code === 0 || event.code === null
        ? null
        : `The agent exited with code ${event.code}`),
  });
}

export function ensureAcpStarted(
  agent: AcpAgentId,
  cwd: string | null,
  workspace: WorkspaceEnv,
): Promise<void> {
  if (processId !== null) return Promise.resolve();
  if (startPromise) return startPromise;
  if (!cwd) {
    const error = "Open a folder before starting the agent";
    useAcpStore.setState({ connection: "error", processError: error });
    return Promise.reject(new Error(error));
  }

  lastStart = { agent, cwd, workspace };
  generation += 1;
  const eventGeneration = generation;
  const channel = new Channel<AcpProcessEvent>();
  channel.onmessage = (event) => handleProcessEvent(event, eventGeneration);
  activeClient.channel = channel;
  useAcpStore.setState({
    connection: "starting",
    processError: null,
    diagnostic: null,
    rpcError: null,
  });

  startPromise = invoke<{ sessionId: number }>("acp_start", {
    agent,
    cwd,
    workspace,
    onEvent: channel,
  })
    .then(async (result) => {
      if (eventGeneration !== generation) return;
      processId = result.sessionId;
      const clientVersion = await getVersion().catch(() => "0.0.0");
      if (eventGeneration !== generation) return;
      const initialized = (await sendRequest("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: "agni", title: "Agni", version: clientVersion },
      }).promise) as {
        protocolVersion?: number;
        agentCapabilities?: unknown;
        agentInfo?: unknown;
      } | null;
      if (initialized?.protocolVersion !== ACP_PROTOCOL_VERSION) {
        throw new Error(
          `The agent selected an unsupported ACP version: ${initialized?.protocolVersion ?? "unknown"}`,
        );
      }
      const created = (await sendRequest("session/new", {
        cwd,
        mcpServers: [],
      }).promise) as {
        sessionId?: string;
        configOptions?: unknown;
        modes?: unknown;
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
        modeState,
        currentMode: modeState?.currentModeId ?? null,
        agentInfo: parseAgentInfo(initialized?.agentInfo),
        capabilities: parseAgentCapabilities(initialized?.agentCapabilities),
      });
    })
    .catch((error) => {
      if (eventGeneration !== generation) return;
      processId = null;
      activeClient.channel = null;
      useAcpStore.setState({
        connection: "error",
        processError: errorText(error),
      });
      throw error instanceof Error ? error : new Error(errorText(error));
    })
    .finally(() => {
      startPromise = null;
    });
  return startPromise;
}

export async function suspendAcp(): Promise<void> {
  generation += 1;
  const id = processId;
  processId = null;
  promptRequestId = null;
  startPromise = null;
  activeClient.channel = null;
  for (const entry of pending.values()) entry.reject(new Error("The agent was suspended"));
  pending.clear();
  if (id !== null) {
    await invoke("acp_stop", { sessionId: id }).catch(() => {});
  }
  useAcpStore.setState({
    connection: "stopped",
    isStreaming: false,
    permission: null,
    processError: null,
    diagnostic: null,
  });
}

export async function stopAcp(): Promise<void> {
  await suspendAcp();
  useAcpStore.setState({ ...INITIAL_STORE, connection: "stopped" });
}

export async function restartAcp(): Promise<void> {
  const start = lastStart;
  await stopAcp();
  if (start) await ensureAcpStarted(start.agent, start.cwd, start.workspace);
}

async function createSession(cwd: string): Promise<void> {
  const created = (await sendRequest("session/new", {
    cwd,
    mcpServers: [],
  }).promise) as {
    sessionId?: string;
    configOptions?: unknown;
    modes?: unknown;
  } | null;
  if (!created?.sessionId) return;
  const modeState = parseModeState(created.modes);
  useAcpStore.setState({
    sessionId: created.sessionId,
    configOptions: parseConfigOptions(created.configOptions),
    modeState,
    currentMode: modeState?.currentModeId ?? null,
  });
}

export async function newAcpSession(): Promise<void> {
  const cwd = lastStart?.cwd ?? null;
  if (!cwd) return;
  useAcpStore.setState((state) => resetAcpConversation(state));
  await createSession(cwd);
}

export async function listAcpSessions(): Promise<AcpSessionInfo[]> {
  const cwd = lastStart?.cwd ?? null;
  if (!cwd) return [];
  const result = (await sendRequest("session/list", { cwd }).promise) as {
    sessions?: unknown;
  } | null;
  return parseSessionList(result?.sessions);
}

export async function loadAcpSession(sessionId: string): Promise<void> {
  const cwd = lastStart?.cwd ?? null;
  if (!cwd) return;
  useAcpStore.setState((state) => resetAcpConversation(state));
  const result = (await sendRequest("session/load", {
    sessionId,
    cwd,
    mcpServers: [],
  }).promise) as { configOptions?: unknown } | null;
  useAcpStore.setState({
    sessionId,
    configOptions: parseConfigOptions(result?.configOptions),
    modeState: null,
    currentMode: null,
    permission: null,
  });
}

export async function setAcpConfigOption(
  configId: string,
  value: string | boolean,
): Promise<void> {
  const sessionId = useAcpStore.getState().sessionId;
  if (!sessionId) return;
  const params: Record<string, unknown> = { sessionId, configId, value };
  if (typeof value === "boolean") params.type = "boolean";
  const result = (await sendRequest("session/set_config_option", params)
    .promise) as { configOptions?: unknown } | null;
  useAcpStore.setState({
    configOptions: parseConfigOptions(result?.configOptions),
  });
}

export async function setAcpMode(modeId: string): Promise<void> {
  const sessionId = useAcpStore.getState().sessionId;
  if (!sessionId) return;
  await sendRequest("session/set_mode", { sessionId, modeId }).promise;
  useAcpStore.setState({ currentMode: modeId });
}

export async function promptAcp(input: AcpPromptInput): Promise<void> {
  const sessionId = useAcpStore.getState().sessionId;
  if (!sessionId) throw new Error("The agent session is not ready");
  const blocks: Record<string, unknown>[] = [];
  const text = input.text.trim();
  if (text) blocks.push({ type: "text", text });
  for (const mention of input.mentions ?? []) {
    let result: ReadResult | null = null;
    try {
      result = await invoke<ReadResult>("fs_read_file", {
        path: mention.path,
        workspace: workspaceEnv(),
      });
    } catch {
      continue;
    }
    if (result.kind !== "text") continue;
    blocks.push({
      type: "resource",
      resource: {
        uri: fileUri(mention.path),
        ...(mimeForPath(mention.path)
          ? { mimeType: mimeForPath(mention.path) }
          : {}),
        text: result.content,
      },
    });
  }
  for (const image of input.images ?? []) {
    blocks.push({ type: "image", mimeType: image.mimeType, data: image.data });
  }
  if (blocks.length === 0) return;
  const display =
    text ||
    (input.images?.length ? "Sent an image" : "Sent file context");
  useAcpStore.setState((state) => appendUserPrompt(state, display));
  const { id, promise } = sendRequest("session/prompt", {
    sessionId,
    prompt: blocks,
  });
  promptRequestId = id;
  useAcpStore.setState({ isStreaming: true, lastStopReason: null, rpcError: null });
  promise.catch((error) => {
    useAcpStore.setState({ rpcError: errorText(error) });
  });
}

export function cancelAcp(): void {
  const sessionId = useAcpStore.getState().sessionId;
  if (sessionId) sendNotification("session/cancel", { sessionId });
  if (useAcpStore.getState().permission) respondToPermission("cancelled");
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
