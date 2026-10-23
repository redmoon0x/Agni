import { describe, expect, it } from "vitest";
import {
  appendUserPrompt,
  mergeConfigOptions,
  parseAgentCapabilities,
  parseAuthMethods,
  parseCommands,
  parseConfigOptions,
  parseEndTurnUsage,
  parseModeState,
  parseModelState,
  parseSessionListPage,
  reconcileAcpUserMessage,
  reduceAcpMessage,
  reduceAcpUpdate,
  resetAcpConversation,
} from "@/modules/acp-agent/acpState";
import { INITIAL_ACP_STATE, type AcpState } from "@/modules/acp-agent/types";

function chunk(sessionUpdate: string, update: Record<string, unknown>) {
  return { sessionId: "s1", update: { sessionUpdate, ...update } };
}

function update(update: Record<string, unknown>): AcpState {
  return reduceAcpUpdate({ ...INITIAL_ACP_STATE }, update);
}

describe("reduceAcpUpdate messages", () => {
  it("appends chunks sharing a messageId into one message", () => {
    let state = update(
      chunk("agent_message_chunk", {
        messageId: "m1",
        content: { type: "text", text: "Hel" },
      }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("agent_message_chunk", {
        messageId: "m1",
        content: { type: "text", text: "lo" },
      }),
    );
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].text).toBe("Hello");
    expect(state.messages[0].role).toBe("agent");
  });

  it("keeps roles separate and starts a new message on a new id", () => {
    let state = update(
      chunk("user_message_chunk", {
        messageId: "u1",
        content: { type: "text", text: "ask" },
      }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("agent_message_chunk", {
        messageId: "a1",
        content: { type: "text", text: "answer" },
      }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("agent_thought_chunk", {
        messageId: "t1",
        content: { type: "text", text: "hmm" },
      }),
    );
    expect(state.messages.map((message) => message.role)).toEqual([
      "user",
      "agent",
      "thought",
    ]);
  });

  it("splits thought and reply chunks that share a messageId", () => {
    let state = update(
      chunk("agent_thought_chunk", {
        messageId: "m1",
        content: { type: "text", text: "thinking" },
      }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("agent_message_chunk", {
        messageId: "m1",
        content: { type: "text", text: "reply" },
      }),
    );
    expect(state.messages.map((m) => [m.role, m.text])).toEqual([
      ["thought", "thinking"],
      ["agent", "reply"],
    ]);
  });

  it("appends id-less chunks of the same role to the previous anonymous message", () => {
    let state = update(
      chunk("agent_message_chunk", { content: { type: "text", text: "a" } }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("agent_message_chunk", { content: { type: "text", text: "b" } }),
    );
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].text).toBe("ab");
  });

  it("ignores empty text chunks", () => {
    const state = update(
      chunk("agent_message_chunk", { content: { type: "text", text: "" } }),
    );
    expect(state.messages).toHaveLength(0);
  });
});

describe("reduceAcpUpdate tool calls", () => {
  it("creates a tool and merges later updates", () => {
    let state = update(
      chunk("tool_call", {
        toolCallId: "c1",
        title: "Read file",
        kind: "read",
        status: "pending",
      }),
    );
    expect(state.tools).toHaveLength(1);
    expect(state.tools[0].status).toBe("pending");

    state = reduceAcpUpdate(
      state,
      chunk("tool_call_update", {
        toolCallId: "c1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "ok" } }],
      }),
    );
    expect(state.tools[0].status).toBe("completed");
    expect(state.tools[0].content).toEqual([
      { type: "content", content: { type: "text", text: "ok" } },
    ]);
  });

  it("creates a placeholder for an update with no prior tool_call", () => {
    const state = update(
      chunk("tool_call_update", { toolCallId: "c2", status: "failed" }),
    );
    expect(state.tools).toHaveLength(1);
    expect(state.tools[0].id).toBe("c2");
    expect(state.tools[0].status).toBe("failed");
  });

  it("captures diff content", () => {
    const state = update(
      chunk("tool_call_update", {
        toolCallId: "c3",
        content: [
          {
            type: "diff",
            path: "/tmp/a.ts",
            oldText: "old",
            newText: "new",
          },
        ],
      }),
    );
    expect(state.tools[0].content[0]).toEqual({
      type: "diff",
      path: "/tmp/a.ts",
      oldText: "old",
      newText: "new",
      changes: [],
      patch: null,
      patchFormat: null,
    });
  });

  it("captures v2 diff changes and git patch text", () => {
    const state = update(
      chunk("tool_call_update", {
        toolCallId: "c4",
        content: [
          {
            type: "diff",
            changes: [
              { operation: "delete", path: "/tmp/gone.ts", fileType: "text" },
              {
                operation: "move",
                oldPath: "/tmp/old.ts",
                path: "/tmp/new.ts",
                fileType: "text",
              },
            ],
            patch: {
              format: "git_patch",
              text: "diff --git a/old.ts b/new.ts\n",
            },
          },
        ],
      }),
    );
    const content = state.tools[0].content[0];
    expect(content).toMatchObject({
      type: "diff",
      path: "/tmp/gone.ts",
      patch: "diff --git a/old.ts b/new.ts\n",
      patchFormat: "git_patch",
    });
    if (content.type !== "diff") throw new Error("expected a diff");
    expect(content.changes).toEqual([
      {
        operation: "delete",
        path: "/tmp/gone.ts",
        oldPath: null,
        fileType: "text",
        mimeType: null,
      },
      {
        operation: "move",
        path: "/tmp/new.ts",
        oldPath: "/tmp/old.ts",
        fileType: "text",
        mimeType: null,
      },
    ]);
  });

  it("records the optional tool call name", () => {
    const state = update(
      chunk("tool_call_update", {
        toolCallId: "c5",
        name: "read_file",
        title: "Reading",
      }),
    );
    expect(state.tools[0].name).toBe("read_file");
  });

  it("replaces tool content on update but appends on content chunks", () => {
    let state = update(
      chunk("tool_call_update", {
        toolCallId: "c6",
        content: [{ type: "content", content: { type: "text", text: "first" } }],
      }),
    );
    // A chunk appends to whatever content is current.
    state = reduceAcpUpdate(
      state,
      chunk("tool_call_content_chunk", {
        toolCallId: "c6",
        content: { type: "content", content: { type: "text", text: "+chunk" } },
      }),
    );
    expect(state.tools[0].content).toHaveLength(2);
    // An update carrying content replaces the accumulated array.
    state = reduceAcpUpdate(
      state,
      chunk("tool_call_update", {
        toolCallId: "c6",
        content: [{ type: "content", content: { type: "text", text: "reset" } }],
      }),
    );
    expect(state.tools[0].content).toEqual([
      { type: "content", content: { type: "text", text: "reset" } },
    ]);
    // Omitting content leaves it untouched.
    state = reduceAcpUpdate(
      state,
      chunk("tool_call_update", { toolCallId: "c6", status: "completed" }),
    );
    expect(state.tools[0].content).toHaveLength(1);
    expect(state.tools[0].status).toBe("completed");
  });

  it("clears message content when a v2 update sends null", () => {
    const base: AcpState = {
      ...INITIAL_ACP_STATE,
      protocolVersion: 2,
      messages: [
        {
          id: "msg:agent:m1",
          role: "agent",
          text: "hello",
          content: [{ type: "text", text: "hello" }],
          sequence: 1,
        },
      ],
    };
    const cleared = reduceAcpUpdate(
      base,
      chunk("agent_message", { messageId: "m1", content: null }),
    );
    expect(cleared.messages[0]).toMatchObject({ text: "", content: [] });
  });

  it("tracks requires_action as a distinct lifecycle state", () => {
    const state = update(
      chunk("state_update", { state: "requires_action" }),
    );
    expect(state.sessionState).toBe("requires_action");
    expect(state.isStreaming).toBe(true);
  });
});

describe("reduceAcpUpdate ancillary state", () => {
  it("replaces the plan", () => {
    const state = update(
      chunk("plan", {
        entries: [{ content: "step", priority: "high", status: "pending" }],
      }),
    );
    expect(state.plan).toEqual([
      { content: "step", priority: "high", status: "pending" },
    ]);
  });

  it("parses usage", () => {
    const state = update(
      chunk("usage_update", {
        used: 10,
        size: 100,
        cost: { amount: 0.5, currency: "USD" },
      }),
    );
    expect(state.usage).toEqual({
      used: 10,
      size: 100,
      cost: { amount: 0.5, currency: "USD" },
    });
  });

  it("parses available commands", () => {
    const state = update(
      chunk("available_commands_update", {
        availableCommands: [{ name: "init", description: "bootstrap" }],
      }),
    );
    expect(state.commands).toEqual([
      { name: "init", description: "bootstrap" },
    ]);
  });

  it("captures command input hints", () => {
    const state = update(
      chunk("available_commands_update", {
        availableCommands: [
          { name: "web", description: "search", input: { hint: "query" } },
        ],
      }),
    );
    expect(state.commands).toEqual([
      { name: "web", description: "search", inputHint: "query" },
    ]);
  });

  it("replaces config options and applies mode updates by modeId", () => {
    let state = update(
      chunk("config_option_update", {
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "m1",
            options: [{ value: "m1", name: "Model 1" }],
          },
        ],
      }),
    );
    expect(state.configOptions).toHaveLength(1);
    expect(state.configOptions[0].category).toBe("model");
    state = reduceAcpUpdate(
      state,
      chunk("current_mode_update", { modeId: "code" }),
    );
    expect(state.currentMode).toBe("code");
    state = reduceAcpUpdate(
      state,
      chunk("current_mode_update", { currentModeId: "architect" }),
    );
    expect(state.currentMode).toBe("architect");
  });

  it("renders the user prompt locally because agents do not echo it", () => {
    const state = appendUserPrompt({ ...INITIAL_ACP_STATE }, "hi");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toEqual(
      expect.objectContaining({ role: "user", text: "hi" }),
    );
    const base = { ...INITIAL_ACP_STATE };
    expect(appendUserPrompt(base, "   ")).toBe(base);
  });

  it("reconciles a v2 accepted prompt with the agent-owned message id", () => {
    const local = appendUserPrompt({ ...INITIAL_ACP_STATE }, "hi");
    const reconciled = reconcileAcpUserMessage(
      local,
      local.messages[0].id,
      "user-1",
    );
    expect(reconciled.messages[0].id).toBe("msg:user:user-1");
  });

  it("returns the same state for unknown updates", () => {
    const base = { ...INITIAL_ACP_STATE };
    const result = reduceAcpUpdate(base, chunk("mystery_update", {}));
    expect(result).toBe(base);
  });

  it("tracks v2 session state and whole-message updates", () => {
    let state = update(
      chunk("agent_message", {
        messageId: "a1",
        content: [
          { type: "text", text: "Here is an image." },
          { type: "image", mimeType: "image/png", data: "abc" },
        ],
      }),
    );
    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        id: "msg:agent:a1",
        text: "Here is an image.",
        content: expect.arrayContaining([
          { type: "image", mimeType: "image/png", data: "abc" },
        ]),
      }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("state_update", { state: "idle", stopReason: "end_turn" }),
    );
    expect(state).toEqual(
      expect.objectContaining({
        sessionState: "idle",
        isStreaming: false,
        lastStopReason: "end_turn",
      }),
    );
  });

  it("keeps display terminal output for terminal tool calls", () => {
    let state = update(
      chunk("terminal_update", {
        terminalId: "term-1",
        title: "Tests",
        state: "running",
      }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("terminal_output_chunk", { terminalId: "term-1", content: "ok\n" }),
    );
    expect(state.terminals["term-1"]).toEqual({
      id: "term-1",
      title: "Tests",
      command: null,
      cwd: null,
      state: "running",
      exitCode: null,
      signal: null,
      output: "ok\n",
      source: "agent",
    });
  });

  it("decodes v2 base64 terminal snapshots and chunks", () => {
    let state = reduceAcpUpdate(
      { ...INITIAL_ACP_STATE, protocolVersion: 2 },
      chunk("terminal_update", {
        terminalId: "term-2",
        command: "cargo test",
        cwd: "/workspace",
        output: { data: btoa("one\n") },
      }),
    );
    expect(state.terminals["term-2"]).toMatchObject({
      title: "cargo test",
      command: "cargo test",
      cwd: "/workspace",
      output: "one\n",
    });
    state = reduceAcpUpdate(
      state,
      chunk("terminal_output_chunk", {
        terminalId: "term-2",
        data: btoa("two\n"),
      }),
    );
    expect(state.terminals["term-2"].output).toBe("one\ntwo\n");
  });

  it("lets a v2 snapshot replace previously retained bytes", () => {
    let state = reduceAcpUpdate(
      { ...INITIAL_ACP_STATE, protocolVersion: 2 },
      chunk("terminal_output_chunk", { terminalId: "t", data: btoa("old") }),
    );
    state = reduceAcpUpdate(
      state,
      chunk("terminal_update", { terminalId: "t", output: { data: btoa("new") } }),
    );
    expect(state.terminals.t.output).toBe("new");
  });

  it("reads v2 terminal exit status", () => {
    const state = update(
      chunk("terminal_update", {
        terminalId: "t",
        exitStatus: { exitCode: 2, signal: "SIGTERM" },
      }),
    );
    expect(state.terminals.t).toMatchObject({
      state: "exited",
      exitCode: 2,
      signal: "SIGTERM",
    });
  });

  it("reads v2 plan_update payloads nested under plan", () => {
    const state = update(
      chunk("plan_update", {
        plan: {
          type: "items",
          planId: "plan-1",
          entries: [{ content: "ship", priority: "high", status: "pending" }],
        },
      }),
    );
    expect(state.plan).toEqual([
      { content: "ship", priority: "high", status: "pending" },
    ]);
    expect(state.planId).toBe("plan-1");
  });

  it("surfaces standard notice updates with their severity", () => {
    const state = update(
      chunk("notice", {
        severity: "warning",
        title: "Quota",
        message: "80 percent used",
      }),
    );
    expect(state.notice).toEqual({
      kind: "notice",
      text: "Quota: 80 percent used",
      severity: "warning",
    });
  });

  it("tracks compaction lifecycle and streams the summary into the transcript", () => {
    let state = update(
      chunk("compaction_update", {
        compactionId: "c-1",
        status: "in_progress",
      }),
    );
    expect(state.compaction).toEqual({ id: "c-1", status: "in_progress" });
    expect(state.notice?.kind).toBe("compaction");
    state = reduceAcpUpdate(
      state,
      chunk("compaction_summary_chunk", {
        messageId: "sum-1",
        content: { type: "text", text: "kept decisions" },
      }),
    );
    expect(state.messages[state.messages.length - 1]).toMatchObject({
      id: "msg:agent:sum-1",
      text: "kept decisions",
    });
    state = update(
      chunk("compaction_update", { compactionId: "c-1", status: "completed" }),
    );
    expect(state.compaction).toEqual({ id: "c-1", status: "completed" });
    expect(state.notice).toBeNull();
  });

  it("records the v2 error payload on an idle state update", () => {
    const state = update(
      chunk("state_update", {
        state: "idle",
        stopReason: "error",
        error: { code: -32000, message: "model unavailable" },
      }),
    );
    expect(state.lastStopReason).toBe("error");
    expect(state.lastStopError).toBe("model unavailable (code -32000)");
  });
});

