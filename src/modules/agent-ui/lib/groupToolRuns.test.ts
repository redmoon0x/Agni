import { describe, expect, it } from "vitest";
import {
  groupToolRuns,
  toolRunLabel,
  type TimelineItem,
} from "@/modules/agent-ui/lib/groupToolRuns";

type Tool = { id: string; status: string; kind: string };
type Msg = { id: string };

const kindOf = (tool: Tool) => tool.kind;

function tool(id: string, status = "completed", kind = "read"): TimelineItem<Tool, Msg> {
  return { kind: "tool", tool: { id, status, kind }, sequence: Number(id) };
}

function message(id: string): TimelineItem<Tool, Msg> {
  return { kind: "message", message: { id }, sequence: Number(id) };
}

describe("groupToolRuns", () => {
  it("leaves a single tool ungrouped", () => {
    const grouped = groupToolRuns([tool("1")], kindOf);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe("tool");
  });

  it("groups consecutive tools and keeps messages separate", () => {
    const grouped = groupToolRuns(
      [
        message("1"),
        tool("2"),
        tool("3", "completed", "execute"),
        message("4"),
        tool("5"),
      ],
      kindOf,
    );
    expect(grouped.map((item) => item.kind)).toEqual([
      "message",
      "tool-run",
      "message",
      "tool",
    ]);
    const run = grouped[1];
    if (run.kind !== "tool-run") throw new Error("expected a run");
    expect(run.tools).toHaveLength(2);
    expect(run.sequence).toBe(2);
    expect(run.label).toBe("Ran 1 command");
  });

  it("surfaces the strongest status in a run", () => {
    const grouped = groupToolRuns(
      [tool("1", "completed"), tool("2", "error")],
      kindOf,
    );
    const run = grouped[0];
    if (run.kind !== "tool-run") throw new Error("expected a run");
    expect(run.status).toBe("error");
  });

  it("keeps running groups running", () => {
    const grouped = groupToolRuns(
      [tool("1", "running"), tool("2", "completed")],
      kindOf,
    );
    const run = grouped[0];
    if (run.kind !== "tool-run") throw new Error("expected a run");
    expect(run.status).toBe("running");
  });
});

describe("toolRunLabel", () => {
  it("prefers commands, then edits, then reads", () => {
    expect(toolRunLabel(["execute", "execute"])).toBe("Ran 2 commands");
    expect(toolRunLabel(["edit", "read"])).toBe("Edited 1 file");
    expect(toolRunLabel(["read", "search"])).toBe("Read 2 files");
    expect(toolRunLabel(["other"])).toBe("Ran 1 tool");
  });
});
