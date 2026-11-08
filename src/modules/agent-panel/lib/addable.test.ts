import { describe, expect, it } from "vitest";
import { buildAddableRows } from "@/modules/agent-panel/lib/addable";
import type { AgentProfile } from "@/modules/agent-panel/lib/profile";

function profile(patch: Partial<AgentProfile>): AgentProfile {
  return {
    id: "profile-work",
    agent: "opencode",
    label: "Work",
    enabled: true,
    environment: [],
    configDir: null,
    dataDir: null,
    hermesProfile: null,
    customProgram: null,
    customArgs: [],
    lastVerifiedAt: null,
    accountLabel: null,
    accountCheckedAt: null,
    managedPaths: false,
    ...patch,
  };
}

const available = [
  { id: "pi" as const, label: "Pi" },
  { id: "opencode" as const, label: "OpenCode" },
  { id: "claude" as const, label: "Claude Code" },
];

describe("buildAddableRows", () => {
  it("lists one row per harness when no profiles exist", () => {
    const rows = buildAddableRows(available, [], []);
    expect(rows.map((row) => row.key)).toEqual(["pi", "opencode", "claude"]);
    expect(rows[0].transport).toBe("Local RPC");
    expect(rows[1].transport).toBe("ACP · stdio");
    expect(rows.every((row) => row.profileLabel === null)).toBe(true);
  });

  it("replaces a harness row with its profiles", () => {
    const rows = buildAddableRows(
      available,
      [profile({}), profile({ id: "profile-personal", label: "Personal" })],
      [],
    );
    const opencode = rows.filter((row) => row.agent === "opencode");
    expect(opencode.map((row) => row.profileLabel)).toEqual([
      "Work",
      "Personal",
    ]);
    expect(rows.some((row) => row.key === "opencode")).toBe(false);
  });

  it("keeps open rows and flags them instead of hiding them", () => {
    const rows = buildAddableRows(
      available,
      [profile({})],
      [
        { agent: "pi", profileId: null },
        { agent: "opencode", profileId: "profile-work" },
      ],
    );
    expect(rows.map((row) => row.key)).toEqual([
      "pi",
      "opencode:profile-work",
      "claude",
    ]);
    expect(rows[0].open).toBe(true);
    expect(rows[1].open).toBe(true);
    expect(rows[2].open).toBe(false);
  });

  it("offers the default row when every profile is disabled", () => {
    const rows = buildAddableRows(available, [profile({ enabled: false })], []);
    expect(rows.map((row) => row.key)).toContain("opencode");
  });
});
