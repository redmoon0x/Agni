import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "@/modules/agent-ui/lib/incrementalMarkdown";

describe("splitStreamingMarkdown", () => {
  it("keeps everything in the tail before a complete fence", () => {
    expect(splitStreamingMarkdown("hello **world**")).toEqual({
      stable: "",
      tail: "hello **world**",
    });
  });

  it("seals at a completed fenced block", () => {
    const text = "intro\n```ts\nconst a = 1;\n```\nmore";
    const split = splitStreamingMarkdown(text);
    expect(split.stable).toBe("intro\n```ts\nconst a = 1;\n```");
    expect(split.tail).toBe("\nmore");
  });

  it("does not seal on an unterminated fence", () => {
    const text = "intro\n```ts\nconst a = 1;";
    expect(splitStreamingMarkdown(text)).toEqual({ stable: "", tail: text });
  });

  it("seals at a paragraph boundary for large prose", () => {
    const text = `${"a".repeat(1600)}\n\n${"b".repeat(600)}`;
    const split = splitStreamingMarkdown(text);
    expect(split.stable.endsWith("\n\n")).toBe(true);
    expect(split.tail).toBe("b".repeat(600));
  });

  it("falls back to a full reparse for CRLF and BOM", () => {
    expect(splitStreamingMarkdown("a\r\n```\r\nb\r\n```")).toEqual({
      stable: "",
      tail: "a\r\n```\r\nb\r\n```",
    });
    expect(splitStreamingMarkdown("\ufeffhello")).toEqual({
      stable: "",
      tail: "\ufeffhello",
    });
  });
});
