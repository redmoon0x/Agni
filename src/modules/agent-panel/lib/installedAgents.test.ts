import { describe, expect, it } from "vitest";
import {
  orderKnownAgents,
  PANEL_AGENTS,
} from "@/modules/agent-panel/lib/installedAgents";

describe("orderKnownAgents", () => {
  it("keeps only installed agents", () => {
    expect(orderKnownAgents(["kilo"])).toEqual(["kilo"]);
  });

  it("restores panel order regardless of probe order", () => {
    expect(orderKnownAgents(["pi", "opencode", "kilo"])).toEqual([
      "pi",
      "opencode",
      "kilo",
    ]);
    expect(orderKnownAgents(["kilo", "pi"])).toEqual(["pi", "kilo"]);
  });

  it("drops ids Agni no longer ships", () => {
    expect(orderKnownAgents(["kilo", "cursor"])).toEqual(["kilo"]);
    expect(orderKnownAgents([])).toEqual([]);
  });

  it("offers every agent when nothing is detected", () => {
    expect(orderKnownAgents(PANEL_AGENTS.map((agent) => agent.id))).toEqual([
      "pi",
      "opencode",
      "kilo",
    ]);
  });
});
