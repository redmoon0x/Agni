import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetAgentTab,
  reportAgentTabStatus,
  tabStatusFromRun,
  useAgentTabStatus,
} from "@/modules/agent-panel/lib/agentTabStatus";
import { useAgentStore } from "@/modules/agents/store/agentStore";

beforeEach(() => {
  useAgentTabStatus.setState({ tabs: {} });
  useAgentStore.setState({ sessions: {}, notifications: [], localAgent: null });
  Object.defineProperty(globalThis, "document", {
    value: { hasFocus: () => true },
    configurable: true,
    writable: true,
  });
});

describe("tabStatusFromRun", () => {
  it("maps panel run states onto tab states", () => {
    expect(tabStatusFromRun("working")).toBe("working");
    expect(tabStatusFromRun("starting")).toBe("idle");
    expect(tabStatusFromRun("waiting")).toBe("waiting");
    expect(tabStatusFromRun("error")).toBe("error");
    expect(tabStatusFromRun("ready")).toBe("idle");
    expect(tabStatusFromRun("stopped")).toBe("idle");
  });
});

describe("reportAgentTabStatus", () => {
  it("tracks busy time while a tab works", () => {
    reportAgentTabStatus({
      tabId: 9,
      agent: "OpenCode",
      status: "working",
      active: true,
    });
    const startedAt = useAgentTabStatus.getState().tabs[9]?.startedAt;
    expect(typeof startedAt).toBe("number");
    // A second report keeps the original start time.
    reportAgentTabStatus({
      tabId: 9,
      agent: "OpenCode",
      status: "working",
      active: true,
    });
    expect(useAgentTabStatus.getState().tabs[9]?.startedAt).toBe(startedAt);
    reportAgentTabStatus({
      tabId: 9,
      agent: "OpenCode",
      status: "idle",
      active: true,
    });
    expect(useAgentTabStatus.getState().tabs[9]?.startedAt).toBeNull();
  });

  it("tracks a background working tab without notifying", () => {
    reportAgentTabStatus({
      tabId: 1,
      agent: "OpenCode",
      status: "working",
      active: false,
    });
    expect(useAgentTabStatus.getState().tabs[1]?.status).toBe("working");
    expect(useAgentStore.getState().sessions[-1]?.status).toBe("working");
    expect(useAgentStore.getState().notifications).toEqual([]);
  });

  it("marks a background tab unread and notifies when it finishes", () => {
    reportAgentTabStatus({
      tabId: 1,
      agent: "OpenCode",
      status: "working",
      active: false,
    });
    reportAgentTabStatus({
      tabId: 1,
      agent: "OpenCode",
      status: "idle",
      active: false,
    });
    expect(useAgentTabStatus.getState().tabs[1]?.unread).toBe(1);
    expect(useAgentStore.getState().sessions[-1]?.status).toBe("waiting");
    expect(useAgentStore.getState().notifications[0]?.kind).toBe("finished");
  });

  it("marks attention and pushes an attention notification", () => {
    reportAgentTabStatus({
      tabId: 2,
      agent: "Pi",
      status: "waiting",
      active: false,
    });
    expect(useAgentTabStatus.getState().tabs[2]?.unread).toBe(1);
    expect(useAgentStore.getState().notifications[0]?.kind).toBe("attention");
  });

  it("clears unread and the bell entry for the focused tab", () => {
    reportAgentTabStatus({
      tabId: 3,
      agent: "OpenCode",
      status: "working",
      active: false,
    });
    reportAgentTabStatus({
      tabId: 3,
      agent: "OpenCode",
      status: "idle",
      active: false,
    });
    reportAgentTabStatus({
      tabId: 3,
      agent: "OpenCode",
      status: "idle",
      active: true,
    });
    expect(useAgentTabStatus.getState().tabs[3]?.unread).toBe(0);
    expect(useAgentStore.getState().sessions[-3]).toBeUndefined();
  });

  it("forgets a closed tab", () => {
    reportAgentTabStatus({
      tabId: 4,
      agent: "Pi",
      status: "working",
      active: false,
    });
    forgetAgentTab(4);
    expect(useAgentTabStatus.getState().tabs[4]).toBeUndefined();
    expect(useAgentStore.getState().sessions[-4]).toBeUndefined();
  });
});
