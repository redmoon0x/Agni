import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TurnFile } from "@/modules/acp-agent/lib/turnFiles";

/** Files changed during one turn, with +/- totals and per-file diff links. */
export function AgentChangedFilesCard({
  files,
  onOpenDiff,
}: {
  files: TurnFile[];
  onOpenDiff?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const insertions = files.reduce((total, file) => total + file.insertions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const visible = expanded ? files : files.slice(0, 4);

  return (
    <div className="ml-7 rounded-md border border-border/50 bg-foreground/[0.015]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="text-[10.5px] font-medium">
          Changed {files.length} file{files.length === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-[9.5px] text-emerald-500">
          +{insertions}
        </span>
        <span className="font-mono text-[9.5px] text-destructive">
          -{deletions}
        </span>
        <span className="flex-1" />
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={11}
          className={cn(
            "text-muted-foreground/60 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      <div className="space-y-0.5 px-1 pb-1">
        {visible.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onOpenDiff?.(file.path)}
            disabled={!onOpenDiff}
            title={file.path}
            className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-[10px] transition-colors enabled:hover:bg-foreground/[0.05] disabled:cursor-default"
          >
            <span className="w-12 shrink-0 truncate text-[9px] text-muted-foreground/70 uppercase">
              {file.operation}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
            {file.insertions > 0 ? (
              <span className="shrink-0 font-mono text-[9px] text-emerald-500">
                +{file.insertions}
              </span>
            ) : null}
            {file.deletions > 0 ? (
              <span className="shrink-0 font-mono text-[9px] text-destructive">
                -{file.deletions}
              </span>
            ) : null}
          </button>
        ))}
        {files.length > visible.length ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:text-foreground"
          >
            and {files.length - visible.length} more
          </button>
        ) : null}
      </div>
    </div>
  );
}
