export const THREAD_UI_STORAGE_KEY = "agni:thread-ui:v1";

/**
 * UI-only thread state, persisted to localStorage. Thread identity is the tab's
 * stable `key` (agent + cwd + workspace + profile + model), never the numeric
 * tab id, which is reassigned on every launch.
 */
export type ThreadUiState = {
  /** Pinned thread keys; pinned rows sort above the rest. */
  pinned: Record<string, boolean>;
  /** User-renamed titles, overriding the harness's live title. */
  titles: Record<string, string>;
  /** Last time a thread was opened, in epoch ms; drives the Done state. */
  lastVisitedAt: Record<string, number>;
  /** Most-recently-used order, newest first. */
  order: string[];
  /** Collapsed workspace folders, by normalized directory key. */
  collapsedFolders: string[];
};

export const EMPTY_THREAD_UI_STATE: ThreadUiState = {
  pinned: {},
  titles: {},
  lastVisitedAt: {},
  order: [],
  collapsedFolders: [],
};

const MAX_ORDER = 500;
const MAX_TITLE = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key && entry === true) out[key] = true;
  }
  return out;
}

function parseTitleRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || typeof entry !== "string") continue;
    const title = entry.trim();
    if (title) out[key] = title.slice(0, MAX_TITLE);
  }
  return out;
}

function parseTimestampRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key && typeof entry === "number" && Number.isFinite(entry) && entry >= 0) {
      out[key] = entry;
    }
  }
  return out;
}

function parseKeyArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/** Decode the persisted payload; anything malformed is dropped, never thrown. */
export function parseThreadUiState(value: unknown): ThreadUiState {
  if (!isRecord(value)) return EMPTY_THREAD_UI_STATE;
  return {
    pinned: parseBooleanRecord(value.pinned),
    titles: parseTitleRecord(value.titles),
    lastVisitedAt: parseTimestampRecord(value.lastVisitedAt),
    order: parseKeyArray(value.order).slice(0, MAX_ORDER),
    collapsedFolders: parseKeyArray(value.collapsedFolders),
  };
}

/** Move `key` to the front of the MRU order, trimming to the cap. */
export function touchOrder(order: readonly string[], key: string): string[] {
  if (!key) return [...order];
  return [key, ...order.filter((entry) => entry !== key)].slice(0, MAX_ORDER);
}

export function setPinned(state: ThreadUiState, key: string, pinned: boolean): ThreadUiState {
  if (!key) return state;
  const has = state.pinned[key] === true;
  if (has === pinned) return state;
  const next = { ...state.pinned };
  if (pinned) next[key] = true;
  else delete next[key];
  return { ...state, pinned: next };
}

export function setTitle(state: ThreadUiState, key: string, title: string | null): ThreadUiState {
  if (!key) return state;
  const trimmed = title?.trim().slice(0, MAX_TITLE) ?? "";
  if ((state.titles[key] ?? "") === trimmed) return state;
  const next = { ...state.titles };
  if (trimmed) next[key] = trimmed;
  else delete next[key];
  return { ...state, titles: next };
}

export function markVisited(
  state: ThreadUiState,
  key: string,
  at: number = Date.now(),
): ThreadUiState {
  if (!key) return state;
  const previous = state.lastVisitedAt[key] ?? 0;
  if (previous >= at) return state;
  return {
    ...state,
    lastVisitedAt: { ...state.lastVisitedAt, [key]: at },
    order: touchOrder(state.order, key),
  };
}

export function toggleFolder(
  state: ThreadUiState,
  folderKey: string,
  collapsed?: boolean,
): ThreadUiState {
  if (!folderKey) return state;
  const isCollapsed = state.collapsedFolders.includes(folderKey);
  const next = collapsed ?? !isCollapsed;
  if (next === isCollapsed) return state;
  return {
    ...state,
    collapsedFolders: next
      ? [...state.collapsedFolders, folderKey]
      : state.collapsedFolders.filter((entry) => entry !== folderKey),
  };
}

/** Drop entries for keys that no longer exist so the payload cannot grow forever. */
export function pruneToKeys(
  state: ThreadUiState,
  keys: readonly string[],
): ThreadUiState {
  const live = new Set(keys);
  const keep = <T>(record: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(record)) {
      if (live.has(key)) out[key] = value;
    }
    return out;
  };
  return {
    pinned: keep(state.pinned),
    titles: keep(state.titles),
    lastVisitedAt: keep(state.lastVisitedAt),
    order: state.order.filter((key) => live.has(key)),
    collapsedFolders: state.collapsedFolders,
  };
}
