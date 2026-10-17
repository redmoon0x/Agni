import { describe, expect, it } from "vitest";
import {
  getSourceControlRemoteIndicator,
  resolvePullStrategy,
} from "@/modules/source-control/useSourceControl";

describe("resolvePullStrategy", () => {
  it("fast-forwards a branch that is only behind", () => {
    expect(resolvePullStrategy({ ahead: 0, behind: 3 })).toBe("ffOnly");
  });

  it("fast-forwards a level branch", () => {
    expect(resolvePullStrategy({ ahead: 0, behind: 0 })).toBe("ffOnly");
  });

  it("rebases a diverged branch so it can be reconciled", () => {
    expect(resolvePullStrategy({ ahead: 2, behind: 3 })).toBe("rebase");
  });

  it("keeps an explicit choice over the default", () => {
    expect(resolvePullStrategy({ ahead: 2, behind: 3 }, "merge")).toBe("merge");
    expect(resolvePullStrategy({ ahead: 0, behind: 3 }, "rebase")).toBe(
      "rebase",
    );
  });
});

describe("getSourceControlRemoteIndicator", () => {
  const base = { hasRepo: true, upstream: "origin/main", busyAction: null };

  it("stays hidden without a repo or an upstream", () => {
    expect(
      getSourceControlRemoteIndicator({
        ...base,
        hasRepo: false,
        ahead: 0,
        behind: 0,
      }).visible,
    ).toBe(false);
    expect(
      getSourceControlRemoteIndicator({
        ...base,
        upstream: null,
        ahead: 0,
        behind: 0,
      }).visible,
    ).toBe(false);
  });

  it("offers a pull when the branch is behind", () => {
    const indicator = getSourceControlRemoteIndicator({
      ...base,
      ahead: 0,
      behind: 4,
    });
    expect(indicator.visible).toBe(true);
    expect(indicator.action).toBe("pull");
    expect(indicator.label).toBe("↓4");
    expect(indicator.disabled).toBe(false);
  });

  it("offers a pull for a diverged branch instead of a dead end", () => {
    const indicator = getSourceControlRemoteIndicator({
      ...base,
      ahead: 2,
      behind: 3,
    });
    expect(indicator.visible).toBe(true);
    expect(indicator.action).toBe("pull");
    expect(indicator.label).toBe("↑2 ↓3");
    expect(indicator.disabled).toBe(false);
  });

  it("offers a push when only ahead", () => {
    const indicator = getSourceControlRemoteIndicator({
      ...base,
      ahead: 1,
      behind: 0,
    });
    expect(indicator.action).toBe("push");
    expect(indicator.label).toBe("↑1");
  });

  it("falls back to fetch when level", () => {
    const indicator = getSourceControlRemoteIndicator({
      ...base,
      ahead: 0,
      behind: 0,
    });
    expect(indicator.action).toBe("fetch");
    expect(indicator.label).toBe("Sync");
  });

  it("disables every action while one is in flight", () => {
    const indicator = getSourceControlRemoteIndicator({
      ...base,
      ahead: 0,
      behind: 2,
      busyAction: "pull",
    });
    expect(indicator.disabled).toBe(true);
  });
});