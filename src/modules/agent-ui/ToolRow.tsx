import {
  ArrowDown01Icon,
  BookOpen01Icon,
  BrainIcon,
  Cancel01Icon,
  Delete02Icon,
  FolderTransferIcon,
  GlobeIcon,
  Loading03Icon,
  MinusSignIcon,
  PencilEdit02Icon,
  RefreshIcon,
  Search01Icon,
  SourceCodeIcon,
  Task01Icon,
  TerminalIcon,
  Tick02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type AgentToolStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "cancelled";

const KIND_ICONS: Record<string, typeof Wrench01Icon> = {
  read: BookOpen01Icon,
  edit: PencilEdit02Icon,
  delete: Delete02Icon,
  move: FolderTransferIcon,
  search: Search01Icon,
  execute: TerminalIcon,
  fetch: GlobeIcon,
  think: BrainIcon,
  task: Task01Icon,
  switch_mode: RefreshIcon,
};

const KIND_TONES: Record<string, string> = {
  read: "text-[var(--terminal-ansi-blue)]",
  edit: "text-[var(--terminal-ansi-yellow)]",
  delete: "text-[var(--terminal-ansi-red)]",
  move: "text-[var(--terminal-ansi-magenta)]",
  search: "text-[var(--terminal-ansi-cyan)]",
  execute: "text-[var(--terminal-ansi-green)]",
  fetch: "text-[var(--terminal-ansi-bright-blue)]",
  think: "text-[var(--terminal-ansi-magenta)]",
  task: "text-[var(--terminal-ansi-bright-yellow)]",
  switch_mode: "text-muted-foreground",
};

function ToolStatus({ status }: { status: AgentToolStatus }) {
  if (status === "running") {
    return (
      <HugeiconsIcon
        icon={Loading03Icon}
        size={12}
        className="mt-0.5 shrink-0 animate-spin text-primary"
      />
    );
  }
  if (status === "error") {
    return (
      <HugeiconsIcon
        icon={Cancel01Icon}
        size={12}
        className="mt-0.5 shrink-0 text-destructive"
      />
    );
  }
  if (status === "success") {
    return (
      <HugeiconsIcon
        icon={Tick02Icon}
        size={12}
        className="mt-0.5 shrink-0 text-muted-foreground/50"
      />
    );
  }
  if (status === "cancelled") {
    return (
      <HugeiconsIcon
        icon={MinusSignIcon}
        size={12}
        className="mt-0.5 shrink-0 text-muted-foreground/40"
      />
    );
  }
  return (
    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
  );
}

export function AgentToolRow({
  title,
  subtitle,
  kind,
  status,
  meta,
  detail,
  path,
  line,
  onOpenPath,
}: {
  title: string;
  subtitle?: string | null;
  kind: string;
  status: AgentToolStatus;
  meta?: string | null;
  detail?: ReactNode;
  path?: string | null;
  line?: number | null;
  onOpenPath?: (path: string, line?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = detail != null;
  const icon = KIND_ICONS[kind] ?? Wrench01Icon;

  return (
    <div className="group/tool rounded-md border border-transparent transition-colors hover:border-border/40 hover:bg-foreground/[0.02]">
      <div className="flex items-start gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={expandable ? () => setOpen((value) => !value) : undefined}
          aria-expanded={expandable ? open : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2 text-left",
            expandable ? "cursor-pointer" : "cursor-default",
          )}
        >
          <span
            className={cn(
              "mt-px grid size-5 shrink-0 place-items-center rounded border bg-background transition-colors",
              status === "error"
                ? "border-destructive/30 text-destructive"
                : cn(
                    "border-border/60",
                    KIND_TONES[kind] ?? "text-muted-foreground",
                  ),
            )}
          >
            <HugeiconsIcon icon={icon} size={11} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-[11px] font-medium text-foreground/85">
                {title}
              </span>
              {meta ? (
                <span
                  className="shrink-0 truncate font-mono text-[9px] text-muted-foreground/50"
                  title={meta}
                >
                  {meta}
                </span>
              ) : null}
            </span>
            {subtitle ? (
              <span
                className="mt-0.5 block truncate font-mono text-[9.5px] text-muted-foreground/70"
                title={subtitle}
              >
                {subtitle}
              </span>
            ) : null}
          </span>
        </button>
        {path && onOpenPath ? (
          <button
            type="button"
            onClick={() => onOpenPath(path, line ?? undefined)}
            title="Open in editor"
            aria-label="Open in editor"
            className="mt-px shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover/tool:opacity-100"
          >
            <HugeiconsIcon icon={SourceCodeIcon} size={12} strokeWidth={1.8} />
          </button>
        ) : null}
        <ToolStatus status={status} />
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Hide details" : "Show details"}
            aria-expanded={open}
            className="mt-px shrink-0 rounded p-1 text-muted-foreground transition-transform hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={11}
              className={cn(open && "rotate-180")}
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
      </div>
      {open && expandable ? (
        <div className="mr-2 mb-2 ml-7 overflow-hidden rounded-md border border-border/50 bg-background/60">
          {detail}
        </div>
      ) : null}
    </div>
  );
}
