import { useCallback, useRef, useState } from "react";
import { disposeSession } from "@/modules/terminal/lib/useTerminalSession";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  nextLeafId,
  removeLeaf,
  setLeafCwd as setLeafCwdInTree,
  siblingLeafOf,
  splitLeaf,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";

// Matches the renderer slot pool size -- over this we'd evict an active leaf.
export const MAX_DOCK_PANES = 4;

type DockState = { tree: PaneNode; activeLeafId: number };

/**
 * Owns the bottom terminal panel's pane tree -- a single split-pane surface
 * independent of the tab strip (unlike the old terminal-tab model, there is
 * only ever one of these for the whole app).
 */
export function useTerminalDock(initialCwd?: string) {
  const idRef = useRef(1);
  const [state, setState] = useState<DockState>(() => {
    const leafId = idRef.current++;
    return {
      tree: { kind: "leaf", id: leafId, cwd: initialCwd },
      activeLeafId: leafId,
    };
  });

  const activeCwd = findLeafCwd(state.tree, state.activeLeafId) ?? null;
  const paneCount = leafIds(state.tree).length;

  const splitActive = useCallback((dir: SplitDir): number | null => {
    let newLeafId: number | null = null;
    setState((s) => {
      if (leafIds(s.tree).length >= MAX_DOCK_PANES) return s;
      const splitId = idRef.current++;
      const leafId = idRef.current++;
      newLeafId = leafId;
      const cwd = findLeafCwd(s.tree, s.activeLeafId);
      const tree = splitLeaf(s.tree, s.activeLeafId, splitId, leafId, dir, cwd);
      return { tree, activeLeafId: leafId };
    });
    return newLeafId;
  }, []);

  const focusPane = useCallback((leafId: number) => {
    setState((s) => {
      if (!hasLeaf(s.tree, leafId) || s.activeLeafId === leafId) return s;
      return { ...s, activeLeafId: leafId };
    });
  }, []);

  const focusNext = useCallback((delta: 1 | -1) => {
    setState((s) => {
      const next = nextLeafId(s.tree, s.activeLeafId, delta);
      if (next === s.activeLeafId) return s;
      return { ...s, activeLeafId: next };
    });
  }, []);

  const setLeafCwd = useCallback((leafId: number, cwd: string) => {
    setState((s) => {
      const tree = setLeafCwdInTree(s.tree, leafId, cwd);
      if (tree === s.tree) return s;
      return { ...s, tree };
    });
  }, []);

  /** No-op on the last remaining pane -- collapse the dock instead of
   * leaving zero panes; a fresh pane is spawned the next time it opens. */
  const closePane = useCallback((leafId: number) => {
    let removed = false;
    setState((s) => {
      const tree = removeLeaf(s.tree, leafId);
      if (tree === null) return s;
      removed = true;
      const remaining = leafIds(tree);
      let activeLeafId = s.activeLeafId;
      if (activeLeafId === leafId) {
        const sib = siblingLeafOf(s.tree, leafId);
        activeLeafId = sib && remaining.includes(sib) ? sib : remaining[0];
      }
      return { tree, activeLeafId };
    });
    if (removed) disposeSession(leafId);
  }, []);

  const closeActive = useCallback(() => {
    closePane(state.activeLeafId);
  }, [closePane, state.activeLeafId]);

  /** Tears down every live pane and starts fresh at `cwd` -- used on workspace switch. */
  const resetDock = useCallback((cwd?: string) => {
    const leafId = idRef.current++;
    let toDispose: number[] = [];
    setState((s) => {
      toDispose = leafIds(s.tree);
      return { tree: { kind: "leaf", id: leafId, cwd }, activeLeafId: leafId };
    });
    for (const lid of toDispose) disposeSession(lid);
  }, []);

  return {
    tree: state.tree,
    activeLeafId: state.activeLeafId,
    activeCwd,
    paneCount,
    splitActive,
    focusPane,
    focusNext,
    setLeafCwd,
    closePane,
    closeActive,
    resetDock,
  };
}

export type TerminalDock = ReturnType<typeof useTerminalDock>;
