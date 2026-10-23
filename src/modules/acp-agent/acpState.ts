import type {
  AcpAgentInfo,
  AcpAuthMethod,
  AcpCapabilities,
  AcpCommand,
  AcpCompactionStatus,
  AcpConfigOption,
  AcpConfigOptionValue,
  AcpContentBlock,
  AcpDiffChange,
  AcpDisplayTerminal,
  AcpMessage,
  AcpMessageRole,
  AcpMode,
  AcpModeState,
  AcpModel,
  AcpModelState,
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

function hasField(update: JsonObject, field: string): boolean {
  return field in update && update[field] !== undefined;
}

/** Reads the message out of a JSON-RPC error object, falling back to the
 *  stringified payload so an `error` stop reason still explains itself. */
function errorText(value: unknown): string | null {
  if (typeof value === "string") return value;
  const object = asObject(value);
  if (!object) return null;
  const message = asString(object.message);
  if (!message) return null;
  const code = asNumber(object.code);
  return code === null ? message : `${message} (code ${code})`;
}

/**
 * Decodes one independently base64-encoded payload. ACP requires each
 * `terminal_output_chunk.data` to be decoded on its own before appending, so
 * callers must never concatenate the encoded strings first. Chunk boundaries
 * may split UTF-8 code points and ANSI escape sequences.
 */
function decodeBase64Text(value: string): string {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    // A malformed snapshot must not take down the stream; keep it verbatim so
    // the user can still see what the agent sent.
    return "";
  }
}

function normalizeStatus(value: string | null): AcpToolStatus {
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
    case "user_message":
      return upsertMessage(state, "user", update);
    case "agent_message":
      return upsertMessage(state, "agent", update);
    case "agent_thought":
      return upsertMessage(state, "thought", update);
    case "tool_call":
      return upsertTool(state, update, "create");
    case "tool_call_update":
      return upsertTool(state, update, "replace");
    case "tool_call_content_chunk":
      return upsertTool(state, update, "append");
    case "terminal_update":
      return updateTerminal(state, update);
    case "terminal_output_chunk":
      return appendTerminalOutput(state, update);
    case "plan":
      return { ...state, plan: parsePlan(update.entries), planId: null };
    case "plan_update":
      return applyPlanUpdate(state, update);
    case "usage_update":
      return { ...state, usage: parseUsage(update) };
    case "available_commands_update":
      return { ...state, commands: parseCommands(update.availableCommands) };
    case "session_info_update":
      return applySessionInfo(state, update);
    case "config_option_update":
      return {
        ...state,
        configOptions: mergeConfigOptions(
          state.configOptions,
          update.configOptions,
        ),
      };
    case "notice":
      return applyNotice(state, update);
    case "compaction_update":
      return applyCompactionUpdate(state, update);
    case "compaction_summary_chunk":
      return appendCompactionSummary(state, update);
    case "current_mode_update": {
      const modeId = asString(update.currentModeId) ?? asString(update.modeId);
      return modeId ? { ...state, currentMode: modeId } : state;
    }
    case "state_update": {
      const sessionState = asString(update.state);
      if (
        sessionState !== "idle" &&
        sessionState !== "running" &&
        sessionState !== "requires_action"
      ) {
        return state;
      }
      const stopReason = asString(update.stopReason);
      const stopError = stopReason === "error" ? errorText(update.error) : null;
      return {
        ...state,
        sessionState,
        isStreaming: sessionState !== "idle",
        ...(sessionState === "idle" && stopReason
          ? { lastStopReason: stopReason, lastStopError: stopError }
          : {}),
      };
    }
    default:
      return state;
  }
}

/** v1 `plan` carries a bare `entries` array; v2 `plan_update` nests it as
 *  `plan: { type, planId, entries }` keyed by a stable `planId`. */
function applyPlanUpdate(state: AcpState, update: JsonObject): AcpState {
  const plan = asObject(update.plan);
  if (!plan) return { ...state, plan: parsePlan(update.entries), planId: null };
  return {
    ...state,
    plan: parsePlan(plan.entries),
    planId: asString(plan.planId) ?? state.planId,
  };
}

