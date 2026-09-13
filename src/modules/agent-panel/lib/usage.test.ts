import { describe, expect, it } from "vitest";
import {
  formatContextUsage,
  formatCost,
  formatCount,
  formatTokens,
} from "@/modules/agent-panel/lib/usage";

describe("formatCount", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(2_000_000)).toBe("2.0M");
  });
});

describe("formatCost", () => {
  it("returns null for missing values", () => {
    expect(formatCost(undefined)).toBeNull();
  });

  it("uses more precision for sub-cent amounts", () => {
    expect(formatCost(0.004)).toBe("$0.0040");
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("maps known currencies and falls back to the code", () => {
    expect(formatCost(2, "EUR")).toBe("€2.00");
    expect(formatCost(2, "SEK")).toBe("SEK 2.00");
  });
});

describe("formatTokens", () => {
  it("renders used over size", () => {
    expect(formatTokens(53000, 200000)).toBe("53.0k / 200.0k");
  });
});

describe("formatContextUsage", () => {
  it("handles unknown shapes without leaking objects", () => {
    expect(formatContextUsage(undefined)).toBeNull();
    expect(formatContextUsage({ mystery: "shape" })).toBeNull();
    expect(formatContextUsage([1, 2, 3])).toBeNull();
  });

  it("handles a bare number", () => {
    expect(formatContextUsage(1234)).toBe("1.2k tokens");
  });

  it("extracts used/size pairs", () => {
    expect(formatContextUsage({ used: 1000, size: 2000 })).toBe(
      "1.0k / 2.0k (50%)",
    );
  });

  it("extracts single-sided counts", () => {
    expect(formatContextUsage({ tokens: 500 })).toBe("500 tokens");
    expect(formatContextUsage({ contextWindow: 200000 })).toBe(
      "context 200.0k",
    );
  });

  it("extracts a ratio or percent", () => {
    expect(formatContextUsage({ percent: 0.42 })).toBe("42% context");
    expect(formatContextUsage({ percentage: 73 })).toBe("73% context");
  });
});
