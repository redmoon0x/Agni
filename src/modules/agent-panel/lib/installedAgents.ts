import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { create } from "zustand";
import { ACP_AGENT_LIST } from "@/modules/acp-agent/lib/agent";
import type { AgentId } from "@/modules/settings/store";
import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";

/** Every agent the panel can host, in tab order. */
export const PANEL_AGENTS: { id: AgentId; label: string }[] = [
  { id: "pi", label: "Pi" },
  ...ACP_AGENT_LIST.map((agent) => ({ id: agent.id, label: agent.label })),
];

/** Keeps probed ids in panel order and drops anything Agni no longer knows. */
export function orderKnownAgents(ids: readonly string[]): AgentId[] {
  const found = new Set(ids);
  return PANEL_AGENTS.filter((agent) => found.has(agent.id)).map(
    (agent) => agent.id,
  );
}

const CACHE_TTL_MS = 60_000;

type Entry = { ids: AgentId[]; checkedAt: number; workspace: WorkspaceEnv };

type State = {
  scopes: Record<string, Entry>;
  setEntry: (scope: string, entry: Entry) => void;
  invalidate: () => void;
};

const useAvailability = create<State>((set, get) => ({
  scopes: {},
  setEntry: (scope, entry) =>
    set((state) => ({ scopes: { ...state.scopes, [scope]: entry } })),
  invalidate: () => {
    const stale = Object.values(get().scopes);
    set({ scopes: {} });
    // Re-probe now instead of waiting for a remount, so an agent that was
    // installed (or removed) while the panel was open updates the tabs.
    for (const entry of stale) {
      void detect(workspaceScopeKey(entry.workspace), entry.workspace);
    }
  },
}));

const inFlight = new Map<string, Promise<void>>();

async function detect(scope: string, workspace: WorkspaceEnv): Promise<void> {
  const cached = useAvailability.getState().scopes[scope];
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return;
  const pending = inFlight.get(scope);
  if (pending) return pending;
  const run = invoke<string[]>("agents_installed", { workspace })
    .then((ids) => {
      if (!Array.isArray(ids)) return;
      useAvailability.getState().setEntry(scope, {
        ids: orderKnownAgents(ids),
        checkedAt: Date.now(),
        workspace,
      });
    })
    .catch(() => {
      // Detection is best effort: a failed probe keeps the last known list
      // rather than hiding agents that do work.
    })
    .finally(() => {
      inFlight.delete(scope);
    });
  inFlight.set(scope, run);
  return run;
}

/** Drops every cached probe so the next check re-reads PATH. */
export function invalidateAgentAvailability(): void {
  useAvailability.getState().invalidate();
}

/**
 * Installed agent ids for a workspace, or `null` while the first probe is in
 * flight. A cached list renders immediately and revalidates behind it.
 */
export function useInstalledAgents(workspace: WorkspaceEnv): AgentId[] | null {
  const scope = workspaceScopeKey(workspace);
  const ids = useAvailability((state) => state.scopes[scope]?.ids ?? null);

  useEffect(() => {
    void detect(scope, workspace);
  }, [scope, workspace]);

  return ids;
}
