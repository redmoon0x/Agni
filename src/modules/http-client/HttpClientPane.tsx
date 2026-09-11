import {
  ApiIcon,
  ArrowDownIcon,
  CheckmarkCircle01Icon,
  CommandLineIcon,
  CopyIcon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type HighlightedNode, highlight } from "@/lib/codeHighlight";
import { cn } from "@/lib/utils";
import { usePreviewAnnotateDraftStore } from "@/modules/preview-annotate";
import { importCurl } from "./lib/curl";
import { type HttpHeader, type HttpMethod, useHttpRequest } from "./lib/http";

type Props = { title: string; url: string };

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const METHODS_WITH_BODY: HttpMethod[] = ["POST", "PUT", "PATCH"];

export function HttpClientPane({ url: initialUrl }: Props) {
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState(initialUrl);
  const [headers, setHeaders] = useState<HttpHeader[]>([]);
  const [body, setBody] = useState("");
  const [showHeaders, setShowHeaders] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlInput, setCurlInput] = useState("");
  const [curlError, setCurlError] = useState<string | null>(null);
  const setDraft = usePreviewAnnotateDraftStore((s) => s.setDraft);
  const { response, send } = useHttpRequest();

  const canSend = url.trim().length > 0 && !response.running;
  const showBody = METHODS_WITH_BODY.includes(method);

  const submit = () => {
    if (!canSend) return;
    void send({
      method,
      url: url.trim(),
      headers,
      body: showBody ? body : "",
    });
  };

  const applyCurl = () => {
    const result = importCurl(curlInput);
    if (!result) {
      setCurlError("Couldn't parse a curl command — check for a URL.");
      return;
    }
    setMethod(result.method);
    setUrl(result.url);
    setHeaders(result.headers);
    setBody(result.body);
    setShowHeaders(result.headers.length > 0);
    setCurlOpen(false);
    setCurlInput("");
    setCurlError(null);
  };

  const sendToPi = () => {
    if (!response.body && response.status === null) return;
    const headerLines = response.headers
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
    const statusLine =
      typeof response.status === "number"
        ? `${response.status} ${response.statusText}`
        : "";
    setDraft(
      [
        `HTTP response from ${method} ${url.trim()}`,
        statusLine ? `\nStatus: ${statusLine}` : "",
        response.latencyMs !== null ? ` (${response.latencyMs} ms)` : "",
        headerLines ? `\n\n${headerLines}` : "",
        response.body ? `\n\n${response.body}` : "",
      ].join(""),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Request bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as HttpMethod)}
          className="h-8 shrink-0 rounded-md border border-border bg-background px-1.5 text-[11px] font-semibold outline-none focus:border-ring"
          aria-label="HTTP method"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="https://api.example.com/endpoint"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-[11px] outline-none focus:border-ring"
          spellCheck={false}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setCurlError(null);
            setCurlOpen(true);
          }}
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          title="Import from curl"
          aria-label="Import from curl"
        >
          <HugeiconsIcon icon={CommandLineIcon} size={14} strokeWidth={1.75} />
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canSend}
          onClick={submit}
          className="h-8 shrink-0 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={SentIcon} size={12} strokeWidth={2} />
          Send
        </Button>
      </div>

      <CurlImportDialog
        open={curlOpen}
        onOpenChange={setCurlOpen}
        value={curlInput}
        onValueChange={setCurlInput}
        error={curlError}
        onImport={applyCurl}
      />

      {/* Headers toggle */}
      <div className="shrink-0 border-b border-border/60 px-3 py-1">
        <button
          type="button"
          onClick={() => setShowHeaders((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon
            icon={ArrowDownIcon}
            size={10}
            strokeWidth={2}
            className={cn("transition-transform", showHeaders && "rotate-180")}
          />
          Headers
          {headers.filter((h) => h.name.trim()).length > 0
            ? ` (${headers.filter((h) => h.name.trim()).length})`
            : ""}
        </button>
        {showHeaders ? (
          <div className="flex flex-col gap-1 py-1.5">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={h.name}
                  onChange={(e) => {
                    const current = headers[i];
                    if (!current) return;
                    const next = [...headers];
                    next[i] = { ...current, name: e.target.value };
                    setHeaders(next);
                  }}
                  placeholder="Header name"
                  className="h-6 w-32 rounded border border-border/70 bg-background px-1.5 text-[10px] outline-none focus:border-ring"
                />
                <input
                  value={h.value}
                  onChange={(e) => {
                    const current = headers[i];
                    if (!current) return;
                    const next = [...headers];
                    next[i] = { ...current, value: e.target.value };
                    setHeaders(next);
                  }}
                  placeholder="Value"
                  className="h-6 min-w-0 flex-1 rounded border border-border/70 bg-background px-1.5 font-mono text-[10px] outline-none focus:border-ring"
                />
                <button
                  type="button"
                  onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                  className="text-[10px] text-muted-foreground hover:text-destructive"
                  aria-label="Remove header"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setHeaders([...headers, { name: "", value: "" }])}
              className="self-start text-[10px] text-muted-foreground hover:text-foreground"
            >
              + Add header
            </button>
          </div>
        ) : null}
      </div>

      {/* Request body */}
      {showBody ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder='{ "key": "value" }'
          rows={3}
          className="mx-3 mt-2 shrink-0 resize-none rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10.5px] leading-relaxed outline-none focus:border-ring"
          spellCheck={false}
        />
      ) : null}

      {/* Response */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {response.status === "pending" ? (
          <p className="text-[11px] text-muted-foreground">
            Waiting for response...
          </p>
        ) : response.status === null && !response.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
              <HugeiconsIcon icon={ApiIcon} size={18} strokeWidth={1.5} />
            </div>
            <p className="text-[12px] font-medium text-muted-foreground">
              Make a request to see the response
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {response.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11px] text-destructive">
                {response.error}
              </div>
            ) : null}
            {response.body || typeof response.status === "number" ? (
              <ResponseActions
                onCopy={() => copyText(response.body)}
                onSendToPi={sendToPi}
                canSendToPi={Boolean(response.body)}
              />
            ) : null}
            {typeof response.status === "number" ? (
              <StatusBar
                status={response.status}
                statusText={response.statusText}
                latencyMs={response.latencyMs}
                headers={response.headers}
              />
            ) : null}
            {response.body ? (
              <ResponseBody body={response.body} headers={response.headers} />
            ) : null}
            {response.status === null && !response.error && response.running ? (
              <p className="text-[11px] text-muted-foreground">Sending...</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBar({
  status,
  statusText,
  latencyMs,
  headers,
}: {
  status: number;
  statusText: string;
  latencyMs: number | null;
  headers: [string, string][];
}) {
  const ok = status >= 200 && status < 300;
  const color = ok
    ? "text-emerald-600 dark:text-emerald-400"
    : status >= 400
      ? "text-destructive"
      : "text-amber-600 dark:text-amber-400";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
      <span className={cn("font-semibold", color)}>
        {status} {statusText}
      </span>
      <span className="text-muted-foreground">
        {latencyMs !== null ? `${latencyMs} ms` : ""}
      </span>
      <span className="text-muted-foreground">{headers.length} headers</span>
      <ResponseHeaders headers={headers} />
    </div>
  );
}

function ResponseHeaders({ headers }: { headers: [string, string][] }) {
  const [open, setOpen] = useState(false);
  if (headers.length === 0) return null;
  return (
    <div className="min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon
          icon={ArrowDownIcon}
          size={10}
          strokeWidth={2}
          className={cn("transition-transform", open && "rotate-180")}
        />
        details
      </button>
      {open ? (
        <div className="mt-1 space-y-0.5 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5">
          {headers.map(([name, value]) => (
            <div key={name} className="flex gap-2 text-[10px]">
              <span className="shrink-0 font-medium text-muted-foreground">
                {name}:
              </span>
              <span className="min-w-0 break-all text-foreground">{value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResponseBody({
  body,
  headers,
}: {
  body: string;
  headers: [string, string][];
}) {
  const contentType =
    headers.find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "";
  const isJson = contentType.includes("json") || looksLikeJson(body);
  const pretty = isJson ? prettyJson(body) : body;
  const lang = isJson ? "json" : "text";

  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {isJson ? "json" : "text"}
        </span>
        <CopyBodyButton text={body} />
      </div>
      <div className="max-h-96 overflow-auto">
        {lang === "json" ? (
          <HighlightedJson code={pretty} />
        ) : (
          <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground">
            {body}
          </pre>
        )}
      </div>
    </div>
  );
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function looksLikeJson(body: string): boolean {
  const trimmed = body.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

const HighlightedJson = memo(function HighlightedJson({
  code,
}: {
  code: string;
}) {
  const [nodes, setNodes] = useState<HighlightedNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlight(code, "json")
      .then((result) => {
        if (!cancelled) setNodes(result);
      })
      .catch(() => {
        if (!cancelled) setNodes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

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

function CopyBodyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(tRef.current), []);

  const onCopy = async () => {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      tRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="text-muted-foreground hover:text-foreground"
      aria-label="Copy response body"
    >
      <HugeiconsIcon
        icon={copied ? CheckmarkCircle01Icon : CopyIcon}
        size={11}
        strokeWidth={1.75}
      />
    </button>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* swallow */
  }
}

function ResponseActions({
  onCopy,
  onSendToPi,
  canSendToPi,
}: {
  onCopy: () => void;
  onSendToPi: () => void;
  canSendToPi: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(tRef.current), []);

  const copy = () => {
    onCopy();
    setCopied(true);
    tRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canSendToPi}
        onClick={onSendToPi}
        className="h-6 gap-1.5 px-2 text-[10px]"
        title="Send the response to Pi in the chat panel"
      >
        <HugeiconsIcon icon={SentIcon} size={11} strokeWidth={2} />
        Send to Pi
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={copy}
        className="h-6 gap-1.5 px-2 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon
          icon={copied ? CheckmarkCircle01Icon : CopyIcon}
          size={11}
          strokeWidth={1.75}
        />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function CurlImportDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  error,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  error: string | null;
  onImport: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from curl</DialogTitle>
        </DialogHeader>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{}'"
          rows={5}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-ring"
          spellCheck={false}
        />
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!value.trim()}
            onClick={onImport}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
