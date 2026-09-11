import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { reducePiRpc, resetPiConversation } from "@/modules/pi-agent/rpcState";
import {
  INITIAL_PI_RPC_STATE,
  type PiConnectionStatus,
  type PiExtensionRequest,
  type PiImageAttachment,
  type PiProcessEvent,
  type PiRpcState,
  type PiSessionEntry,
} from "@/modules/pi-agent/types";
import type { WorkspaceEnv } from "@/modules/workspace";

type PiStore = PiRpcState & {
  connection: PiConnectionStatus;
  processError: string | null;
  diagnostic: string | null;
};

const INITIAL_STORE: PiStore = {
  ...INITIAL_PI_RPC_STATE,
  connection: "idle",
  processError: null,
  diagnostic: null,
};

export const usePiStore = create<PiStore>(() => INITIAL_STORE);

let sessionId: number | null = null;
let startPromise: Promise<void> | null = null;
let requestSequence = 0;
let generation = 0;
const activeClient: { channel: Channel<PiProcessEvent> | null } = {
  channel: null,
};
let lastStart: { cwd: string | null; workspace: WorkspaceEnv } | null = null;

function requestId(): string {
  requestSequence += 1;
  return `agni-${requestSequence}`;
}

function handleProcessEvent(event: PiProcessEvent, eventGeneration: number) {
  if (eventGeneration !== generation) return;
  if (event.kind === "rpc") {
    usePiStore.setState((state) => reducePiRpc(state, event.message));
    const rpc = event.message as Record<string, unknown> | null;
    if (
      rpc?.type === "response" &&
      rpc.success === true &&
      (rpc.command === "new_session" ||
        rpc.command === "set_model" ||
        rpc.command === "switch_session" ||
        rpc.command === "fork" ||
        rpc.command === "clone" ||
        rpc.command === "set_session_name")
    ) {
      void syncPiState();
    }
    if (
      rpc?.type === "agent_end" ||
      rpc?.type === "compaction_end" ||
      (rpc?.type === "response" &&
        rpc.success === true &&
        rpc.command === "compact")
    ) {
      void syncSessionStats();
    }
    return;
  }
  if (event.kind === "stderr") {
    usePiStore.setState({ diagnostic: event.message });
    return;
  }
  if (event.kind === "protocol_error") {
    usePiStore.setState({ rpcError: event.message });
    return;
  }
  sessionId = null;
  startPromise = null;
  activeClient.channel = null;
  const diagnostic = usePiStore.getState().diagnostic;
  usePiStore.setState({
    connection: "exited",
    session: { ...usePiStore.getState().session, isStreaming: false },
    processError:
      diagnostic ??
      (event.code === 0 || event.code === null
        ? null
        : `Pi exited with code ${event.code}`),
  });
}

async function send(message: Record<string, unknown>): Promise<void> {
  if (sessionId === null) throw new Error("Pi is not running");
  await invoke("pi_send", { sessionId, message });
}

async function syncPiState(): Promise<void> {
  if (sessionId === null) return;
  await Promise.all([
    send({ id: requestId(), type: "get_state" }),
    send({ id: requestId(), type: "get_messages" }),
    send({ id: requestId(), type: "get_available_models" }),
    send({ id: requestId(), type: "get_commands" }),
    send({ id: requestId(), type: "get_session_stats" }),
  ]).catch((error) => {
    usePiStore.setState({ rpcError: String(error) });
  });
}

async function syncSessionStats(): Promise<void> {
  if (sessionId === null) return;
  await send({ id: requestId(), type: "get_session_stats" }).catch(() => {});
}

export function ensurePiStarted(
  cwd: string | null,
  workspace: WorkspaceEnv,
): Promise<void> {
  if (sessionId !== null) return Promise.resolve();
  if (startPromise) return startPromise;

  lastStart = { cwd, workspace };
  generation += 1;
  const eventGeneration = generation;
  const channel = new Channel<PiProcessEvent>();
  channel.onmessage = (event) => handleProcessEvent(event, eventGeneration);
  activeClient.channel = channel;
  usePiStore.setState({
    connection: "starting",
    processError: null,
    diagnostic: null,
    rpcError: null,
  });

  startPromise = invoke<{ sessionId: number }>("pi_start", {
    cwd,
    workspace,
    onEvent: channel,
  })
    .then(async (result) => {
      if (eventGeneration !== generation) return;
      sessionId = result.sessionId;
      usePiStore.setState({ connection: "ready", processError: null });
      await syncPiState();
    })
    .catch((error) => {
      if (eventGeneration !== generation) return;
      sessionId = null;
      activeClient.channel = null;
      usePiStore.setState({
        connection: "error",
        processError: String(error),
      });
      throw error;
    })
    .finally(() => {
      startPromise = null;
    });
  return startPromise;
}

