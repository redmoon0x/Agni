import {
  Add01Icon,
  ArrowDown01Icon,
  ChartHistogramIcon,
  Chat01Icon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { AgentSessionRow } from "@/modules/agent-panel/AgentSessionRow";
import { useAgentTabStatus } from "@/modules/agent-panel/lib/agentTabStatus";
import {
  filterThreads,
  groupThreads,
  threadTitle,
  type ThreadGroup,
} from "@/modules/agent-panel/lib/threads";
import { orderThreadKeys, useThreadUiStore } from "@/modules/agent-panel/lib/threadUiStore";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";

type Props = {
  cwd: string | null;
  agentTabs: AgentTab[];
  activeTabId: number | null;
  onActivateTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  /** Reveals the agent panel and opens its harness picker. */
  onNewSession: () => void;
};

/**
 * T3-style thread switcher: every open conversation grouped by workspace, with
 * a live title, pinned rows first, and UI state (pins, renames, last visit,
 * folder collapse) persisted to localStorage. Harness and model selection live
 * inside the agent panel, so this list never duplicates those pickers.
 */
export function ThreadsSidebar({
  cwd,
  agentTabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onNewSession,
}: Props) {
  const [query, setQuery] = useState("");
  const titles = useAgentTabStatus((state) => state.tabs);
  const pinned = useThreadUiStore((state) => state.pinned);
  const customTitles = useThreadUiStore((state) => state.titles);
  const order = useThreadUiStore((state) => state.order);
  const collapsedFolders = useThreadUiStore((state) => state.collapsedFolders);
  const prune = useThreadUiStore((state) => state.prune);
  const toggleFolder = useThreadUiStore((state) => state.toggleFolder);

  const titleOf = useMemo(
    () => (tab: AgentTab) =>
      customTitles[tab.key] ??
      threadTitle({
        liveTitle: titles[tab.id]?.title ?? null,
        initialPrompt: tab.initialPrompt ?? null,
        fallback: tab.title,
      }),
    [customTitles, titles],
  );

  const keys = useMemo(() => agentTabs.map((tab) => tab.key), [agentTabs]);
  useEffect(() => {
    prune(keys);
  }, [keys, prune]);

  const groups = useMemo<ThreadGroup[]>(() => {
    const byKey = new Map(agentTabs.map((tab) => [tab.key, tab]));
    return groupThreads(agentTabs).map((group) => {
      const ordered = orderThreadKeys(
        group.tabs.map((tab) => tab.key),
        order,
        pinned,
      );
      return {
        ...group,
        tabs: ordered.flatMap((key) => {
          const tab = byKey.get(key);
          return tab ? [tab] : [];
        }),
      };
    });
  }, [agentTabs, order, pinned]);

  const visible = useMemo(
    () => filterThreads(groups, query, titleOf),
    [groups, query, titleOf],
  );
  const pinnedCount = useMemo(
    () => agentTabs.filter((tab) => pinned[tab.key]).length,
    [agentTabs, pinned],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-2.5">
        <span className="grid size-6 place-items-center rounded-md border border-border/50 bg-background/60 text-foreground/80">
          <HugeiconsIcon icon={Chat01Icon} size={13} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground/90">Threads</p>
          <p className="text-[11px] text-muted-foreground">
            {agentTabs.length} open
          </p>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Token usage"
          title="Token usage"
          onClick={() => void openSettingsWindow("usage")}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <HugeiconsIcon icon={ChartHistogramIcon} size={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="New thread"
          title="New thread"
          onClick={onNewSession}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Manage providers"
          title="Manage providers"
          onClick={() => void openSettingsWindow("providers")}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.8} />
        </button>
      </div>

      <div className="shrink-0 px-2 pt-2">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            strokeWidth={1.8}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter threads..."
            aria-label="Filter threads"
            className="w-full rounded-md border border-border/60 bg-background/60 py-1 pl-7 pr-2 text-[11px] outline-none placeholder:text-muted-foreground/60 focus:border-ring/50"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5">
        {agentTabs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-gradient-to-b from-foreground/[0.035] to-transparent px-4 py-5 text-center">
            <span className="mx-auto mb-2 grid size-9 place-items-center rounded-xl border border-border/50 bg-background/60 text-muted-foreground">
              <HugeiconsIcon icon={Chat01Icon} size={16} strokeWidth={1.6} />
            </span>
            <p className="text-[13px] font-medium text-foreground/90">
              No threads yet
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Pick a harness and model in the agent panel to start one.
            </p>
            <button
              type="button"
              onClick={onNewSession}
              className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
            >
              New thread
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            No thread matches "{query.trim()}".
          </p>
        ) : (
          visible.map((group) => {
            const collapsed = collapsedFolders.includes(group.key);
            return (
              <div key={group.key || "no-folder"} className="mb-3 last:mb-0">
                <button
                  type="button"
                  onClick={() => toggleFolder(group.key)}
                  aria-expanded={!collapsed}
                  className="group/folder flex w-full items-center gap-1.5 rounded px-1 pb-1 text-left text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <span
                    aria-hidden
                    className="inline-block transition-transform duration-150"
                    style={{
                      transform: collapsed ? "rotate(-90deg)" : "none",
                    }}
                  >
                    <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2} />
                  </span>
                  <span className="truncate">{group.label}</span>
                  <span className="tabular-nums text-muted-foreground/50">
                    {group.tabs.length}
                  </span>
                </button>
                {collapsed ? null : (
                  <div className="space-y-1">
                    {group.tabs.map((tab) => (
                      <AgentSessionRow
                        key={tab.id}
                        tab={tab}
                        active={tab.id === activeTabId}
                        title={titleOf(tab)}
                        onActivate={() => onActivateTab(tab.id)}
                        onClose={() => onCloseTab(tab.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {agentTabs.length} thread{agentTabs.length === 1 ? "" : "s"}
          {pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ""}
          {cwd ? "" : " · no folder"}
        </span>
        <button
          type="button"
          onClick={onNewSession}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon icon={Add01Icon} size={11} strokeWidth={1.8} />
          New thread
        </button>
      </div>
    </div>
  );
}
