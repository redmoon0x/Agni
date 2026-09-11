import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useRef } from "react";
import { PaneTreeView } from "@/modules/terminal/PaneTreeView";
import type { TerminalPaneHandle } from "@/modules/terminal/TerminalPane";
import type { PaneNode } from "@/modules/terminal/lib/panes";

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

type Props = {
  tree: PaneNode;
  activeLeafId: number;
  paneCount: number;
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onFocusLeaf: (leafId: number) => void;
  onClosePane: (leafId: number) => void;
};

/** Bottom-panel terminal surface -- a single split-pane tree, mounted only while the dock is open. */
export function TerminalDockView({
  tree,
  activeLeafId,
  paneCount,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
  onClosePane,
}: Props) {
  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    searchReadyRef.current = onSearchReady;
  }, [onSearchReady]);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearch: (addon) => searchReadyRef.current(leafId, addon),
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onExit: (code) => exitRef.current(leafId, code),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  };

  return (
    <div data-terminal-dock className="relative h-full w-full">
      <PaneTreeView
        node={tree}
        tabVisible
        activeLeafId={activeLeafId}
        paneCount={paneCount}
        onFocusLeaf={onFocusLeaf}
        onClosePane={onClosePane}
        getBundle={getBundle}
      />
    </div>
  );
}
