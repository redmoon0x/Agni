import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/modules/agent-panel/lib/relativeTime";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("formatRelativeTime", () => {
  it("handles empty and future timestamps", () => {
    expect(formatRelativeTime(null, NOW)).toBe("");
    expect(formatRelativeTime(Number.NaN, NOW)).toBe("");
    expect(formatRelativeTime(NOW + 1000, NOW)).toBe("now");
  });

  it("steps through minutes, hours and days", () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("now");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d");
  });

  it("falls back to a date after a week", () => {
    expect(formatRelativeTime(NOW - 30 * 86_400_000, NOW)).toBe("2025-12-16");
  });
});
