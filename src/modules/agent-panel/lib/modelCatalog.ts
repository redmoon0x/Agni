import { isRecord, isText } from "@/modules/agent-panel/lib/record";
import type { AgentId } from "@/modules/settings/store";

/** One entry of a harness model catalog, shaped like ACP `ModelInfo`. */
export type CatalogModel = {
  id: string;
  name: string;
  description?: string;
  groupId?: string;
  groupName?: string;
};

export type ModelCatalogEntry = {
  /** When a session or probe last reported this catalog. */
  at: number;
  models: CatalogModel[];
};

/** Catalogs older than this are refreshed before they are trusted. */
export const MODEL_CATALOG_TTL_MS = 10 * 60_000;

/** One catalog per harness account: the same agent can hold several accounts. */
export function modelCatalogKey(
  agent: AgentId,
  profileId: string | null | undefined,
): string {
  return `${agent}:${profileId ?? ""}`;
}

export function isModelCatalogFresh(
  entry: ModelCatalogEntry | null | undefined,
  now: number = Date.now(),
): boolean {
  return (
    !!entry &&
    entry.models.length > 0 &&
    now - entry.at >= 0 &&
    now - entry.at < MODEL_CATALOG_TTL_MS
  );
}

/** Newest report wins per id; known ids keep their position so rows do not jump. */
export function mergeModelCatalog(
  previous: ModelCatalogEntry | null | undefined,
  next: readonly CatalogModel[],
  now: number = Date.now(),
): ModelCatalogEntry {
  if (!previous || previous.models.length === 0) {
    return { at: now, models: [...next] };
  }
  const byId = new Map(previous.models.map((model) => [model.id, model]));
  for (const model of next) byId.set(model.id, model);
  return { at: now, models: [...byId.values()] };
}

function parseModel(value: unknown): CatalogModel | null {
  if (!isRecord(value)) return null;
  if (!isText(value.id) || !isText(value.name)) return null;
  return {
    id: value.id,
    name: value.name,
    ...(isText(value.description) ? { description: value.description } : {}),
    ...(isText(value.groupId) ? { groupId: value.groupId } : {}),
    ...(isText(value.groupName) ? { groupName: value.groupName } : {}),
  };
}

/** Decode the persisted catalog; anything malformed or empty is dropped. */
export function parseModelCatalog(
  value: unknown,
): Record<string, ModelCatalogEntry> {
  if (!isRecord(value)) return {};
  const out: Record<string, ModelCatalogEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
    if (!Array.isArray(entry.models)) continue;
    const models = entry.models.flatMap((model) => {
      const parsed = parseModel(model);
      return parsed ? [parsed] : [];
    });
    if (models.length > 0) out[key] = { at, models };
  }
  return out;
}

/** Last model the user picked per harness account, restored on the next tab. */
export function parseModelPreferences(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, model] of Object.entries(value)) {
    if (isText(model)) out[key] = model;
  }
  return out;
}