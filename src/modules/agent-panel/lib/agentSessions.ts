import { isAcpAgentId } from "@/modules/acp-agent/lib/agent";
import { isAbsolutePath } from "@/modules/acp-agent/lifecycle";
import type { AgentId } from "@/modules/settings/store";
import type { WorkspaceEnv } from "@/modules/workspace";

/** One open agent session, persisted so the panel survives an app restart. */
export type AgentSessionRecord = {
  /** Stable tab key (agent + cwd + workspace + profile + model). */
  key: string;
  agent: AgentId;
  profileId: string | null;
  cwd: string | null;
  workspace: WorkspaceEnv;
  initialModel: string | null;
};

export type AgentSessionsPref = {
  sessions: AgentSessionRecord[];
  activeKey: string | null;
};

/** Matches ACP_MAX_SESSIONS so a restore never queues doomed spawns. */
export const MAX_AGENT_SESSIONS = 8;

export const EMPTY_AGENT_SESSIONS: AgentSessionsPref = {
  sessions: [],
  activeKey: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAgent(value: unknown): AgentId | null {
  if (typeof value !== "string" || !value || value.length > 64) return null;
  if (value === "pi" || isAcpAgentId(value)) return value as AgentId;
  return null;
}

function parseWorkspace(value: unknown): WorkspaceEnv | null {
  if (!isRecord(value)) return null;
  if (value.kind === "local") return { kind: "local" };
  if (
    value.kind === "wsl" &&
    typeof value.distro === "string" &&
    value.distro.trim() &&
    value.distro.length <= 100
  ) {
    return { kind: "wsl", distro: value.distro.trim() };
  }
  return null;
}

function parseRecord(value: unknown): AgentSessionRecord | null {
  if (!isRecord(value)) return null;
  const agent = parseAgent(value.agent);
  const workspace = parseWorkspace(value.workspace);
  if (!agent || !workspace) return null;
  if (typeof value.key !== "string" || !value.key || value.key.length > 500) {
    return null;
  }
  const cwd = typeof value.cwd === "string" ? value.cwd : null;
  if (cwd !== null && (!isAbsolutePath(cwd) || cwd.length > 1_000)) return null;
  const profileId =
    typeof value.profileId === "string" && value.profileId.length <= 128
      ? value.profileId
      : null;
  const initialModel =
    typeof value.initialModel === "string" && value.initialModel.length <= 200
      ? value.initialModel
      : null;
  return { key: value.key, agent, profileId, cwd, workspace, initialModel };
}

/** Decode the persisted session list; anything malformed is dropped. */
export function parseAgentSessions(value: unknown): AgentSessionsPref {
  if (!isRecord(value)) return EMPTY_AGENT_SESSIONS;
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
        .flatMap((entry) => {
          const record = parseRecord(entry);
          return record ? [record] : [];
        })
        // Guard against a corrupted file; the planner applies the real cap.
        .slice(0, 50)
    : [];
  const activeKey =
    typeof value.activeKey === "string" && value.activeKey.length <= 500
      ? value.activeKey
      : null;
  return { sessions, activeKey };
}

/**
 * Restore planner: keep the newest 8 unique tabs, drop records whose profile
 * no longer exists, and keep the active key only if it survived.
 */
export function planAgentSessionRestore(
  pref: AgentSessionsPref,
  profiles: readonly { id: string }[],
): { records: AgentSessionRecord[]; dropped: number } {
  const seen = new Set<string>();
  const records: AgentSessionRecord[] = [];
  for (const record of pref.sessions) {
    if (records.length >= MAX_AGENT_SESSIONS) break;
    if (seen.has(record.key)) continue;
    if (
      record.profileId !== null &&
      !profiles.some((profile) => profile.id === record.profileId)
    ) {
      continue;
    }
    seen.add(record.key);
    records.push(record);
  }
  return { records, dropped: pref.sessions.length - records.length };
}
