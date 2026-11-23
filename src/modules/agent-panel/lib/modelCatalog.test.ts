import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG_TTL_MS,
  isModelCatalogFresh,
  mergeModelCatalog,
  modelCatalogKey,
  parseModelCatalog,
  parseModelPreferences,
} from "@/modules/agent-panel/lib/modelCatalog";

const models = [
  { id: "claude-opus", name: "Claude Opus" },
  { id: "claude-sonnet", name: "Claude Sonnet" },
];

describe("modelCatalogKey", () => {
  it("keeps accounts of one harness apart", () => {
    expect(modelCatalogKey("claude", "profile-work")).toBe("claude:profile-work");
    expect(modelCatalogKey("claude", null)).toBe("claude:");
  });
});

describe("isModelCatalogFresh", () => {
  const now = 1_000_000;

  it("accepts a catalog reported inside the TTL", () => {
    expect(isModelCatalogFresh({ at: now - 1, models }, now)).toBe(true);
  });

  it("rejects an expired, future or empty catalog", () => {
    expect(isModelCatalogFresh({ at: now - MODEL_CATALOG_TTL_MS, models }, now)).toBe(false);
    expect(isModelCatalogFresh({ at: now + 1, models }, now)).toBe(false);
    expect(isModelCatalogFresh({ at: now, models: [] }, now)).toBe(false);
    expect(isModelCatalogFresh(undefined, now)).toBe(false);
  });
});

describe("mergeModelCatalog", () => {
  it("keeps first-seen order and replaces changed entries", () => {
    const first = mergeModelCatalog(undefined, models, 10);
    const merged = mergeModelCatalog(
      first,
      [{ id: "claude-sonnet", name: "Claude Sonnet 4.6" }, { id: "claude-haiku", name: "Haiku" }],
      20,
    );
    expect(merged.at).toBe(20);
    expect(merged.models.map((model) => model.id)).toEqual([
      "claude-opus",
      "claude-sonnet",
      "claude-haiku",
    ]);
    expect(merged.models[1].name).toBe("Claude Sonnet 4.6");
  });
});

describe("parseModelCatalog", () => {
  it("drops entries without a usable model list", () => {
    const parsed = parseModelCatalog({
      "claude:": { at: 5, models: [{ id: "a", name: "A" }] },
      "codex:": { at: 5, models: [] },
      "hermes:": { at: 5, models: [{ id: "", name: "nameless" }] },
      "kilo:": null,
    });
    expect(Object.keys(parsed)).toEqual(["claude:"]);
    expect(parsed["claude:"].models).toEqual([{ id: "a", name: "A" }]);
  });

  it("returns an empty catalog for non-objects", () => {
    expect(parseModelCatalog("nope")).toEqual({});
  });
});

describe("parseModelPreferences", () => {
  it("keeps only non-empty string model ids", () => {
    expect(
      parseModelPreferences({ "claude:": "opus", "codex:": 4, "kilo:": "  " }),
    ).toEqual({ "claude:": "opus" });
  });
});