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
