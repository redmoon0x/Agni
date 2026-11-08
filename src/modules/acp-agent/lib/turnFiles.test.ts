import { describe, expect, it } from "vitest";
import {
  acpTurnFiles,
  countPatchLines,
} from "@/modules/acp-agent/lib/turnFiles";
import type { AcpMessage, AcpToolCall } from "@/modules/acp-agent/types";

function user(id: string, sequence: number): AcpMessage {
  return { id, role: "user", text: id, content: [], sequence };
}

function agent(id: string, sequence: number): AcpMessage {
  return { id, role: "agent", text: id, content: [], sequence };
}

function editTool(
  id: string,
  sequence: number,
  path: string,
  patch: string,
): AcpToolCall {
  return {
    id,
    title: "Edit",
    name: "edit",
    kind: "edit",
    status: "completed",
    content: [
      {
        type: "diff",
        path,
        oldText: null,
        newText: "",
        changes: [],
        patch,
        patchFormat: "git_patch",
      },
    ],
    locations: [],
    rawInput: null,
    rawOutput: null,
    sequence,
  };
}

describe("countPatchLines", () => {
  it("counts added and removed lines, ignoring headers", () => {
    const patch = ["--- a/x", "+++ b/x", "@@ -1 +1 @@", "-old", "+new", "+two"].join(
      "\n",
    );
    expect(countPatchLines(patch)).toEqual({ insertions: 2, deletions: 1 });
  });

  it("returns zeros without a patch", () => {
    expect(countPatchLines(null)).toEqual({ insertions: 0, deletions: 0 });
  });
});

describe("acpTurnFiles", () => {
  it("groups files under the turn that changed them", () => {
    const messages = [
      user("u1", 1),
      agent("a1", 2),
      user("u2", 3),
      agent("a2", 4),
    ];
    const tools = [
      editTool("t1", 5, "src/a.ts", "--- a\n+++ b\n+one\n"),
      editTool("t2", 6, "src/a.ts", "--- a\n+++ b\n+two\n+three\n-old\n"),
    ];
    const turns = acpTurnFiles(messages, tools);
    expect(turns).toHaveLength(1);
    expect(turns[0].id).toBe("u2");
    expect(turns[0].endSequence).toBe(6);
    expect(turns[0].files).toEqual([
      {
        path: "src/a.ts",
        operation: "update",
        insertions: 3,
        deletions: 1,
      },
    ]);
  });

  it("skips turns with no diffs and starts an implicit opening turn", () => {
    const tools = [editTool("t1", 2, "README.md", "+++ b\n+hello\n")];
    const turns = acpTurnFiles([], tools);
    expect(turns).toHaveLength(1);
    expect(turns[0].files[0].path).toBe("README.md");
    expect(turns[0].files[0].insertions).toBe(1);
  });
});
