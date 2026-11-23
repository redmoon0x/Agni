import {
  Cancel01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import { baseName } from "@/modules/agent-ui/lib/path";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import { AgentElapsed } from "./AgentElapsed";
import { AgentStatusDot } from "./AgentStatusDot";
import { useAgentTabStatus } from "./lib/agentTabStatus";
import { formatRelativeTime } from "./lib/relativeTime";
import { handleAgentRowNavigation } from "./lib/rovingFocus";
import { useThreadUiStore } from "@/modules/agent-panel/lib/threadUiStore";

type Props = {
  tab: AgentTab;
  active: boolean;
  /** Resolved label (custom name, harness title, or prompt). */
  title: string;
  onActivate: () => void;
  onClose: () => void;
};

/** One open thread in the Threads list. */
export function AgentSessionRow({ tab, active, title, onActivate, onClose }: Props) {
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  const entry = useAgentTabStatus((state) => state.tabs[tab.id]);
  const status = entry?.status ?? "idle";
  const unread = entry?.unread ?? 0;
  const lastVisitedAt = useThreadUiStore((state) => state.lastVisitedAt[tab.key] ?? null);
  const isPinned = useThreadUiStore((state) => state.pinned[tab.key] === true);
  const setPinned = useThreadUiStore((state) => state.setPinned);
  const setTitle = useThreadUiStore((state) => state.setTitle);
  const profile = tab.profileId
    ? (profiles.find((candidate) => candidate.id === tab.profileId) ?? null)
    : null;
  const profileLabel = profile?.label ?? "Default";
  const label = `${title}${tab.profileId ? ` · ${profileLabel}` : ""}`;
  const busy = status === "working" || status === "waiting";

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const startRename = () => {
    setDraft(title);
    setRenaming(true);
  };
  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === title) return;
    setTitle(tab.key, next);
  };
  const cancelRename = () => setRenaming(false);

  const statusText =
    status === "working"
      ? "Working"
      : status === "waiting"
        ? "Waiting for you"
        : status === "error"
          ? "Failed"
          : unread > 0
            ? "Done"
            : "Idle";
  const statusTone =
    status === "working"
      ? "text-primary"
      : status === "waiting"
        ? "text-amber-500"
        : status === "error"
          ? "text-destructive"
          : unread > 0
            ? "text-emerald-500"
            : "text-muted-foreground/60";

  const requestClose = () => {
    if (
      busy &&
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(
        `${label} is still ${status === "working" ? "working" : "waiting for input"}. Closing stops this session.`,
      )
    ) {
      return;
    }
    onClose();
  };

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2 rounded-lg border py-1.5 pr-1 pl-2 transition-colors",
        active
          ? "border-primary/30 bg-primary/[0.08]"
          : "border-transparent hover:bg-foreground/[0.035]",
      )}
    >
      {active ? (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
      ) : null}
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border/50 bg-background/60 text-foreground/85">
        <AgentIcon agent={tab.agent} size={13} />
      </span>
      {renaming ? (
        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
            aria-label="Thread title"
            className="w-full rounded-sm border border-border/60 bg-background/70 px-1.5 py-0.5 text-[13px] font-medium text-foreground outline-none focus:border-ring/60"
          />
          <span className="mt-0.5 flex items-center gap-1 text-[11px]">
            <span
              className="max-w-24 shrink-0 truncate rounded border border-border/50 bg-foreground/[0.03] px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground"
              title={profile?.accountLabel ?? profile?.label ?? "Default profile"}
            >
              {profileLabel}
            </span>
            <span className="truncate text-muted-foreground">
              {tab.cwd ? baseName(tab.cwd) : "No folder"}
            </span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          data-agent-row
          onClick={onActivate}
          onDoubleClick={startRename}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              requestClose();
            }
          }}
          onKeyDown={(event) => {
            handleAgentRowNavigation(event);
            if (event.key === "F2") {
              event.preventDefault();
              startRename();
              return;
            }
            if (event.key === "Delete" || event.key === "Backspace") {
              event.preventDefault();
              requestClose();
            }
          }}
          aria-current={active ? "page" : undefined}
          title={`${label} — ${statusText} (double-click to rename)`}
          className="min-w-0 flex-1 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="flex items-center gap-1.5">
            {isPinned ? (
              <HugeiconsIcon
                icon={PinIcon}
                size={11}
                strokeWidth={1.8}
                className="shrink-0 text-muted-foreground/70"
                aria-label="Pinned"
              />
            ) : null}
            <span className="truncate text-[13px] font-medium text-foreground/90">
              {title}
            </span>
            <span className="min-w-0 flex-1" />
            <AgentStatusDot status={status} unread={unread} />
            <AgentElapsed
              tabId={tab.id}
              className="text-[11px] font-medium text-primary/90"
            />
            {status !== "working" && lastVisitedAt !== null ? (
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
                {formatRelativeTime(lastVisitedAt)}
              </span>
            ) : null}
            {unread > 0 ? (
              <span className="rounded-full bg-primary/15 px-1 text-[10px] font-medium tabular-nums text-primary">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px]">
            <span
              className="max-w-24 shrink-0 truncate rounded border border-border/50 bg-foreground/[0.03] px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground"
              title={profile?.accountLabel ?? profile?.label ?? "Default profile"}
            >
              {profileLabel}
            </span>
            <span className="truncate text-muted-foreground">
              {tab.cwd ? baseName(tab.cwd) : "No folder"}
            </span>
            {tab.initialModel ? (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span
                  className="max-w-24 truncate text-muted-foreground"
                  title={tab.initialModel}
                >
                  {tab.initialModel}
                </span>
              </>
            ) : null}
            <span className="text-muted-foreground/30">·</span>
            <span className={cn("shrink-0 font-medium", statusTone)}>
              {statusText}
            </span>
          </span>
        </button>
      )}
      {!renaming ? (
        <span className="mt-0.5 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setPinned(tab.key, !isPinned)}
            aria-label={isPinned ? `Unpin ${label}` : `Pin ${label}`}
            title={isPinned ? "Unpin thread" : "Pin thread"}
            className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-70"
          >
            <HugeiconsIcon
              icon={isPinned ? PinOffIcon : PinIcon}
              size={10}
              strokeWidth={2}
            />
          </button>
          <button
            type="button"
            onClick={requestClose}
            aria-label={`Close ${label}`}
            title="Close thread"
            className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-70"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
          </button>
        </span>
      ) : null}
    </div>
  );
}
