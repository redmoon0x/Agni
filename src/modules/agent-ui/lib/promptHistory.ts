const STORAGE_PREFIX = "agni.promptHistory.";
const MAX_ENTRIES = 50;

type Cursor = { index: number; draft: string };

const cursors = new Map<string, Cursor>();

function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}${sessionKey}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPromptHistory(sessionKey: string): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(storageKey(sessionKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Remember a sent prompt. Consecutive duplicates are collapsed. */
export function recordPrompt(sessionKey: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const store = storage();
  if (!store) return;
  const entries = readPromptHistory(sessionKey);
  if (entries[entries.length - 1] === trimmed) {
    cursors.delete(sessionKey);
    return;
  }
  entries.push(trimmed);
  const capped = entries.slice(-MAX_ENTRIES);
  try {
    store.setItem(storageKey(sessionKey), JSON.stringify(capped));
  } catch {
    /* quota or disabled storage: recall is best effort */
  }
  cursors.delete(sessionKey);
}

export function clearPromptHistory(sessionKey: string): void {
  cursors.delete(sessionKey);
  storage()?.removeItem(storageKey(sessionKey));
}

/**
 * Step through history. The first `prev` snapshots the unsent draft, and
 * stepping past the newest entry restores it. Returns null when there is no
 * history to move through.
 */
export function recallPrompt(
  sessionKey: string,
  current: string,
  direction: "prev" | "next",
): string | null {
  const entries = readPromptHistory(sessionKey);
  if (entries.length === 0) return null;
  let cursor = cursors.get(sessionKey);
  if (!cursor) {
    cursor = { index: entries.length, draft: current };
  }
  if (direction === "prev") {
    cursor.index = Math.max(0, cursor.index - 1);
  } else {
    cursor.index = Math.min(entries.length, cursor.index + 1);
  }
  cursors.set(sessionKey, cursor);
  return cursor.index >= entries.length ? cursor.draft : entries[cursor.index];
}

export function resetPromptHistoryCursor(sessionKey: string): void {
  cursors.delete(sessionKey);
}
