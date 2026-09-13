const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  INR: "₹",
};

const USED_KEYS = ["used", "tokens", "tokenCount", "current", "count", "value"];
const SIZE_KEYS = [
  "size",
  "limit",
  "max",
  "maximum",
  "total",
  "contextWindow",
  "capacity",
  "window",
];
const PERCENT_KEYS = ["percent", "percentage", "ratio", "fraction"];

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickNumber(
  source: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatCost(
  cost: number | undefined,
  currency = "USD",
): string | null {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return null;
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const amount = cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
  return `${symbol}${amount}`;
}

export function formatTokens(used: number, size: number): string {
  return `${formatCount(used)} / ${formatCount(size)}`;
}

/**
 * Context/token usage arrives in an implementation-defined shape (`unknown` in
 * Pi's stats). Extract only what is recognizable and render nothing otherwise,
 * so unknown wire shapes never leak a raw object into the UI.
 */
export function formatContextUsage(usage: unknown): string | null {
  if (typeof usage === "number" && Number.isFinite(usage)) {
    return `${formatCount(usage)} tokens`;
  }
  const object = asObject(usage);
  if (!object) return null;

  const used = pickNumber(object, USED_KEYS);
  const size = pickNumber(object, SIZE_KEYS);
  if (used !== null && size !== null && size > 0) {
    const percent = Math.round((used / size) * 100);
    return `${formatCount(used)} / ${formatCount(size)} (${percent}%)`;
  }
  if (used !== null) return `${formatCount(used)} tokens`;
  if (size !== null) return `context ${formatCount(size)}`;

  const percent = pickNumber(object, PERCENT_KEYS);
  if (percent !== null) {
    const whole = percent <= 1 ? percent * 100 : percent;
    return `${Math.round(whole)}% context`;
  }
  return null;
}
