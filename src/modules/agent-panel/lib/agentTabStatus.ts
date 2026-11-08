import { create } from "zustand";
import type { AgentRunStatus } from "@/modules/agent-ui/Header";
import { osNotify } from "@/modules/agents/lib/notify";
import { useAgentStore } from "@/modules/agents/store/agentStore";

export type AgentTabRunStatus = "idle" | "working" | "waiting" | "error";

type Entry = {
  status: AgentTabRunStatus;
  unread: number;
  /** When the current working run began; null outside a working turn. */
  startedAt: number | null;
};

type State = {
  tabs: Record<number, Entry>;
  setStatus: (tabId: number, status: AgentTabRunStatus) => void;
  markUnread: (tabId: number) => void;
  clearUnread: (tabId: number) => void;
  remove: (tabId: number) => void;
};

function idleEntry(): Entry {
  return { status: "idle", unread: 0, startedAt: null };
}

/** Lightweight per-tab projection so the tab bar can show agent state. */
export const useAgentTabStatus = create<State>((set) => ({
  tabs: {},
  setStatus: (tabId, status) =>
    set((state) => {
      const previous = state.tabs[tabId] ?? idleEntry();
      const startedAt =
        status === "working"
          ? previous.status === "working"
            ? previous.startedAt
            : Date.now()
          : null;
      if (previous.status === status && previous.startedAt === startedAt) {
        return state;
      }
      return {
        tabs: { ...state.tabs, [tabId]: { ...previous, status, startedAt } },
      };
    }),
  markUnread: (tabId) =>
    set((state) => {
      const previous = state.tabs[tabId] ?? idleEntry();
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...previous, unread: previous.unread + 1 },
        },
      };
    }),
  clearUnread: (tabId) =>
    set((state) => {
      const previous = state.tabs[tabId];
      if (!previous || previous.unread === 0) return state;
      return {
        tabs: { ...state.tabs, [tabId]: { ...previous, unread: 0 } },
      };
    }),
  remove: (tabId) =>
    set((state) => {
      if (!state.tabs[tabId]) return state;
      const next = { ...state.tabs };
      delete next[tabId];
      return { tabs: next };
    }),
}));

export function tabStatusFromRun(status: AgentRunStatus): AgentTabRunStatus {
  switch (status) {
    case "working":
      return "working";
    case "waiting":
      return "waiting";
    case "error":
      return "error";
    // "starting" is connection setup, not agent work: keeping it idle avoids
    // bell entries for tabs that were merely opened.
    default:
      return "idle";
  }
}

/**
 * Report a panel's run state. Background tabs accrue an unread marker and push
 * into the agent bell; the focused tab clears both so it never nags you for
 * something you are looking at.
 */
export function reportAgentTabStatus(options: {
  tabId: number;
  agent: string;
  status: AgentTabRunStatus;
  active: boolean;
}): void {
  const { tabId, agent, status, active } = options;
  const store = useAgentTabStatus.getState();
  const previous = store.tabs[tabId]?.status ?? "idle";
  store.setStatus(tabId, status);

  // Agent sessions share the bell's `sessions` map with PTY leaf ids, so use a
  // separate negative key space to avoid collisions.
  const leafId = -tabId;

  if (active) {
    store.clearUnread(tabId);
    useAgentStore.getState().finish(leafId);
    return;
  }

  const agents = useAgentStore.getState();
  const known = Boolean(agents.sessions[leafId]);
  const attention = status === "waiting" || status === "error";
  const finished = previous === "working" && status === "idle";

  if (status === "working") {
    if (known) agents.setStatus(leafId, "working");
    else agents.start(leafId, agent);
    return;
  }

  if (attention) {
    if (!known) agents.start(leafId, agent);
    agents.setStatus(leafId, "waiting");
    if (previous !== status) {
      store.markUnread(tabId);
      agents.pushNotification({
        source: "local",
        leafId,
        agent,
        kind: status === "error" ? "error" : "attention",
      });
      notifyWhenUnfocused(
        `${agent} ${status === "error" ? "failed" : "needs your input"}`,
        agent,
      );
    }
    return;
  }

  if (finished) {
    if (known) agents.setStatus(leafId, "waiting");
    store.markUnread(tabId);
    agents.pushNotification({
      source: "local",
      leafId,
      agent,
      kind: "finished",
    });
    notifyWhenUnfocused(`${agent} finished`, agent);
  }
}

/** Drop a closed tab's status dot and bell entry. */
export function forgetAgentTab(tabId: number): void {
  useAgentTabStatus.getState().remove(tabId);
  useAgentStore.getState().finish(-tabId);
}

function notifyWhenUnfocused(title: string, body: string): void {
  if (typeof document !== "undefined" && document.hasFocus()) return;
  void osNotify(title, body);
}
