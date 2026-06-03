import { Button } from "@/components/ui/button";
import { highlight, isHighlightable, type HighlightedNode } from "@/lib/codeHighlight";
import { CheckmarkCircle01Icon, CopyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Streamdown `components.pre` override. Handles fenced code blocks:
 * detects `language-X` from the child `<code>` element's className,
 * syntax-highlights via Lezer, and renders a chrome bar with copy button.
 */
export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  // Streamdown wraps fenced blocks as <pre><code class="language-X">...</code></pre>
  const codeEl = extractCodeElement(children);
  if (!codeEl) {
    return <pre className="not-prose my-2 overflow-x-auto rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">{children}</pre>;
  }

  const lang = codeEl.className?.match(/language-(\S+)/)?.[1] ?? null;
  const code = String(codeEl.children ?? "").replace(/\n$/, "");

  return (
    <div className="not-prose my-2 overflow-hidden rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {lang ?? "text"}
        </span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto">
        {lang && isHighlightable(lang) ? (
          <HighlightedPre code={code} lang={lang} />
        ) : (
          <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}

function extractCodeElement(node: ReactNode): { className?: string; children?: ReactNode } | null {
  if (!node || typeof node !== "object") return null;
  const el = node as { type?: string; props?: { className?: string; children?: ReactNode; originalType?: string } };
  if (el.type === "code" || el.props?.originalType === "code") return el.props ?? {};
  if (el.props?.children) {
    if (Array.isArray(el.props.children)) {
      for (const child of el.props.children) {
        const r = extractCodeElement(child);
        if (r) return r;
      }
    } else {
      return extractCodeElement(el.props.children);
    }
  }
  return null;
}

const HighlightedPre = memo(function HighlightedPre({ code, lang }: { code: string; lang: string }) {
  const [nodes, setNodes] = useState<HighlightedNode[] | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    let cancelled = false;
    highlight(code, lang)
      .then((result) => {
        if (cancelled || cancelRef.current) return;
        setNodes(result);
      })
      .catch(() => {
        if (cancelled) return;
        setNodes(null);
      });
    return () => {
      cancelled = true;
      cancelRef.current = true;
    };
  }, [code, lang]);

  if (!nodes) {
    return (
      <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
        {code}
      </pre>
    );
  }

  return (
    <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
      {nodes.map((node, i) =>
        node.kind === "break" ? (
          <span key={i}>{"\n"}</span>
        ) : (
          <span key={i} className={node.cls || undefined}>
            {node.value}
          </span>
        ),
      )}
    </pre>
  );
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(tRef.current), []);

  const onCopy = async () => {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      tRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch { /* swallow */ }
  };

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onCopy}
      className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label="Copy code"
    >
      <HugeiconsIcon icon={copied ? CheckmarkCircle01Icon : CopyIcon} size={11} strokeWidth={1.75} />
    </Button>
  );
}
