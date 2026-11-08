import { describe, expect, it } from "vitest";
import { minimapMarkers } from "@/modules/agent-ui/lib/minimap";

describe("minimapMarkers", () => {
  it("normalizes positions from 0 to 1", () => {
    const markers = minimapMarkers([
      { tone: "user" },
      { tone: "agent" },
      { tone: "tool" },
    ]);
    expect(markers.map((marker) => marker.position)).toEqual([0, 0.5, 1]);
  });

  it("marks failing entries as errors", () => {
    const markers = minimapMarkers([{ tone: "tool", error: true }]);
    expect(markers[0].tone).toBe("error");
  });

  it("bounds the marker count", () => {
    const entries = Array.from({ length: 1000 }, () => ({ tone: "agent" as const }));
    const markers = minimapMarkers(entries, 100);
    expect(markers.length).toBeLessThanOrEqual(100);
    expect(markers[0].position).toBe(0);
    expect(markers[markers.length - 1].position).toBeGreaterThan(0.98);
  });

  it("is empty for an empty thread", () => {
    expect(minimapMarkers([])).toEqual([]);
  });
});
