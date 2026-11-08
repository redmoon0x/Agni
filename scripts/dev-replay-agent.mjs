#!/usr/bin/env node
/**
 * Dev-only ACP agent that replays a recorded turn over NDJSON JSON-RPC.
 *
 * Run from the Agni repo root (the app passes the workspace as cwd):
 *   node scripts/dev-replay-agent.mjs
 *
 * In a dev build it appears in the agent picker as "Dev Replay". It needs no
 * tokens and produces deterministic transcripts, which makes UI work and
 * protocol debugging cheap.
 */
import readline from "node:readline";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function result(id, value) {
  send({ id, result: value ?? null });
}

function notify(method, params) {
  send({ method, params });
}

function update(sessionId, payload) {
  notify("session/update", { sessionId, update: payload });
}

const MODELS = [
  { modelId: "replay-fast", name: "Replay Fast", description: "Short deterministic turn" },
  { modelId: "replay-thorough", name: "Replay Thorough", description: "Full tool transcript" },
];

const DIFF_PATCH = [
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1,3 +1,4 @@",
  "-export const value = 1;",
  "+export const value = 2;",
  "+export const replay = true;",
  "",
].join("\n");

async function replayTurn(sessionId, promptId) {
  const chunks = [
    "Replaying a recorded turn.\n\n",
    "I'll read the entry point, then make one edit and run a check.\n\n",
  ];
  let messageId = `replay-${Date.now()}`;
  for (const text of chunks) {
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      messageId,
      content: { type: "text", text },
    });
    await sleep(60);
  }

  const readId = `tool-read-${Date.now()}`;
  update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: readId,
    title: "Read src/example.ts",
    kind: "read",
    status: "pending",
    locations: [{ path: "src/example.ts" }],
  });
  await sleep(120);
  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: readId,
    status: "completed",
    content: [
      {
        type: "content",
        content: { type: "text", text: "export const value = 1;\n" },
      },
    ],
  });
  await sleep(80);

  const editId = `tool-edit-${Date.now()}`;
  update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: editId,
    title: "Edit src/example.ts",
    kind: "edit",
    status: "in_progress",
    locations: [{ path: "src/example.ts" }],
  });
  await sleep(120);
  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: editId,
    status: "completed",
    content: [
      {
        type: "diff",
        path: "src/example.ts",
        changes: [{ operation: "update", path: "src/example.ts" }],
        patch: { type: "text", format: "git_patch", text: DIFF_PATCH },
      },
    ],
  });
  await sleep(80);

  const shellId = `tool-shell-${Date.now()}`;
  update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: shellId,
    title: "Run tests",
    kind: "execute",
    status: "in_progress",
  });
  await sleep(160);
  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: shellId,
    status: "completed",
    content: [
      {
        type: "content",
        content: { type: "text", text: "3 passed, 0 failed" },
      },
    ],
  });

  messageId = `replay-final-${Date.now()}`;
  update(sessionId, {
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: {
      type: "text",
      text: "\n\nDone. The edit is applied and the suite is green.",
    },
  });
  update(sessionId, {
    sessionUpdate: "state_update",
    state: "idle",
    stopReason: "end_turn",
  });
  result(promptId, {
    stopReason: "end_turn",
    messageId,
    usage: { inputTokens: 90, outputTokens: 30 },
  });
}

const rl = readline.createInterface({ input: process.stdin });
let promptChain = Promise.resolve();
let cancellations = new Set();

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (typeof method !== "string") {
    // Responses to client-initiated requests are ignored by this agent.
    return;
  }
  const sessionId = params?.sessionId ?? "dev-replay-session";

  if (method === "initialize") {
    result(id, {
      protocolVersion: 2,
      info: { name: "dev-replay", title: "Dev Replay", version: "0.1.0" },
      capabilities: { session: { resume: {}, close: {} } },
      authMethods: [],
    });
    return;
  }
  if (method === "session/new") {
    result(id, {
      sessionId: "dev-replay-session",
      modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask" },
          { id: "edits", name: "Edits" },
          { id: "auto", name: "Auto" },
        ],
      },
      models: { currentModelId: "replay-fast", availableModels: MODELS },
      availableCommands: [
        { name: "replay", description: "Replay the recorded turn again" },
      ],
    });
    return;
  }
  if (method === "session/set_model" || method === "session/set_mode") {
    result(id, null);
    return;
  }
  if (method === "session/prompt") {
    cancellations.delete(id);
    promptChain = promptChain.then(async () => {
      if (cancellations.has(id)) return;
      await replayTurn(sessionId, id);
    });
    return;
  }
  if (method === "session/cancel") {
    cancellations.add(id);
    return;
  }
  if (method === "session/close" || method === "session/load" || method === "session/resume") {
    result(id, { sessionId });
    return;
  }
  if (id !== undefined) result(id, null);
});