function parseCompactionStatus(value: unknown): AcpCompactionStatus | null {
  if (
    value === "in_progress" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

function applyCompactionUpdate(state: AcpState, update: JsonObject): AcpState {
  const status = parseCompactionStatus(update.status);
  if (status === null) return state;
  const compaction = {
    id: asString(update.compactionId) ?? state.compaction?.id ?? null,
    status,
  };
  const next: AcpState = { ...state, compaction };
  if (status === "in_progress") {
    return {
      ...next,
      notice: {
        kind: "compaction",
        text: "Compacting conversation",
        severity: null,
      },
    };
  }
  // Only retire a compaction notice; never clobber a retry or agent notice.
  return next.notice?.kind === "compaction" ? { ...next, notice: null } : next;
}

/** Compaction summaries are streamed as content chunks and land in the
 *  transcript as a plain agent message so they survive a reload. */
function appendCompactionSummary(state: AcpState, update: JsonObject): AcpState {
  const content = parseContentBlock(update.content);
  if (!content) return state;
  const text = asString(content.text);
  if (content.type !== "text" || !text) return state;
  const messageId = asString(update.messageId);
  const id = messageId ? `msg:agent:${messageId}` : null;
  const messages = state.messages;
  const last = messages[messages.length - 1];
  const targetId =
    id ?? (last && last.role === "agent" && last.id.startsWith("anon:")
      ? last.id
      : null);
  if (targetId) {
    const index = messages.findIndex((message) => message.id === targetId);
    if (index >= 0) {
      const messages2 = messages.slice();
      const existing = messages2[index];
      messages2[index] = {
        ...existing,
        text: existing.text + text,
        content: [...existing.content, content],
      };
      return { ...state, messages: messages2.slice(-MAX_MESSAGES) };
    }
  }
  const newId = targetId ?? `anon:agent:${nextSequence()}`;
  const message: AcpMessage = {
    id: newId,
    role: "agent",
    text,
    content: [content],
    sequence: nextSequence(),
  };
  return {
    ...state,
    messages: [...messages, message].slice(-MAX_MESSAGES),
  };
}

function applyNotice(state: AcpState, update: JsonObject): AcpState {
  const rawSeverity = asString(update.severity);
  const severity =
    rawSeverity === "info" ||
    rawSeverity === "warning" ||
    rawSeverity === "error" ||
    rawSeverity === "other"
      ? rawSeverity
      : "other";
  const title = asString(update.title);
  const message = asString(update.message);
  const text = title && message ? `${title}: ${message}` : (title ?? message);
  if (!text) return { ...state, notice: null };
  return { ...state, notice: { kind: "notice", text, severity } };
}

export function resetAcpConversation(state: AcpState): AcpState {
  return {
    ...state,
    messages: [],
    tools: [],
    terminals: {},
    plan: [],
    planId: null,
    permission: null,
    elicitation: null,
    usage: null,
    sessionTitle: null,
    notice: null,
    compaction: null,
    isStreaming: false,
    lastStopReason: null,
    lastStopError: null,
    rpcError: null,
  };
}

function applySessionInfo(state: AcpState, update: JsonObject): AcpState {
  let next = state;
  const title = update.title;
  if (typeof title === "string") next = { ...next, sessionTitle: title };
  else if (title === null) next = { ...next, sessionTitle: null };

  const meta = asObject(update._meta);
  if (!meta) return next;

  if ("opencode/retry" in meta) {
    const retry = asObject(meta["opencode/retry"]);
    if (!retry) {
      if (next.notice?.kind === "retry") next = { ...next, notice: null };
    } else {
      const attempt = asNumber(retry.attempt);
      const error = asObject(retry.error);
      const message = error ? asString(error.message) : null;
      const base =
        attempt === null ? "Retrying" : `Retrying (attempt ${attempt})`;
      next = {
        ...next,
        notice: { kind: "retry", text: message ? `${base}: ${message}` : base, severity: null },
      };
    }
  }

  const compaction = meta["opencode/compaction"];
  if (compaction !== undefined) {
    const status = asObject(compaction)
      ? asString((compaction as JsonObject).status)
      : null;
    if (status === "started") {
      next = { ...next, notice: { kind: "compaction", text: "Compacting conversation", severity: null } };
    } else if (next.notice?.kind === "compaction") {
      next = { ...next, notice: null };
    }
  }
  return next;
}

const MAX_TERMINAL_OUTPUT = 1024 * 1024;

function terminalId(update: JsonObject): string | null {
  return asString(update.terminalId);
}

/** v1 sends `title`/`state`/`exitCode` flat; v2 sends `command`/`cwd` plus an
 *  `exitStatus` object and an authoritative base64 `output` snapshot. Fields
 *  follow omit/null/value patch semantics, so only concrete values overwrite. */
function updateTerminal(state: AcpState, update: JsonObject): AcpState {
  const id = terminalId(update);
  if (!id) return state;
  const current: AcpDisplayTerminal = state.terminals[id] ?? {
    id,
    title: null,
    command: null,
    cwd: null,
    output: "",
    state: null,
    exitCode: null,
    signal: null,
  };

  const exitStatus = asObject(update.exitStatus);
  const exitCode =
    exitStatus && "exitCode" in exitStatus
      ? asNumber(exitStatus.exitCode)
      : asNumber(update.exitCode);
  const signal =
    exitStatus && "signal" in exitStatus
      ? asString(exitStatus.signal)
      : asString(update.signal);

  const command = asString(update.command);
  const cwd = asString(update.cwd);
  const next: AcpDisplayTerminal = {
    ...current,
    title: asString(update.title) ?? command ?? current.title,
    command: command ?? current.command,
    cwd: cwd ?? current.cwd,
    state: asString(update.state) ?? (exitStatus ? "exited" : current.state),
    exitCode: exitCode !== null ? exitCode : current.exitCode,
    signal: signal !== null ? signal : current.signal,
    source: "agent",
  };

  const output = asObject(update.output);
  if (output && typeof output.data === "string") {
    // A concrete snapshot replaces all retained bytes; never splice.
    next.output = decodeBase64Text(output.data).slice(-MAX_TERMINAL_OUTPUT);
  }

  return { ...state, terminals: { ...state.terminals, [id]: next } };
}

function appendTerminalOutput(state: AcpState, update: JsonObject): AcpState {
  const id = terminalId(update);
  if (!id) return state;
  const raw =
    asString(update.data) ??
    asString(update.content) ??
    asString(update.text) ??
    asString(update.output) ??
    "";
  if (!raw) return state;
  const isV2Chunk = typeof update.data === "string";
  const content = isV2Chunk ? decodeBase64Text(raw) : raw;
  if (!content) return state;
  const current = state.terminals[id] ?? {
    id,
    title: null,
    command: null,
    cwd: null,
    output: "",
    state: "running",
    exitCode: null,
    signal: null,
  };
  const output = `${current.output}${content}`.slice(-MAX_TERMINAL_OUTPUT);
  return {
    ...state,
    terminals: { ...state.terminals, [id]: { ...current, output } },
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
    content: [{ type: "text", text: trimmed }],
    sequence: nextSequence(),
  };
  return {
    ...state,
    messages: [...state.messages, message].slice(-MAX_MESSAGES),
  };
}

export function reconcileAcpUserMessage(
  state: AcpState,
  localId: string,
  messageId: string,
): AcpState {
  const localIndex = state.messages.findIndex(
    (message) => message.id === localId,
  );
  if (localIndex < 0) return state;
  const canonicalId = `msg:user:${messageId}`;
  const canonicalIndex = state.messages.findIndex(
    (message) => message.id === canonicalId,
  );
  if (canonicalIndex >= 0) {
    return {
      ...state,
      messages: state.messages.filter((message) => message.id !== localId),
    };
  }
  const messages = state.messages.slice();
  messages[localIndex] = { ...messages[localIndex], id: canonicalId };
  return { ...state, messages };
}

function appendChunk(
  state: AcpState,
  role: AcpMessageRole,
  update: JsonObject,
): AcpState {
  const content = parseContentBlock(update.content);
  if (!content) return state;
  const text = asString(content.text) ?? "";
  if (content.type === "text" && !text) return state;

  const messageId = asString(update.messageId);
  const messages = state.messages;
  const last = messages[messages.length - 1];
  const id = messageId ? `msg:${role}:${messageId}` : null;

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
    const reverseContentIndex =
      content.type === "text"
        ? [...existing.content]
            .reverse()
            .findIndex((block) => block.type === "text")
        : -1;
    const contentIndex =
      reverseContentIndex < 0
        ? -1
        : existing.content.length - 1 - reverseContentIndex;
    const blocks = existing.content.slice();
    if (contentIndex >= 0 && content.type === "text") {
      const previous = blocks[contentIndex];
      blocks[contentIndex] = {
        ...previous,
        text: `${previous.text ?? ""}${text}`,
      };
    } else {
      blocks.push(content);
    }
    next[index] = { ...existing, text: existing.text + text, content: blocks };
  } else {
    const message: AcpMessage = {
      id: targetId ?? `anon:${role}:${nextSequence()}`,
      role,
      text,
      content: [content],
      sequence: nextSequence(),
    };
    next = [...messages, message];
  }
  return { ...state, messages: next.slice(-MAX_MESSAGES) };
}

function upsertMessage(
  state: AcpState,
  role: AcpMessageRole,
  update: JsonObject,
): AcpState {
  const messageId = asString(update.messageId);
  if (!messageId) return state;
  const id = `msg:${role}:${messageId}`;

  // v2 upsert semantics: an absent `content` leaves it unchanged, while
  // `null` or `[]` explicitly clears it.
  const clearing =
    hasField(update, "content") &&
    (update.content === null ||
      (Array.isArray(update.content) && update.content.length === 0));

  const rawContent = Array.isArray(update.content) ? update.content : [];
  const content = clearing
    ? []
    : rawContent.flatMap((block) => {
        const parsed = parseContentBlock(block);
        return parsed ? [parsed] : [];
      });

  if (clearing) {
    const index = state.messages.findIndex((message) => message.id === id);
    if (index < 0) return state;
    const messages = state.messages.slice();
    messages[index] = { ...messages[index], text: "", content: [] };
    return { ...state, messages };
  }

  if (content.length === 0) return state;
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  const index = state.messages.findIndex((message) => message.id === id);
  if (index < 0) {
    return {
      ...state,
      messages: [
        ...state.messages,
        { id, role, text, content, sequence: nextSequence() },
      ].slice(-MAX_MESSAGES),
    };
  }
  const messages = state.messages.slice();
  messages[index] = { ...messages[index], text, content };
  return { ...state, messages };
}

function parseContentBlock(value: unknown): AcpContentBlock | null {
  const content = asObject(value);
  const type = content ? asString(content.type) : null;
  return content && type ? (content as AcpContentBlock) : null;
}

/** `tool_call` and `tool_call_update` carry a `content` array that replaces
 *  whatever was accumulated; only `tool_call_content_chunk` appends. */
type ToolUpdateMode = "create" | "replace" | "append";

function upsertTool(
  state: AcpState,
  update: JsonObject,
  mode: ToolUpdateMode,
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
      name: asString(update.name),
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
  const name = asString(update.name);
  // v2 patch semantics let an agent clear a field with an explicit `null`,
  // which v1 cannot express. Only honour the clear once v2 is negotiated so
  // v1 agents that use `null` as a stand-in for omission keep working.
  const clearable = state.protocolVersion === 2;
  const cleared = (field: string) =>
    clearable && update[field] === null && field in update;
  const hasContent = hasField(update, "content");
  const content = (() => {
    if (mode === "append") {
      return incomingContent.length
        ? [...existing.content, ...incomingContent].slice(-MAX_TOOL_CONTENT)
        : existing.content;
    }
    // A present `content` is authoritative: replace it, or clear it on `null`.
    if (hasContent) return update.content === null ? [] : incomingContent;
    return existing.content;
  })();
  const locations = (() => {
    if (incomingLocations.length) return incomingLocations;
    if (hasField(update, "locations") && update.locations === null) return [];
    return existing.locations;
  })();
  tools[index] = {
    ...existing,
    title: title ?? (cleared("title") ? "" : existing.title),
    name: name ?? (cleared("name") ? null : existing.name),
    kind: kind ?? (cleared("kind") ? "other" : existing.kind),
    status: status
      ? normalizeStatus(status)
      : cleared("status")
        ? "pending"
        : existing.status,
    content,
    locations,
    rawOutput: update.rawOutput ?? existing.rawOutput,
    rawInput: mode === "create" ? (update.rawInput ?? existing.rawInput) : existing.rawInput,
  };
  return { ...state, tools };
}

function parseDiffChanges(value: unknown): AcpDiffChange[] {
  if (!Array.isArray(value)) return [];
  const changes: AcpDiffChange[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) continue;
    const path = asString(object.path);
    const oldPath = asString(object.oldPath);
    const target = path ?? oldPath;
    if (!target) continue;
    changes.push({
      operation: asString(object.operation) ?? "modify",
      path: target,
      oldPath: path ? oldPath : null,
      fileType: asString(object.fileType),
      mimeType: asString(object.mimeType),
    });
  }
  return changes;
}

