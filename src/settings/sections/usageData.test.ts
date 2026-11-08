import { describe, expect, it } from "vitest";
import {
  aggregateUsage,
  bucketKey,
  grainForPeriod,
  type UsageEvent,
  type UsagePeriod,
} from "@/settings/sections/usageData";

const event = (
  timestamp: string,
  provider: string,
  input: number,
): UsageEvent => ({
  timestamp,
  provider,
  source: "Pi",
  input,
  output: 2,
  cacheRead: 3,
  cacheWrite: 1,
});

describe("usage aggregation", () => {
  it("groups weeks from Monday across year boundaries", () => {
    expect(bucketKey(new Date(2025, 0, 1), "week")).toBe("2024-12-30");
  });

  it("includes cached tokens and separates providers and periods", () => {
    const now = new Date(2025, 4, 20, 12);
    const events = [
      event(new Date(2025, 4, 19, 11).toISOString(), "OpenAI", 10),
      event(new Date(2025, 4, 19, 10).toISOString(), "Anthropic", 5),
      event(new Date(2025, 3, 1).toISOString(), "OpenAI", 100),
    ];
    const stats = aggregateUsage(events, "week", "day", "OpenAI", now);
    expect(stats.total).toBe(16);
    expect(stats.cacheRead).toBe(3);
    expect(stats.providers).toEqual([["OpenAI", 16]]);
    expect(stats.points).toHaveLength(7);
    expect(stats.points.reduce((sum, point) => sum + point.count, 0)).toBe(16);
  });

  it("filters agent sources separately from model providers", () => {
    const now = new Date(2025, 4, 20, 12);
    const timestamp = new Date(2025, 4, 20, 10).toISOString();
    const events = [
      event(timestamp, "commandcode", 10),
      { ...event(timestamp, "DeepSeek", 100), source: "CommandCode" },
    ];
    expect(aggregateUsage(events, "all", "day", "commandcode", now).total).toBe(16);
    const commandCode = aggregateUsage(events, "all", "day", "all", now, "CommandCode");
    expect(commandCode.total).toBe(106);
    expect(commandCode.providers).toEqual([["DeepSeek", 106]]);
    expect(aggregateUsage(events, "all", "day", "commandcode", now, "CommandCode").total).toBe(0);
  });

  it("uses one date-range control for totals and automatically groups its chart", () => {
    const now = new Date(2025, 4, 20, 12);
    const events = [
      event(new Date(2025, 4, 20, 10).toISOString(), "OpenAI", 10),
      event(new Date(2025, 4, 18, 10).toISOString(), "OpenAI", 20),
      event(new Date(2025, 3, 20, 10).toISOString(), "OpenAI", 30),
      event(new Date(2024, 2, 20, 10).toISOString(), "OpenAI", 40),
    ];
    const total = (period: UsagePeriod) =>
      aggregateUsage(events, period, grainForPeriod(period), "all", now).total;
    const periods: UsagePeriod[] = ["today", "week", "month", "year", "all"];
    expect(periods.map(total)).toEqual([16, 42, 42, 78, 124]);
    expect(grainForPeriod("today")).toBe("hour");
    expect(grainForPeriod("week")).toBe("day");
    expect(grainForPeriod("year")).toBe("week");
    expect(grainForPeriod("all")).toBe("month");
    const today = aggregateUsage(events, "today", "hour", "all", now);
    expect(today.points.find((point) => point.key === "2025-05-20T10")?.count).toBe(16);
  });

  it("keeps an empty all-time chart near today", () => {
    const now = new Date(2025, 4, 20);
    const stats = aggregateUsage([], "all", "month", "all", now);
    expect(stats.points).toEqual([{ key: "2025-05-01", count: 0 }]);
  });

  it("shows the latest 500 days without dropping totals", () => {
    const now = new Date(2025, 4, 20, 12);
    const stats = aggregateUsage(
      [event(new Date(2020, 0, 1).toISOString(), "OpenAI", 10)],
      "all",
      "day",
      "all",
      now,
    );
    expect(stats.total).toBe(16);
    expect(stats.points.length).toBeLessThanOrEqual(500);
    expect(stats.points[stats.points.length - 1].key).toBe("2025-05-20");
  });
});
