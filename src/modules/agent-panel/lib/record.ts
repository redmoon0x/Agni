/** Shared guards for persisted preference payloads (settings store, catalogs). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}