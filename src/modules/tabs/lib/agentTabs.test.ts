import { describe, expect, it } from "vitest";
import { agentTabKey } from "@/modules/tabs/lib/useTabs";

describe("agentTabKey", () => {
  it("dedupes equivalent roots", () => {
    expect(agentTabKey("opencode", "D:\\Repo\\", { kind: "local" })).toBe(
      agentTabKey("opencode", "d:/repo", { kind: "local" }),
    );
  });

  it("separates agent, workspace and cwd", () => {
    const base = agentTabKey("opencode", "/repo", { kind: "local" });
    expect(agentTabKey("kilo", "/repo", { kind: "local" })).not.toBe(base);
    expect(agentTabKey("opencode", "/other", { kind: "local" })).not.toBe(base);
    expect(
      agentTabKey("opencode", "/repo", { kind: "wsl", distro: "Ubuntu" }),
    ).not.toBe(base);
  });

  it("treats a missing cwd as its own key", () => {
    expect(agentTabKey("opencode", null, { kind: "local" })).toBe(
      agentTabKey("opencode", "", { kind: "local" }),
    );
  });
});
