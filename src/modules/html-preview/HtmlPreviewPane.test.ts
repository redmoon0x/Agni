import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "HtmlPreviewPane.tsx"), "utf8");
const iframeMatch = src.match(/<iframe[\s\S]*?\/>/);
const iframeJsx = iframeMatch?.[0] ?? "";

describe("HtmlPreviewPane iframe sandbox", () => {
  it("declares an iframe in the source", () => {
    expect(iframeJsx).not.toBe("");
  });

  it("allows scripts without same-origin access", () => {
    expect(iframeJsx).toMatch(/sandbox="[^"]*allow-scripts/);
    expect(iframeJsx).not.toMatch(/allow-same-origin/);
  });

  it("does not allow top navigation", () => {
    expect(iframeJsx).not.toMatch(/allow-top-navigation/);
  });

  it("sets referrerPolicy to no-referrer", () => {
    expect(iframeJsx).toMatch(/referrerPolicy="no-referrer"/);
  });
});
