import { describe, expect, it } from "vitest";
import { summarizeAccount } from "@/modules/agent-panel/lib/accountProbe";

describe("summarizeAccount", () => {
  it("reads Claude's auth status email", () => {
    const raw = JSON.stringify(
      {
        loggedIn: true,
        authMethod: "claude.ai",
        email: "teamuser@c3alabs.com",
        subscriptionType: "pro",
      },
      null,
      2,
    );
    expect(summarizeAccount("claude", raw)).toBe("teamuser@c3alabs.com");
    expect(summarizeAccount("claude", '{"loggedIn": true}')).toBe("Signed in");
  });

  it("reads CommandCode whoami email and strips ANSI", () => {
    const raw = [
      "\u001b[1mUser Information:\u001b[22m",
      "i Name: \u001b[36mdeviprasadshettjp1x\u001b[39m",
      "i Email: \u001b[36mdev@example.com\u001b[39m",
      "i Username: \u001b[36mdeviprasadshettjp1x\u001b[39m",
    ].join("\n");
    expect(summarizeAccount("commandcode", raw)).toBe("dev@example.com");
  });

  it("summarizes OpenCode auth providers", () => {
    const raw = [
      "T  Credentials ~\\.local\\share\\opencode\\auth.json",
      "|",
      "\u001b[34m•\u001b[39m  OpenRouter \u001b[90mapi",
      "|",
      "—  1 credentials",
    ].join("\n");
    expect(summarizeAccount("opencode", raw)).toBe("OpenRouter");
  });

  it("summarizes Hermes provider credentials", () => {
    const raw = [
      "copilot (1 credentials):",
      "openai-codex (1 credentials):",
      "openrouter (1 credentials):",
    ].join("\n");
    expect(summarizeAccount("hermes", raw)).toBe(
      "copilot, openai-codex, openrouter",
    );
  });

  it("falls back to the first meaningful line", () => {
    expect(summarizeAccount("mystery", "\n Signed in as foo \n")).toBe(
      "Signed in as foo",
    );
    expect(summarizeAccount("mystery", "   ")).toBe("Signed in");
  });
});
