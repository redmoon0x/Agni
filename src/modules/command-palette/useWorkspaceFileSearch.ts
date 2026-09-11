import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export const COMMAND_PALETTE_FILE_SEARCH_MIN_QUERY_LENGTH = 2;
const COMMAND_PALETTE_FILE_SEARCH_LIMIT = 50;
const COMMAND_PALETTE_FILE_SEARCH_DEBOUNCE_MS = 120;

export type CommandPaletteFileHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

type Params = {
  root: string | null;
  query: string;
  enabled: boolean;
  /** Minimum query length before a search fires. Defaults to the command
   * palette's 2-char gate; Pi's `@` mention passes 1 so a single letter
   * already shows candidates. */
  minQueryLength?: number;
  /** When true, an empty query lists files instead of returning nothing --
   * gives Pi's bare `@` mention an immediate starting list. */
  listOnEmpty?: boolean;
};

export function useWorkspaceFileSearch({
  root,
  query,
  enabled,
  minQueryLength = COMMAND_PALETTE_FILE_SEARCH_MIN_QUERY_LENGTH,
  listOnEmpty = false,
}: Params) {
  const [results, setResults] = useState<CommandPaletteFileHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  // A full workspace walk has no cancellation on the Rust side, so firing one
  // per keystroke lets several pile up concurrently on a large root (they all
  // eventually resolve, stalling results well behind what's currently typed).
  // Instead, keep at most one in flight and remember only the latest query
  // that arrived while busy, firing it the moment the current walk finishes.
  const inFlightRef = useRef(false);
  const pendingRef = useRef<{
    rootPath: string;
    q: string;
    requestId: number;
  } | null>(null);

  const applyHits = useCallback((hits: CommandPaletteFileHit[]) => {
    setResults(
      hits
        .filter((hit) => !hit.is_dir)
        .slice(0, COMMAND_PALETTE_FILE_SEARCH_LIMIT),
    );
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setResults([]);
    setSearching(false);
    setError(null);
  }, []);

  const runSearch = useCallback(
    (rootPath: string, q: string, requestId: number) => {
      if (inFlightRef.current) {
        pendingRef.current = { rootPath, q, requestId };
        return;
      }
      inFlightRef.current = true;
      const useSearch = q.length >= minQueryLength;
      const invokeArgs = {
        root: rootPath,
        limit: COMMAND_PALETTE_FILE_SEARCH_LIMIT,
        ...(useSearch ? { query: q } : {}),
      };
      const promise = useSearch
        ? invoke<{ hits: CommandPaletteFileHit[]; truncated: boolean }>(
            "fs_search",
            invokeArgs,
          ).then(({ hits }) => hits)
        : invoke<{ files: string[] }>("fs_list_files", invokeArgs).then(
            ({ files }) =>
              files.map(
                (rel): CommandPaletteFileHit => ({
                  path: `${rootPath}${rootPath.endsWith("/") || rootPath.endsWith("\\") ? "" : "/"}${rel}`,
                  rel,
                  name: rel.split(/[\\/]/).pop() ?? rel,
                  is_dir: false,
                }),
              ),
          );
      void promise
        .then((hits) => {
          if (requestId !== requestIdRef.current) return;
          applyHits(hits);
        })
        .catch((e) => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setError(String(e));
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setSearching(false);
          inFlightRef.current = false;
          const pending = pendingRef.current;
          if (pending) {
            pendingRef.current = null;
            runSearch(pending.rootPath, pending.q, pending.requestId);
          }
        });
    },
    [applyHits, minQueryLength],
  );

  const retry = useCallback(() => {
    const rootPath = root;
    const q = query.trim();
    if (!enabled || !rootPath) return;
    if (q.length < minQueryLength && !(listOnEmpty && q.length === 0)) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setSearching(true);
    setError(null);
    runSearch(rootPath, q, requestId);
  }, [enabled, listOnEmpty, minQueryLength, query, root, runSearch]);

  useEffect(() => {
    const q = query.trim();
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!enabled || !root) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    if (q.length < minQueryLength && !(listOnEmpty && q.length === 0)) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);
    setResults([]);

    const handle = window.setTimeout(() => {
      runSearch(root, q, requestId);
    }, COMMAND_PALETTE_FILE_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [enabled, listOnEmpty, minQueryLength, query, root, runSearch]);

  return { results, searching, error, reset, retry };
}
