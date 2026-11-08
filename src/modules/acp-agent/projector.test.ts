import { describe, expect, it } from "vitest";
import { appendUserPrompt } from "@/modules/acp-agent/acpState";
import {
  INITIAL_ACP_STORE,
  reduceAcpFrame,
  type AcpFrame,
  type AcpStore,
} from "@/modules/acp-agent/projector";
import type { AcpElicitationRequest } from "@/modules/acp-agent/types";

function store(overrides: Partial<AcpStore> = {}): AcpStore {
  return { ...INITIAL_ACP_STORE, ...overrides };
}

const urlElicitation: AcpElicitationRequest = {
  mode: "url",
  id: 7,
  scope: null,
  message: "Sign in",
  title: null,
  url: "https://example.com/auth",
  elicitationId: "e1",
};

describe("reduceAcpFrame response", () => {
  it("ignores responses that are not the prompt", () => {
    const state = store({ isStreaming: true });
    const next = reduceAcpFrame(state, {
      kind: "response",
      id: 1,
      method: "session/set_mode",
      result: null,
      error: null,
    });
    expect(next).toBe(state);
  });

  it("applies the v1 prompt outcome on the response", () => {
    const state = store({ protocolVersion: 1, isStreaming: true });
    const next = reduceAcpFrame(state, {
      kind: "response",
      id: 4,
      method: "session/prompt",
      result: { stopReason: "end_turn", usage: { totalTokens: 10 } },
      error: null,
    });
    expect(next.isStreaming).toBe(false);
    expect(next.sessionState).toBe("idle");
    expect(next.lastStopReason).toBe("end_turn");
    expect(next.usage).toEqual({ used: 10, size: 0, cost: null });
  });

  it("reports a v1 error as the stop reason", () => {
    const state = store({ protocolVersion: 1, isStreaming: true });
    const next = reduceAcpFrame(state, {
      kind: "response",
      id: 4,
      method: "session/prompt",
      result: null,
      error: { code: -32000, message: "nope" },
    });
    expect(next.lastStopReason).toBe("error");
    expect(next.lastStopError).toContain("nope");
  });

  it("reconciles the optimistic user message on a v2 response", () => {
    const seeded = appendUserPrompt(
      store({ protocolVersion: 2 }),
      "hello",
    ) as AcpStore;
    const local = seeded.messages[seeded.messages.length - 1];
    expect(local).toBeDefined();
    const next = reduceAcpFrame(seeded, {
      kind: "response",
      id: 4,
      method: "session/prompt",
      result: { messageId: "remote-1" },
      error: null,
      promptLocalMessageId: local?.id ?? null,
    });
    expect(next.messages[next.messages.length - 1]?.id).toBe(
      "msg:user:remote-1",
    );
  });

  it("returns to idle on a v2 error response", () => {
    const state = store({ protocolVersion: 2, isStreaming: true });
    const next = reduceAcpFrame(state, {
      kind: "response",
      id: 4,
      method: "session/prompt",
      result: null,
      error: { message: "boom" },
    });
    expect(next.isStreaming).toBe(false);
    expect(next.sessionState).toBe("idle");
  });

  it("clears a retry notice on a successful prompt response", () => {
    const state = store({
      protocolVersion: 2,
      notice: { kind: "retry", text: "retrying", severity: null },
    });
    const next = reduceAcpFrame(state, {
      kind: "response",
      id: 4,
      method: "session/prompt",
      result: {},
      error: null,
    });
    expect(next.notice).toBeNull();
  });
});

