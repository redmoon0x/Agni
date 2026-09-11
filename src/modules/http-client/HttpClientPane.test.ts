import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "HttpClientPane.tsx"), "utf8");

describe("HttpClientPane", () => {
  it("offers the standard HTTP methods", () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(src).toContain(`"${method}"`);
    }
  });

  it("has a URL input and a send button", () => {
    expect(src).toContain("placeholder=");
    expect(src).toContain("Send");
    expect(src).toContain('placeholder="https://api.example.com/endpoint"');
  });

  it("renders JSON bodies through the shared highlighter", () => {
    expect(src).toContain('highlight(code, "json")');
    expect(src).toContain("node.cls");
  });

  it("pretty-prints JSON before highlighting", () => {
    expect(src).toContain("JSON.stringify(JSON.parse(body), null, 2)");
  });

  it("only shows the body textarea for body-bearing methods", () => {
    expect(src).toContain("METHODS_WITH_BODY");
    expect(src).toContain('["POST", "PUT", "PATCH"]');
  });
});
