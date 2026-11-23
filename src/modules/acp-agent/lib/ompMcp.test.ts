import { describe, expect, it } from "vitest";
import { ompMcpServers } from "@/modules/acp-agent/lib/ompMcp";

describe("OMP MCP config forwarding", () => {
  it("forwards existing stdio and HTTP servers in ACP format", () => {
    expect(ompMcpServers({
      user: { mcpServers: {
        local: { type: "stdio", command: "server", args: ["--serve"], env: { TOKEN: "secret" } },
        remote: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer token" } },
      } },
      project: null,
    })).toEqual([
      { name: "local", command: "server", args: ["--serve"], env: [{ name: "TOKEN", value: "secret" }] },
      { name: "remote", type: "http", url: "https://example.com/mcp", headers: [{ name: "Authorization", value: "Bearer token" }] },
    ]);
  });

  it("uses project overrides and respects disabled/forced servers", () => {
    expect(ompMcpServers({
      user: { disabledServers: ["blocked"], enabledServers: ["forced"], mcpServers: {
        blocked: { command: "blocked" },
        forced: { enabled: false, command: "enabled" },
        local: { command: "old" },
      } },
      project: { mcpServers: { local: { command: "new" }, ignored: { enabled: false, command: "ignored" } } },
    })).toEqual([
      { name: "forced", command: "enabled", args: [], env: [] },
      { name: "local", command: "new", args: [], env: [] },
    ]);
  });

  it("rejects malformed server definitions rather than sending corrupt ACP requests", () => {
    expect(() => ompMcpServers({ user: { mcpServers: { bad: { command: "run", args: [3] } } }, project: null })).toThrow("invalid arguments");
  });
});
