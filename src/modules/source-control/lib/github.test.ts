import { describe, expect, it } from "vitest";
import type { GithubPullRequest } from "@/lib/native";
import {
  checksLabel,
  checksTone,
  pullRequestSummary,
} from "@/modules/source-control/lib/github";

function checks(passed = 0, failed = 0, pending = 0) {
  return { passed, failed, pending };
}

describe("checksTone", () => {
  it("prioritises failures, then pending, then passing", () => {
    expect(checksTone(checks(0, 1, 2))).toBe("failed");
    expect(checksTone(checks(3, 0, 1))).toBe("pending");
    expect(checksTone(checks(3, 0, 0))).toBe("passed");
    expect(checksTone(checks(0, 0, 0))).toBe("none");
  });
});

describe("checksLabel", () => {
  it("names the dominant state", () => {
    expect(checksLabel(checks(0, 2, 0))).toBe("2 failing");
    expect(checksLabel(checks(0, 0, 1))).toBe("1 pending");
    expect(checksLabel(checks(4, 0, 0))).toBe("4 passing");
    expect(checksLabel(checks())).toBe("no checks");
  });
});

describe("pullRequestSummary", () => {
  const base: GithubPullRequest = {
    number: 42,
    title: "Add GitHub support",
    url: "https://github.com/o/r/pull/42",
    state: "OPEN",
    isDraft: false,
    reviewDecision: null,
    headRef: "feat/github",
    baseRef: "main",
    checks: checks(2, 0, 0),
  };

  it("reads as number, state and checks", () => {
    expect(pullRequestSummary(base)).toBe("#42 open · 2 passing");
    expect(pullRequestSummary({ ...base, isDraft: true })).toBe(
      "#42 draft · 2 passing",
    );
  });
});
