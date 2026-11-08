import { emit, listen } from "@tauri-apps/api/event";
import {
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal/lib/useTerminalSession";
import type { SplitDir } from "@/modules/terminal/lib/panes";

export const RUN_IN_DOCK_EVENT = "agni-run-in-dock";
export const RUN_IN_DOCK_RESULT_EVENT = "agni-run-in-dock-result";

type DockHandle = {
  splitActive: (dir: SplitDir) => number | null;
};

let handle: DockHandle | null = null;
let opener: (() => void) | null = null;

/** Called by `useTerminalDock` so non-React code (the ACP store) can reach the
 *  one live dock. Cleared on unmount so a torn-down dock is never used. */
export function registerTerminalDock(next: DockHandle | null): void {
  handle = next;
}

/** Called by the main window so a terminal can be opened before writing. */
export function registerTerminalDockOpener(next: (() => void) | null): void {
  opener = next;
}

/** Run in this window's dock only. Used by the cross-window host so a request
 *  can never bounce back out. */
export async function runInDockTerminalLocal(command: string): Promise<boolean> {
  opener?.();
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
  // The PTY can appear a moment after the pane mounts.
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (writeToSession(leafId, `${command}\r`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Opens a fresh dock pane and types `command` into it. In a window without a
 * dock (the Settings window), asks the main window to host it.
 */
export async function runInDockTerminal(command: string): Promise<boolean> {
  if (handle) return runInDockTerminalLocal(command);

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let settled = false;
  let resolveResult: (value: boolean) => void = () => {};
  const result = new Promise<boolean>((resolve) => {
    resolveResult = resolve;
  });
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    resolveResult(false);
  }, 12_000);

  let unlisten: (() => void) | undefined;
  try {
    // Register before emitting so a fast reply cannot race past us.
    unlisten = await listen<{ requestId: string; ok: boolean }>(
      RUN_IN_DOCK_RESULT_EVENT,
      (event) => {
        if (event.payload?.requestId !== requestId || settled) return;
        settled = true;
        resolveResult(event.payload.ok === true);
      },
    );
  } catch {
    clearTimeout(timer);
    return false;
  }

  await emit(RUN_IN_DOCK_EVENT, { requestId, command }).catch(() => {});
  const ok = await result;
  clearTimeout(timer);
  unlisten();
  return ok;
}
