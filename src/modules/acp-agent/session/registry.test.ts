import { describe, expect, it } from "vitest";
import {
  acpSessionKey,
  disposeAcpSession,
  getOrCreateAcpSession,
  listAcpSessions,
  releaseAcpSession,
  resetAcpSessionRegistryForTests,
} from "@/modules/acp-agent/session/registry";

const local = { kind: "local" as const };

describe("acpSessionKey", () => {
  it("normalizes separators, case and trailing slashes", () => {
    const a = acpSessionKey({ agent: "opencode", cwd: "D:\\Repo\\", workspace: local });
    const b = acpSessionKey({ agent: "opencode", cwd: "d:/repo", workspace: local });
    expect(a).toBe(b);
  });

  it("separates agents and workspaces", () => {
    expect(
      acpSessionKey({ agent: "opencode", cwd: "/repo", workspace: local }),
    ).not.toBe(
      acpSessionKey({ agent: "kilo", cwd: "/repo", workspace: local }),
    );
    expect(
      acpSessionKey({ agent: "opencode", cwd: "/repo", workspace: local }),
    ).not.toBe(
      acpSessionKey({
        agent: "opencode",
        cwd: "/repo",
        workspace: { kind: "wsl", distro: "Ubuntu" },
      }),
    );
  });

  it("separates profiles of the same agent", () => {
    expect(
      acpSessionKey({
        agent: "opencode",
        cwd: "/repo",
        workspace: local,
        profileId: "profile-work",
      }),
    ).not.toBe(
      acpSessionKey({
        agent: "opencode",
        cwd: "/repo",
        workspace: local,
        profileId: "profile-personal",
      }),
    );
  });
});

describe("session registry", () => {
  it("reuses one client for equivalent configs", () => {
    resetAcpSessionRegistryForTests();
    const a = getOrCreateAcpSession({
      agent: "opencode",
      cwd: "D:\\Repo\\",
      workspace: local,
    });
    const b = getOrCreateAcpSession({
      agent: "opencode",
      cwd: "d:/repo",
      workspace: local,
    });
    expect(a).toBe(b);
    expect(listAcpSessions()).toHaveLength(1);
  });

  it("tracks panel references and drops the client on dispose", async () => {
    resetAcpSessionRegistryForTests();
    const client = getOrCreateAcpSession({
      agent: "kilo",
      cwd: "/repo",
      workspace: local,
    });
    client.acquire();
    client.acquire();
    expect(client.refCount()).toBe(2);
    expect(client.lastUsedAt()).toBeGreaterThan(0);
    releaseAcpSession(acpSessionKey(client.config));
    expect(client.refCount()).toBe(1);

    const key = acpSessionKey(client.config);
    await disposeAcpSession(key);
    expect(listAcpSessions()).toHaveLength(0);
  });
});
