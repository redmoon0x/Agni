import { describe, expect, it } from "vitest";
import {
  type AgentSessionRecord,
  type AgentSessionsPref,
  MAX_AGENT_SESSIONS,
  parseAgentSessions,
  planAgentSessionRestore,
} from "@/modules/agent-panel/lib/agentSessions";

function record(patch: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    key: "opencode-profile-work:D:/Agni:local::",
    agent: "opencode",
    profileId: "profile-work",
    cwd: "D:/Agni",
    workspace: { kind: "local" },
    initialModel: null,
    ...patch,
  };
}

describe("parseAgentSessions", () => {
  it("keeps valid records and rejects junk", () => {
    const parsed = parseAgentSessions({
      sessions: [
        record(),
        record({ key: "" }),
        { ...record(), agent: "not-a-harness" },
        { ...record(), workspace: { kind: "wsl" } },
        record({ cwd: "relative/path" }),
        record({ key: "pi:local", agent: "pi", profileId: null }),
      ],
      activeKey: "pi:local",
    });
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions[0].profileId).toBe("profile-work");
    expect(parsed.sessions[1].agent).toBe("pi");
    expect(parsed.activeKey).toBe("pi:local");
  });

  it("accepts a long list and lets the planner cap it", () => {
    const sessions = Array.from(
      { length: MAX_AGENT_SESSIONS + 4 },
      (_, index) => record({ key: `key-${index}` }),
    );
    const parsed = parseAgentSessions({ sessions });
    expect(parsed.sessions).toHaveLength(MAX_AGENT_SESSIONS + 4);
    expect(
      planAgentSessionRestore(parsed, [{ id: "profile-work" }]).records,
    ).toHaveLength(MAX_AGENT_SESSIONS);
  });

  it("returns an empty list for junk", () => {
    expect(parseAgentSessions(null)).toEqual({ sessions: [], activeKey: null });
    expect(parseAgentSessions({ sessions: "nope" })).toEqual({
      sessions: [],
      activeKey: null,
    });
  });
});

describe("planAgentSessionRestore", () => {
  const pref: AgentSessionsPref = {
    sessions: [
      record({ key: "a" }),
      record({ key: "a" }),
      record({ key: "b", profileId: "profile-gone" }),
      record({ key: "c", profileId: null }),
    ],
    activeKey: "a",
  };

  it("dedupes keys and drops records with a removed profile", () => {
    const plan = planAgentSessionRestore(pref, [{ id: "profile-work" }]);
    expect(plan.records.map((entry) => entry.key)).toEqual(["a", "c"]);
    expect(plan.dropped).toBe(2);
  });

  it("caps the plan at the ACP session limit", () => {
    const many: AgentSessionsPref = {
      sessions: Array.from({ length: MAX_AGENT_SESSIONS + 3 }, (_, index) =>
        record({ key: `key-${index}` }),
      ),
      activeKey: null,
    };
    expect(
      planAgentSessionRestore(many, [{ id: "profile-work" }]).records,
    ).toHaveLength(MAX_AGENT_SESSIONS);
  });
});
