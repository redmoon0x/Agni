import { describe, expect, it } from "vitest";
import { formatElapsed } from "@/modules/agent-panel/lib/elapsed";

describe("formatElapsed", () => {
  const start = 1_000_000;

  it("returns null without a start", () => {
    expect(formatElapsed(null)).toBeNull();
  });

  it("formats seconds, minutes and hours", () => {
    expect(formatElapsed(start, start + 12_000)).toBe("12s");
    expect(formatElapsed(start, start + 59_999)).toBe("59s");
    expect(formatElapsed(start, start + 60_000)).toBe("1m");
    expect(formatElapsed(start, start + 3 * 60_000 + 20_000)).toBe("3m");
    expect(formatElapsed(start, start + 2 * 3_600_000)).toBe("2h");
  });

  it("never goes negative", () => {
    expect(formatElapsed(start, start - 5_000)).toBe("0s");
  });
});
