import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  capQueue,
  clearQueuedAttachments,
  getQueuedAttachments,
  newQueuedPrompt,
  readQueue,
  setQueuedAttachments,
  writeQueue,
} from "@/modules/agent-ui/lib/promptQueue";

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
  writeQueue(KEY, []);
});

describe("prompt queue storage", () => {
  it("round-trips queued prompts", () => {
    const first = newQueuedPrompt("one", "queue", 0);
    const second = newQueuedPrompt("two", "steer", 2);
    writeQueue(KEY, [first, second]);
    expect(readQueue(KEY)).toEqual([first, second]);
  });

  it("drops malformed entries", () => {
    window.localStorage.setItem(
      `agni.promptQueue.${KEY}`,
      JSON.stringify([{ id: "x", text: "ok", mode: "queue" }, { nope: true }]),
    );
    expect(readQueue(KEY)).toHaveLength(1);
  });

  it("caps the queue at twenty items", () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      newQueuedPrompt(`p${index}`, "queue", 0),
    );
    expect(capQueue(items)).toHaveLength(20);
    expect(capQueue(items)[0].text).toBe("p5");
  });

  it("keeps attachments in memory, not storage", () => {
    const item = newQueuedPrompt("with image", "queue", 1);
    setQueuedAttachments(item.id, [
      { type: "image", name: "a.png", data: "abc", mimeType: "image/png" },
    ]);
    writeQueue(KEY, [item]);
    expect(getQueuedAttachments(item.id)).toHaveLength(1);
    expect(window.localStorage.getItem(`agni.promptQueue.${KEY}`) ?? "").not.toContain(
      "abc",
    );
    clearQueuedAttachments(item.id);
    expect(getQueuedAttachments(item.id)).toEqual([]);
  });
});
