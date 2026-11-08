import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { ACP_AGENT_LIST } from "@/modules/acp-agent/lib/agent";
import {
  CUSTOM_AGENT_ID,
  CUSTOM_AGENT_LABEL,
} from "@/modules/agent-panel/lib/profile";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentId } from "@/modules/settings/store";
import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";

/** Every built-in agent the panel can host, in tab order. */
export const PANEL_AGENTS: { id: AgentId; label: string }[] = [
  { id: "pi", label: "Pi" },
  ...ACP_AGENT_LIST.map((agent) => ({ id: agent.id, label: agent.label })),
];

/** Dev-only agents that never ship in a release build. */
export const DEV_PANEL_AGENTS: { id: AgentId; label: string }[] =
  import.meta.env.DEV
    ? [{ id: "dev-replay", label: "Dev Replay (dev)" }]
    : [];

/** Built-ins plus registry-installed agents and custom ACP profiles. */
export function usePanelAgents(): { id: AgentId; label: string }[] {
  const installed = usePreferencesStore((state) => state.installedAcpAgents);
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  return useMemo(() => {
    const known = new Set(PANEL_AGENTS.map((agent) => agent.id));
    const profileAgents: { id: AgentId; label: string }[] = [];
    for (const profile of profiles) {
      if (!profile.enabled || known.has(profile.agent)) continue;
      known.add(profile.agent);
      profileAgents.push({
        id: profile.agent,
        label:
          profile.agent === CUSTOM_AGENT_ID
            ? CUSTOM_AGENT_LABEL
            : profile.agent,
      });
    }
    return [
      ...PANEL_AGENTS,
      ...profileAgents,
      ...installed
        .filter((agent) => !known.has(agent.id))
        .map((agent) => ({ id: agent.id, label: agent.label })),
      ...DEV_PANEL_AGENTS,
    ];
  }, [installed, profiles]);
}

/** Harnesses usable right now in this workspace (installed or registry-managed). */
export function useAvailableAgents(
  workspace: WorkspaceEnv,
): { id: AgentId; label: string }[] {
  const panel = usePanelAgents();
  const installed = useInstalledAgents(workspace);
  const registry = usePreferencesStore((state) => state.installedAcpAgents);
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  return useMemo(() => {
    if (!installed) return panel;
    // Custom ACP needs no PATH probe; its profile carries the executable.
    const customIds = profiles
      .filter((profile) => profile.enabled && profile.agent === CUSTOM_AGENT_ID)
      .map((profile) => profile.agent);
    const ids = new Set<string>([
      ...installed,
      ...registry.map((agent) => agent.id),
      ...DEV_PANEL_AGENTS.map((agent) => agent.id),
      ...customIds,
    ]);
    return panel.filter((agent) => ids.has(agent.id));
  }, [installed, panel, profiles, registry]);
}

/** Display label for any known agent id, falling back to a capitalized id. */
export function agentLabel(id: AgentId): string {
  if (id === CUSTOM_AGENT_ID) return CUSTOM_AGENT_LABEL;
  const builtin = PANEL_AGENTS.find((agent) => agent.id === id);
  if (builtin) return builtin.label;
  return (
    usePreferencesStore
      .getState()
      .installedAcpAgents.find((agent) => agent.id === id)?.label ?? id
  );
}

/** Keeps probed ids in panel order and drops anything Agni no longer knows. */
export function orderKnownAgents(ids: readonly string[]): AgentId[] {
  const found = new Set(ids);
  const known = [
    ...PANEL_AGENTS,
    ...usePreferencesStore.getState().installedAcpAgents.map((agent) => ({
      id: agent.id,
      label: agent.label,
    })),
  ];
  return known
    .filter((agent) => found.has(agent.id))
    .map((agent) => agent.id);
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

async function detect(
  scope: string,
  workspace: WorkspaceEnv,
  force = false,
): Promise<void> {
  const cached = useAvailability.getState().scopes[scope];
  if (!force && cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return;
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
    // Health refresh: while a panel is mounted, re-probe on a slow interval so
    // an agent installed (or removed) in another window shows up.
    const timer = window.setInterval(() => {
      void detect(scope, workspace);
    }, 5 * 60_000);
    const onFocus = () => void detect(scope, workspace, true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [scope, workspace]);

  return ids;
}