export async function stopPi(): Promise<void> {
  generation += 1;
  if (sessionId !== null) {
    await invoke("pi_stop", { sessionId }).catch(() => {});
    sessionId = null;
  }
  activeClient.channel = null;
  startPromise = null;
  usePiStore.setState({ ...INITIAL_STORE, connection: "stopped" });
}

export async function restartPi(): Promise<void> {
  await stopPi();
  if (lastStart) await ensurePiStarted(lastStart.cwd, lastStart.workspace);
}

export async function promptPi(
  message: string,
  images: PiImageAttachment[] = [],
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) return;
  const streaming = usePiStore.getState().session.isStreaming;
  await send({
    id: requestId(),
    type: "prompt",
    message: trimmed,
    ...(images.length ? { images } : {}),
    ...(streaming ? { streamingBehavior: "steer" } : {}),
  });
}

export async function steerPi(
  message: string,
  images: PiImageAttachment[] = [],
): Promise<void> {
  await send({
    id: requestId(),
    type: "steer",
    message: message.trim(),
    ...(images.length ? { images } : {}),
  });
}

export async function followUpPi(
  message: string,
  images: PiImageAttachment[] = [],
): Promise<void> {
  await send({
    id: requestId(),
    type: "follow_up",
    message: message.trim(),
    ...(images.length ? { images } : {}),
  });
}

export async function abortPi(): Promise<void> {
  await send({ id: requestId(), type: "abort" });
}

export async function abortPiRetry(): Promise<void> {
  await send({ id: requestId(), type: "abort_retry" });
  usePiStore.setState((state) => ({
    session: { ...state.session, isRetrying: false },
  }));
}

export async function setPiModel(provider: string, modelId: string) {
  await send({ id: requestId(), type: "set_model", provider, modelId });
}

export async function setPiThinkingLevel(level: string) {
  await send({ id: requestId(), type: "set_thinking_level", level });
  usePiStore.setState((state) => ({
    session: { ...state.session, thinkingLevel: level },
  }));
}

export async function newPiSession() {
  usePiStore.setState((state) => resetPiConversation(state));
  await send({ id: requestId(), type: "new_session" });
}

export async function compactPiSession() {
  await send({ id: requestId(), type: "compact" });
}

export async function setPiAutoCompaction(enabled: boolean) {
  await send({ id: requestId(), type: "set_auto_compaction", enabled });
  usePiStore.setState((state) => ({
    session: { ...state.session, autoCompactionEnabled: enabled },
  }));
}

export async function setPiAutoRetry(enabled: boolean) {
  await send({ id: requestId(), type: "set_auto_retry", enabled });
}

export async function setPiSteeringMode(mode: "all" | "one-at-a-time") {
  await send({ id: requestId(), type: "set_steering_mode", mode });
  usePiStore.setState((state) => ({
    session: { ...state.session, steeringMode: mode },
  }));
}

export async function setPiFollowUpMode(mode: "all" | "one-at-a-time") {
  await send({ id: requestId(), type: "set_follow_up_mode", mode });
  usePiStore.setState((state) => ({
    session: { ...state.session, followUpMode: mode },
  }));
}

export async function listPiSessions(): Promise<PiSessionEntry[]> {
  const sessionFile = usePiStore.getState().session.sessionFile;
  if (!sessionFile) return [];
  return invoke<PiSessionEntry[]>("pi_list_sessions", { sessionFile });
}

export async function switchPiSession(path: string) {
  await send({ id: requestId(), type: "switch_session", sessionPath: path });
}

export async function loadPiForkMessages() {
  await send({ id: requestId(), type: "get_fork_messages" });
}

export async function forkPiSession(entryId: string) {
  await send({ id: requestId(), type: "fork", entryId });
}

export async function clonePiSession() {
  await send({ id: requestId(), type: "clone" });
}

export async function setPiSessionName(name: string) {
  await send({ id: requestId(), type: "set_session_name", name: name.trim() });
}

export async function exportPiSession() {
  await send({ id: requestId(), type: "export_html" });
}

export async function respondToPiExtension(
  request: PiExtensionRequest,
  response: Record<string, unknown>,
) {
  await send({
    type: "extension_ui_response",
    id: request.id,
    ...response,
  });
  usePiStore.setState({ extensionRequest: null });
}
