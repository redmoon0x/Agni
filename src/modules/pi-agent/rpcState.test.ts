import { describe, expect, it } from "vitest";
import { INITIAL_PI_RPC_STATE } from "@/modules/pi-agent/types";
import { reducePiRpc } from "@/modules/pi-agent/rpcState";

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
});
