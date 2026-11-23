import { describe, expect, it } from "vitest";
import type { AddableRow } from "@/modules/agent-panel/lib/addable";
import {
  filterAgentRows,
  filterCatalogModels,
  groupCatalogModels,
  modelIsFree,
  pickerJumpIndex,
  pickerJumpLabel,
} from "@/modules/agent-panel/lib/picker";

function row(patch: Partial<AddableRow>): AddableRow {
  return {
    key: "claude:",
    agent: "claude",
    label: "Claude Code",
    profileId: null,
    profileLabel: null,
    transport: "ACP · stdio",
    open: false,
    ...patch,
  };
}

describe("pickerJumpLabel", () => {
  it("numbers the first nine rows only", () => {
    expect(pickerJumpLabel(0)).toBe("1");
    expect(pickerJumpLabel(8)).toBe("9");
    expect(pickerJumpLabel(9)).toBeNull();
  });
});

describe("pickerJumpIndex", () => {
  it("maps 1-9 to zero-based indexes and ignores other keys", () => {
    expect(pickerJumpIndex("1")).toBe(0);
    expect(pickerJumpIndex("9")).toBe(8);
    expect(pickerJumpIndex("0")).toBeNull();
    expect(pickerJumpIndex("a")).toBeNull();
  });
});

describe("filterAgentRows", () => {
  const rows = [
    row({}),
    row({ key: "claude:work", profileId: "work", profileLabel: "Work" }),
    row({ key: "pi", agent: "pi", label: "Pi", transport: "Local RPC" }),
  ];

  it("matches harness and account labels", () => {
    expect(filterAgentRows(rows, "claude").map((entry) => entry.key)).toEqual([
      "claude:",
      "claude:work",
    ]);
    expect(filterAgentRows(rows, "work").map((entry) => entry.key)).toEqual([
      "claude:work",
    ]);
    expect(
      filterAgentRows(rows, "local rpc").map((entry) => entry.key),
    ).toEqual(["pi"]);
  });

  it("returns every row for an empty query", () => {
    expect(filterAgentRows(rows, "   ")).toHaveLength(3);
  });
});

describe("filterCatalogModels", () => {
  const models = [
    {
      id: "claude-opus",
      name: "Claude Opus",
      groupId: "anthropic",
      groupName: "Anthropic",
    },
    { id: "gpt-5", name: "GPT-5", groupId: "openai", groupName: "OpenAI" },
  ];

  it("matches names, ids and provider groups", () => {
    expect(
      filterCatalogModels(models, "opus").map((model) => model.id),
    ).toEqual(["claude-opus"]);
    expect(
      filterCatalogModels(models, "openai").map((model) => model.id),
    ).toEqual(["gpt-5"]);
    expect(filterCatalogModels(models, "")).toHaveLength(2);
  });

  it("keeps only free or only paid models", () => {
    const mixed = [
      ...models,
      {
        id: "opencode-zen/beam-free",
        name: "Beam Free",
        groupId: "opencode-zen",
      },
      { id: "meta/llama:free", name: "Llama", groupId: "openrouter" },
      { id: "qwen2.5", name: "Qwen", groupId: "ollama" },
    ];
    expect(
      filterCatalogModels(mixed, "", "free").map((model) => model.id),
    ).toEqual(["opencode-zen/beam-free", "meta/llama:free", "qwen2.5"]);
    expect(
      filterCatalogModels(mixed, "", "paid").map((model) => model.id),
    ).toEqual(["claude-opus", "gpt-5"]);
    expect(filterCatalogModels(mixed, "beam", "paid")).toHaveLength(0);
  });
});

describe("modelIsFree", () => {
  it("detects free ids, names, descriptions and local providers", () => {
    expect(modelIsFree({ id: "beam-free", name: "Beam" })).toBe(true);
    expect(modelIsFree({ id: "meta/llama:free", name: "Llama" })).toBe(true);
    expect(
      modelIsFree({ id: "x", name: "Stealth", description: "free tier" }),
    ).toBe(true);
    expect(
      modelIsFree({ id: "qwen2.5", name: "Qwen", groupId: "ollama" }),
    ).toBe(true);
    expect(modelIsFree({ id: "claude-opus", name: "Claude Opus" })).toBe(false);
    expect(modelIsFree({ id: "freedom-1", name: "Freedom" })).toBe(false);
  });
});

describe("groupCatalogModels", () => {
  it("groups consecutive models that share a provider", () => {
    const groups = groupCatalogModels([
      { id: "a", name: "A", groupId: "x", groupName: "X" },
      { id: "b", name: "B", groupId: "x", groupName: "X" },
      { id: "c", name: "C" },
      { id: "d", name: "D" },
    ]);
    expect(groups.map((group) => [group.label, group.models.length])).toEqual([
      ["X", 2],
      [null, 2],
    ]);
  });
});
