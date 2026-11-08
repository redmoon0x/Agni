import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPromptHistory,
  readPromptHistory,
  recallPrompt,
  recordPrompt,
  resetPromptHistoryCursor,
} from "@/modules/agent-ui/lib/promptHistory";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const KEY = "opencode:/repo:local";

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: new MemoryStorage() },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  clearPromptHistory(KEY);
  resetPromptHistoryCursor(KEY);
});

describe("prompt history", () => {
  it("records prompts and collapses consecutive duplicates", () => {
    recordPrompt(KEY, "first");
    recordPrompt(KEY, "first");
    recordPrompt(KEY, "second");
    expect(readPromptHistory(KEY)).toEqual(["first", "second"]);
  });

  it("ignores blank prompts", () => {
    recordPrompt(KEY, "   ");
    expect(readPromptHistory(KEY)).toEqual([]);
  });

  it("walks backwards, then restores the unsent draft", () => {
    recordPrompt(KEY, "first");
    recordPrompt(KEY, "second");
    expect(recallPrompt(KEY, "draft", "prev")).toBe("second");
    expect(recallPrompt(KEY, "", "prev")).toBe("first");
    expect(recallPrompt(KEY, "", "prev")).toBe("first");
    expect(recallPrompt(KEY, "", "next")).toBe("second");
    expect(recallPrompt(KEY, "", "next")).toBe("draft");
  });

  it("returns null with no history", () => {
    expect(recallPrompt(KEY, "draft", "prev")).toBeNull();
  });
});
