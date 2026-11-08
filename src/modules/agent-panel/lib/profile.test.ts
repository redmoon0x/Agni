import { describe, expect, it } from "vitest";
import {
  type AgentProfile,
  defaultProfileFor,
  managedProfileEnvError,
  parseAgentProfiles,
  profileCustomLaunch,
  profileEnvWire,
  profileExtraArgs,
  profileIsolationHint,
  profileVerifiedLabel,
  secretAccount,
} from "@/modules/agent-panel/lib/profile";

function profile(patch: Partial<AgentProfile>): AgentProfile {
  return {
    id: "profile-a",
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

describe("parseAgentProfiles", () => {
  it("keeps valid profiles and secret references", () => {
    const parsed = parseAgentProfiles([
      {
        id: "profile-work",
        agent: "claude",
        label: "Claude — Work",
        environment: [
          {
            name: "ANTHROPIC_API_KEY",
            value: { kind: "secret", account: "a:b" },
          },
          { name: "PLAIN", value: { kind: "text", value: "x" } },
        ],
        configDir: "~/.claude-work",
      },
      { id: "Bad Id", agent: "claude" },
      { id: "profile-b", agent: "" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].environment).toEqual([
      {
        name: "ANTHROPIC_API_KEY",
        value: { kind: "secret", account: "a:b" },
        sensitive: true,
      },
      { name: "PLAIN", value: { kind: "text", value: "x" } },
    ]);
    expect(parsed[0].configDir).toBe("~/.claude-work");
  });

  it("returns an empty list for junk", () => {
    expect(parseAgentProfiles(null)).toEqual([]);
    expect(parseAgentProfiles({})).toEqual([]);
  });
});

describe("profileEnvWire", () => {
  it("maps the documented isolation variables per harness", () => {
    expect(
      profileEnvWire(
        profile({
          agent: "claude",
          configDir: "C:\\claude-work",
        }),
      ),
    ).toEqual([{ name: "CLAUDE_CONFIG_DIR", value: "C:\\claude-work" }]);

    expect(
      profileEnvWire(
        profile({
          agent: "opencode",
          configDir: "C:\\oc-config",
          dataDir: "C:\\oc-data",
        }),
      ),
    ).toEqual([
      { name: "XDG_DATA_HOME", value: "C:\\oc-data" },
      { name: "OPENCODE_CONFIG_DIR", value: "C:\\oc-config" },
    ]);

    expect(
      profileEnvWire(profile({ agent: "hermes", dataDir: "C:\\hermes-work" })),
    ).toEqual([{ name: "HERMES_HOME", value: "C:\\hermes-work" }]);

    expect(
      profileEnvWire(profile({ agent: "pi", configDir: "C:\\pi-work" })),
    ).toEqual([{ name: "PI_CODING_AGENT_DIR", value: "C:\\pi-work" }]);
  });

  it("appends explicit environment entries", () => {
    const wire = profileEnvWire(
      profile({
        environment: [
          {
            name: "ANTHROPIC_API_KEY",
            value: { kind: "secret", account: "profile-a:ANTHROPIC_API_KEY" },
            sensitive: true,
          },
          { name: "PLAIN", value: { kind: "text", value: "x" } },
        ],
      }),
    );
    expect(wire).toEqual([
      { name: "ANTHROPIC_API_KEY", secret: "profile-a:ANTHROPIC_API_KEY" },
      { name: "PLAIN", value: "x" },
    ]);
  });
});

describe("managedProfileEnvError", () => {
  it("blocks a managed profile that lost its isolation env", () => {
    const error = managedProfileEnvError(
      profile({ label: "OpenCode — Work", managedPaths: true }),
    );
    expect(error).toContain("OpenCode — Work");
    expect(error).toContain("default account");
  });

  it("accepts a managed profile once its folders are resolved", () => {
    expect(
      managedProfileEnvError(
        profile({
          agent: "opencode",
          managedPaths: true,
          configDir: "C:\\oc-config",
          dataDir: "C:\\oc-data",
        }),
      ),
    ).toBeNull();
    expect(
      managedProfileEnvError(
        profile({
          agent: "claude",
          managedPaths: true,
          configDir: "C:\\claude-work",
        }),
      ),
    ).toBeNull();
  });

  it("accepts an explicitly configured isolation variable", () => {
    expect(
      managedProfileEnvError(
        profile({
          agent: "opencode",
          managedPaths: true,
          environment: [
            { name: "XDG_DATA_HOME", value: { kind: "text", value: "C:\\oc" } },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("ignores profiles that are not managed or have no known folder", () => {
    expect(managedProfileEnvError(null)).toBeNull();
    expect(managedProfileEnvError(profile({ managedPaths: false }))).toBeNull();
    expect(
      managedProfileEnvError(profile({ agent: "custom", managedPaths: true })),
    ).toBeNull();
  });
});

describe("profile helpers", () => {
  it("adds Hermes profile args", () => {
    expect(
      profileExtraArgs(profile({ agent: "hermes", hermesProfile: "work" })),
    ).toEqual(["-p", "work"]);
    expect(profileExtraArgs(profile({ agent: "claude" }))).toEqual([]);
  });

  it("picks the configured default, then the first enabled profile", () => {
    const first = profile({ id: "profile-1", label: "One" });
    const second = profile({ id: "profile-2", label: "Two" });
    const disabled = profile({ id: "profile-3", enabled: false });
    expect(defaultProfileFor([first, second], "opencode", {})?.id).toBe(
      "profile-1",
    );
    expect(
      defaultProfileFor([first, second], "opencode", { opencode: "profile-2" })
        ?.id,
    ).toBe("profile-2");
    expect(defaultProfileFor([disabled], "opencode", {})).toBeNull();
  });

  it("builds stable secret account names", () => {
    expect(secretAccount("profile-a", "OPENAI_API_KEY")).toBe(
      "profile-a:OPENAI_API_KEY",
    );
  });

  it("describes isolation per harness", () => {
    expect(profileIsolationHint("claude").configLabel).toBe(
      "CLAUDE_CONFIG_DIR",
    );
    expect(profileIsolationHint("opencode").dataLabel).toBe(
      "XDG data directory",
    );
    expect(profileIsolationHint("commandcode").configLabel).toBeNull();
    expect(profileIsolationHint("custom").note).toContain("ACP-compatible");
  });

  it("parses and builds a custom ACP launch", () => {
    const [parsed] = parseAgentProfiles([
      {
        id: "profile-custom",
        agent: "custom",
        label: "My agent",
        customProgram: "npx",
        customArgs: ["@scope/agent", "--acp"],
        lastVerifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(parsed.customProgram).toBe("npx");
    expect(parsed.customArgs).toEqual(["@scope/agent", "--acp"]);
    expect(profileCustomLaunch(parsed)).toEqual({
      program: "npx",
      args: ["@scope/agent", "--acp"],
    });
    expect(profileCustomLaunch(profile({ agent: "opencode" }))).toBeNull();
  });

  it("describes verification freshness", () => {
    expect(profileVerifiedLabel(null)).toBe("Not verified");
    expect(profileVerifiedLabel(new Date().toISOString())).toContain(
      "just now",
    );
  });
});