function parseToolContent(value: unknown): AcpToolContent[] {
  const raw = Array.isArray(value) ? value : [value];
  const parsed: AcpToolContent[] = [];
  for (const item of raw) {
    const object = asObject(item);
    if (!object) continue;
    switch (asString(object.type)) {
      case "content": {
        const content = asObject(object.content) as AcpContentBlock | null;
        if (content) parsed.push({ type: "content", content });
        break;
      }
      case "diff": {
        const changes = parseDiffChanges(object.changes);
        const patch = asObject(object.patch);
        const patchText = patch ? asString(patch.text) : null;
        // v2 has no oldText/newText pair: `changes` plus `patch` are the whole
        // payload, and either may be absent (binary, symlink, directory).
        const primary = changes[0];
        parsed.push({
          type: "diff",
          path: primary?.path ?? asString(object.path) ?? "",
          oldText: asString(object.oldText),
          newText: asString(object.newText) ?? patchText ?? "",
          changes,
          patch: patchText,
          patchFormat: patch ? asString(patch.format) : null,
        });
        break;
      }
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
    cost: amount !== null && currency ? { amount, currency } : null,
  };
}

export function parseCommands(value: unknown): AcpCommand[] {
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
    const id = asString(object.id) ?? asString(object.configId);
    const name = asString(object.name);
    if (!id || !name) continue;
    const rawType = asString(object.type);
    if (rawType !== null && rawType !== "select" && rawType !== "boolean") {
      continue;
    }
    const rawValue = object.currentValue;
    const currentValue =
      typeof rawValue === "boolean" ? rawValue : (asString(rawValue) ?? "");
    const description = asString(object.description);
    const category = asString(object.category);
    options.push({
      id,
      name,
      type: rawType === "boolean" ? "boolean" : "select",
      currentValue,
      options: parseConfigOptionValues(object.options),
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
    });
  }
  return options;
}

