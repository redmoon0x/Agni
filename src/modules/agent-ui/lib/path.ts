export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function displayPath(path: string, cwd: string | null): string {
  if (!cwd) return path;
  const normalized = path.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root || normalized === root) return path;
  return normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : path;
}

/** Absolute on Windows (`C:\`, `C:/`) or POSIX (`/`), plus UNC (`\\`). */
export function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path);
}

/**
 * A tool location may be relative to the agent's cwd. File IO resolves a
 * relative path against the process cwd, not the workspace, so it must be made
 * absolute first. Returns the canonical forward-slash form.
 */
export function resolveToolPath(path: string, cwd: string | null): string {
  const normalized = path.replace(/\\/g, "/");
  if (isAbsolutePath(normalized)) return normalized;
  if (!cwd) return normalized;
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return normalized;
  return `${root}/${normalized.replace(/^\.?\//, "")}`;
}
