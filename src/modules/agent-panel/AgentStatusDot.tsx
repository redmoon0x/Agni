import { cn } from "@/lib/utils";
import type { AgentTabRunStatus } from "@/modules/agent-panel/lib/agentTabStatus";

/**
 * Compact agent state indicator shared by the tab bar and the agents sidebar.
 * Working pulses, waiting is amber, errors are destructive, and a finished
 * background tab shows a muted unread dot.
 */
export function AgentStatusDot({
  status,
  unread,
  className,
}: {
  status: AgentTabRunStatus;
  unread: number;
  className?: string;
}) {
  if (status === "working") {
    return (
      <span
        role="status"
        aria-label="Agent working"
        title="Working"
        className={cn(
          "size-1.5 shrink-0 animate-pulse rounded-full bg-primary",
          className,
        )}
      />
    );
  }
  if (status === "waiting") {
    return (
      <span
        role="status"
        aria-label="Agent needs input"
        title="Needs your input"
        className={cn("size-1.5 shrink-0 rounded-full bg-amber-500", className)}
      />
    );
  }
  if (status === "error") {
    return (
      <span
        role="status"
        aria-label="Agent error"
        title="Error"
        className={cn("size-1.5 shrink-0 rounded-full bg-destructive", className)}
      />
    );
  }
  if (unread > 0) {
    return (
      <span
        role="status"
        aria-label="New agent activity"
        title="New activity"
        className={cn("size-1.5 shrink-0 rounded-full bg-primary/70", className)}
      />
    );
  }
  return null;
}

export function agentStatusLabel(
  status: AgentTabRunStatus,
  unread: number,
): string {
  if (status === "working") return "Working";
  if (status === "waiting") return "Needs input";
  if (status === "error") return "Error";
  if (unread > 0) return "Finished";
  return "Idle";
}
