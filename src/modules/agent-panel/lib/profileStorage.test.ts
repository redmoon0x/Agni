import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "./profile";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  needsManagedStorage,
  resolveManagedProfilePaths,
} from "./profileStorage";

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

describe("needsManagedStorage", () => {
  it("flags managed profiles that lost their resolved folders", () => {
    expect(needsManagedStorage(profile({ managedPaths: true }))).toBe(true);
    expect(
      needsManagedStorage(
        profile({
          managedPaths: true,
          configDir: "C:\\acme\\config",
          dataDir: "C:\\acme\\data",
        }),
      ),
    ).toBe(false);
    expect(
      needsManagedStorage(profile({ managedPaths: false, configDir: "C:\\x" })),
    ).toBe(false);
  });
});

describe("resolveManagedProfilePaths", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("resolves only managed profiles and keeps order", async () => {
    invoke.mockResolvedValue({
      root: "C:\\acme",
      configDir: "C:\\acme\\config",
      dataDir: "C:\\acme\\data",
    });
    const work = profile({
      id: "profile-work",
      managedPaths: true,
      lastVerifiedAt: "2026-10-30T12:01:07.054Z",
      accountLabel: "OpenRouter, OpenCode",
      accountCheckedAt: "2026-10-30T12:01:07.054Z",
    });
    const manual = profile({
      id: "profile-manual",
      configDir: "C:\\manual\\config",
    });

    const resolved = await resolveManagedProfilePaths([work, manual]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("ensure_profile_storage", {
      profileId: "profile-work",
    });
    expect(resolved[0]).toMatchObject({
      id: "profile-work",
      configDir: "C:\\acme\\config",
      dataDir: "C:\\acme\\data",
      lastVerifiedAt: null,
      accountLabel: null,
      accountCheckedAt: null,
    });
    expect(resolved[1]).toBe(manual);
  });

  it("leaves a profile untouched when storage resolution fails", async () => {
    invoke.mockRejectedValue(new Error("no home"));
    const work = profile({ id: "profile-work", managedPaths: true });

    const [resolved] = await resolveManagedProfilePaths([work]);

    expect(resolved).toBe(work);
  });

  it("does not call the backend when every profile is resolved", async () => {
    const resolvedProfile = profile({
      managedPaths: true,
      configDir: "C:\\acme\\config",
      dataDir: "C:\\acme\\data",
    });

    const resolved = await resolveManagedProfilePaths([resolvedProfile]);

    expect(invoke).not.toHaveBeenCalled();
    expect(resolved[0]).toBe(resolvedProfile);
  });
});
