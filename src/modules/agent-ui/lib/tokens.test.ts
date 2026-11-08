import { describe, expect, it } from "vitest";
import {
  detectAtToken,
  detectSlashToken,
  replaceAtToken,
} from "@/modules/agent-ui/lib/tokens";

describe("detectAtToken", () => {
  it("detects a mention at the start and after whitespace", () => {
    expect(detectAtToken("@src", 4)).toEqual({ query: "src", start: 0 });
    expect(detectAtToken("look at @src/ap", 15)).toEqual({
      query: "src/ap",
      start: 8,
    });
  });

  it("ignores an @ inside a word or followed by whitespace", () => {
    expect(detectAtToken("mail@host", 9)).toBeNull();
    expect(detectAtToken("@ src", 5)).toBeNull();
  });

  it("only looks before the caret", () => {
    expect(detectAtToken("@src done", 4)?.query).toBe("src");
  });
});

describe("replaceAtToken", () => {
  it("replaces the token and returns the next caret", () => {
    const value = "open @sr please";
    const token = detectAtToken(value, 8);
    expect(token).not.toBeNull();
    if (!token) return;
    const result = replaceAtToken(value, token, "src/main.ts");
    expect(result.value).toBe("open @src/main.ts  please");
    expect(result.caret).toBe("open @src/main.ts ".length);
  });
});

describe("detectSlashToken", () => {
  it("matches only a whole-input command", () => {
    expect(detectSlashToken("/revi")).toBe("revi");
    expect(detectSlashToken("/")).toBe("");
    expect(detectSlashToken("/cmd now")).toBeNull();
    expect(detectSlashToken("text /cmd")).toBeNull();
  });
});
