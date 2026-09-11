import {
  INITIAL_PI_RPC_STATE,
  type PiContentBlock,
  type PiExtensionRequest,
  type PiExtensionWidget,
  type PiForkMessage,
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

function isQueueMode(value: unknown): value is "all" | "one-at-a-time" {
  return value === "all" || value === "one-at-a-time";
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
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

function isChatMessage(message: PiMessage): boolean {
  return message.role === "user" || message.role === "assistant";
}

const MAX_MESSAGES = 500;

let sequenceCounter = 0;

function nextSequence(): number {
  sequenceCounter += 1;
  return sequenceCounter;
}

function upsertMessage(messages: PiMessage[], message: PiMessage): PiMessage[] {
  if (message.timestamp !== undefined) {
    const index = messages.findIndex(
      (candidate) =>
        candidate.role === message.role &&
        candidate.timestamp === message.timestamp,
    );
    if (index >= 0) {
      const next = [...messages];
      next[index] = { ...message, sequence: next[index].sequence };
      return next;
    }
  }
  if (message.role === "assistant") {
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last?.role === "assistant" && last.timestamp === undefined) {
      const next = [...messages];
      next[lastIndex] = { ...message, sequence: next[lastIndex].sequence };
      return next;
    }
  }
  return [...messages, { ...message, sequence: nextSequence() }].slice(
    -MAX_MESSAGES,
  );
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
        sequence: nextSequence(),
      },
    ];
  }
  const next = [...tools];
  next[index] = { ...next[index], ...update, sequence: next[index].sequence };
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

function forkMessages(value: unknown): PiForkMessage[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map(asObject)
    .filter((message): message is JsonObject => !!message)
    .map((message) => ({
      entryId: asString(message.entryId),
      text: asString(message.text),
    }))
    .filter(
      (message): message is { entryId: string; text: string } =>
        !!message.entryId && !!message.text,
    );
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
          steeringMode: isQueueMode(data.steeringMode)
            ? data.steeringMode
            : "one-at-a-time",
          followUpMode: isQueueMode(data.followUpMode)
            ? data.followUpMode
            : "one-at-a-time",
          pendingMessageCount: asNumber(data.pendingMessageCount) ?? 0,
          isRetrying: false,
        },
        rpcError: null,
      };
    }
    if (command === "get_messages" && Array.isArray(data?.messages)) {
      return {
        ...state,
        messages: data.messages
          .filter(isMessage)
          .filter(isChatMessage)
          .map((message) => ({ ...message, sequence: nextSequence() }))
          .slice(-MAX_MESSAGES),
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
    if (command === "get_fork_messages") {
      const messages = forkMessages(data?.messages);
      return messages ? { ...state, forkMessages: messages, rpcError: null } : state;
    }
    if (command === "export_html" && data) {
      const path = asString(data.path);
      return path ? { ...state, exportedHtmlPath: path, rpcError: null } : state;
    }
    if (command === "set_model" && isModel(message.data)) {
      return {
        ...state,
        session: { ...state.session, model: message.data },
        rpcError: null,
      };
    }
    if (
      command === "new_session" ||
      command === "switch_session" ||
      command === "fork" ||
      command === "clone"
    ) {
      return {
        ...state,
        extensionRequest: null,
        extensionStatuses: {},
        extensionWidgets: [],
        extensionTitle: null,
        extensionEditorText: null,
        forkMessages: [],
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
  if (type === "agent_end") {
    return {
      ...state,
      session: {
        ...state.session,
        isStreaming: false,
        isRetrying: message.willRetry === true,
      },
      // The turn is over; drop stale tool rows so they don't pile up below
      // newer messages. The transcript is rebuilt from get_messages anyway.
      tools: [],
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
  if (type === "auto_retry_start") {
    return { ...state, session: { ...state.session, isRetrying: true } };
  }
  if (type === "auto_retry_end") {
    return { ...state, session: { ...state.session, isRetrying: false } };
  }
  if (["message_start", "message_update", "message_end"].includes(type)) {
    if (!isMessage(message.message)) return state;
    if (!isChatMessage(message.message)) return state;
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
    if (request) return { ...state, extensionRequest: request };
    const id = asString(message.id);
    const method = asString(message.method);
    if (!id || !method) return state;
    if (method === "notify") {
      const notification = asString(message.message);
      const notifyType = asString(message.notifyType);
      return notification
        ? {
            ...state,
            extensionNotification: {
              id,
              message: notification,
              type:
                notifyType === "warning" || notifyType === "error"
                  ? notifyType
                  : "info",
            },
          }
        : state;
    }
    if (method === "setStatus") {
      const key = asString(message.statusKey);
      if (!key) return state;
      const statuses = { ...state.extensionStatuses };
      const text = asString(message.statusText);
      if (text === null) delete statuses[key];
      else statuses[key] = text;
      return { ...state, extensionStatuses: statuses };
    }
    if (method === "setWidget") {
      const key = asString(message.widgetKey);
      const lines = asStringArray(message.widgetLines);
      if (!key) return state;
      const widgets = state.extensionWidgets.filter((widget) => widget.key !== key);
      if (lines) {
        const widget: PiExtensionWidget = {
          key,
          lines,
          placement:
            message.widgetPlacement === "aboveEditor"
              ? "aboveEditor"
              : "belowEditor",
        };
        widgets.push(widget);
      }
      return { ...state, extensionWidgets: widgets };
    }
    if (method === "setTitle") {
      return { ...state, extensionTitle: asString(message.title) };
    }
    if (method === "set_editor_text") {
      const text = asString(message.text);
      return text === null
        ? state
        : { ...state, extensionEditorText: { id, text } };
    }
    return state;
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
