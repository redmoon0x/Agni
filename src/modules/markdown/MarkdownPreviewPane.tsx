import { cn } from "@/lib/utils";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { InlineCode, MarkdownCodeBlock } from "./MarkdownCodeBlock";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "suspended" }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

const SUSPEND_AFTER_MS = 30_000;

type Props = {
  path: string;
  visible: boolean;
};

const components = { code: InlineCode, pre: MarkdownCodeBlock };

export function MarkdownPreviewPane({ path, visible }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "suspended" });

  useEffect(() => {
    if (!visible) {
      const timer = window.setTimeout(
        () => setStatus({ kind: "suspended" }),
        SUSPEND_AFTER_MS,
      );
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    setStatus({ kind: "loading" });
    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          setStatus({ kind: "ready", content: res.content });
        } else if (res.kind === "binary") {
          setStatus({ kind: "binary" });
        } else {
          setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, visible]);

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <div className="flex-1 overflow-auto px-6 py-4">
        {status.kind === "loading" && (
          <p className="text-[12px] text-muted-foreground">Loading...</p>
        )}
        {status.kind === "suspended" && (
          <p className="text-[12px] text-muted-foreground">Preview suspended</p>
        )}
        {status.kind === "error" && (
          <p className="text-[12px] text-destructive">
            Failed to read file: {status.message}
          </p>
        )}
        {status.kind === "binary" && (
          <p className="text-[12px] text-muted-foreground">
            Binary file -- cannot render as markdown.
          </p>
        )}
        {status.kind === "toolarge" && (
          <p className="text-[12px] text-muted-foreground">
            File is {status.size} bytes; limit {status.limit}.
          </p>
        )}
        {status.kind === "ready" && (
          <Streamdown
            className="select-text prose-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            components={components}
          >
            {status.content}
          </Streamdown>
        )}
      </div>
    </div>
  );
}
