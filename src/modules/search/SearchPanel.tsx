import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { PathIcon } from "@/modules/explorer/lib/PathIcon";

type GrepHit = { path: string; rel: string; line: number; text: string };
type GrepResponse = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;
const MAX_RESULTS = 200;

type Props = {
  rootPath: string | null;
  onOpenResult: (path: string, line: number) => void;
};

function highlightMatch(text: string, query: string, caseSensitive: boolean) {
  const idx = caseSensitive
    ? text.indexOf(query)
    : text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[2px] bg-primary/25 text-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchPanel({ rootPath, onOpenResult }: Props) {
  const [query, setQuery] = useState("");
  const [includeGlob, setIncludeGlob] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hits, setHits] = useState<GrepHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = query.trim().length >= MIN_QUERY_LEN;

  useEffect(() => {
    if (!active || !rootPath) {
      setHits([]);
      setTruncated(false);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    let alive = true;
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<GrepResponse>("fs_grep", {
          pattern: query,
          root: rootPath,
          glob: includeGlob.trim() ? [includeGlob.trim()] : undefined,
          case_insensitive: !caseSensitive,
          max_results: MAX_RESULTS,
          workspace: currentWorkspaceEnv(),
        });
        if (!alive) return;
        setHits(res.hits);
        setTruncated(res.truncated);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setHits([]);
        setTruncated(false);
        setError(String(e));
      } finally {
        if (alive) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [query, includeGlob, caseSensitive, rootPath, active]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byPath = new Map<string, GrepHit[]>();
    for (const hit of hits) {
      const existing = byPath.get(hit.path);
      if (existing) {
        existing.push(hit);
      } else {
        byPath.set(hit.path, [hit]);
        order.push(hit.path);
      }
    }
    return order.flatMap((path) => {
      const pathHits = byPath.get(path);
      const first = pathHits?.[0];
      if (!pathHits || !first) return [];
      return [{ path, rel: first.rel, hits: pathHits }];
    });
  }, [hits]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1 px-2 py-1.5">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={2}
            className="absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files…"
            className="h-7 pr-14 pl-6.5 text-xs"
          />
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
            <button
              type="button"
              aria-pressed={caseSensitive}
              title="Match Case"
              onClick={() => setCaseSensitive((v) => !v)}
              className={cn(
                "rounded px-1 py-0.5 text-[10px] font-semibold",
                caseSensitive
                  ? "bg-primary/20 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              Aa
            </button>
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        </div>
        <Input
          value={includeGlob}
          onChange={(e) => setIncludeGlob(e.target.value)}
          placeholder="files to include (e.g. *.ts)"
          className="h-6 text-[11px]"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1">
          {!rootPath ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              Open a folder to search.
            </div>
          ) : !active ? null : error ? (
            <div className="px-3 py-2 text-[11px] text-destructive">
              {error}
            </div>
          ) : searching && hits.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              Searching…
            </div>
          ) : groups.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              No matches
            </div>
          ) : (
            groups.map((group) => {
              const url = fileIconUrl(group.rel.split(/[/\\]/).pop() ?? "");
              return (
                <div key={group.path} className="mb-1">
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-foreground/85"
                    title={group.path}
                  >
                    <PathIcon url={url} className="size-3.5" />
                    <span className="truncate">{group.rel}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {group.hits.length}
                    </span>
                  </div>
                  {group.hits.map((hit) => (
                    <button
                      key={`${hit.path}:${hit.line}`}
                      type="button"
                      onClick={() => onOpenResult(hit.path, hit.line)}
                      className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-xs text-foreground/70 hover:bg-accent/50 hover:text-foreground"
                    >
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {hit.line}
                      </span>
                      <span className="truncate whitespace-pre">
                        {highlightMatch(hit.text.trim(), query, caseSensitive)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
          {truncated && groups.length > 0 ? (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
              Showing partial results — refine your query.
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
