import {
  mergeConfigOptions,
  parseAgentCapabilities,
  parseAgentInfo,
  parseAuthMethods,
  parseCommands,
  parseConfigOptions,
  parseEndTurnUsage,
  parseModeState,
  parseModelState,
  reconcileAcpUserMessage,
  reduceAcpMessage,
} from "@/modules/acp-agent/acpState";
import type {
  AcpConnectionStatus,
  AcpElicitationRequest,
  AcpPermissionRequest,
  AcpSessionConfig,
  AcpState,
} from "@/modules/acp-agent/types";
import { INITIAL_ACP_STATE } from "@/modules/acp-agent/types";

export type AcpStore = AcpState & {
  connection: AcpConnectionStatus;
  processError: string | null;
  diagnostic: string | null;
};

export const INITIAL_ACP_STORE: AcpStore = {
  ...INITIAL_ACP_STATE,
  connection: "idle",
  processError: null,
  diagnostic: null,
};

export type AcpSetupStep =
  | "initialize"
  | "session/new"
  | "session/load"
  | "session/resume"
  | "session/fork";

/**
 * Every input that can change projected ACP state. The transport (`store.ts`)
 * owns request correlation and process lifecycle; this module owns the mapping
 * from wire facts to UI state so it can be replayed and tested without Tauri.
 */
export type AcpFrame =
  | { kind: "rpc"; message: Record<string, unknown> }
  | { kind: "stderr"; message: string }
  | { kind: "protocol_error"; message: string }
  | { kind: "exit"; code: number | null }
  | {
      kind: "response";
      id: number | string;
      method: string;
      result: unknown;
      error: unknown;
      /** Local optimistic message id, needed to reconcile v2 prompt responses. */
      promptLocalMessageId?: string | null;
    }
  | {
      kind: "setup";
      step: AcpSetupStep;
      result: unknown;
      sessionConfig?: AcpSessionConfig | null;
    }
  | {
      kind: "request";
      request: "permission";
      value: AcpPermissionRequest;
    }
  | {
      kind: "request";
      request: "elicitation";
      value: AcpElicitationRequest;
    }
  | {
      kind: "request";
      request: "elicitation/complete";
      elicitationId: string;
    }
  | {
      kind: "connection";
      connection: AcpConnectionStatus;
      processError?: string | null;
      diagnostic?: string | null;
      sessionConfig?: AcpSessionConfig | null;
    };

export function reduceAcpFrame(state: AcpStore, frame: AcpFrame): AcpStore {
  switch (frame.kind) {
    case "rpc":
      return reduceAcpMessage(state, frame.message) as AcpStore;
    case "stderr":
      return { ...state, diagnostic: frame.message };
    case "protocol_error":
      return {
        ...state,
        rpcError: frame.message,
        isStreaming: false,
        permission: null,
        elicitation: null,
      };
    case "exit":
      return {
        ...state,
        connection: "exited",
        sessionId: null,
        isStreaming: false,
        permission: null,
        elicitation: null,
        processError:
          state.diagnostic ??
          (frame.code === 0 || frame.code === null
            ? null
            : `The agent exited with code ${frame.code}`),
      };
    case "response":
      return reduceAcpResponse(state, frame);
    case "setup":
      return reduceAcpSetup(state, frame);
    case "request":
      return reduceAcpRequest(state, frame);
    case "connection":
      return {
        ...state,
        connection: frame.connection,
        processError:
          frame.processError === undefined
            ? state.processError
            : frame.processError,
        diagnostic:
          frame.diagnostic === undefined ? state.diagnostic : frame.diagnostic,
        sessionConfig:
          frame.sessionConfig === undefined
            ? state.sessionConfig
            : frame.sessionConfig,
      };
    default:
      return state;
  }
}

