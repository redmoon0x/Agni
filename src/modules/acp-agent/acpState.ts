import type {
  AcpAgentInfo,
  AcpCapabilities,
  AcpCommand,
  AcpConfigOption,
  AcpConfigOptionValue,
  AcpContentBlock,
  AcpMessage,
  AcpMessageRole,
  AcpMode,
  AcpModeState,
  AcpPlanEntry,
  AcpSessionInfo,
  AcpState,
  AcpToolCall,
  AcpToolContent,
  AcpToolLocation,
  AcpToolStatus,
  AcpUsage,
} from "@/modules/acp-agent/types";
import { EMPTY_ACP_CAPABILITIES } from "@/modules/acp-agent/types";

type JsonObject = Record<string, unknown>;

const MAX_MESSAGES = 500;
const MAX_TOOL_CONTENT = 50;

let sequenceCounter = 0;

function nextSequence(): number {
  sequenceCounter += 1;
  return sequenceCounter;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function normalizeStatus(value: string | null): AcpToolStatus {
  if (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  return "pending";
}

export function reduceAcpMessage(state: AcpState, value: unknown): AcpState {
  const message = asObject(value);
  if (!message) return state;
  if (asString(message.method) !== "session/update") return state;
  const params = asObject(message.params);
  if (!params) return state;
  return reduceAcpUpdate(state, params);
}

export function reduceAcpUpdate(state: AcpState, params: JsonObject): AcpState {
  const update = asObject(params.update);
  if (!update) return state;
  switch (asString(update.sessionUpdate)) {
    case "user_message_chunk":
      return appendChunk(state, "user", update);
    case "agent_message_chunk":
      return appendChunk(state, "agent", update);
    case "agent_thought_chunk":
      return appendChunk(state, "thought", update);
    case "tool_call":
      return upsertTool(state, update, true);
    case "tool_call_update":
      return upsertTool(state, update, false);
    case "plan":
      return { ...state, plan: parsePlan(update.entries) };
    case "usage_update":
      return { ...state, usage: parseUsage(update) };
    case "available_commands_update":
      return { ...state, commands: parseCommands(update.availableCommands) };
    case "config_option_update":
      return { ...state, configOptions: parseConfigOptions(update.configOptions) };
    case "current_mode_update": {
      const modeId =
        asString(update.currentModeId) ?? asString(update.modeId);
      return modeId ? { ...state, currentMode: modeId } : state;
    }
    default:
      return state;
  }
}

export function resetAcpConversation(state: AcpState): AcpState {
  return {
    ...state,
    messages: [],
    tools: [],
    plan: [],
    permission: null,
    usage: null,
    isStreaming: false,
    lastStopReason: null,
    rpcError: null,
  };
}

let localPromptCounter = 0;

/** Agents only echo user messages when replaying a loaded session, so the
 * client renders the prompt it just sent itself. */
export function appendUserPrompt(state: AcpState, text: string): AcpState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  localPromptCounter += 1;
  const message: AcpMessage = {
    id: `user:local:${localPromptCounter}`,
    role: "user",
    text: trimmed,
    sequence: nextSequence(),
  };
  return {
    ...state,
    messages: [...state.messages, message].slice(-MAX_MESSAGES),
  };
}

function appendChunk(
  state: AcpState,
  role: AcpMessageRole,
  update: JsonObject,
): AcpState {
  const content = asObject(update.content);
  const text = content ? (asString(content.text) ?? "") : "";
  if (!text) return state;

  const messageId = asString(update.messageId);
  const messages = state.messages;
  const last = messages[messages.length - 1];
  const id = messageId ? `msg:${messageId}` : null;

  let targetId = id;
  let index = -1;
  if (targetId) {
    index = messages.findIndex((message) => message.id === targetId);
  } else if (last && last.role === role && last.id.startsWith("anon:")) {
    targetId = last.id;
    index = messages.length - 1;
  } else {
    targetId = `anon:${role}:${nextSequence()}`;
  }

  let next: AcpMessage[];
  if (index >= 0 && targetId) {
    next = messages.slice();
    const existing = next[index];
    next[index] = { ...existing, text: existing.text + text };
  } else {
    const message: AcpMessage = {
      id: targetId ?? `anon:${role}:${nextSequence()}`,
      role,
      text,
      sequence: nextSequence(),
    };
    next = [...messages, message];
  }
  return { ...state, messages: next.slice(-MAX_MESSAGES) };
}

function upsertTool(
  state: AcpState,
  update: JsonObject,
  isNew: boolean,
): AcpState {
  const toolCallId = asString(update.toolCallId);
  if (!toolCallId) return state;

  const tools = state.tools.slice();
  const index = tools.findIndex((tool) => tool.id === toolCallId);
  const incomingContent = parseToolContent(update.content);
  const incomingLocations = parseLocations(update.locations);

  if (index < 0) {
    const tool: AcpToolCall = {
      id: toolCallId,
      title: asString(update.title) ?? "",
      kind: asString(update.kind) ?? "other",
      status: normalizeStatus(asString(update.status)),
      content: incomingContent,
      locations: incomingLocations,
      rawInput: update.rawInput ?? null,
      rawOutput: update.rawOutput ?? null,
      sequence: nextSequence(),
    };
    tools.push(tool);
    return { ...state, tools };
  }

  const existing = tools[index];
  const status = asString(update.status);
  const title = asString(update.title);
  const kind = asString(update.kind);
  tools[index] = {
    ...existing,
    title: title ?? existing.title,
    kind: kind ?? existing.kind,
    status: status ? normalizeStatus(status) : existing.status,
    content: incomingContent.length
      ? [...existing.content, ...incomingContent].slice(-MAX_TOOL_CONTENT)
      : existing.content,
    locations: incomingLocations.length ? incomingLocations : existing.locations,
    rawOutput: update.rawOutput ?? existing.rawOutput,
    rawInput: isNew ? (update.rawInput ?? existing.rawInput) : existing.rawInput,
  };
  return { ...state, tools };
}

function parseToolContent(value: unknown): AcpToolContent[] {
  if (!Array.isArray(value)) return [];
  const parsed: AcpToolContent[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) continue;
    switch (asString(object.type)) {
      case "content": {
        const content = asObject(object.content) as AcpContentBlock | null;
        if (content) parsed.push({ type: "content", content });
        break;
      }
      case "diff":
        parsed.push({
          type: "diff",
          path: asString(object.path) ?? "",
          oldText: asString(object.oldText),
          newText: asString(object.newText) ?? "",
        });
        break;
      case "terminal":
        parsed.push({
          type: "terminal",
          terminalId: asString(object.terminalId) ?? "",
        });
        break;
      default:
        parsed.push({ type: "unknown", value: object });
    }
  }
  return parsed.slice(-MAX_TOOL_CONTENT);
}

