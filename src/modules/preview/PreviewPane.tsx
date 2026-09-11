import {
  Alert02Icon,
  BoundingBoxIcon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import type { RectPx } from "@/modules/preview-annotate";
import {
  AnnotationComposer,
  buildPrompt,
  normalizeRect,
  SelectionOverlay,
  usePreviewAnnotateDraftStore,
} from "@/modules/preview-annotate";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
};

// Tear the iframe down after this much invisibility — a background dev
// server page can hold hundreds of MB inside the WebView.
const SUSPEND_AFTER_MS = 30_000;

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ url, visible, onUrlChange }, ref) {
    // `nonce` is part of the iframe `key`. Bumping it remounts the iframe,
    // which is the only reliable cross-origin reload (calling
    // contentWindow.location.reload() throws on cross-origin frames).
    const [nonce, setNonce] = useState(0);
    const [loaded, setLoaded] = useState(visible);
    const [annotating, setAnnotating] = useState(false);
    const [selection, setSelection] = useState<RectPx | null>(null);
    const addressRef = useRef<PreviewAddressBarHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const containerSizeRef = useRef({ width: 0, height: 0 });
    const setDraft = usePreviewAnnotateDraftStore((s) => s.setDraft);

    useEffect(() => {
      if (visible) {
        setLoaded(true);
        return;
      }
      const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
      return () => clearTimeout(t);
    }, [visible]);

    useEffect(() => {
      if (visible) setAnnotating(false);
    }, [visible]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          setLoaded(true);
          setNonce((n) => n + 1);
        },
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => url,
      }),
      [url],
    );

    const handleSelect = useCallback((rect: RectPx) => {
      const node = containerRef.current;
      if (!node) return;
      const bounds = node.getBoundingClientRect();
      containerSizeRef.current = {
        width: bounds.width,
        height: bounds.height,
      };
      setSelection(rect);
    }, []);

    const handleSubmit = useCallback(
      (instruction: string) => {
        if (!selection) return;
        const region = normalizeRect(selection, containerSizeRef.current);
        setDraft(
          buildPrompt(
            {
              kind: "url",
              url,
              region,
            },
            instruction,
          ),
        );
        setSelection(null);
        setAnnotating(false);
      },
      [selection, setDraft, url],
    );

    const showXfoHint = url ? !isLocalUrl(url) : false;

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <PreviewAddressBar
          ref={addressRef}
          url={url}
          onSubmit={onUrlChange}
          onReload={() => setNonce((n) => n + 1)}
        />
        {showXfoHint ? (
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-amber-500/8 px-3 text-[11px] text-amber-600 dark:text-amber-400">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={12}
              strokeWidth={1.75}
              className="shrink-0"
            />
            <span className="truncate">
              Many public sites refuse to embed (X-Frame-Options). If the page
              is blank, open it externally.
            </span>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className={
            url
              ? "relative min-h-0 flex-1 bg-white"
              : "relative min-h-0 flex-1 bg-background"
          }
        >
          {url ? (
            loaded ? (
              <>
                <iframe
                  key={`${url}#${nonce}`}
                  src={url}
                  title="Preview"
                  className="h-full w-full border-0"
                  // sandbox grants the bare minimum for a dev preview: scripts,
                  // same-origin (cookies/storage for the previewed app), forms,
                  // popups for "open in new tab". Critically OMITS
                  // `allow-top-navigation*` — without it the iframe cannot
                  // navigate the parent Tauri webview to an attacker origin,
                  // which would otherwise expose `window.__TAURI__` IPC.
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                  referrerPolicy="no-referrer"
                  allow="clipboard-read; clipboard-write; fullscreen"
                />
                <button
                  type="button"
                  title={
                    annotating ? "Stop annotating (Esc)" : "Annotate for Pi"
                  }
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
                    anchor={selection}
                    containerSize={containerSizeRef.current}
                    targetLabel={url}
                    onCancel={() => setSelection(null)}
                    onSubmit={handleSubmit}
                  />
                ) : null}
              </>
            ) : (
              <SuspendedState
                onReload={() => {
                  setLoaded(true);
                  setNonce((n) => n + 1);
                }}
              />
            )
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    );
  },
);

function SuspendedState({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium text-foreground">
          Preview suspended
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
          Released to free memory after sitting in the background.
        </p>
      </div>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-border/60 bg-card px-3 py-1 text-[11px] hover:bg-accent/50"
      >
        Reload
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          Nothing to preview yet
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Type a URL above, or open the{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">
            Ports
          </span>{" "}
          dropdown to jump straight to your running dev server. Public sites
          often block embedding — open them in your browser via the link icon if
          you see a blank page.
        </p>
      </div>
    </div>
  );
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "[::1]" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
