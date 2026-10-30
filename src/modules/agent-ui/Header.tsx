import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AgentSubtitleTone =
  | "default"
  | "primary"
  | "destructive"
  | "warning";

export type AgentRunStatus =
  | "ready"
  | "working"
  | "waiting"
  | "starting"
  | "error"
  | "stopped"
  | "idle";

const PILL: Partial<
  Record<AgentRunStatus, { label: string; tone: string; dot: string }>
> = {
  working: {
    label: "Working",
    tone: "border-primary/25 bg-primary/[0.07] text-primary",
    dot: "animate-pulse bg-primary",
  },
  waiting: {
    label: "Waiting",
    tone: "border-primary/35 bg-primary/10 text-primary",
    dot: "bg-primary",
  },
  starting: {
    label: "Starting",
    tone: "border-border bg-foreground/[0.03] text-muted-foreground",
    dot: "animate-pulse bg-muted-foreground",
  },
  error: {
    label: "Error",
    tone: "border-destructive/30 bg-destructive/[0.06] text-destructive",
    dot: "bg-destructive",
  },
  stopped: {
    label: "Stopped",
    tone: "border-border bg-foreground/[0.02] text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

export function AgentStatusPill({ status }: { status: AgentRunStatus }) {
  const pill = PILL[status];
  if (!pill) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[9px] font-medium tracking-wide uppercase",
        pill.tone,
      )}
    >
      <span className={cn("size-1.5 rounded-full", pill.dot)} />
      {pill.label}
    </span>
  );
}

export function AgentIconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AgentHeader({
  picker,
  mark,
  label,
  status,
  subtitle,
  subtitleTitle,
  subtitleTone = "default",
  meta,
  actions,
}: {
  picker?: ReactNode;
  mark: ReactNode;
  label: string;
  status: AgentRunStatus;
  subtitle: string;
  subtitleTitle?: string;
  subtitleTone?: AgentSubtitleTone;
  meta?: string | null;
  actions?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-border/60 px-2.5">
      <div className="flex h-7 items-center gap-2">
        {picker ?? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border/50 bg-background/50">
              {mark}
            </span>
            <span className="truncate text-[11px] font-semibold tracking-wide uppercase">
              {label}
            </span>
          </span>
        )}
        <AgentStatusPill status={status} />
        <span className="min-w-0 flex-1" />
        {actions ? (
          <span className="flex shrink-0 items-center gap-0.5">{actions}</span>
        ) : null}
      </div>
      <div className="flex h-4 items-center gap-1.5 pb-0.5 text-[10px] leading-none">
        <span
          className={cn(
            "min-w-0 truncate",
            subtitleTone === "default" && "text-muted-foreground",
            subtitleTone === "primary" && "text-primary",
            subtitleTone === "destructive" && "text-destructive",
            subtitleTone === "warning" && "text-amber-500",
          )}
          title={subtitleTitle ?? subtitle}
        >
          {subtitle}
        </span>
        {meta ? (
          <>
            <span className="shrink-0 text-muted-foreground/30">·</span>
            <span
              className="shrink-0 truncate text-muted-foreground/60 tabular-nums"
              title={meta}
            >
              {meta}
            </span>
          </>
        ) : null}
      </div>
    </header>
  );
}