describe("reduceAcpFrame setup", () => {
  it("applies initialize negotiation", () => {
    const next = reduceAcpFrame(store(), {
      kind: "setup",
      step: "initialize",
      result: {
        protocolVersion: 2,
        info: { name: "agent", title: "Agent", version: "1.0" },
        capabilities: { session: { resume: {} } },
        authMethods: [{ id: "login", type: "agent", name: "Log in" }],
      },
    });
    expect(next.protocolVersion).toBe(2);
    expect(next.agentInfo.name).toBe("agent");
    expect(next.capabilities.sessionResume).toBe(true);
    expect(next.authMethods).toHaveLength(1);
  });

  it("finishes session/new as a ready connection", () => {
    const next = reduceAcpFrame(store(), {
      kind: "setup",
      step: "session/new",
      result: {
        sessionId: "s1",
        modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
        availableCommands: [{ name: "review" }],
      },
      sessionConfig: { agent: "opencode", cwd: "/repo", workspace: { kind: "local" } },
    });
    expect(next.connection).toBe("ready");
    expect(next.sessionId).toBe("s1");
    expect(next.currentMode).toBe("ask");
    expect(next.commands.map((command) => command.name)).toEqual(["review"]);
    expect(next.sessionConfig?.cwd).toBe("/repo");
  });

  it("merges session/resume and keeps catalogs the agent did not resend", () => {
    const state = store({
      commands: [{ name: "old" }],
      modelState: {
        currentModelId: "m1",
        availableModels: [{ modelId: "m1", name: "M1", description: null }],
      },
      configOptions: [
        {
          id: "thinking",
          name: "Thinking",
          type: "boolean",
          currentValue: true,
          options: [],
        },
      ],
    });
    const next = reduceAcpFrame(state, {
      kind: "setup",
      step: "session/resume",
      result: { sessionId: "s2" },
    });
    expect(next.sessionId).toBe("s2");
    expect(next.commands.map((command) => command.name)).toEqual(["old"]);
    expect(next.modelState?.currentModelId).toBe("m1");
    expect(next.configOptions).toHaveLength(1);
  });

  it("replaces catalogs on session/load", () => {
    const state = store({
      commands: [{ name: "old" }],
      modelState: {
        currentModelId: "m1",
        availableModels: [{ modelId: "m1", name: "M1", description: null }],
      },
    });
    const next = reduceAcpFrame(state, {
      kind: "setup",
      step: "session/load",
      result: { sessionId: "s3", availableCommands: [] },
    });
    expect(next.commands).toHaveLength(0);
    expect(next.modelState?.currentModelId).toBe("m1");
  });
});

describe("reduceAcpFrame transport", () => {
  it("delegates session/update notifications", () => {
    const frame: AcpFrame = {
      kind: "rpc",
      message: {
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hi" },
          },
        },
      },
    };
    const next = reduceAcpFrame(store(), frame);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].text).toBe("hi");
  });

  it("uses the diagnostic as the exit explanation when present", () => {
    const next = reduceAcpFrame(
      store({ diagnostic: "missing binary" }),
      { kind: "exit", code: 1 },
    );
    expect(next.connection).toBe("exited");
    expect(next.processError).toBe("missing binary");
  });

  it("reports a non-zero exit code without a diagnostic", () => {
    const next = reduceAcpFrame(store(), { kind: "exit", code: 3 });
    expect(next.processError).toBe("The agent exited with code 3");
  });

  it("treats a clean exit as no error", () => {
    const next = reduceAcpFrame(store(), { kind: "exit", code: 0 });
    expect(next.processError).toBeNull();
    expect(next.sessionId).toBeNull();
  });

  it("clears blocking requests on a protocol error", () => {
    const next = reduceAcpFrame(
      store({
        isStreaming: true,
        permission: {
          id: 1,
          sessionId: "s1",
          toolCallId: null,
          title: null,
          description: null,
          subject: null,
          options: [],
        },
        elicitation: urlElicitation,
      }),
      { kind: "protocol_error", message: "desync" },
    );
    expect(next.isStreaming).toBe(false);
    expect(next.permission).toBeNull();
    expect(next.elicitation).toBeNull();
    expect(next.rpcError).toBe("desync");
  });
});

describe("reduceAcpFrame requests", () => {
  it("stores permission and elicitation requests", () => {
    const withPermission = reduceAcpFrame(store(), {
      kind: "request",
      request: "permission",
      value: {
        id: 1,
        sessionId: "s1",
        toolCallId: null,
        title: "Run",
        description: null,
        subject: null,
        options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }],
      },
    });
    expect(withPermission.permission?.title).toBe("Run");

    const withElicitation = reduceAcpFrame(withPermission, {
      kind: "request",
      request: "elicitation",
      value: urlElicitation,
    });
    expect(withElicitation.elicitation).toBe(urlElicitation);
  });

  it("only clears a matching url elicitation on complete", () => {
    const state = store({ elicitation: urlElicitation });
    expect(
      reduceAcpFrame(state, {
        kind: "request",
        request: "elicitation/complete",
        elicitationId: "other",
      }).elicitation,
    ).toBe(urlElicitation);
    expect(
      reduceAcpFrame(state, {
        kind: "request",
        request: "elicitation/complete",
        elicitationId: "e1",
      }).elicitation,
    ).toBeNull();
  });
});