function parseLocations(value: unknown): AcpToolLocation[] {
  if (!Array.isArray(value)) return [];
  const locations: AcpToolLocation[] = [];
  for (const item of value) {
    const object = asObject(item);
    const path = object ? asString(object.path) : null;
    if (!path) continue;
    const line = object ? asNumber(object.line) : null;
    locations.push(line === null ? { path } : { path, line });
  }
  return locations;
}

function parsePlan(value: unknown): AcpPlanEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: AcpPlanEntry[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) continue;
    entries.push({
      content: asString(object.content) ?? "",
      priority: asString(object.priority),
      status: asString(object.status),
    });
  }
  return entries;
}

function parseUsage(update: JsonObject): AcpUsage | null {
  const used = asNumber(update.used);
  const size = asNumber(update.size);
  if (used === null || size === null) return null;
  const cost = asObject(update.cost);
  const amount = cost ? asNumber(cost.amount) : null;
  const currency = cost ? asString(cost.currency) : null;
  return {
    used,
    size,
    cost:
      amount !== null && currency ? { amount, currency } : null,
  };
}

function parseCommands(value: unknown): AcpCommand[] {
  if (!Array.isArray(value)) return [];
  const commands: AcpCommand[] = [];
  for (const item of value) {
    const object = asObject(item);
    const name = object ? asString(object.name) : null;
    if (!name) continue;
    const description = object ? asString(object.description) : null;
    const input = object ? asObject(object.input) : null;
    const inputHint = input ? asString(input.hint) : null;
    commands.push({
      name,
      ...(description ? { description } : {}),
      ...(inputHint ? { inputHint } : {}),
    });
  }
  return commands;
}