/** Keeps the previous options when an update payload omits a valid list. */
export function mergeConfigOptions(
  previous: AcpConfigOption[],
  value: unknown,
): AcpConfigOption[] {
  return Array.isArray(value) ? parseConfigOptions(value) : previous;
}

function parseConfigOptionValues(value: unknown): AcpConfigOptionValue[] {
  if (!Array.isArray(value)) return [];
  const values: AcpConfigOptionValue[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) continue;
    if (Array.isArray(object.options)) {
      values.push(...parseConfigOptionValues(object.options));
      continue;
    }
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
    availableModes.push(description ? { id, name, description } : { id, name });
  }
  if (!currentModeId || availableModes.length === 0) return null;
  return { currentModeId, availableModes };
}

/**
 * ACP `SessionModelState`. Agents that expose their model catalog this way
 * (instead of a `model` config option) still get a model picker.
 */
export function parseModelState(value: unknown): AcpModelState | null {
  const object = asObject(value);
  if (!object) return null;
  const available = Array.isArray(object.availableModels)
    ? object.availableModels
    : [];
  const availableModels: AcpModel[] = [];
  for (const item of available) {
    const model = asObject(item);
    const modelId = model ? asString(model.modelId) : null;
    const name = model ? asString(model.name) : null;
    if (!modelId || !name) continue;
    const description = model ? asString(model.description) : null;
    availableModels.push({ modelId, name, description });
  }
  if (availableModels.length === 0) return null;
  return {
    currentModelId: asString(object.currentModelId),
    availableModels,
  };
}

