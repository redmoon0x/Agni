import type { Tab } from "@/modules/tabs";
import { hasLeaf, leafIdForPty } from "@/modules/terminal";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (tabId: number, leafId: number) => void;
type OnAgentStarted = (tabId: number, leafId: number, agent: string) => void;
type OnAgentDone = (tabId: number) => void;
type Ctx = {
  tabs: Tab[];
  activeId: number;
  focused: boolean;
  onActivate: Activate;
  onAgentStarted: OnAgentStarted;
  onAgentDone: OnAgentDone;
};

function tabInfo(
  tabs: Tab[],
  leafId: number,
): { tabId: number; title: string } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) {
      return { tabId: t.id, title: t.title };
    }
  }
  return null;
}

function route(
  session: AgentSession,
  kind: "attention" | "finished",
  ctx: Ctx,
): void {
  const info = tabInfo(ctx.tabs, session.leafId);
  const heading =
    kind === "attention"
      ? `${session.agent} needs your input`
      : `${session.agent} finished`;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    body: info?.title,
    focused: ctx.focused,
    visible: ctx.activeId === session.tabId,
    // Stop fires every turn, so finished only updates the bell; attention toasts.
    allowToast: kind === "attention",
    tabId: session.tabId,
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.tabId, session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = tabInfo(ctx.tabs, leafId);
      if (!info) return;
      store.start(leafId, info.tabId, sig.agent ?? "agent");
      ctx.onAgentStarted(info.tabId, leafId, sig.agent ?? "agent");
      return;
    }
    case "working":
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "attention", ctx);
      return;
    }
    case "finished": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", ctx);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "exited": {
      const tabId = store.sessions[leafId]?.tabId ?? 0;
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      if (tabId) ctx.onAgentDone(tabId);
      return;
    }
  }
}

export function AgentNotificationsBridge({
  tabs,
  activeId,
  onActivate,
  onAgentStarted,
  onAgentDone,
}: {
  tabs: Tab[];
  activeId: number;
  onActivate: Activate;
  onAgentStarted: OnAgentStarted;
  onAgentDone: OnAgentDone;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({
    tabs,
    activeId,
    focused,
    onActivate,
    onAgentStarted,
    onAgentDone,
  });
  ctxRef.current = {
    tabs,
    activeId,
    focused,
    onActivate,
    onAgentStarted,
    onAgentDone,
  };

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<AgentSignal>("agni:agent-signal", (e) =>
      handleSignal(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return null;
}