export function parseConfigOptions(value: unknown): AcpConfigOption[] {
  if (!Array.isArray(value)) return [];
  const options: AcpConfigOption[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) continue;
    const id = asString(object.id);
    const name = asString(object.name);
    if (!id || !name) continue;
    const rawValue = object.currentValue;
    const currentValue =
      typeof rawValue === "boolean" ? rawValue : (asString(rawValue) ?? "");
    const description = asString(object.description);
    const category = asString(object.category);
    options.push({
      id,
      name,
      type: asString(object.type) === "boolean" ? "boolean" : "select",
      currentValue,
      options: parseConfigOptionValues(object.options),
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
    });
  }
  return options;
}

function parseConfigOptionValues(value: unknown): AcpConfigOptionValue[] {
  if (!Array.isArray(value)) return [];
  const values: AcpConfigOptionValue[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) continue;
    const optionValue = asString(object.value);
    const name = asString(object.name);
    if (optionValue === null || !name) continue;
    const description = asString(object.description);
    values.push(
      description
        ? { value: optionValue, name, description }
        : { value: optionValue, name },
    );
  }
  return values;
}

export function parseModeState(value: unknown): AcpModeState | null {
  const object = asObject(value);
  if (!object) return null;
  const currentModeId = asString(object.currentModeId);
  const available = Array.isArray(object.availableModes)
    ? object.availableModes
    : [];
  const availableModes: AcpMode[] = [];
  for (const item of available) {
    const mode = asObject(item);
    const id = mode ? asString(mode.id) : null;
    const name = mode ? asString(mode.name) : null;
    if (!id || !name) continue;
    const description = mode ? asString(mode.description) : null;
    availableModes.push(
      description ? { id, name, description } : { id, name },
    );
  }
  if (!currentModeId || availableModes.length === 0) return null;
  return { currentModeId, availableModes };
}

export function parseAgentCapabilities(value: unknown): AcpCapabilities {
  const object = asObject(value);
  if (!object) return EMPTY_ACP_CAPABILITIES;
  const prompt = asObject(object.promptCapabilities);
  const session = asObject(object.sessionCapabilities);
  return {
    loadSession: object.loadSession === true,
    sessionList: session?.list !== undefined && session?.list !== null,
    promptImage: prompt?.image === true,
    promptAudio: prompt?.audio === true,
    promptEmbeddedContext: prompt?.embeddedContext === true,
  };
}

export function parseAgentInfo(value: unknown): AcpAgentInfo {
  const object = asObject(value);
  return {
    name: object ? asString(object.name) : null,
    title: object ? asString(object.title) : null,
    version: object ? asString(object.version) : null,
  };
}

export function parseSessionList(value: unknown): AcpSessionInfo[] {
  if (!Array.isArray(value)) return [];
  const sessions: AcpSessionInfo[] = [];
  for (const item of value) {
    const object = asObject(item);
    const sessionId = object ? asString(object.sessionId) : null;
    if (!sessionId) continue;
    sessions.push({
      sessionId,
      cwd: object ? asString(object.cwd) : null,
      title: object ? asString(object.title) : null,
      updatedAt: object ? asString(object.updatedAt) : null,
    });
  }
  return sessions;
}
