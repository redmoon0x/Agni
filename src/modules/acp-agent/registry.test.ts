import { describe, expect, it } from "vitest";
import { parseAcpRegistry } from "./registry";

describe("parseAcpRegistry", () => {
  it("keeps validated agents and setup commands", () => {
    const registry = parseAcpRegistry({
      version: "1.0.0",
      agents: [
        {
          id: "example-agent",
          name: "Example Agent",
          version: "1.2.3",
          description: "An ACP example.",
          repository: "https://github.com/example/agent",
          website: null,
          authors: ["Example"],
          license: "MIT",
          distribution: {
            kind: "npx",
            installCommand: "npx --yes example-agent --acp",
          },
        },
      ],
    });

    expect(registry.agents).toEqual([
      expect.objectContaining({
        id: "example-agent",
        distribution: {
          kind: "npx",
          installCommand: "npx --yes example-agent --acp",
        },
      }),
    ]);
  });

  it("drops malformed agents and external URLs", () => {
    const registry = parseAcpRegistry({
      version: "1.0.0",
      agents: [
        {
          id: "unsafe-link",
          name: "Unsafe Link",
          version: "1.0.0",
          description: "An ACP example.",
          repository: "javascript:alert(1)",
          authors: ["Example", 7],
          distribution: { kind: "binary", installCommand: null },
        },
        { id: "missing-fields" },
      ],
    });

    expect(registry.agents).toHaveLength(1);
    expect(registry.agents[0]).toMatchObject({
      id: "unsafe-link",
      repository: null,
      authors: ["Example"],
    });
  });

  it("rejects malformed registry envelopes", () => {
    expect(() => parseAcpRegistry({ version: "1.0.0" })).toThrow("invalid");
  });
});
