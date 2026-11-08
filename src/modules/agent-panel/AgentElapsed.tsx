import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgentTabStatus } from "./lib/agentTabStatus";
import { formatElapsed } from "./lib/elapsed";

/** Live busy time for a working tab; renders nothing otherwise. */
export function AgentElapsed({
  tabId,
  className,
}: {
  tabId: number;
  className?: string;
}) {
  const startedAt = useAgentTabStatus(
    (state) => state.tabs[tabId]?.startedAt ?? null,
  );
  const status = useAgentTabStatus(
    (state) => state.tabs[tabId]?.status ?? "idle",
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null || status !== "working") return null;
  return (
    <span aria-hidden className={cn("tabular-nums", className)}>
      {formatElapsed(startedAt, now)}
    </span>
  );
}
