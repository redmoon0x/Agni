import {
  INITIAL_PI_RPC_STATE,
  type PiContentBlock,
  type PiExtensionRequest,
  type PiMessage,
  type PiModel,
  type PiRpcState,
  type PiToolActivity,
} from "@/modules/pi-agent/types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isModel(value: unknown): value is PiModel {
  const model = asObject(value);
  return !!(
    model &&
    asString(model.id) &&
    asString(model.name) &&
    asString(model.provider)
  );
}

function isMessage(value: unknown): value is PiMessage {
  const message = asObject(value);
  return !!(
    message &&
    asString(message.role) &&
    (typeof message.content === "string" || Array.isArray(message.content))
  );
}

const MAX_MESSAGES = 500;

function upsertMessage(messages: PiMessage[], message: PiMessage): PiMessage[] {
  if (message.timestamp !== undefined) {
    const index = messages.findIndex(
      (candidate) =>
        candidate.role === message.role &&
        candidate.timestamp === message.timestamp,
    );
    if (index >= 0) {
      const next = [...messages];
      next[index] = message;
      return next;
    }
  }
  if (message.role === "assistant") {
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last?.role === "assistant" && last.timestamp === undefined) {
      const next = [...messages];
      next[lastIndex] = message;
      return next;
    }
  }
  return [...messages, message].slice(-MAX_MESSAGES);
}

function toolOutput(value: unknown): string {
  const result = asObject(value);
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => asString(asObject(block)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function updateTool(
  tools: PiToolActivity[],
  id: string,
  update: Partial<PiToolActivity>,
): PiToolActivity[] {
  const index = tools.findIndex((tool) => tool.id === id);
  if (index === -1) {
    return [
      ...tools.slice(-49),
      {
        id,
        name: update.name ?? "tool",
        args: update.args ?? null,
        status: update.status ?? "running",
        output: update.output ?? "",
      },
    ];
  }
  const next = [...tools];
  next[index] = { ...next[index], ...update };
  return next;
}

function extensionRequest(message: JsonObject): PiExtensionRequest | null {
  const id = asString(message.id);
  const method = asString(message.method);
  if (
    !id ||
    !method ||
    !["select", "confirm", "input", "editor"].includes(method)
  ) {
    return null;
  }
  return {
    type: "extension_ui_request",
    id,
    method,
    title: asString(message.title) ?? undefined,
    message: asString(message.message) ?? undefined,
    options: Array.isArray(message.options)
      ? message.options.filter(
          (option): option is string => typeof option === "string",
        )
      : undefined,
    placeholder: asString(message.placeholder) ?? undefined,
    prefill: asString(message.prefill) ?? undefined,
  };
}

export function reducePiRpc(state: PiRpcState, value: unknown): PiRpcState {
  const message = asObject(value);
  const type = asString(message?.type);
  if (!message || !type) return state;

  if (type === "response") {
    const command = asString(message.command);
    if (message.success === false) {
      return {
        ...state,
        rpcError: asString(message.error) ?? "Pi command failed",
      };
    }
    const data = asObject(message.data);
    if (command === "get_state" && data) {
      return {
        ...state,
        session: {
          model: isModel(data.model) ? data.model : null,
          thinkingLevel: asString(data.thinkingLevel) ?? "off",
          isStreaming: data.isStreaming === true,
          isCompacting: data.isCompacting === true,
          sessionId: asString(data.sessionId) ?? undefined,
          sessionName: asString(data.sessionName) ?? undefined,
          sessionFile: asString(data.sessionFile) ?? undefined,
          autoCompactionEnabled: data.autoCompactionEnabled !== false,
        },
        rpcError: null,
      };
    }
    if (command === "get_messages" && Array.isArray(data?.messages)) {
      return {
        ...state,
        messages: data.messages.filter(isMessage).slice(-MAX_MESSAGES),
        tools: [],
        rpcError: null,
      };
    }
    if (command === "get_available_models" && Array.isArray(data?.models)) {
      return { ...state, models: data.models.filter(isModel), rpcError: null };
    }
    if (command === "get_commands" && Array.isArray(data?.commands)) {
      return {
        ...state,
        commands: data.commands
          .map(asObject)
          .filter((c): c is JsonObject => !!c && typeof c.name === "string")
          .map((c) => ({
            name: c.name as string,
            description: asString(c.description) ?? undefined,
          })),
        rpcError: null,
      };
    }
    if (command === "get_session_stats" && data) {
      return {
        ...state,
        stats: {
          userMessages: asNumber(data.userMessages),
          assistantMessages: asNumber(data.assistantMessages),
          toolCalls: asNumber(data.toolCalls),
          totalMessages: asNumber(data.totalMessages),
          cost: asNumber(data.cost),
          contextUsage: data.contextUsage,
        },
        rpcError: null,
      };
    }
    if (command === "set_model" && isModel(message.data)) {
      return {
        ...state,
        session: { ...state.session, model: message.data },
        rpcError: null,
      };
    }
    return { ...state, rpcError: null };
  }

  if (type === "agent_start") {
    return {
      ...state,
      session: { ...state.session, isStreaming: true },
      rpcError: null,
    };
  }
  if (type === "agent_settled") {
    return {
      ...state,
      session: { ...state.session, isStreaming: false },
    };
  }
  if (type === "compaction_start") {
    return {
      ...state,
      session: { ...state.session, isCompacting: true },
    };
  }
  if (type === "compaction_end") {
    return {
      ...state,
      session: { ...state.session, isCompacting: false },
    };
  }
  if (["message_start", "message_update", "message_end"].includes(type)) {
    if (!isMessage(message.message)) return state;
    return {
      ...state,
      messages: upsertMessage(state.messages, message.message),
    };
  }
  if (type === "tool_execution_start") {
    const id = asString(message.toolCallId);
    if (!id) return state;
    return {
      ...state,
      tools: updateTool(state.tools, id, {
        name: asString(message.toolName) ?? "tool",
        args: message.args,
        status: "running",
      }),
    };
  }
  if (type === "tool_execution_update") {
    const id = asString(message.toolCallId);
    if (!id) return state;
    return {
      ...state,
      tools: updateTool(state.tools, id, {
        output: toolOutput(message.partialResult),
      }),
    };
  }
  if (type === "tool_execution_end") {
    const id = asString(message.toolCallId);
    if (!id) return state;
    return {
      ...state,
      tools: updateTool(state.tools, id, {
        status: message.isError === true ? "error" : "done",
        output: toolOutput(message.result),
      }),
    };
  }
  if (type === "extension_ui_request") {
    const request = extensionRequest(message);
    return request ? { ...state, extensionRequest: request } : state;
  }
  if (type === "extension_error") {
    return {
      ...state,
      rpcError: asString(message.error) ?? "A Pi extension failed",
    };
  }
  return state;
}

export function resetPiConversation(state: PiRpcState): PiRpcState {
  return {
    ...INITIAL_PI_RPC_STATE,
    models: state.models,
    thinkingLevels: state.thinkingLevels,
    commands: state.commands,
    session: { ...state.session, isStreaming: false, isCompacting: false },
  };
}

export function messageText(message: PiMessage, blockType = "text"): string {
  if (typeof message.content === "string") {
    return blockType === "text" ? message.content : "";
  }
  return message.content
    .filter((block: PiContentBlock) => block.type === blockType)
    .map(
      (block) => (blockType === "thinking" ? block.thinking : block.text) ?? "",
    )
    .filter(Boolean)
    .join("\n");
}
