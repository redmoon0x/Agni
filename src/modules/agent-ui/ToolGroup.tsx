import { ArrowDown01Icon, Loading03Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import type { AgentToolStatus } from "@/modules/agent-ui/ToolRow";

/**
 * A narrated run of consecutive tool calls ("Read 14 files", "Ran 3 commands").
 * Collapsed by default; failures are surfaced on the header so a broken run is
 * never hidden behind the disclosure.
 */
export function AgentToolGroup({
  label,
  status,
  count,
  children,
}: {
  label: string;
  status: AgentToolStatus;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const failed = status === "error";
  const running = status === "running";

  return (
    <div className="group/run">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
          failed
            ? "border-destructive/30 bg-destructive/[0.04]"
            : "border-border/50 hover:border-border/80 hover:bg-foreground/[0.02]",
        )}
      >
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded border",
            failed
              ? "border-destructive/30 text-destructive"
              : "border-border/60 text-muted-foreground",
          )}
        >
          {running ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={11}
              className="animate-spin"
            />
          ) : failed ? (
            <HugeiconsIcon icon={Cancel01Icon} size={11} />
          ) : (
            <span className="size-1.5 rounded-full bg-current opacity-60" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">
          {label}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {count} steps
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={11}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="mt-1 ml-7 max-h-96 space-y-0.5 overflow-y-auto rounded-md border border-border/40 bg-background/40 p-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}
