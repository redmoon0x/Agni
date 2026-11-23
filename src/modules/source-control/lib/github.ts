import type { GithubChecks, GithubPullRequest } from "@/lib/native";

export type ChecksTone = "failed" | "pending" | "passed" | "none";

/** A checks dot: failing, pending, passing, or none. */
export function checksTone(checks: GithubChecks): ChecksTone {
  if (checks.failed > 0) return "failed";
  if (checks.pending > 0) return "pending";
  if (checks.passed > 0) return "passed";
  return "none";
}

export function checksLabel(checks: GithubChecks): string {
  const tone = checksTone(checks);
  if (tone === "failed") return `${checks.failed} failing`;
  if (tone === "pending") return `${checks.pending} pending`;
  if (tone === "passed") return `${checks.passed} passing`;
  return "no checks";
}

/** One-line description for a tooltip: "#123 open · 2 passing". */
export function pullRequestSummary(pr: GithubPullRequest): string {
  const state = pr.isDraft ? "draft" : pr.state.toLowerCase();
  return `#${pr.number} ${state} · ${checksLabel(pr.checks)}`;
}
