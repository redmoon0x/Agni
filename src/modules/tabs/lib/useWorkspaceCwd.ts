import { useEffect, useMemo, useRef } from "react";

/**
 * Derives the explorer root from the terminal dock's active cwd (falling
 * back to the last known one, then workspace home). Editor/preview/git tabs
 * never drive this -- opening a new terminal from a file shouldn't hijack
 * the user's working directory context.
 */
export function useWorkspaceCwd(
  dockActiveCwd: string | null,
  home: string | null,
): { explorerRoot: string | null } {
  const lastDockCwd = useRef<string | null>(null);

  useEffect(() => {
    if (dockActiveCwd) lastDockCwd.current = dockActiveCwd;
  }, [dockActiveCwd]);

  const explorerRoot = useMemo<string | null>(() => {
    return dockActiveCwd ?? lastDockCwd.current ?? home;
  }, [dockActiveCwd, home]);

  return { explorerRoot };
}