describe("reduceAcpMessage", () => {
  it("routes session/update notifications", () => {
    const state = reduceAcpMessage(
      { ...INITIAL_ACP_STATE },
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: chunk("agent_message_chunk", {
          messageId: "m1",
          content: { type: "text", text: "hi" },
        }),
      },
    );
    expect(state.messages).toHaveLength(1);
  });

  it("ignores responses and unknown methods", () => {
    const base = { ...INITIAL_ACP_STATE };
    expect(reduceAcpMessage(base, { jsonrpc: "2.0", id: 1, result: {} })).toBe(
      base,
    );
    expect(reduceAcpMessage(base, { jsonrpc: "2.0", method: "other" })).toBe(
      base,
    );
  });
});

describe("resetAcpConversation", () => {
  it("clears the transcript but keeps session identity", () => {
    let state = update(
      chunk("agent_message_chunk", {
        messageId: "m1",
        content: { type: "text", text: "hi" },
      }),
    );
    state = { ...state, sessionId: "sess-1", commands: [{ name: "x" }] };
    const reset = resetAcpConversation(state);
    expect(reset.messages).toHaveLength(0);
    expect(reset.sessionId).toBe("sess-1");
    expect(reset.commands).toEqual([{ name: "x" }]);
  });
});

describe("capability and config parsing", () => {
  it("reads agent prompt capabilities", () => {
    expect(
      parseAgentCapabilities({
        loadSession: true,
        sessionCapabilities: { list: {} },
        promptCapabilities: { image: true, embeddedContext: true },
      }),
    ).toEqual({
      loadSession: true,
      sessionList: true,
      sessionResume: false,
      sessionClose: false,
      sessionDelete: false,
      sessionFork: false,
      additionalDirectories: false,
      promptImage: true,
      promptAudio: false,
      promptEmbeddedContext: true,
      authLogout: false,
    });
  });

  it("reads v2 capabilities and authentication methods", () => {
    expect(
      parseAgentCapabilities({
        session: {
          prompt: { image: {}, embeddedContext: {} },
          delete: {},
          fork: {},
          additionalDirectories: {},
        },
      }),
    ).toEqual(
      expect.objectContaining({
        sessionList: true,
        sessionResume: true,
        sessionClose: true,
        sessionDelete: true,
        sessionFork: true,
        additionalDirectories: true,
        promptImage: true,
        promptEmbeddedContext: true,
      }),
    );
    expect(
      parseAuthMethods([
        {
          methodId: "login",
          type: "agent",
          name: "Sign in",
          env: [{ name: "TOKEN", value: "x" }],
        },
      ]),
    ).toEqual([
      {
        methodId: "login",
        type: "agent",
        name: "Sign in",
        args: [],
        env: [{ name: "TOKEN", value: "x" }],
      },
    ]);
  });

  it("parses a session list page with a cursor", () => {
    expect(
      parseSessionListPage({
        sessions: [
          {
            sessionId: "s1",
            cwd: "/repo",
            title: "Fix bug",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          { title: "no id" },
        ],
        nextCursor: "page-2",
      }),
    ).toEqual({
      sessions: [
        {
          sessionId: "s1",
          cwd: "/repo",
          title: "Fix bug",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: "page-2",
    });
    expect(parseSessionListPage({ sessions: [] })).toEqual({
      sessions: [],
      nextCursor: null,
    });
    expect(parseSessionListPage(null)).toEqual({
      sessions: [],
      nextCursor: null,
    });
  });

  it("parses select and boolean config options", () => {
    const options = parseConfigOptions([
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "m1",
        options: [{ value: "m1", name: "Model 1", description: "fast" }],
      },
      {
        id: "brave",
        name: "Brave",
        type: "boolean",
        currentValue: false,
      },
    ]);
    expect(options).toHaveLength(2);
    expect(options[0].options[0]).toEqual({
      value: "m1",
      name: "Model 1",
      description: "fast",
    });
    expect(options[1].type).toBe("boolean");
    expect(options[1].currentValue).toBe(false);
    expect(options[1].options).toEqual([]);
  });

  it("parses legacy mode state", () => {
    const modes = parseModeState({
      currentModeId: "ask",
      availableModes: [{ id: "ask", name: "Ask" }],
    });
    expect(modes).toEqual({
      currentModeId: "ask",
      availableModes: [{ id: "ask", name: "Ask" }],
    });
    expect(
      parseModeState({ currentModeId: "ask", availableModes: [] }),
    ).toBeNull();
    expect(parseModeState(null)).toBeNull();
  });

  it("parses the session model catalog", () => {
    const models = parseModelState({
      currentModelId: "openrouter:sonnet",
      availableModels: [
        {
          modelId: "openrouter:sonnet",
          name: "OpenRouter - Sonnet",
          description: "Provider: OpenRouter",
        },
        { modelId: "local:qwen", name: "Local - Qwen" },
      ],
    });
    expect(models).toEqual({
      currentModelId: "openrouter:sonnet",
      availableModels: [
        {
          modelId: "openrouter:sonnet",
          name: "OpenRouter - Sonnet",
          description: "Provider: OpenRouter",
        },
        { modelId: "local:qwen", name: "Local - Qwen", description: null },
      ],
    });
  });

  it("drops malformed models and an empty catalog", () => {
    expect(
      parseModelState({
        currentModelId: "m1",
        availableModels: [{ name: "No id" }, { modelId: "m2" }],
      }),
    ).toBeNull();
    expect(parseModelState({ currentModelId: "m1" })).toBeNull();
    expect(parseModelState(null)).toBeNull();
  });

  it("parses v2 config options with configId and grouped values", () => {
    const options = parseConfigOptions([
      {
        configId: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "m1",
        options: [
          {
            groupId: "recommended",
            name: "Recommended",
            options: [{ value: "m1", name: "Model 1", description: "fast" }],
          },
          {
            groupId: "other",
            name: "Other",
            options: [{ value: "m2", name: "Model 2" }],
          },
        ],
      },
      {
        configId: "effort",
        name: "Effort",
        category: "thought_level",
        type: "select",
        currentValue: "default",
        options: [{ group: "levels", name: "Levels", options: [{ value: "default", name: "Default" }] }],
      },
    ]);
    expect(options).toHaveLength(2);
    expect(options[0].id).toBe("model");
    expect(options[0].options).toEqual([
      { value: "m1", name: "Model 1", description: "fast" },
      { value: "m2", name: "Model 2" },
    ]);
    expect(options[1].id).toBe("effort");
    expect(options[1].options).toEqual([
      { value: "default", name: "Default" },
    ]);
  });

  it("ignores unrecognized option types", () => {
    expect(
      parseConfigOptions([
        { id: "a", name: "A", type: "slider", currentValue: "1" },
        { id: "b", name: "B", type: "select", currentValue: "x", options: [] },
      ]),
    ).toEqual([
      {
        id: "b",
        name: "B",
        type: "select",
        currentValue: "x",
        options: [],
      },
    ]);
  });

  it("keeps previous options when an update payload is missing or malformed", () => {
    const previous = parseConfigOptions([
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "m1",
        options: [],
      },
    ]);
    expect(mergeConfigOptions(previous, undefined)).toBe(previous);
    expect(mergeConfigOptions(previous, null)).toBe(previous);
    expect(mergeConfigOptions(previous, "nope")).toBe(previous);
    expect(mergeConfigOptions(previous, [])).toEqual([]);
  });

  it("does not wipe config options when a notification omits them", () => {
    let state = update(
      chunk("config_option_update", {
        configOptions: [
          {
            id: "effort",
            name: "Effort",
            category: "thought_level",
            type: "select",
            currentValue: "default",
            options: [{ value: "default", name: "Default" }],
          },
        ],
      }),
    );
    const before = state.configOptions;
    expect(before).toHaveLength(1);
    state = reduceAcpUpdate(state, chunk("config_option_update", {}));
    expect(state.configOptions).toBe(before);
  });

  it("parses available commands from session setup responses", () => {
    expect(
      parseCommands([{ name: "compact", description: "Compact the session" }]),
    ).toEqual([{ name: "compact", description: "Compact the session" }]);
    expect(parseCommands(null)).toEqual([]);
  });

  it("tracks session titles and opencode retry and compaction notices", () => {
    let state = update(
      chunk("session_info_update", { title: "Implement auth" }),
    );
    expect(state.sessionTitle).toBe("Implement auth");

    state = reduceAcpUpdate(
      state,
      chunk("session_info_update", {
        _meta: {
          "opencode/retry": {
            attempt: 2,
            nextRetryAt: "2026-10-02T12:00:05.000Z",
            error: { type: "provider.rate-limit", message: "Rate limit exceeded" },
          },
        },
      }),
    );
    expect(state.notice).toEqual({
      kind: "retry",
      text: "Retrying (attempt 2): Rate limit exceeded",
      severity: null,
    });

    state = reduceAcpUpdate(
      state,
      chunk("session_info_update", { _meta: { "opencode/retry": null } }),
    );
    expect(state.notice).toBeNull();

    state = reduceAcpUpdate(
      state,
      chunk("session_info_update", {
        _meta: { "opencode/compaction": { status: "started" } },
      }),
    );
    expect(state.notice).toEqual({
      kind: "compaction",
      text: "Compacting conversation",
      severity: null,
    });

    state = reduceAcpUpdate(
      state,
      chunk("session_info_update", {
        _meta: { "opencode/compaction": { status: "completed" } },
      }),
    );
    expect(state.notice).toBeNull();
  });

  it("maps end-turn usage onto the displayed context usage", () => {
    const previous = { used: 10, size: 200_000, cost: null };
    expect(
      parseEndTurnUsage(
        { inputTokens: 1200, outputTokens: 340, totalTokens: 1540 },
        previous,
      ),
    ).toEqual({ used: 1540, size: 200_000, cost: null });
    expect(parseEndTurnUsage({ inputTokens: 5, outputTokens: 5 }, previous)).toEqual({
      used: 10,
      size: 200_000,
      cost: null,
    });
    expect(parseEndTurnUsage(null, previous)).toBe(previous);
  });

  it("records cancelled tool calls", () => {
    const state = update(
      chunk("tool_call_update", { toolCallId: "c1", status: "cancelled" }),
    );
    expect(state.tools[0].status).toBe("cancelled");
  });
});
