import { BoundingBoxIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { RectPx } from "@/modules/preview-annotate";
import {
  AnnotationComposer,
  BRIDGE_SCRIPT_SOURCE,
  buildPrompt,
  isBridgeAlive,
  normalizeRect,
  requestResolve,
  SelectionOverlay,
  usePreviewAnnotateDraftStore,
} from "@/modules/preview-annotate";
import { currentWorkspaceEnv } from "@/modules/workspace";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

type Props = {
  path: string;
  visible: boolean;
};

function fileBaseHref(path: string): string | undefined {
  if (path.startsWith("/")) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    return `file://${encodeURI(dir)}`;
  }
  if (/^[A-Za-z]:\//.test(path)) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1).replace(/\\/g, "/");
    return `file:///${encodeURI(dir)}`;
  }
  if (/^[A-Za-z]:\\/.test(path)) {
    const dir = path.slice(0, path.lastIndexOf("\\") + 1).replace(/\\/g, "/");
    return `file:///${encodeURI(dir)}`;
  }
  return undefined;
}

function withBaseHref(content: string, href: string | undefined): string {
  const base = href ? `<base href="${href}">` : "";
  const bridge = `<script>${BRIDGE_SCRIPT_SOURCE}</script>`;
  const inject = `${base}${bridge}`;
  if (/<head\b[^>]*>/i.test(content)) {
    return content.replace(/<head\b[^>]*>/i, (match) => `${match}${inject}`);
  }
  return `${inject}${content}`;
}

export function HtmlPreviewPane({ path, visible }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [annotating, setAnnotating] = useState(false);
  const [selection, setSelection] = useState<{
    rect: RectPx;
    selector: string;
    label: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const setDraft = usePreviewAnnotateDraftStore((s) => s.setDraft);

  useEffect(() => {
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
  }, [path]);

  useEffect(() => {
    if (visible) setAnnotating(false);
  }, [visible]);

  const srcDoc = useMemo(
    () =>
      status.kind === "ready"
        ? withBaseHref(status.content, fileBaseHref(path))
        : "",
    [path, status],
  );

  const measureContainer = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    containerSizeRef.current = { width: rect.width, height: rect.height };
  }, []);

  const handleSelect = useCallback(
    (rect: RectPx) => {
      measureContainer();
      const size = containerSizeRef.current;
      const region = normalizeRect(rect, size);
      const iframe = iframeRef.current;
      void isBridgeAlive(iframe).then((alive) => {
        if (alive) {
          void requestResolve(iframe, rect).then((result) => {
            if (result?.selector) {
              setSelection({
                rect,
                selector: result.selector,
                label: result.selector,
              });
              return;
            }
            setSelection({
              rect,
              selector: "",
              label: `${region.x}%–${region.x + region.width}% × ${region.y}%–${region.y + region.height}%`,
            });
          });
        } else {
          setSelection({
            rect,
            selector: "",
            label: `${region.x}%–${region.x + region.width}% × ${region.y}%–${region.y + region.height}%`,
          });
        }
      });
    },
    [measureContainer],
  );

  const handleSubmit = useCallback(
    (instruction: string) => {
      if (!selection) return;
      setDraft(
        buildPrompt(
          {
            kind: "html",
            filePath: path,
            selector: selection.selector || selection.label,
            label: selection.label,
          },
          instruction,
        ),
      );
      setSelection(null);
      setAnnotating(false);
    },
    [path, selection, setDraft],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      {status.kind === "ready" ? (
        <div className="relative min-h-0 flex-1">
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            title="HTML Preview"
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer"
          />
          <button
            type="button"
            title={annotating ? "Stop annotating (Esc)" : "Annotate for Pi"}
            aria-pressed={annotating}
            onClick={() => {
              setAnnotating((value) => !value);
              setSelection(null);
            }}
            className={cn(
              "absolute top-2 right-2 z-20 flex size-7 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground",
              annotating && "border-primary bg-primary/10 text-primary",
            )}
          >
            <HugeiconsIcon
              icon={BoundingBoxIcon}
              size={14}
              strokeWidth={1.75}
            />
          </button>
          <SelectionOverlay
            enabled={annotating}
            onSelect={handleSelect}
            onCancel={() => {
              setAnnotating(false);
              setSelection(null);
            }}
          />
          {selection ? (
            <AnnotationComposer
              anchor={selection.rect}
              containerSize={containerSizeRef.current}
              targetLabel={selection.label}
              onCancel={() => setSelection(null)}
              onSubmit={handleSubmit}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4">
          {status.kind === "loading" && (
            <p className="text-[12px] text-muted-foreground">Loading...</p>
          )}
          {status.kind === "error" && (
            <p className="text-[12px] text-destructive">
              Failed to read file: {status.message}
            </p>
          )}
          {status.kind === "binary" && (
            <p className="text-[12px] text-muted-foreground">
              Binary file - cannot render as HTML.
            </p>
          )}
          {status.kind === "toolarge" && (
            <p className="text-[12px] text-muted-foreground">
              File is {status.size} bytes; limit {status.limit}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
