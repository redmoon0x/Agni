/** Compact busy-time label: 12s, 3m, 2h. Null when the tab is not working. */
export function formatElapsed(
  startedAt: number | null,
  now = Date.now(),
): string | null {
  if (startedAt === null) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