export function parseAgentCapabilities(value: unknown): AcpCapabilities {
  const object = asObject(value);
  if (!object) return EMPTY_ACP_CAPABILITIES;
  const session = asObject(object.session);
  const prompt = asObject(session?.prompt ?? object.promptCapabilities);
  const sessionCapabilities = asObject(object.sessionCapabilities);
  const auth = asObject(object.auth);
  return {
    loadSession: object.loadSession === true,
    sessionList:
      session !== null ||
      (sessionCapabilities?.list !== undefined &&
        sessionCapabilities?.list !== null),
    sessionResume:
      session !== null ||
      (sessionCapabilities?.resume !== undefined &&
        sessionCapabilities?.resume !== null),
    sessionClose:
      session !== null ||
      (sessionCapabilities?.close !== undefined &&
        sessionCapabilities?.close !== null),
    sessionDelete:
      session?.delete !== undefined ||
      (sessionCapabilities?.delete !== undefined &&
        sessionCapabilities?.delete !== null),
    sessionFork:
      session?.fork !== undefined ||
      (sessionCapabilities?.fork !== undefined &&
        sessionCapabilities?.fork !== null),
    additionalDirectories:
      session?.additionalDirectories !== undefined ||
      (sessionCapabilities?.additionalDirectories !== undefined &&
        sessionCapabilities?.additionalDirectories !== null),
    promptImage: prompt?.image === true || asObject(prompt?.image) !== null,
    promptAudio: prompt?.audio === true || asObject(prompt?.audio) !== null,
    promptEmbeddedContext:
      prompt?.embeddedContext === true ||
      asObject(prompt?.embeddedContext) !== null,
    authLogout: auth?.logout === true || asObject(auth?.logout) !== null,
  };
}

