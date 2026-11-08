import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { ACP_AGENTS, type AcpAgentDescriptor } from "@/modules/acp-agent/lib/agent";

/**
 * The Rust launch catalog (`acp_agents`). The typeScript mirror is authoritative
 * for first paint and icons; this round-trip exists so drift between the two is
 * caught instead of silently changing behavior per platform.
 */
export type AcpAgentCatalogEntry = Pick<
  AcpAgentDescriptor,
  "id" | "label" | "program" | "args" | "probeProgram"
>;

type CatalogState = {
  entries: Record<string, AcpAgentCatalogEntry> | null;
  setEntries: (entries: AcpAgentCatalogEntry[]) => void;
};

const useAgentCatalog = create<CatalogState>((set) => ({
  entries: null,
  setEntries: (entries) =>
    set({
      entries: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
    }),
}));

export function parseAcpAgentCatalog(value: unknown): AcpAgentCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.label !== "string" ||
      typeof record.program !== "string" ||
      typeof record.probeProgram !== "string"
    ) {
      return [];
    }
    return [
      {
        id: record.id,
        label: record.label,
        program: record.program,
        args: Array.isArray(record.args)
          ? record.args.filter((arg): arg is string => typeof arg === "string")
          : [],
        probeProgram: record.probeProgram,
      },
    ];
  });
}

/** Fetch the Rust catalog and remember it. Best effort: offline keeps the mirror. */
export async function syncAgentCatalog(): Promise<AcpAgentCatalogEntry[]> {
  try {
    const entries = parseAcpAgentCatalog(await invoke<unknown>("acp_agents"));
    if (entries.length > 0) useAgentCatalog.getState().setEntries(entries);
    return entries;
  } catch {
    return [];
  }
}

/** The Rust-side entry for an agent, when the catalog has been synced. */
export function agentCatalogEntry(id: string): AcpAgentCatalogEntry | null {
  return useAgentCatalog.getState().entries?.[id] ?? null;
}

/**
 * Differences between the TypeScript mirror and the Rust catalog. Empty in a
 * healthy build; used by the dev boot guard and by `agent.test.ts`.
 */
export function agentCatalogDrift(
  entries: readonly AcpAgentCatalogEntry[],
): string[] {
  const drift: string[] = [];
  const byId = new Map<string, AcpAgentDescriptor>(
    Object.values(ACP_AGENTS).map((agent) => [agent.id, agent]),
  );
  for (const entry of entries) {
    const mirrored = byId.get(entry.id);
    if (!mirrored) {
      drift.push(`rust-only agent: ${entry.id}`);
      continue;
    }
    if (mirrored.label !== entry.label) {
      drift.push(`${entry.id}: label ${mirrored.label} != ${entry.label}`);
    }
    if (mirrored.program !== entry.program) {
      drift.push(`${entry.id}: program ${mirrored.program} != ${entry.program}`);
    }
    if (mirrored.probeProgram !== entry.probeProgram) {
      drift.push(
        `${entry.id}: probeProgram ${mirrored.probeProgram} != ${entry.probeProgram}`,
      );
    }
    if (mirrored.args.join("\u0000") !== entry.args.join("\u0000")) {
      drift.push(`${entry.id}: args differ`);
    }
  }
  for (const mirrored of byId.values()) {
    if (!entries.some((entry) => entry.id === mirrored.id)) {
      drift.push(`ts-only agent: ${mirrored.id}`);
    }
  }
  return drift;
}
