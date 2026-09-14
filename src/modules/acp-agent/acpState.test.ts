import { describe, expect, it } from "vitest";
import {
  appendUserPrompt,
  parseAgentCapabilities,
  parseConfigOptions,
  parseModeState,
  parseSessionList,
  reduceAcpMessage,
  reduceAcpUpdate,
  resetAcpConversation,
} from "@/modules/acp-agent/acpState";
import {
  INITIAL_ACP_STATE,
  type AcpState,
} from "@/modules/acp-agent/types";

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
    });
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
    expect(state.commands).toEqual([{ name: "init", description: "bootstrap" }]);
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
    state = reduceAcpUpdate(state, chunk("current_mode_update", { modeId: "code" }));
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

  it("returns the same state for unknown updates", () => {
    const base = { ...INITIAL_ACP_STATE };
    const result = reduceAcpUpdate(base, chunk("mystery_update", {}));
    expect(result).toBe(base);
  });
});

describe("reduceAcpMessage", () => {
  it("routes session/update notifications", () => {
    const state = reduceAcpMessage({ ...INITIAL_ACP_STATE }, {
      jsonrpc: "2.0",
      method: "session/update",
      params: chunk("agent_message_chunk", {
        messageId: "m1",
        content: { type: "text", text: "hi" },
      }),
    });
    expect(state.messages).toHaveLength(1);
  });

  it("ignores responses and unknown methods", () => {
    const base = { ...INITIAL_ACP_STATE };
    expect(
      reduceAcpMessage(base, { jsonrpc: "2.0", id: 1, result: {} }),
    ).toBe(base);
    expect(
      reduceAcpMessage(base, { jsonrpc: "2.0", method: "other" }),
    ).toBe(base);
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
      promptImage: true,
      promptAudio: false,
      promptEmbeddedContext: true,
    });
  });

  it("parses a session list", () => {
    expect(
      parseSessionList([
        {
          sessionId: "s1",
          cwd: "/repo",
          title: "Fix bug",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        { title: "no id" },
      ]),
    ).toEqual([
      {
        sessionId: "s1",
        cwd: "/repo",
        title: "Fix bug",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
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
    expect(parseModeState({ currentModeId: "ask", availableModes: [] })).toBeNull();
    expect(parseModeState(null)).toBeNull();
  });
});