export function parseAuthMethods(value: unknown): AcpAuthMethod[] {
  if (!Array.isArray(value)) return [];
  const methods: AcpAuthMethod[] = [];
  for (const item of value) {
    const method = asObject(item);
    if (!method) continue;
    const methodId = asString(method.methodId) ?? asString(method.id);
    const name = asString(method.name);
    const type = asString(method.type);
    if (!methodId || !name || !type) continue;
    const args = Array.isArray(method.args)
      ? method.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    const rawEnv = method.env;
    const env = Array.isArray(rawEnv)
      ? rawEnv.flatMap((item) => {
          const entry = asObject(item);
          const name = entry ? asString(entry.name) : null;
          const value = entry ? asString(entry.value) : null;
          return name !== null && value !== null ? [{ name, value }] : [];
        })
      : rawEnv && typeof rawEnv === "object"
        ? Object.entries(rawEnv).flatMap(([name, value]) =>
            typeof value === "string" ? [{ name, value }] : [],
          )
        : [];
    const description = asString(method.description);
    methods.push({
      methodId,
      type,
      name,
      args,
      env,
      ...(description ? { description } : {}),
    });
  }
  return methods;
}

export function parseAgentInfo(value: unknown): AcpAgentInfo {
  const object = asObject(value);
  return {
    name: object ? asString(object.name) : null,
    title: object ? asString(object.title) : null,
    version: object ? asString(object.version) : null,
  };
}

export function parseSessionListPage(value: unknown): {
  sessions: AcpSessionInfo[];
  nextCursor: string | null;
} {
  const object = asObject(value);
  const raw = object && Array.isArray(object.sessions) ? object.sessions : [];
  const sessions: AcpSessionInfo[] = [];
  for (const item of raw) {
    const entry = asObject(item);
    const sessionId = entry ? asString(entry.sessionId) : null;
    if (!sessionId) continue;
    sessions.push({
      sessionId,
      cwd: entry ? asString(entry.cwd) : null,
      title: entry ? asString(entry.title) : null,
      updatedAt: entry ? asString(entry.updatedAt) : null,
    });
  }
  const cursor = object ? asString(object.nextCursor) : null;
  return { sessions, nextCursor: cursor && cursor.length > 0 ? cursor : null };
}

export function parseEndTurnUsage(
  value: unknown,
  previous: AcpUsage | null,
): AcpUsage | null {
  const object = asObject(value);
  if (!object) return previous;
  const total =
    asNumber(object.totalTokens) ??
    (() => {
      const input = asNumber(object.inputTokens);
      const output = asNumber(object.outputTokens);
      return input === null && output === null ? null : (input ?? 0) + (output ?? 0);
    })();
  if (total === null) return previous;
  return {
    used: total,
    size: previous?.size ?? 0,
    cost: previous?.cost ?? null,
  };
}
