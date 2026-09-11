import { describe, expect, it } from "vitest";
import { reducePiRpc } from "@/modules/pi-agent/rpcState";
import { INITIAL_PI_RPC_STATE } from "@/modules/pi-agent/types";

describe("reducePiRpc", () => {
  it("hydrates state and model choices", () => {
    const withState = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "response",
      command: "get_state",
      success: true,
      data: {
        model: { id: "m1", name: "Model One", provider: "test" },
        thinkingLevel: "high",
        isStreaming: false,
        isCompacting: false,
        sessionId: "session-1",
        steeringMode: "all",
        followUpMode: "one-at-a-time",
        pendingMessageCount: 2,
      },
    });
    const withModels = reducePiRpc(withState, {
      type: "response",
      command: "get_available_models",
      success: true,
      data: {
        models: [{ id: "m2", name: "Model Two", provider: "test" }],
      },
    });
    expect(withModels.session.model?.id).toBe("m1");
    expect(withModels.session.thinkingLevel).toBe("high");
    expect(withModels.session.steeringMode).toBe("all");
    expect(withModels.session.pendingMessageCount).toBe(2);
    expect(withModels.models.map((model) => model.id)).toEqual(["m2"]);
  });

  it("replaces a streamed assistant message instead of duplicating it", () => {
    const start = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 4 },
    });
    const update = reducePiRpc(start, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        timestamp: 4,
      },
    });
    expect(update.messages).toHaveLength(1);
    expect(update.messages[0].content).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  it("correlates tool updates and completion", () => {
    const start = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "pwd" },
    });
    const end = reducePiRpc(start, {
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "bash",
      isError: false,
      result: { content: [{ type: "text", text: "/repo" }] },
    });
    expect(end.tools).toEqual([
      expect.objectContaining({
        id: "tool-1",
        status: "done",
        output: "/repo",
      }),
    ]);
  });

  it("keeps file-read results out of the chat transcript", () => {
    const state = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "message_end",
      message: {
        role: "toolResult",
        content: [
          { type: "text", text: "const everyLine = 'of the file';" },
        ],
        timestamp: 5,
      },
    });

    expect(state.messages).toEqual([]);
  });

  it("omits tool results when loading a saved transcript", () => {
    const state = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "response",
      command: "get_messages",
      success: true,
      data: {
        messages: [
          { role: "user", content: "Read the file", timestamp: 1 },
          {
            role: "toolResult",
            content: [{ type: "text", text: "a very long file" }],
            timestamp: 2,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "I read it." }],
            timestamp: 3,
          },
        ],
      },
    });

    expect(state.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("retains only interactive extension requests", () => {
    const notify = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "extension_ui_request",
      id: "n1",
      method: "notify",
      message: "done",
    });
    const confirm = reducePiRpc(notify, {
      type: "extension_ui_request",
      id: "c1",
      method: "confirm",
      title: "Run command?",
    });
    expect(notify.extensionRequest).toBeNull();
    expect(confirm.extensionRequest?.id).toBe("c1");
  });

  it("handles non-blocking extension UI updates", () => {
    let state = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "extension_ui_request",
      id: "notice-1",
      method: "notify",
      message: "Build complete",
      notifyType: "info",
    });
    state = reducePiRpc(state, {
      type: "extension_ui_request",
      id: "status-1",
      method: "setStatus",
      statusKey: "branch",
      statusText: "main",
    });
    state = reducePiRpc(state, {
      type: "extension_ui_request",
      id: "widget-1",
      method: "setWidget",
      widgetKey: "summary",
      widgetLines: ["2 files changed"],
      widgetPlacement: "aboveEditor",
    });
    state = reducePiRpc(state, {
      type: "extension_ui_request",
      id: "editor-1",
      method: "set_editor_text",
      text: "Review the diff",
    });

    expect(state.extensionNotification?.message).toBe("Build complete");
    expect(state.extensionStatuses).toEqual({ branch: "main" });
    expect(state.extensionWidgets).toEqual([
      {
        key: "summary",
        lines: ["2 files changed"],
        placement: "aboveEditor",
      },
    ]);
    expect(state.extensionEditorText?.text).toBe("Review the diff");
  });

  it("tracks retry state and session-operation responses", () => {
    let state = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "auto_retry_start",
      attempt: 1,
    });
    state = reducePiRpc(state, {
      type: "response",
      command: "get_fork_messages",
      success: true,
      data: {
        messages: [{ entryId: "entry-1", text: "Initial request" }],
      },
    });
    state = reducePiRpc(state, {
      type: "response",
      command: "export_html",
      success: true,
      data: { path: "/tmp/session.html" },
    });
    state = reducePiRpc(state, { type: "auto_retry_end", attempt: 1 });

    expect(state.session.isRetrying).toBe(false);
    expect(state.forkMessages).toEqual([
      { entryId: "entry-1", text: "Initial request" },
    ]);
    expect(state.exportedHtmlPath).toBe("/tmp/session.html");
  });

  it("assigns monotonic sequences to messages and tools for interleaving", () => {
    let state = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "message_start",
      message: { role: "user", content: "list files", timestamp: 1 },
    });
    state = reducePiRpc(state, {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "ls" },
    });
    state = reducePiRpc(state, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "here" }],
        timestamp: 2,
      },
    });

    // user -> tool -> assistant in chronological order
    const sorted = [...state.messages, ...state.tools].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
    );
    expect(sorted.map((s) => ("role" in s ? s.role : s.name))).toEqual([
      "user",
      "bash",
      "assistant",
    ]);

    // sequences are strictly increasing and unique
    const seqs = sorted.map((s) => s.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
    const [first, second, third] = seqs as number[];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });

  it("preserves the sequence of a streamed message across updates", () => {
    const start = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 4 },
    });
    const originalSeq = start.messages[0].sequence;
    const update = reducePiRpc(start, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        timestamp: 4,
      },
    });
    expect(update.messages).toHaveLength(1);
    expect(update.messages[0].sequence).toBe(originalSeq);
  });

  it("preserves the sequence of a tool row across updates", () => {
    const start = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "pwd" },
    });
    const originalSeq = start.tools[0].sequence;
    const end = reducePiRpc(start, {
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "bash",
      isError: false,
      result: { content: [{ type: "text", text: "/repo" }] },
    });
    expect(end.tools[0].sequence).toBe(originalSeq);
  });

  it("clears tool rows when an agent turn ends", () => {
    const withTool = reducePiRpc(INITIAL_PI_RPC_STATE, {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "ls" },
    });
    expect(withTool.tools).toHaveLength(1);
    const ended = reducePiRpc(withTool, { type: "agent_end" });
    expect(ended.tools).toEqual([]);
    expect(ended.session.isStreaming).toBe(false);
  });
});
