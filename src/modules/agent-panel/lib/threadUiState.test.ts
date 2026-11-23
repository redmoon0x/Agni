import { describe, expect, it } from "vitest";
import {
  EMPTY_THREAD_UI_STATE,
  markVisited,
  parseThreadUiState,
  pruneToKeys,
  setPinned,
  setTitle,
  toggleFolder,
  touchOrder,
} from "@/modules/agent-panel/lib/threadUiState";

describe("parseThreadUiState", () => {
  it("returns empty state for malformed payloads", () => {
    expect(parseThreadUiState(null)).toBe(EMPTY_THREAD_UI_STATE);
    expect(parseThreadUiState("nope")).toBe(EMPTY_THREAD_UI_STATE);
    expect(parseThreadUiState(42)).toBe(EMPTY_THREAD_UI_STATE);
  });

  it("keeps only well-formed entries", () => {
    const parsed = parseThreadUiState({
      pinned: { a: true, b: false, c: "yes" },
      titles: { a: "  Fix login  ", b: "   ", c: 9 },
      lastVisitedAt: { a: 1000, b: -5, c: Number.NaN, d: "x" },
      order: ["a", "a", 3, "", "b"],
      collapsedFolders: ["/repo", 7],
    });
    expect(parsed.pinned).toEqual({ a: true });
    expect(parsed.titles).toEqual({ a: "Fix login" });
    expect(parsed.lastVisitedAt).toEqual({ a: 1000 });
    expect(parsed.order).toEqual(["a", "b"]);
    expect(parsed.collapsedFolders).toEqual(["/repo"]);
  });
});

describe("touchOrder", () => {
  it("moves the key to the front without duplicating", () => {
    expect(touchOrder(["b", "a", "c"], "a")).toEqual(["a", "b", "c"]);
    expect(touchOrder(["a"], "d")).toEqual(["d", "a"]);
    expect(touchOrder([], "a")).toEqual(["a"]);
  });
});

describe("setPinned", () => {
  it("adds and removes without mutating", () => {
    const start = EMPTY_THREAD_UI_STATE;
    const pinned = setPinned(start, "k", true);
    expect(pinned.pinned).toEqual({ k: true });
    expect(start.pinned).toEqual({});
    expect(setPinned(pinned, "k", true)).toBe(pinned);
    expect(setPinned(pinned, "k", false).pinned).toEqual({});
  });
});

describe("setTitle", () => {
  it("stores trimmed titles and clears empties", () => {
    const titled = setTitle(EMPTY_THREAD_UI_STATE, "k", "  Renamed thread  ");
    expect(titled.titles).toEqual({ k: "Renamed thread" });
    expect(setTitle(titled, "k", "   ").titles).toEqual({});
  });
});

describe("markVisited", () => {
  it("records the newest visit and bumps MRU order", () => {
    let state = markVisited(EMPTY_THREAD_UI_STATE, "a", 100);
    state = markVisited(state, "b", 200);
    state = markVisited(state, "a", 300);
    expect(state.lastVisitedAt).toEqual({ a: 300, b: 200 });
    expect(state.order).toEqual(["a", "b"]);
    // Older visits do not move timestamps back.
    expect(markVisited(state, "a", 50)).toBe(state);
  });
});

describe("toggleFolder", () => {
  it("collapses and expands by key", () => {
    const collapsed = toggleFolder(EMPTY_THREAD_UI_STATE, "/repo");
    expect(collapsed.collapsedFolders).toEqual(["/repo"]);
    expect(toggleFolder(collapsed, "/repo").collapsedFolders).toEqual([]);
    expect(toggleFolder(EMPTY_THREAD_UI_STATE, "/repo", false)).toBe(
      EMPTY_THREAD_UI_STATE,
    );
  });
});

describe("pruneToKeys", () => {
  it("drops entries whose thread is gone but keeps folders", () => {
    let state = markVisited(EMPTY_THREAD_UI_STATE, "a", 100);
    state = markVisited(state, "b", 200);
    state = setPinned(state, "b", true);
    state = setTitle(state, "b", "Keep");
    state = toggleFolder(state, "/repo");
    const pruned = pruneToKeys(state, ["b"]);
    expect(pruned.pinned).toEqual({ b: true });
    expect(pruned.titles).toEqual({ b: "Keep" });
    expect(pruned.lastVisitedAt).toEqual({ b: 200 });
    expect(pruned.order).toEqual(["b"]);
    expect(pruned.collapsedFolders).toEqual(["/repo"]);
  });
});
