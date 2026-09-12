import { hasLeaf, leafIdForPty } from "@/modules/terminal";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (leafId: number) => void;
type Ctx = {
  dockTree: PaneNode;
  dockOpen: boolean;
  dockActiveLeafId: number;
  focused: boolean;
  onActivate: Activate;
};

function isVisible(ctx: Ctx, leafId: number): boolean {
  return ctx.dockOpen && ctx.dockActiveLeafId === leafId;
}

function route(
  session: AgentSession,
  kind: "attention" | "finished",
  ctx: Ctx,
): void {
  const heading =
    kind === "attention"
      ? `${session.agent} needs your input`
      : `${session.agent} finished`;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    focused: ctx.focused,
    visible: isVisible(ctx, session.leafId),
    // Stop fires every turn, so finished only updates the bell; attention toasts.
    allowToast: kind === "attention",
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      if (!hasLeaf(ctx.dockTree, leafId)) return;
      store.start(leafId, sig.agent ?? "agent");
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
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
    }
  }
}

export function AgentNotificationsBridge({
  dockTree,
  dockOpen,
  dockActiveLeafId,
  onActivate,
}: {
  dockTree: PaneNode;
  dockOpen: boolean;
  dockActiveLeafId: number;
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({
    dockTree,
    dockOpen,
    dockActiveLeafId,
    focused,
    onActivate,
  });
  ctxRef.current = {
    dockTree,
    dockOpen,
    dockActiveLeafId,
    focused,
    onActivate,
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
