import { baseName } from "@/modules/agent-ui/lib/path";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";

const MAX_THREAD_TITLE = 72;

function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? "").trim();
}

function truncate(text: string): string {
  return text.length > MAX_THREAD_TITLE
    ? `${text.slice(0, MAX_THREAD_TITLE - 1).trimEnd()}...`
    : text;
}

/**
 * A thread's sidebar label. The harness's own session title wins, then the
 * prompt a fanout tab was seeded with, then the bare harness name.
 */
export function threadTitle(input: {
  liveTitle: string | null;
  initialPrompt?: string | null;
  fallback: string;
}): string {
  const live = input.liveTitle?.trim();
  if (live) return truncate(firstLine(live));
  const prompt = input.initialPrompt?.trim();
  if (prompt) return truncate(firstLine(prompt));
  return input.fallback;
}

export type ThreadGroup = {
  /** Normalized directory key. */
  key: string;
  label: string;
  tabs: AgentTab[];
};

function normalizeDir(value: string | null): string {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** One group per working directory, in first-seen order, threads kept in order. */
export function groupThreads(
  tabs: readonly AgentTab[],
  cwdOf: (tab: AgentTab) => string | null = (tab) => tab.cwd,
): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  const byKey = new Map<string, ThreadGroup>();
  for (const tab of tabs) {
    const cwd = cwdOf(tab);
    const key = normalizeDir(cwd);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: cwd ? baseName(cwd) : "No folder", tabs: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.tabs.push(tab);
  }
  return groups;
}

export function filterThreads(
  groups: readonly ThreadGroup[],
  query: string,
  titleOf: (tab: AgentTab) => string,
): ThreadGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) =>
        `${titleOf(tab)} ${tab.agent}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.tabs.length > 0);
}
