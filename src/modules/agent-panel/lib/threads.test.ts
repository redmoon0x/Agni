import { describe, expect, it } from "vitest";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import {
  filterThreads,
  groupThreads,
  threadTitle,
} from "@/modules/agent-panel/lib/threads";

function tab(patch: Partial<AgentTab>): AgentTab {
  return {
    id: 1,
    kind: "agent",
    title: "Agent",
    key: "claude::local",
    agent: "claude",
    cwd: "D:/work/agni",
    workspace: { kind: "local" },
    initialModel: null,
    initialPrompt: null,
    profileId: null,
    ...patch,
  };
}

describe("threadTitle", () => {
  it("prefers the live harness title", () => {
    expect(
      threadTitle({
        liveTitle: "Implement auth",
        initialPrompt: "seeded",
        fallback: "Claude",
      }),
    ).toBe("Implement auth");
  });

  it("falls back to the fanout prompt, then the harness name", () => {
    expect(
      threadTitle({
        liveTitle: null,
        initialPrompt: "Draft the plan",
        fallback: "Claude",
      }),
    ).toBe("Draft the plan");
    expect(
      threadTitle({ liveTitle: "  ", initialPrompt: "", fallback: "Claude" }),
    ).toBe("Claude");
  });

  it("uses the first line and truncates runaway titles", () => {
    expect(
      threadTitle({
        liveTitle: "First line\nsecond line",
        fallback: "Claude",
      }),
    ).toBe("First line");
    const long = "x".repeat(200);
    expect(threadTitle({ liveTitle: long, fallback: "Claude" }).endsWith("...")).toBe(true);
  });
});

describe("groupThreads", () => {
  it("groups by normalized directory in first-seen order", () => {
    const groups = groupThreads([
      tab({ id: 1, cwd: "D:\\Work\\Agni\\" }),
      tab({ id: 2, cwd: "D:/work/agni" }),
      tab({ id: 3, cwd: "D:/work/other" }),
      tab({ id: 4, cwd: null }),
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Agni",
      "other",
      "No folder",
    ]);
    expect(groups[0].tabs.map((entry) => entry.id)).toEqual([1, 2]);
  });
});

describe("filterThreads", () => {
  const groups = groupThreads([
    tab({ id: 1, agent: "claude" }),
    tab({ id: 2, agent: "codex" }),
  ]);

  it("keeps matching threads and drops empty groups", () => {
    const result = filterThreads(groups, "codex", (entry) => entry.agent);
    expect(result).toHaveLength(1);
    expect(result[0].tabs.map((entry) => entry.id)).toEqual([2]);
  });

  it("returns every group for a blank query", () => {
    expect(filterThreads(groups, "  ", (entry) => entry.agent)).toHaveLength(1);
  });
});
