import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import { baseName } from "@/modules/agent-ui/lib/path";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import { AgentElapsed } from "./AgentElapsed";
import { AgentStatusDot } from "./AgentStatusDot";
import { useAgentTabStatus } from "./lib/agentTabStatus";
import { handleAgentRowNavigation } from "./lib/rovingFocus";

type Props = {
  tab: AgentTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
};

/** One open session in the Agents list. */
export function AgentSessionRow({ tab, active, onActivate, onClose }: Props) {
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  const entry = useAgentTabStatus((state) => state.tabs[tab.id]);
  const status = entry?.status ?? "idle";
  const unread = entry?.unread ?? 0;
  const profile = tab.profileId
    ? (profiles.find((candidate) => candidate.id === tab.profileId) ?? null)
    : null;
  const profileLabel = profile?.label ?? "Default";
  const label = `${tab.title}${tab.profileId ? ` · ${profileLabel}` : ""}`;
  const busy = status === "working" || status === "waiting";

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
      <button
        type="button"
        data-agent-row
        onClick={onActivate}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            requestClose();
          }
        }}
        onKeyDown={(event) => {
          handleAgentRowNavigation(event);
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            requestClose();
          }
        }}
        aria-current={active ? "page" : undefined}
        title={`${label} — ${statusText}`}
        className="min-w-0 flex-1 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground/90">
            {tab.title}
          </span>
          <span className="min-w-0 flex-1" />
          <AgentStatusDot status={status} unread={unread} />
          <AgentElapsed
            tabId={tab.id}
            className="text-[11px] font-medium text-primary/90"
          />
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
      <button
        type="button"
        onClick={requestClose}
        aria-label={`Close ${label}`}
        title="Close agent"
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-70"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
      </button>
    </div>
  );
}
