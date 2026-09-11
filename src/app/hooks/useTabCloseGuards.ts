import { useCallback, useState } from "react";
import type { Tab } from "@/modules/tabs";

type Params = {
  tabs: Tab[];
  disposeTab: (id: number) => void;
};

/**
 * Guards tab closing: dirty editors route through a confirmation dialog
 * instead of closing immediately. Owns the pending-close states the dialogs
 * render from.
 */
export function useTabCloseGuards({ tabs, disposeTab }: Params) {
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );

  const handleClose = useCallback(
    (id: number) => {
      const t = tabs.find((x) => x.id === id);
      if (t?.kind === "editor" && t.dirty) {
        setPendingCloseTab(id);
        return;
      }
      disposeTab(id);
    },
    [tabs, disposeTab],
  );

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      disposeTab(pendingCloseTab);
      setPendingCloseTab(null);
    }
  }, [pendingCloseTab, disposeTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      for (const id of pendingDeleteTabs) disposeTab(id);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs, disposeTab]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathDeleted = useCallback(
    (path: string) => {
      const dirty: number[] = [];
      for (const t of tabs) {
        if (
          t.kind !== "editor" &&
          t.kind !== "markdown" &&
          t.kind !== "html" &&
          t.kind !== "image" &&
          t.kind !== "pdf"
        ) {
          continue;
        }
        if (t.path !== path && !t.path.startsWith(`${path}/`)) continue;
        if (t.kind === "editor" && t.dirty) {
          dirty.push(t.id);
        } else {
          disposeTab(t.id);
        }
      }
      if (dirty.length > 0) setPendingDeleteTabs(dirty);
    },
    [tabs, disposeTab],
  );

  return {
    pendingCloseTab,
    pendingDeleteTabs,
    handleClose,
    confirmClose,
    cancelClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  };
}