function reduceAcpResponse(
  state: AcpStore,
  frame: Extract<AcpFrame, { kind: "response" }>,
): AcpStore {
  const { result, error, method } = frame;
  if (method !== "session/prompt") return state;

  const object = asObject(result);
  let next = state;

  if (object && "usage" in object && !error) {
    next = { ...next, usage: parseEndTurnUsage(object.usage, next.usage) };
  }
  if (next.notice?.kind === "retry") {
    next = { ...next, notice: null };
  }

  if (next.protocolVersion === 1) {
    // v1 reports the outcome on the prompt response itself.
    return {
      ...next,
      isStreaming: false,
      sessionState: "idle",
      lastStopReason: error
        ? "error"
        : typeof object?.stopReason === "string"
          ? object.stopReason
          : null,
      lastStopError: error ? errorText(error) : null,
    };
  }

  const messageId =
    typeof object?.messageId === "string" ? object.messageId : null;
  if (messageId && frame.promptLocalMessageId) {
    next = reconcileAcpUserMessage(
      next,
      frame.promptLocalMessageId,
      messageId,
    ) as AcpStore;
  }
  if (error) {
    // In v2 an error response means the message was never inserted; the turn
    // never started, so there is no stop reason to report.
    return { ...next, isStreaming: false, sessionState: "idle" };
  }
  return next;
}

function reduceAcpSetup(
  state: AcpStore,
  frame: Extract<AcpFrame, { kind: "setup" }>,
): AcpStore {
  const result = asObject(frame.result);
  if (frame.step === "initialize") {
    return {
      ...state,
      protocolVersion:
        result?.protocolVersion === 1 || result?.protocolVersion === 2
          ? result.protocolVersion
          : state.protocolVersion,
      agentInfo: parseAgentInfo(result?.info ?? result?.agentInfo),
      capabilities: parseAgentCapabilities(
        result?.capabilities ?? result?.agentCapabilities,
      ),
      authMethods: parseAuthMethods(result?.authMethods),
    };
  }

  if (frame.step === "session/new") {
    const modeState = parseModeState(result?.modes);
    return {
      ...state,
      connection: "ready",
      processError: null,
      sessionId: typeof result?.sessionId === "string" ? result.sessionId : null,
      configOptions: parseConfigOptions(result?.configOptions),
      commands: parseCommands(result?.availableCommands),
      modeState,
      currentMode: modeState?.currentModeId ?? null,
      modelState: parseModelState(result?.models),
      sessionConfig:
        frame.sessionConfig === undefined
          ? state.sessionConfig
          : frame.sessionConfig,
    };
  }

  if (frame.step === "session/resume") {
    const modeState =
      result?.modes === undefined ? state.modeState : parseModeState(result.modes);
    return {
      ...state,
      sessionId: typeof result?.sessionId === "string" ? result.sessionId : state.sessionId,
      configOptions: mergeConfigOptions(state.configOptions, result?.configOptions),
      commands: Array.isArray(result?.availableCommands)
        ? parseCommands(result.availableCommands)
        : state.commands,
      modeState,
      currentMode: modeState?.currentModeId ?? null,
      modelState:
        result?.models === undefined
          ? state.modelState
          : parseModelState(result.models),
      permission: null,
      elicitation: null,
    };
  }

  if (frame.step === "session/load") {
    const modeState = parseModeState(result?.modes);
    return {
      ...state,
      sessionId: typeof result?.sessionId === "string" ? result.sessionId : state.sessionId,
      configOptions: parseConfigOptions(result?.configOptions),
      commands: parseCommands(result?.availableCommands),
      modeState,
      currentMode: modeState?.currentModeId ?? null,
      modelState:
        result?.models === undefined
          ? state.modelState
          : parseModelState(result.models),
      permission: null,
      elicitation: null,
    };
  }

  // session/fork
  const modeState = parseModeState(result?.modes);
  return {
    ...state,
    sessionId: typeof result?.sessionId === "string" ? result.sessionId : state.sessionId,
    configOptions: parseConfigOptions(result?.configOptions),
    commands: parseCommands(result?.availableCommands),
    modeState,
    currentMode: modeState?.currentModeId ?? null,
    modelState: parseModelState(result?.models),
    permission: null,
    elicitation: null,
  };
}

function reduceAcpRequest(
  state: AcpStore,
  frame: Extract<AcpFrame, { kind: "request" }>,
): AcpStore {
  if (frame.request === "permission") {
    return { ...state, permission: frame.value };
  }
  if (frame.request === "elicitation") {
    return { ...state, elicitation: frame.value };
  }
  // elicitation/complete: only clears the matching URL elicitation.
  const current = state.elicitation;
  return current?.mode === "url" && current.elicitationId === frame.elicitationId
    ? { ...state, elicitation: null }
    : state;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function errorText(error: unknown): string {
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
