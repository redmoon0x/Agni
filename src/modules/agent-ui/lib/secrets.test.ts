import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/modules/agent-ui/lib/secrets";

describe("redactSecrets", () => {
  it("redacts common credentials", () => {
    const text = [
      "anthropic sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      "openai sk-proj-abcdefghijklmnopqrstuvwxyz1234",
      "github ghp_abcdefghijklmnopqrstuvwxyz012345",
      "aws AKIAIOSFODNN7EXAMPLE",
      "slack xoxb-1234567890-abcdefghij",
    ].join("\n");
    const result = redactSecrets(text);
    expect(result.text).not.toContain("sk-ant-");
    expect(result.text).not.toContain("sk-proj-");
    expect(result.text).not.toContain("ghp_");
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.text).not.toContain("xoxb-");
    expect(result.redacted.length).toBeGreaterThanOrEqual(4);
  });

  it("redacts key assignments", () => {
    const result = redactSecrets("api_key = abcdefghijklmnop1234");
    expect(result.text).toContain("[redacted]");
  });

  it("leaves ordinary prose and paths alone", () => {
    const text =
      "Read src/modules/agent-ui/Composer.tsx and explain the token handling.";
    const result = redactSecrets(text);
    expect(result.text).toBe(text);
    expect(result.redacted).toEqual([]);
  });
});
