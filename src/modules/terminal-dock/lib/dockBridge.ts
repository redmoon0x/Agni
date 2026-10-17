import {
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal/lib/useTerminalSession";
import type { SplitDir } from "@/modules/terminal/lib/panes";

type DockHandle = {
  splitActive: (dir: SplitDir) => number | null;
};

let handle: DockHandle | null = null;

/** Called by `useTerminalDock` so non-React code (the ACP store) can reach the
 *  one live dock. Cleared on unmount so a torn-down dock is never used. */
export function registerTerminalDock(next: DockHandle | null): void {
  handle = next;
}

/** Opens a fresh dock pane and types `command` into it. Returns false when the
 *  dock is not mounted (headless, or a settings-only window). */
export async function runInDockTerminal(command: string): Promise<boolean> {
  const current = handle;
  if (!current) return false;
  const leafId = current.splitActive("col");
  if (leafId === null) return false;
  try {
    await whenSessionReady(leafId);
  } catch {
    // The pane never opened a PTY; still try the write so the user sees
    // something rather than a silent no-op.
  }
  return writeToSession(leafId, `${command}\r`);
}