import type { AcpSessionConfig } from "@/modules/acp-agent/types";
import { workspaceScopeKey } from "@/modules/workspace";

export type SerialQueue = {
  enqueue: <T>(task: () => Promise<T>) => Promise<T>;
};

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path);
}

export function isPathWithinRoots(path: string, roots: readonly string[]): boolean {
  if (!isAbsolutePath(path)) return false;
  const candidate = normalizePath(path);
  return roots.some((root) => {
    const normalized = normalizePath(root.trim());
    return (
      normalized.length > 0 &&
      (candidate === normalized || candidate.startsWith(`${normalized}/`))
    );
  });
}

export function parseDirectoryList(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const directory = item.trim();
    if (!directory || !isAbsolutePath(directory)) continue;
    const key = normalizePath(directory);
    if (seen.has(key)) continue;
    seen.add(key);
    directories.push(directory);
    if (directories.length >= limit) break;
  }
  return directories;
}

export function sameSessionConfig(
  a: AcpSessionConfig | null,
  b: AcpSessionConfig | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.agent === b.agent &&
    normalizePath(a.cwd) === normalizePath(b.cwd) &&
    workspaceScopeKey(a.workspace) === workspaceScopeKey(b.workspace)
  );
}

/** Resolves when the promise settles or when the budget expires. Never rejects. */
export function settleWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(settle, settle);
  });
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
