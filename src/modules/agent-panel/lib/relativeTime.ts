const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age like T3's sidebar: "now", "5m", "3h", "2d", then an ISO date. */
export function formatRelativeTime(
  timestamp: number | null,
  now: number = Date.now(),
): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "";
  const delta = now - timestamp;
  if (delta < 0) return "now";
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
