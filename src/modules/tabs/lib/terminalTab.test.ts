import { describe, expect, it } from "vitest";
import { createTerminalTab } from "./terminalTab";

describe("createTerminalTab", () => {
  it("creates a normal terminal tab without private mode", () => {
    const tab = createTerminalTab({
      tabId: 1,
      leafId: 2,
      title: "shell",
      cwd: "/repo",
    });

    expect(tab.private).toBeUndefined();
    expect(tab.title).toBe("shell");
    expect(tab.paneTree).toEqual({ kind: "leaf", id: 2, cwd: "/repo" });
  });

  it("creates a private terminal tab with private mode", () => {
    const tab = createTerminalTab({
      tabId: 3,
      leafId: 4,
      title: "private",
      private: true,
    });

    expect(tab.private).toBe(true);
    expect(tab.title).toBe("private");
  });
});
