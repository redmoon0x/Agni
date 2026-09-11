import { beforeEach, describe, expect, it } from "vitest";
import { usePreviewAnnotateDraftStore } from "./draftStore";
import type { SelectorElement } from "./resolve";
import { buildPrompt, buildSelector, normalizeRect } from "./resolve";

describe("normalizeRect", () => {
  it("converts px rect to clamped percentages", () => {
    expect(
      normalizeRect(
        { x: 100, y: 50, width: 200, height: 100 },
        { width: 1000, height: 500 },
      ),
    ).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it("clamps out-of-bounds values to 0–100", () => {
    const r = normalizeRect(
      { x: -50, y: 0, width: 2000, height: 100 },
      { width: 100, height: 100 },
    );
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(100);
    expect(r.height).toBe(100);
  });

  it("is safe for zero-size containers", () => {
    expect(
      normalizeRect(
        { x: 0, y: 0, width: 0, height: 0 },
        { width: 0, height: 0 },
      ),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

function el(partial: Partial<SelectorElement>): SelectorElement {
  return {
    tagName: "div",
    getAttribute: (name: string) =>
      name === "id" ? (partial.id ?? null) : null,
    ...partial,
  };
}

describe("buildSelector", () => {
  it("prefers id", () => {
    expect(buildSelector(el({ tagName: "button", id: "submit" }))).toBe(
      "#submit",
    );
  });

  it("falls back to first two classes", () => {
    expect(
      buildSelector(
        el({ tagName: "button", className: "btn btn-primary is-active" }),
      ),
    ).toBe("button.btn.btn-primary");
  });

  it("disambiguates repeated siblings with nth-of-type", () => {
    const one = el({ tagName: "li" });
    const two = el({ tagName: "li" });
    const three = el({ tagName: "li" });
    one.children = [one, two, three];
    two.children = [one, two, three];
    three.children = [one, two, three];
    expect(buildSelector(two)).toBe("li:nth-of-type(2)");
  });

  it("returns the bare tag when no id/class/duplicate", () => {
    expect(buildSelector(el({ tagName: "section" }))).toBe("section");
  });

  it("ignores html and body", () => {
    expect(buildSelector(el({ tagName: "html" }))).toBe("");
    expect(buildSelector(el({ tagName: "body" }))).toBe("");
  });

  it("escapes special chars in id and class", () => {
    expect(buildSelector(el({ id: "a:b.c" }))).toBe("#a\\:b\\.c");
  });
});

describe("buildPrompt", () => {
  it("builds an html-target prompt with selector and instruction", () => {
    const prompt = buildPrompt(
      {
        kind: "html",
        filePath: "src/index.html",
        selector: "button.btn-primary",
        label: "button.btn-primary",
      },
      "Make this green",
    );
    expect(prompt).toContain("@src/index.html");
    expect(prompt).toContain("button.btn-primary");
    expect(prompt).toContain("Make this green");
  });

  it("builds a url-target prompt with region percentages", () => {
    const prompt = buildPrompt(
      {
        kind: "url",
        url: "http://localhost:5173",
        region: { x: 10, y: 20, width: 30, height: 40 },
      },
      "Fix the alignment",
    );
    expect(prompt).toContain("http://localhost:5173");
    expect(prompt).toContain("10%–40%");
    expect(prompt).toContain("20%–60%");
    expect(prompt).toContain("Fix the alignment");
  });

  it("omits trailing whitespace instruction", () => {
    const prompt = buildPrompt(
      {
        kind: "html",
        filePath: "src/index.html",
        selector: "div",
        label: "div",
      },
      "   ",
    );
    expect(prompt).not.toContain("undefined");
    expect(prompt.endsWith("div")).toBe(true);
  });
});

describe("usePreviewAnnotateDraftStore", () => {
  beforeEach(() => {
    usePreviewAnnotateDraftStore.getState().setDraft("");
    usePreviewAnnotateDraftStore.setState({ pending: null });
  });

  it("stages and consumes a draft once", () => {
    const store = usePreviewAnnotateDraftStore.getState();
    store.setDraft("hello");
    expect(usePreviewAnnotateDraftStore.getState().pending).toEqual({
      text: "hello",
    });
    expect(usePreviewAnnotateDraftStore.getState().consume()).toBe("hello");
    expect(usePreviewAnnotateDraftStore.getState().consume()).toBeNull();
  });

  it("returns null when no draft is pending", () => {
    expect(usePreviewAnnotateDraftStore.getState().consume()).toBeNull();
  });
});
