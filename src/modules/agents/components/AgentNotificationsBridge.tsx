import { PI_TERMINAL_LEAF_ID } from "@/modules/pi-agent";
import { hasLeaf, leafIdForPty } from "@/modules/terminal";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import type { AgentSession, AgentSignal, AgentSurface } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (surface: AgentSurface, leafId: number) => void;
type Ctx = {
  dockTree: PaneNode;
  dockOpen: boolean;
  dockActiveLeafId: number;
  /** Pi panel is open and showing its terminal mode. */
  piPanelVisible: boolean;
  focused: boolean;
  onActivate: Activate;
};

function resolveSurface(dockTree: PaneNode, leafId: number): AgentSurface | null {
  if (leafId === PI_TERMINAL_LEAF_ID) return "pi-panel";
  if (hasLeaf(dockTree, leafId)) return "dock";
  return null;
}

function isSurfaceVisible(ctx: Ctx, surface: AgentSurface, leafId: number): boolean {
  if (surface === "dock") return ctx.dockOpen && ctx.dockActiveLeafId === leafId;
  return ctx.piPanelVisible;
}

function route(session: AgentSession, kind: "attention" | "finished", ctx: Ctx): void {
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
    visible: isSurfaceVisible(ctx, session.surface, session.leafId),
    // Stop fires every turn, so finished only updates the bell; attention toasts.
    allowToast: kind === "attention",
    surface: session.surface,
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.surface, session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const surface = resolveSurface(ctx.dockTree, leafId);
      if (!surface) return;
      store.start(leafId, surface, sig.agent ?? "agent");
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
  piPanelVisible,
  onActivate,
}: {
  dockTree: PaneNode;
  dockOpen: boolean;
  dockActiveLeafId: number;
  piPanelVisible: boolean;
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({
    dockTree,
    dockOpen,
    dockActiveLeafId,
    piPanelVisible,
    focused,
    onActivate,
  });
  ctxRef.current = {
    dockTree,
    dockOpen,
    dockActiveLeafId,
    piPanelVisible,
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
